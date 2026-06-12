// LiveChart.jsx — Scrolling canvas chart of live IMU data.
//
// Reads sampleRef each animation frame, maintains a rolling buffer,
// and draws two panels: gyroscope (top) and accelerometer (bottom).

import { useEffect, useRef } from "react";

// Canvas dimensions and layout constants.
// MARGIN reserves space on the left for Y-axis labels and on top for the legend.
const W       = 750;
const PANEL_H = 140;
const GAP     = 12;
const MARGIN  = { left: 52, right: 16, top: 28, bottom: 8 };
const H       = MARGIN.top + PANEL_H + GAP + PANEL_H + MARGIN.bottom;
const BUFFER  = 250; // samples kept in rolling window

// One colour and label per axis, shared by both panels.
const COLORS = ["#e53935", "#43a047", "#1e88e5"]; // X=red Y=green Z=blue
const LABELS = ["X", "Y", "Z"];

// Draws a single data panel (either gyro or accelerometer).
// Receives the canvas context, the three axis buffers, the vertical
// position to start drawing, and the label for the Y axis.
function drawPanel(ctx, buffers, panelTop, axisLabel) {
  const plotW = W - MARGIN.left - MARGIN.right;

  // Auto-scale the Y axis to the current data range, with a small padding
  // so lines don't sit right on the panel edges.
  const all = buffers.flat();
  const dataMin = all.length ? Math.min(...all) : -1;
  const dataMax = all.length ? Math.max(...all) :  1;
  const pad  = (dataMax - dataMin) * 0.12 || 1;
  const yMin = dataMin - pad;
  const yMax = dataMax + pad;

  // Draw the dark panel background and a subtle border.
  ctx.fillStyle = "#0d0d1a";
  ctx.fillRect(MARGIN.left, panelTop, plotW, PANEL_H);
  ctx.strokeStyle = "#2a2a3a";
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN.left, panelTop, plotW, PANEL_H);

  // Draw three horizontal grid lines (top, middle, bottom) with numeric
  // tick labels showing the corresponding data value on the Y axis.
  ctx.font = "9px system-ui";
  ctx.textAlign = "right";
  [0, 0.5, 1].forEach((t) => {
    const val = yMax - t * (yMax - yMin);
    const y   = panelTop + t * PANEL_H;
    ctx.strokeStyle = "#1e1e2e";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, y);
    ctx.lineTo(MARGIN.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "#666";
    ctx.fillText(val.toFixed(1), MARGIN.left - 4, y + 3.5);
  });

  // Draw the rotated axis label (e.g. "Gyro (°/s)") vertically on the far left.
  // ctx.save/restore is used so the rotation doesn't affect subsequent drawing.
  ctx.save();
  ctx.fillStyle = "#999";
  ctx.font = "10px system-ui";
  ctx.textAlign = "center";
  ctx.translate(14, panelTop + PANEL_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(axisLabel, 0, 0);
  ctx.restore();

  // Draw one coloured line per axis, mapping sample index → X position
  // and data value → Y position within the panel.
  buffers.forEach((data, ci) => {
    if (data.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = COLORS[ci];
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    data.forEach((v, i) => {
      const x = MARGIN.left + (i / (BUFFER - 1)) * plotW;
      const y = panelTop + PANEL_H * (1 - (v - yMin) / (yMax - yMin));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

export default function LiveChart({ sampleRef }) {
  // canvasRef attaches to the <canvas> element so we can draw on it.
  // gyroBuf and accBuf each hold three arrays (one per axis) of recent samples.
  const canvasRef    = useRef(null);
  const gyroBuf      = useRef([[], [], []]);
  const accBuf       = useRef([[], [], []]);
  const lastSampleRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    let animId;

    const frame = () => {
      animId = requestAnimationFrame(frame);

      // On each new sample, append the latest values to the rolling buffers
      // and drop the oldest entry once the buffer exceeds BUFFER length.
      const sample = sampleRef.current;
      if (sample && sample !== lastSampleRef.current) {
        lastSampleRef.current = sample;
        [0, 1, 2].forEach((i) => {
          gyroBuf.current[i].push(sample.gyro[i]);
          accBuf.current[i].push(sample.acc[i]);
          if (gyroBuf.current[i].length > BUFFER) gyroBuf.current[i].shift();
          if (accBuf.current[i].length  > BUFFER) accBuf.current[i].shift();
        });
      }

      // Clear the whole canvas before redrawing everything from scratch.
      ctx.clearRect(0, 0, W, H);

      // Draw the colour-coded legend (X/Y/Z) at the top of the canvas.
      LABELS.forEach((label, i) => {
        const lx = MARGIN.left + 10 + i * 52;
        ctx.strokeStyle = COLORS[i];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lx, 13);
        ctx.lineTo(lx + 18, 13);
        ctx.stroke();
        ctx.fillStyle = "#ccc";
        ctx.font = "10px system-ui";
        ctx.textAlign = "left";
        ctx.fillText(label, lx + 22, 17);
      });

      // Draw the gyro panel on top and the accelerometer panel below it.
      drawPanel(ctx, gyroBuf.current, MARGIN.top,                   "Gyro (°/s)");
      drawPanel(ctx, accBuf.current,  MARGIN.top + PANEL_H + GAP,   "Acc (m/s²)");
    };

    frame();
    // Stop the animation loop when the component is removed from the page.
    return () => cancelAnimationFrame(animId);
  }, [sampleRef]);

  // The canvas element that everything is drawn onto.
  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
       className="visualizer-overlay"
    />
  );
}
