// Visualizer.jsx — Live 3D model driven by real-time IMU data.
//
// Two display modes (toggled with the slider below the canvas):
//   vectors — model stays centered; a blue gravity arrow and orange linear-
//             acceleration arrow are drawn in world space.
//   motion  — linear acceleration is double-integrated to move the model
//             around the viewport; no arrows.
//
// resetRef resets orientation, velocity, and position to zero.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";

const SIZE = 750;

const BASE = import.meta.env.BASE_URL;
const MODELS = [
  { url: `${BASE}Cato%20solid%20model.stl`,         pos: [0, 0, 0],    rot: [0, 0, 0],              shader: true  },
  { url: `${BASE}Cato%20Text%20square%20thick.stl`, pos: [0, 0, 6.15], rot: [0, 0, -Math.PI / 2],   shader: false },
  { url: `${BASE}auli%20logo.stl`,                  pos: [0, 0, 0],    rot: [0, Math.PI, 0],         shader: false },
];

const VERT = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = `
  uniform vec3 lightDir;
  uniform vec3 baseColor;
  uniform vec3 highlightColor;
  varying vec3 vNormal;
  void main() {
    float diff = max(dot(vNormal, lightDir), 0.0);
    vec3 color = mix(baseColor, highlightColor, diff);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const BETA = 0.1;
const GYRO_SCALE_0 = 1.15; // increase above 1.0 to reduce gyro lag
const GYRO_SCALE_1 = 1.14;
const GYRO_SCALE_2 = 1.17;

// ArrowHelper uses THREE.Line whose linewidth is ignored by WebGL.
// This builds an arrow from a cylinder (shaft) + cone (head) so thickness is controllable.
function makeArrow(color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 8), mat);
  const head  = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1, 8), mat);
  const group = new THREE.Group();
  group.add(shaft);
  group.add(head);

  group.setDirection = (dir) => {
    const d = dir.clone().normalize();
    if (d.y > 0.9999) {
      group.quaternion.set(0, 0, 0, 1);
    } else if (d.y < -0.9999) {
      group.quaternion.set(1, 0, 0, 0);
    } else {
      const axis = new THREE.Vector3(0, 1, 0).cross(d).normalize();
      group.quaternion.setFromAxisAngle(axis, Math.acos(d.y));
    }
  };

  group.setLength = (length, headLen = 0.8, headWidth = 0.5) => {
    const shaftLen = Math.max(length - headLen, 0.01);
    shaft.scale.y = shaftLen;
    shaft.position.y = shaftLen / 2;
    head.scale.set(headWidth / 0.28, headLen, headWidth / 0.28);
    head.position.y = shaftLen + headLen / 2;
  };

  return group;
}

function madgwickUpdate([q0, q1, q2, q3], gx, gy, gz, ax, ay, az, dt) {
  let norm = Math.sqrt(ax*ax + ay*ay + az*az);
  if (norm === 0) norm = 1;
  ax /= norm; ay /= norm; az /= norm;

  // Gradient for gravity reference along -Y world axis
  const q1q1 = q1*q1, q3q3 = q3*q3;
  const q1q3sq = q1q1 + q3q3;
  let s0 =  4*q0*q1q3sq           + 2*q3*ax - 2*q1*az;
  let s1 =  4*q1*q1q3sq + 2*q2*ax - 4*q1*ay - 2*q0*az;
  let s2 =  4*q2*q1q3sq + 2*q1*ax            + 2*q3*az;
  let s3 =  4*q3*q1q3sq + 2*q0*ax - 4*q3*ay  + 2*q2*az;
  norm = Math.sqrt(s0*s0 + s1*s1 + s2*s2 + s3*s3) || 1;
  s0 /= norm; s1 /= norm; s2 /= norm; s3 /= norm;

  const n0 = q0 + (0.5*(-q1*gx - q2*gy - q3*gz) - BETA*s0) * dt;
  const n1 = q1 + (0.5*( q0*gx + q2*gz - q3*gy) - BETA*s1) * dt;
  const n2 = q2 + (0.5*( q0*gy - q1*gz + q3*gx) - BETA*s2) * dt;
  const n3 = q3 + (0.5*( q0*gz + q1*gy - q2*gx) - BETA*s3) * dt;
  norm = Math.sqrt(n0*n0 + n1*n1 + n2*n2 + n3*n3) || 1;
  return [n0/norm, n1/norm, n2/norm, n3/norm];
}

export default function Visualizer({ sampleRef, resetRef }) {
  const mountRef = useRef(null);
  const [mode, setMode] = useState("vectors");
  const modeRef = useRef("vectors");

  useEffect(() => {
    const mount = mountRef.current;

    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
    camera.position.set(0, 0, 28);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    // Ground grid — fixed in world space (not part of the rotating group).
    const grid = new THREE.GridHelper(28, 14, 0x444466, 0x2a2a44);
    grid.position.y = -8;
    scene.add(grid);

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7);
    scene.add(dir);

    const shaderMat = new THREE.ShaderMaterial({
      uniforms: {
        lightDir:       { value: new THREE.Vector3(0.5, 1.0, 0.8).normalize() },
        baseColor:      { value: new THREE.Color(0x1565c0) },
        highlightColor: { value: new THREE.Color(0xffd54f) },
      },
      vertexShader:   VERT,
      fragmentShader: FRAG,
    });
    const greyMat = new THREE.MeshStandardMaterial({ color: 0x888888 });

    const group = new THREE.Group();
    group.scale.setScalar(0.5);
    scene.add(group);

    const loader = new STLLoader();
    MODELS.forEach(({ url, pos, rot, shader }) => {
      loader.load(url, (geo) => {
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, shader ? shaderMat : greyMat);
        mesh.position.set(...pos);
        mesh.rotation.set(...rot);
        group.add(mesh);
      });
    });

    // Arrows for vectors mode — gravity (blue) and linear acceleration (orange).
    const gravArrow = makeArrow(0x0277bd);
    gravArrow.setDirection(new THREE.Vector3(0, -1, 0));
    gravArrow.setLength(7, 0.8, 0.5);
    const accArrow = makeArrow(0xe64a19);
    accArrow.visible = false;
    scene.add(gravArrow);
    scene.add(accArrow);

    let q = [1, 0, 0, 0];
    const velocity = new THREE.Vector3();
    let lastTime = null;
    let lastSample = null;

    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (resetRef?.current) {
        q = [1, 0, 0, 0];
        velocity.set(0, 0, 0);
        group.position.set(0, 0, 0);
        group.quaternion.set(0, 0, 0, 1);
        lastTime = null;
        lastSample = null;
        resetRef.current = false;
      }

      const sample = sampleRef.current;
      if (sample && sample !== lastSample) {
        const now = performance.now();
        if (lastTime !== null) {
          const dt = Math.min((now - lastTime) / 1000, 0.1);
          const DEG2RAD = Math.PI / 180;
          q = madgwickUpdate(
            q,
            sample.gyro[0] * DEG2RAD * GYRO_SCALE_0,
            sample.gyro[1] * DEG2RAD * GYRO_SCALE_1,
            sample.gyro[2] * DEG2RAD * GYRO_SCALE_2,
            sample.acc[0], sample.acc[1], sample.acc[2],
            dt,
          );

          const threeQuat = new THREE.Quaternion(q[1], q[2], q[3], q[0]);
          group.quaternion.copy(threeQuat);

          // Gravity in body frame: unit vector rotated into sensor frame, then scaled
          // to match sensor units so the subtraction cancels when stationary.
          const accVec = new THREE.Vector3(sample.acc[0], sample.acc[1], sample.acc[2]);
          const gravBody = new THREE.Vector3(0, -1, 0)
            .applyQuaternion(threeQuat.clone().invert())
            .multiplyScalar(accVec.length() || 1);

          // Linear acceleration: subtract gravity from total acc, then rotate to world frame.
          const linAccWorld = accVec.clone().sub(gravBody).applyQuaternion(threeQuat);

          if (modeRef.current === "vectors") {
            group.position.set(0, 0, 0);
            velocity.set(0, 0, 0);

            gravArrow.visible = true;
            gravArrow.setDirection(new THREE.Vector3(0, -1, 0));
            gravArrow.setLength(7, 0.8, 0.4);

            const accMag = linAccWorld.length();
            if (accMag > 0.05) {
              accArrow.visible = true;
              accArrow.setDirection(linAccWorld.clone().normalize());
              accArrow.setLength(Math.min(accMag * 2, 10), 0.8, 0.4);
            } else {
              accArrow.visible = false;
            }
          } else {
            gravArrow.visible = false;
            accArrow.visible = false;

            velocity.addScaledVector(linAccWorld, dt);
            velocity.multiplyScalar(0.98); // light damping to limit drift
            group.position.addScaledVector(velocity, dt * 15);
            group.position.clampLength(0, 10);
          }
        }
        lastTime   = now;
        lastSample = sample;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [sampleRef, resetRef]);

  return (
    <div style={{ display: "inline-block" }}>
      <div ref={mountRef} style={{ borderRadius: "8px", overflow: "hidden" }} />
      <div style={{ marginTop: "8px", display: "flex", gap: "8px", alignItems: "center", justifyContent: "center", color: "#ccc", fontSize: "14px" }}>
        <span style={{ color: mode === "vectors" ? "#fff" : "#888" }}>Vectors</span>
        <input
          type="range" min="0" max="1" step="1"
          value={mode === "motion" ? 1 : 0}
          onChange={(e) => {
            const newMode = e.target.value === "1" ? "motion" : "vectors";
            modeRef.current = newMode;
            setMode(newMode);
          }}
          style={{ cursor: "pointer", accentColor: "#1565c0" }}
        />
        <span style={{ color: mode === "motion" ? "#fff" : "#888" }}>Motion</span>
      </div>
    </div>
  );
}
