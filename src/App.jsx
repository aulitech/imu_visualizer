import { useRef, useCallback } from "react";
import { useWebHID } from "./useWebHID";
import Visualizer from "./Visualizer";
import LiveChart from "./LiveChart";

export default function App() {
  const sampleRef = useRef(null);
  const resetRef = useRef(false);

  const handleSample = useCallback((sample) => {
    sampleRef.current = sample;
  }, []);

  const { status, deviceName, connect, disconnect } = useWebHID(handleSample);

  const connected = status === "connected";

  return (
    <div className="app">
      <div className="header">
        <h1>Cato IMU Visualizer</h1>
      <div className="controls">
        <button
          onClick={connected ? disconnect : connect}
          disabled={status === "connecting"}
          className={connected ? "btn-disconnect" : "btn-connect"}
        >
          {status === "connecting"
            ? "Connecting…"
            : connected
              ? "Disconnect"
              : "Connect Cato"}
        </button>

        {connected && (
          <button
            className="btn-reset"
            onClick={() => {
              resetRef.current = true;
            }}
          >
            Reset Orientation
          </button>
        )}

        <span className={`status status-${status}`}>
          {connected
            ? `Connected: ${deviceName}`
            : status === "connecting"
              ? "Searching…"
              : "Not connected"}
        </span>
      </div>
</div>
      <div className="visualizer-container">
        <Visualizer sampleRef={sampleRef} resetRef={resetRef} height={window.innerHeight} width={window.innerWidth} />
        <LiveChart sampleRef={sampleRef} height={window.innerHeight} width={window.innerWidth}/>
      </div>
    </div>
  );
}
