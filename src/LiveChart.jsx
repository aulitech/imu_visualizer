// LiveChart.jsx — Scrolling canvas chart of live IMU data.
//
// Reads sampleRef each animation frame, maintains a rolling buffer,
// and draws two panels: gyroscope (top) and accelerometer (bottom).

import { useEffect, useRef } from "react";

const W       = 750;
const PANEL_H = 140;
const GAP     = 12;
const MARGIN  = { left: 52, right: 16, top: 28, bottom: 8 };
const H       = MARGIN.top + PANEL_H + GAP + PANEL_H + MARGIN.bottom;
const BUFFER  = 250; // samples kept in rolling window

const COLORS = ["#e53935", "#43a047", "#1e88e5"]; // X=red Y=green Z=blue
const LABELS = ["X", "Y", "Z"];

function drawPanel(ctx, buffers, panelTop, axisLabel) {
  const plotW = W - MARGIN.left - MARGIN.right;

  const all = buffers.flat();
  const dataMin = all.length ? Math.min(...all) : -1;
  const dataMax = all.length ? Math.max(...all) :  1;
  const pad  = (dataMax - dataMin) * 0.12 || 1;
  const yMin = dataMin - pad;
  const yMax = dataMax + pad;

  // Panel background + border
  ctx.fillStyle = "#0d0d1a";
  ctx.fillRect(MARGIN.left, panelTop, plotW, PANEL_H);
  ctx.strokeStyle = "#2a2a3a";
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN.left, panelTop, plotW, PANEL_H);

  // Horizontal grid lines + Y tick labels
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

  // Axis label (rotated)
  ctx.save();
  ctx.fillStyle = "#999";
  ctx.font = "10px system-ui";
  ctx.textAlign = "center";
  ctx.translate(14, panelTop + PANEL_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(axisLabel, 0, 0);
  ctx.restore();

  // Data lines
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

      ctx.clearRect(0, 0, W, H);

      // Legend
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

      drawPanel(ctx, gyroBuf.current, MARGIN.top,                   "Gyro (°/s)");
      drawPanel(ctx, accBuf.current,  MARGIN.top + PANEL_H + GAP,   "Acc (m/s²)");
    };

    frame();
    return () => cancelAnimationFrame(animId);
  }, [sampleRef]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ borderRadius: "8px" }}
    />
  );
}
