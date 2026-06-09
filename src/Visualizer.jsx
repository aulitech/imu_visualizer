// Visualizer.jsx — Live 3D model driven by real-time BLE IMU data.
//
// Reads from sampleRef each animation frame and integrates the gyroscope
// (deg/s → cumulative rotation in radians) to orient the Cato model.
// resetRef, when set to true by the parent, resets orientation to zero.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";

const SIZE = 750;

const MODELS = [
  { url: "/Cato%20solid%20model.stl",         pos: [0, 0, 0],    rot: [0, 0, 0],              shader: true  },
  { url: "/Cato%20Text%20square%20thick.stl", pos: [0, 0, 6.15], rot: [0, 0, -Math.PI / 2],   shader: false },
  { url: "/auli%20logo.stl",                  pos: [0, 0, 0],    rot: [0, Math.PI, 0],         shader: false },
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

export default function Visualizer({ sampleRef, resetRef }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;

    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 28);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

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

    // Gyro integration state — plain vars, no React state (no re-renders needed)
    let rotX = 0, rotY = 0, rotZ = 0;
    let lastTime = null;
    let lastSample = null;

    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Parent can request a reset by setting resetRef.current = true
      if (resetRef?.current) {
        rotX = rotY = rotZ = 0;
        lastTime = null;
        lastSample = null;
        group.rotation.set(0, 0, 0);
        resetRef.current = false;
      }

      const sample = sampleRef.current;
      if (sample && sample !== lastSample) {
        const now = performance.now();
        if (lastTime !== null) {
          const dt = Math.min((now - lastTime) / 1000, 0.1); // seconds, capped at 100 ms
          rotX += sample.gyro[0] * dt * (Math.PI / 180);
          rotY += sample.gyro[1] * dt * (Math.PI / 180);
          rotZ += sample.gyro[2] * dt * (Math.PI / 180);
          group.rotation.set(rotX, rotY, rotZ);
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

  return <div ref={mountRef} style={{ borderRadius: "8px", overflow: "hidden" }} />;
}
