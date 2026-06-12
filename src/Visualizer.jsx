// Visualizer.jsx — Live 3D model driven by real-time BLE IMU data.
//
// Reads from sampleRef each animation frame and integrates the gyroscope
// (deg/s → cumulative rotation in radians) to orient the Cato model.
// resetRef, when set to true by the parent, resets orientation to zero.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";

// Canvas size in pixels for the 3D viewport.
const SIZE = 750;

// Each entry describes one STL file to load: its URL, position offset,
// initial rotation, and whether to use the fancy blue/gold shader.
const BASE = import.meta.env.BASE_URL;
const MODELS = [
  { url: `${BASE}Cato%20solid%20model.stl`,         pos: [0, 0, 0],    rot: [0, 0, 0],              shader: true  },
  { url: `${BASE}Cato%20Text%20square%20thick.stl`, pos: [0, 0, 6.15], rot: [0, 0, -Math.PI / 2],   shader: false },
  { url: `${BASE}auli%20logo.stl`,                  pos: [0, 0, 0],    rot: [0, Math.PI, 0],         shader: false },
];

// Vertex shader: passes the surface normal to the fragment shader so it
// can calculate how much light hits each face.
const VERT = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader: blends between a dark blue base colour and a gold
// highlight depending on how directly the face points toward the light.
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

// Madgwick AHRS filter — fuses gyro (rad/s) + acc to produce a stable quaternion.
// beta controls how aggressively the accelerometer corrects gyro drift.
const BETA = 0.09;

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
  // mountRef attaches to the <div> in the JSX so Three.js can inject its canvas into it.
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;

    // Create the Three.js scene and set a dark navy background colour.
    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Perspective camera: 45° field of view, placed 28 units back on the Z axis.
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 28);

    // WebGL renderer: inject its <canvas> element into the mount div.
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    // Lighting: soft ambient fill plus a directional "sun" light from the upper-right.
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7);
    scene.add(dir);

    // Two materials: the custom blue/gold shader for the main body,
    // and plain grey for the text and logo parts.
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

    // A Group acts as a single parent object; rotating the group rotates all
    // loaded meshes together. Scaled to 50% so the model fits in the viewport.
    const group = new THREE.Group();
    group.scale.setScalar(0.5);
    scene.add(group);

    // Load each STL file asynchronously and add it to the group once ready.
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

    // Madgwick filter state — quaternion [w, x, y, z], no React state needed
    let q = [1, 0, 0, 0];
    let lastTime = null;
    let lastSample = null;

    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // If the "Reset Orientation" button was pressed, reset quaternion to identity.
      if (resetRef?.current) {
        q = [1, 0, 0, 0];
        lastTime = null;
        lastSample = null;
        group.quaternion.set(0, 0, 0, 1);
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
            sample.gyro[0] * DEG2RAD,
            sample.gyro[1] * DEG2RAD,
            sample.gyro[2] * DEG2RAD,
            sample.acc[0], sample.acc[1], sample.acc[2],
            dt,
          );
          group.quaternion.set(q[1], q[2], q[3], q[0]); // THREE expects (x,y,z,w)
        }
        lastTime   = now;
        lastSample = sample;
      }

      renderer.render(scene, camera);
    };
    animate();

    // Cleanup: stop the animation loop and remove the canvas when the component unmounts.
    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [sampleRef, resetRef]);

  // The div that Three.js will inject its canvas into.
  return <div ref={mountRef} style={{ borderRadius: "8px", overflow: "hidden" }} />;
}
