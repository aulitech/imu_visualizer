// ota.js

// OTA (Over-The-Air) update module using WebHID feature reports

const OTA_FR = {
  id: 6,
  write: {
    length: 244,
    headerLength: 5, // 0:0x00, 1:0xFF, 2:msgType, 3:lenLSB, 4:lenMSB
    msgTypeIndex: 2,
    lenIndex: 3,
    maxData: 244 - 5,
  },
  // Incoming feature reports include a 6-byte header in the returned DataView:
  // [0]=reportId, [1]=0x00, [2]=0xFF, [3]=msgType, [4]=lenLSB, [5]=lenMSB, then payload
  read: {
    headerLength: 6,
    msgTypeIndex: 3,
    lenIndex: 4,
    maxData: 244 - 6,
  },
};

// Report IDs
const OTA_CONTROL = 6;
const SENSOR_STREAM = 7;
const PRACTICE = 8;
const HEARTBEAT = 10;
const STATUS = 9;

const max = Math.max;
const min = Math.min;

// Current connected device

let device = null;
let onDisconnect = null;
let onStatus = null;
let onSensor = null;
let onPractice = null;

let lastRow = {
  ts: Number.MAX_VALUE,
  dt: 0,
  latched: 0,
  count: 0,
  action: 0,
  trigger: "",
  latchedLabel: "",
  nonNull: 0,
  gestures: [],
};

const otaDisconnectHandler = (event) => {
  console.log(
    "HID Device disconnected: event: ",
    event.device,
    "device: ",
    device,
  );
  if (event.device === device) {
    ota.close().catch(() => {});
  }
};
let lastStatus = 0;
const handleStatus = async (data) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const gesture = view.getUint8(0);
  const action = view.getUint8(1);
  const status = view.getUint8(2);
  const conIdx = view.getUint8(3);
  const fullStatus = view.getUint32(0, true);

  const newStatus = {
    conIdx: conIdx,
    profileName:
      device?.config?.profiles?.[conIdx]?.name || `Profile ${conIdx + 1}`,
    gesture: device?.info?.gesture_list[gesture]?.label || "",
    action: device?.config?.global_info?.action_list[action]?.label || "",
    hbLost: (status & 0x80) !== 0,
    deepSleep: (status & 0x40) !== 0,
    unsavedChanges: (status & 0x20) !== 0,
    pointerSleep: (status & 0x10) !== 0,
    scrolling: (status & 0x08) !== 0,
    practice: (status & 0x04) !== 0,
    holdTilIdle: (status & 0x02) !== 0,
    dwellClick: (status & 0x01) !== 0,
  };

  // Log status changes
  if (fullStatus !== lastStatus) {
    console.log("OTA Status Report: ", newStatus);
    lastStatus = fullStatus;
  }
  // Send Heartbeat before updating status

  const ack = new Uint8Array([0x00]);
  await device.sendReport(HEARTBEAT, ack).catch((err) => {
    console.error("Error sending Heartbeat ack: ", String(err));
    // ignore error
  });

  // Update status callback
  onStatus(newStatus);
};

const handleSensorReport = (data) => {
  const SensorSample = {
    // Note: swapped x,y,z to match device & three.js orientations
    ts: data.getUint32(0, true),
    acc: {
      y: data.getFloat32(4, true),
      z: data.getFloat32(8, true),
      x: data.getFloat32(12, true),
    },
    gyro: {
      y: -data.getFloat32(16, true),
      z: -data.getFloat32(20, true),
      x: data.getFloat32(24, true),
    },
  };
  onSensor(SensorSample);
};

const getInfo = () => device?.info ?? {};

const handlePracticeReport = (data) => {
  // Handle practice report data
  // bytes 0-3: timestamp
  // byte 4: latched
  // bytes 5-end: gesture index,confidence,threshold as  16-bit value
  //
  // grab the gestures as 16 bit values
  const gestureResults = new Uint16Array(data.buffer.slice(5)).filter(
    (x) => (x & 0x7f00) > 0, // filter out 0 confidence
  );

  if (gestureResults.length < 1) {
    console.log("Invalid input report. No gesture data");
    return;
  }

  const ts = data.getUint32(0, true);
  const latched = data.getUint8(4);
  const dt =
    latched === 0 && lastRow.latched < 2 //transition to idle
      ? 0 // reset dt to 0
      : ts - lastRow.ts > 0 // not a transition to idle
        ? ts - lastRow.ts + lastRow.dt // calculate delta time
        : 0;

  const gestureNames = device?.info?.gesture_list ?? [];
  const inference = {
    ts: ts,
    dt: dt,
    latched: latched,
    count: 1,
    action: null,
    latchedLabel: gestureNames[latched] || "Unknown",
    // sum the confidence of all gestures
    nonNull: Array.from(
      gestureResults,
      (x) => (x & 0x00ff) > 1 && (x & 0x7f00) >> 8, // skip "Idle" and "Movement"
    ).reduce((total, g) => total + g, 0),
    gestures: Array.from(gestureResults, (x) => {
      return {
        label: gestureNames[x & 0x00ff] || "Unknown",
        confidence: (x & 0x7f00) >> 8,
        threshold: (x & 0x8000) > 0,
      };
    }),
  };

  // For repeated inferences, update count
  if (
    lastRow?.latched === inference.latched && // repeated
    JSON.stringify(lastRow.gestures) === JSON.stringify(inference.gestures)
  ) {
    //console.log("handleIR: ignoring duplicate", inference.latched, inference.nonNull);
    lastRow.count += 1;
    lastRow.dt = inference.dt;
    delete lastRow.trigger;
    onPractice(lastRow);
    //console.log("IR: updated inference ", gestureHistory.length);
    return;
  }

  if (inference.latched === 0) {
    if (lastRow?.latched > 1) {
      // transition to idle,trigger action
      const profile = device.config.profiles[device.info.conn_idx];
      inference.action = profile.gesture.bindings[lastRow.latched];
      inference.trigger = lastRow.latchedLabel;
    }
  }

  lastRow = inference;
  onPractice(inference);
};

function otaReportHandler(event) {
  if (event.device !== device) {
    console.warn("Received report from unknown device: ", event.device);
    return;
  }
  if (event.reportId === SENSOR_STREAM) console.log("[ota] sensor stream report received");
  switch (event.reportId) {
    case SENSOR_STREAM:
      handleSensorReport(event.data);
      break;
    case STATUS:
      handleStatus(event.data);
      break;
    case PRACTICE:
      handlePracticeReport(event.data);
      break;
    default:
      console.warn("Unknown Input Report ID: ", event.reportId);
      break;
  }
}

async function connect(
  statusSetter,
  disconnectHandler,
  sensorHandler,
  practiceHandler,
) {
  const filters = [{ vendorId: 0x1915, productId: 0x52dd }];

  try {
    const devices = await navigator.hid.requestDevice({ filters });
    if (devices.length === 0) {
      throw new Error("No device selected");
    }

    device = devices[0];

    await device.open();
    console.log("Device opened: ", device);

    onDisconnect = disconnectHandler;
    onSensor = sensorHandler;
    onPractice = practiceHandler;
    onStatus = statusSetter;
    navigator.hid.addEventListener("disconnect", otaDisconnectHandler);
    device.removeEventListener("inputreport", otaReportHandler);
    device.addEventListener("inputreport", otaReportHandler);

    device.info = {};
    device.config = { global_info: {}, profiles: [] };

    // Load device info, grabbing the profile index to set initial status

    try {
      device.info = await send("init");
    } catch (e) {
      console.error("Error during device initialization: ", String(e));
      // retry after a short delay
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    let recoveryRetry = 0;
    while (!device.info.version && recoveryRetry < 15) {
      try {
        device.info = await processFR(device); // this is a recovery attempt to get info if init command failed, it could hang
      } catch (e) {
        console.error("Error during initialization recovery: ", String(e));
        // retry after a short delay
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      recoveryRetry += 1;
      console.log(`Initialization attempt (${recoveryRetry})`, device.info);
    }

    if (!device.info.version) {
      throw new Error(
        "Failed to initialize device after multiple attempts. Reset Cato and try again.",
      );
    }

    const initialStatus = new Uint8Array([
      0x00,
      0x00,
      0x00,
      device.info.conn_idx ?? 0,
    ]);

    // Load global info
    device.config.global_info = await send("config get /global_info");

    // Load profiles

    let i = 0;
    while (i < 20) {
      // max 20 profiles, avoid infinite loop
      try {
        device.config.profiles[i] = await send(`config get /profiles/${i}`);
        i += 1;
      } catch {
        console.log("End of profiles at index ", i);
        break; // no more profiles  - exit loop
      }
    }

    handleStatus(initialStatus); // reset status display after reading profiles
    return device;
  } catch (error) {
    console.error("Error connecting to device: ", error);
    close(device).catch(() => {});
    throw error;
  }
}

async function close() {
  if (!device) return;

  if (device.opened) {
    await device.forget().catch((err) => {
      device = null;
      throw new Error(`Error closing device: ${String(err)}`);
    });
  }

  console.log("Device closed: ", device);
  onDisconnect(null);
  device = null;
  onDisconnect = null;
}

async function processFR(device) {
  if (!device) throw new Error("No connected device");
  if (!device.opened) throw new Error("Device not opened");

  const ACK = new Uint8Array([0x00, 0xff, 0x02, 0x00, 0x00]);
  const NACK = new Uint8Array([0x00, 0xff, 0x03, 0x00, 0x00]);
  void ACK;
  void NACK; // reserved for future use

  let remaining = 1;
  const reportResponse = { error: null, data: "" };
  const decoder = new TextDecoder();

  while (remaining > 0) {
    const dv = await device.receiveFeatureReport(OTA_FR.id).catch((err) => {
      throw new Error(`Error receiving feature report: ${String(err)}`);
    });

    // 5 bytes of header then payload:  0x00, 0xFF, msgType, lenLSB, lenMSB, payload
    const MTYPES = [
      "FIRST",
      "MID",
      "ACK_NRSP",
      "ACK_RSP",
      "NACK",
      "EMPTY",
      "RESULT",
    ];
    const payloadOffset = OTA_FR.read.headerLength;
    const payloadView = new Uint8Array(
      dv.buffer,
      dv.byteOffset + payloadOffset,
      Math.max(0, dv.byteLength - payloadOffset),
    );
    let data = decoder.decode(payloadView);
    const reportLength = dv.getUint16(OTA_FR.read.lenIndex, true);
    const msgType = dv.getUint8(OTA_FR.read.msgTypeIndex);
    data = data.slice(0, min(reportLength, data.length));
    remaining = 0;

    switch (msgType) {
      case 0: // FIRST
      case 1: // MID
        remaining = max(0, reportLength - data.length);
        reportResponse.data += data;
        break;
      case 2: // ACK_NRSP
        break;
      case 3: // ACK_RSP
        remaining = 1;
        break;
      case 4: // NACK
        reportResponse.error = data;
        break;
      case 5: // EMPTY
        reportResponse.error = "Empty response from device.";
        break;
      case 6: // RESULT
        reportResponse.data = data;
        break;
      default:
        reportResponse.error = `Unknown message type: ${String(msgType)}`;
        break;
    }
/*
    console.log(
      "OTA received Msg Type " +
        MTYPES[msgType] +
        " (" +
        reportLength +
        ":" +
        remaining +
        ") " +
        reportResponse.error,
    );*/
  }

  if (reportResponse.data.length > 0) {
    try {
      reportResponse.data = JSON.parse(reportResponse.data);
    } catch (e) {
      throw new Error("Error parsing JSON response: " + String(e));
    }
  }

  if (reportResponse.error) {
    otaSendLock = false;

    if (reportResponse.error.toLowerCase().includes("found null node")) {
      remaining = 0; // stop waiting for more data
      console.warn("OTA Warning: Found null node.");
    } else {
      console.error("OTA Error in report response: ", reportResponse.error);
    }
    throw new Error(reportResponse.error);
  }
  return reportResponse.data;
}

let otaSendLock = false;

async function send(data) {
  const err = !device
    ? "No connected device"
    : !device.opened
      ? "Device not opened"
      : !data
        ? "No data"
        : otaSendLock
          ? "Send in progress"
          : undefined;
  if (err) {
    console.error(err);
    throw new Error(err);
  }

  otaSendLock = true;

  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(data);

  // Send in multiple packets if necessary.
  // Each packet payload length <= OTA_FR.write.maxData, with msgType 0 (FIRST) then 1 (MID) for remaining chunks.
  let offset = 0;
  let chunkIndex = 0;
  console.log("OTA Sending: ", data);
  while (offset < uint8Array.length) {
    const remaining = uint8Array.length - offset;
    const chunkLen = Math.min(OTA_FR.write.maxData, remaining);
    const msgType = chunkIndex === 0 ? 0x00 : 0x01; // FIRST, then MID

    const featureReport = new Uint8Array(OTA_FR.write.length).fill(0);
    // Header: [0x00, 0xFF, msgType, lenLSB, lenMSB]
    featureReport.set(
      [0x00, 0xff, msgType, remaining & 0xff, (remaining >> 8) & 0xff],
      0,
    );
    featureReport.set(
      uint8Array.slice(offset, offset + chunkLen),
      OTA_FR.write.headerLength,
    );

    /*
    console.log(
      `OTA Sending chunk ${chunkIndex}: `,
      data.slice(offset, offset + chunkLen)
      );
    */

    try {
      await device.sendFeatureReport(OTA_FR.id, featureReport);
    } catch (e) {
      otaSendLock = false;
      throw new Error(`Error sending feature report: ${String(e)}`);
    }

    offset += chunkLen;
    chunkIndex += 1;
  }

  const res = await processFR(device).catch((err) => {
    otaSendLock = false;
    throw new Error(`Error processing feature report: ${String(err)}`);
  });

  console.log("OTA Response: ", res);
  otaSendLock = false;
  return res;
}

const ota = { connect, close, send, getInfo };
export default ota;
