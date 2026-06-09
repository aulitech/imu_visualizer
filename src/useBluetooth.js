// useBluetooth.js — Web Bluetooth hook for the Cato IMU stream.
//
// Connects to the Cato's BLE motion service, enables the IMU stream,
// subscribes to accelerometer/gyro notifications, and calls onSample
// for every incoming packet.
//
// Packet layout (16 bytes, all big-endian):
//   [0-1]  seq   Uint16
//   [2-3]  ts    Uint16
//   [4-5]  ax    Int16 / 10  (m/s²)
//   [6-7]  ay    Int16 / 10
//   [8-9]  az    Int16 / 10
//   [10-11] gx   Int16 / 10  (deg/s)
//   [12-13] gy   Int16 / 10
//   [14-15] gz   Int16 / 10

import { useState, useCallback, useRef } from "react";

const MOTION_SERVICE = "01912446-e5aa-9ee9-0e19-000e7e57049c";
const ACC_CHAR       = "00800000-0001-11e1-ac36-0002a5d5c51b";
const ENABLE_CHAR    = "00001524-1212-efde-1523-785feabcd123";

export function useBluetooth(onSample) {
  const [status, setStatus]         = useState("disconnected");
  const [deviceName, setDeviceName] = useState(null);

  const deviceRef  = useRef(null);
  const accCharRef = useRef(null);

  const handleNotification = useCallback((event) => {
    const v  = event.target.value;
    const ax = v.getInt16(4,  false) / 10;
    const ay = v.getInt16(6,  false) / 10;
    const az = v.getInt16(8,  false) / 10;
    const gx = v.getInt16(10, false) / 10;
    const gy = v.getInt16(12, false) / 10;
    const gz = v.getInt16(14, false) / 10;
    onSample({ acc: [ax, ay, az], gyro: [gx, gy, gz] });
  }, [onSample]);

  const connect = useCallback(async () => {
    setStatus("connecting");
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [MOTION_SERVICE],
      });

      device.addEventListener("gattserverdisconnected", () => {
        accCharRef.current = null;
        deviceRef.current  = null;
        setStatus("disconnected");
        setDeviceName(null);
      });

      const server     = await device.gatt.connect();
      const service    = await server.getPrimaryService(MOTION_SERVICE);
      const enableChar = await service.getCharacteristic(ENABLE_CHAR);
      const accChar    = await service.getCharacteristic(ACC_CHAR);

      await enableChar.writeValue(new Uint8Array([0x01]));
      await accChar.startNotifications();
      accChar.addEventListener("characteristicvaluechanged", handleNotification);

      deviceRef.current  = device;
      accCharRef.current = accChar;
      setDeviceName(device.name ?? "Cato");
      setStatus("connected");
    } catch (err) {
      console.error("BLE connect failed:", err);
      setStatus("disconnected");
    }
  }, [handleNotification]);

  const disconnect = useCallback(async () => {
    const accChar = accCharRef.current;
    if (accChar) {
      try {
        await accChar.stopNotifications();
        accChar.removeEventListener("characteristicvaluechanged", handleNotification);
      } catch {}
    }
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
    accCharRef.current = null;
    deviceRef.current  = null;
    setStatus("disconnected");
    setDeviceName(null);
  }, [handleNotification]);

  return { status, deviceName, connect, disconnect };
}
