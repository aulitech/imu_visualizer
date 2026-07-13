// useWebHID.js — WebHID hook for the Cato IMU stream.
//
// Connects via WebHID (works over USB or Bluetooth Classic HID).
// Sends "sensor_stream on/off" using the same OTA feature-report protocol
// as mc3, then forwards parsed sensor samples to the onSample callback.
//
// Sensor input report (ID 7) layout — all Float32, little-endian:
//   bytes  0- 3: timestamp
//   bytes  4- 7: acc.y
//   bytes  8-11: acc.z
//   bytes 12-15: acc.x
//   bytes 16-19: gyro.y  (negated)
//   bytes 20-23: gyro.z  (negated)
//   bytes 24-27: gyro.x

import { useState, useCallback, useRef } from "react";

const VENDOR_ID   = 0x1915;
const PRODUCT_ID  = 0x52dd;
const OTA_ID      = 6;
const SENSOR_ID   = 7;
const STATUS_ID   = 9;
const HEARTBEAT_ID = 10;
const REPORT_LEN  = 244;

const OTA_WRITE_HEADER_LEN = 5; // [0]=0x00, [1]=0xFF, [2]=msgType, [3]=lenLSB, [4]=lenMSB
const OTA_WRITE_MAX_DATA   = REPORT_LEN - OTA_WRITE_HEADER_LEN;
const OTA_READ_HEADER_LEN  = 6; // [0]=reportId, [1]=0x00, [2]=0xFF, [3]=msgType, [4]=lenLSB, [5]=lenMSB
const OTA_READ_MSGTYPE_IDX = 3;
const OTA_READ_LEN_IDX     = 4;

// Writes a text command to the device, splitting it across multiple feature
// reports (msgType FIRST, then MID) if it's longer than one report can hold.
async function writeOtaCommand(device, command) {
  const payload = new TextEncoder().encode(command);
  let offset = 0;
  let chunkIndex = 0;

  while (offset < payload.length) {
    const remaining = payload.length - offset;
    const chunkLen  = Math.min(OTA_WRITE_MAX_DATA, remaining);
    const msgType   = chunkIndex === 0 ? 0x00 : 0x01; // FIRST, then MID

    const report = new Uint8Array(REPORT_LEN).fill(0);
    report.set([0x00, 0xFF, msgType, remaining & 0xFF, (remaining >> 8) & 0xFF], 0);
    report.set(payload.slice(offset, offset + chunkLen), OTA_WRITE_HEADER_LEN);
    await device.sendFeatureReport(OTA_ID, report);

    offset += chunkLen;
    chunkIndex += 1;
  }
}

// Reads back the device's response, reassembling multi-packet replies
// (FIRST/MID) using the length header, then JSON-parses the result.
// Throws on NACK/EMPTY/unknown message types.
async function readOtaResponse(device) {
  const decoder = new TextDecoder();
  let remaining = 1;
  let data = "";
  let error = null;

  while (remaining > 0) {
    const dv = await device.receiveFeatureReport(OTA_ID);
    const reportLength = dv.getUint16(OTA_READ_LEN_IDX, true);
    const msgType = dv.getUint8(OTA_READ_MSGTYPE_IDX);
    const payloadView = new Uint8Array(
      dv.buffer,
      dv.byteOffset + OTA_READ_HEADER_LEN,
      Math.max(0, dv.byteLength - OTA_READ_HEADER_LEN),
    );
    const chunk = decoder.decode(payloadView).slice(0, Math.min(reportLength, payloadView.length));
    remaining = 0;

    switch (msgType) {
      case 0: // FIRST
      case 1: // MID
        remaining = Math.max(0, reportLength - chunk.length);
        data += chunk;
        break;
      case 2: // ACK_NRSP
        break;
      case 3: // ACK_RSP
        remaining = 1; // another packet follows
        break;
      case 4: // NACK
        error = chunk || "Device returned NACK";
        break;
      case 5: // EMPTY
        error = "Empty response from device.";
        break;
      case 6: // RESULT
        data = chunk;
        break;
      default:
        error = `Unknown OTA message type: ${msgType}`;
        break;
    }
  }

  if (error) throw new Error(error);
  if (data.length === 0) return null;
  try {
    return JSON.parse(data);
  } catch {
    return data; // not every response is JSON (e.g. plain acks)
  }
}

async function sendOtaCommand(device, command) {
  await writeOtaCommand(device, command);
  return readOtaResponse(device);
}

// Ensures OTA command #2 doesn't start writing before OTA command #1
// has finished reading its response — the device can only handle one
// exchange at a time. `lockRef` is a useRef(false) owned by the caller.
async function sendOtaCommandLocked(lockRef, device, command) {
  if (!device) throw new Error("No connected device");
  if (!device.opened) throw new Error("Device not opened");
  if (lockRef.current) throw new Error("Send in progress");

  lockRef.current = true;
  try {
    return await sendOtaCommand(device, command);
  } finally {
    lockRef.current = false;
  }
}

// Reads raw bytes and extracts acc/gyro values
function parseSensor(data) {
  return {
    acc:  [
       data.getFloat32(12, true), // y??
       data.getFloat32( 4, true), // x??
       data.getFloat32( 8, true), // z??
    ],
    gyro: [
       data.getFloat32(24, true), // y
       -data.getFloat32(16, true), //x
       -data.getFloat32(20, true), //z
    ],
  };
}

// 
export function useWebHID(onSample) {
  const [status, setStatus]         = useState("disconnected"); // re-renders on connect/disconnect; "connecting" = waiting for user to select device
  const [deviceName, setDeviceName] = useState(null); // re-render on connect to show device name
  const deviceRef     = useRef(null); // holds the current HIDDevice
  const onSampleRef   = useRef(onSample);
  onSampleRef.current = onSample;
  const sendLockRef   = useRef(false); // serializes OTA command send/response exchanges

  // fires on every input report; if sensor report, parses and calls on Sample; if status report, replies with heartbeat
  const handleInputReport = useCallback((event) => {
    if (event.reportId === SENSOR_ID) {
      onSampleRef.current(parseSensor(event.data));
    } else if (event.reportId === STATUS_ID) {
      event.device.sendReport(HEARTBEAT_ID, new Uint8Array([0x00])).catch(() => {});
    }
  }, []);

  // Opens the connection
  const connect = useCallback(async () => {
    setStatus("connecting");
    try {
      const devices = await navigator.hid.requestDevice({ // Shows HID device picker
        filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }],
      });
      if (devices.length === 0) throw new Error("No device selected");

      const device = devices[0]; // Opens device
      if (!device.opened) await device.open();

      device.addEventListener("inputreport", handleInputReport); // Registers handleInputReport listener

      const onHidDisconnect = (e) => { //Registers disconnect listener
        if (e.device !== device) return;
        navigator.hid.removeEventListener("disconnect", onHidDisconnect);
        device.removeEventListener("inputreport", handleInputReport);
        deviceRef.current = null;
        setStatus("disconnected");
        setDeviceName(null);
      };
      navigator.hid.addEventListener("disconnect", onHidDisconnect);

      await sendOtaCommandLocked(sendLockRef, device, "sensor_stream on"); // Sends command to start stream

      deviceRef.current = device; // Sets status to "connected"
      setDeviceName(device.productName || "Cato");
      setStatus("connected");
    } catch (err) {
      console.error("WebHID connect failed:", err);
      setStatus("disconnected");
    }
  }, [handleInputReport]);

  const disconnect = useCallback(async () => {
    const device = deviceRef.current;
    if (!device) return;
    try {
      await sendOtaCommandLocked(sendLockRef, device, "sensor_stream off"); // sends command to stop stream
      device.removeEventListener("inputreport", handleInputReport); // removes event listener
      await device.close(); // closes de
    } catch {}
    deviceRef.current = null;
    setStatus("disconnected");
    setDeviceName(null);
  }, [handleInputReport]);

  // Sends an arbitrary OTA command to the connected device and returns its
  // (JSON-parsed, if applicable) response. For future UI-driven commands.
  const sendCommand = useCallback((command) => {
    return sendOtaCommandLocked(sendLockRef, deviceRef.current, command);
  }, []);

  return { status, deviceName, connect, disconnect, sendCommand };
}
