// Top-level component
import { useRef, useCallback } from "react";
import { useWebHID } from "./useWebHID";
import Visualizer from "./Visualizer";
import LiveChart from "./LiveChart";

export default function App() {
  const sampleRef = useRef(null);  // sampleRef holds latest IMU sample
  const resetRef  = useRef(false); // resetRef = flag to signal orientation reset

  const handleSample = useCallback((sample) => { // function handed to useWebHID, drops current sample into sampleRef
    sampleRef.current = sample;
  }, []);

  const { status, deviceName, connect, disconnect } = useWebHID(handleSample); // calls WebHID hook

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
      </div>

      <Visualizer sampleRef={sampleRef} resetRef={resetRef} />
      <LiveChart sampleRef={sampleRef} />
    </div>
  );
}
