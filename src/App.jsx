// Top-level component
import { useRef, useCallback, useState } from "react";
import { useWebHID } from "./useWebHID";
import Visualizer from "./Visualizer";
import LiveChart from "./LiveChart";

const HELP_SECTIONS = [
  {
    title: "Connecting your device",
    body: [
      "Click Connect Cato to open the browser's device picker. Select your Cato device from the list (it must be paired via USB or Bluetooth beforehand).",
      "Click Disconnect to end the session and stop the sensor stream.",
      "Click Reset Orientation to zero out the current orientation estimate and return the model to its default position.",
    ],
  },
  {
    title: "3D Visualizer",
    body: [
      "The 3D model mirrors the physical orientation of your Cato device in real time. Orientation is estimated using a Madgwick sensor-fusion filter that combines the gyroscope (fast, tracks rotation) and accelerometer (slow, corrects drift toward gravity).",
      "The ground grid is fixed in world space — it always represents the floor, letting you see how the device is tilted relative to gravity.",
    ],
  },
  {
    title: "Vectors mode",
    body: [
      "The model stays centred in the viewport. Two arrows are drawn in world space:",
      "Blue arrow — estimated gravity direction. Always points downward when the filter is tracking correctly.",
      "Orange arrow — linear acceleration (total accelerometer reading minus the gravity component). It appears only when the device is actively moving and fades when the device is stationary.",
    ],
  },
  {
    title: "Motion mode",
    body: [
      "Linear acceleration is double-integrated to move the model through the viewport, giving a sense of translational motion. The arrows are hidden in this mode.",
      "A small amount of velocity damping is applied each frame to prevent unbounded drift. The model snaps back if it reaches the edge of the view.",
    ],
  },
  {
    title: "Live Chart",
    body: [
      "The scrolling chart shows the most recent 250 samples from the sensor stream.",
      "Top panel — Gyroscope (°/s): rate of rotation around each axis.",
      "Bottom panel — Accelerometer (m/s²): total acceleration including gravity (~9.81 m/s² when stationary).",
      "Each axis is colour-coded: blue = axis 0, green = axis 1, red = axis 2.",
    ],
  },
];

export default function App() {
  const sampleRef  = useRef(null);
  const resetRef   = useRef(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleSample = useCallback((sample) => {
    sampleRef.current = sample;
  }, []);

  const { status, deviceName, connect, disconnect } = useWebHID(handleSample);

  const connected = status === "connected";

  return (
    <div className="app">
      <h1>Cato IMU Visualizer</h1>

      <div className="controls">
        <button
          onClick={connected ? disconnect : connect}
          disabled={status === "connecting"}
          className={connected ? "btn-disconnect" : "btn-connect"}
        >
          {status === "connecting" ? "Connecting…" : connected ? "Disconnect" : "Connect Cato"}
        </button>

        {connected && (
          <button className="btn-reset" onClick={() => { resetRef.current = true; }}>
            Reset Orientation
          </button>
        )}

        <span className={`status status-${status}`}>
          {connected ? `Connected: ${deviceName}` : status === "connecting" ? "Searching…" : "Not connected"}
        </span>

        <button
          className="btn-help"
          onClick={() => setShowHelp((v) => !v)}
          aria-label="Toggle help"
        >
          {showHelp ? "Hide Help" : "?  Help"}
        </button>
      </div>

      {showHelp && (
        <div className="help-panel">
          {HELP_SECTIONS.map(({ title, body }) => (
            <div className="help-section" key={title}>
              <h3>{title}</h3>
              {body.map((line) => <p key={line}>{line}</p>)}
            </div>
          ))}
        </div>
      )}

      <Visualizer sampleRef={sampleRef} resetRef={resetRef} />
      <LiveChart sampleRef={sampleRef} />
    </div>
  );
}
