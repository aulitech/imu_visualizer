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

// Send a text command via OTA feature report
async function sendOtaCommand(device, command) {
  const payload = new TextEncoder().encode(command);
  const report  = new Uint8Array(REPORT_LEN).fill(0);
  // Header: [0x00, 0xFF, msgType=FIRST, lenLSB, lenMSB]
  report[0] = 0x00;
  report[1] = 0xFF;
  report[2] = 0x00;
  report[3] = payload.length & 0xFF;
  report[4] = (payload.length >> 8) & 0xFF;
  report.set(payload, 5);
  await device.sendFeatureReport(OTA_ID, report);

  // Drain response packets until the device signals it is done.
  // msgType 3 (ACK_RSP) means another packet follows; anything else is terminal.
  let more = true;
  while (more) {
    const dv = await device.receiveFeatureReport(OTA_ID);
    const msgType = dv.getUint8(3); // [0]=reportId [1]=0x00 [2]=0xFF [3]=msgType
    more = msgType === 3; // ACK_RSP
  }
}

// Reads raw bytes and extracts acc/gyro values
function parseSensor(data) {
  return {
    acc:  [
       data.getFloat32(12, true),
       data.getFloat32( 4, true),
       data.getFloat32( 8, true),
    ],
    gyro: [
       data.getFloat32(24, true),
      -data.getFloat32(16, true),
      -data.getFloat32(20, true),
    ],
  };
}

// 
export function useWebHID(onSample) {
  const [status, setStatus]         = useState("disconnected"); // re-renders on connect/disconnect; "connecting" = waiting for user to select device
  const [deviceName, setDeviceName] = useState(null); // re-render on connect to show device name
  const deviceRef     = useRef(null); // holds the current HIDDevice
  onSampleRef.current = onSample;

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

      await sendOtaCommand(device, "sensor_stream on"); // Sends command to start stream

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
      await sendOtaCommand(device, "sensor_stream off"); // sends command to stop stream
      device.removeEventListener("inputreport", handleInputReport); // removes event listener
      await device.close();
    } catch {}
    deviceRef.current = null;
    setStatus("disconnected");
    setDeviceName(null);
  }, [handleInputReport]);

  return { status, deviceName, connect, disconnect };
}
