"use client";

// In-app 3D viewer for CAD exports (STL / OBJ / GLTF / GLB) attached to a
// project chat. There's no npm access to this repo's package.json from
// this session, so instead of adding three.js as a dependency, this loads
// the same UMD builds Anthropic's own three.js examples use, straight from
// jsdelivr (which mirrors the three npm package's files 1:1) — no bundler
// config needed, works in any client component.

import { useEffect, useRef, useState } from "react";

const THREE_VERSION = "0.128.0";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

const scriptCache = new Map();
function loadScript(src) {
  if (scriptCache.has(src)) return scriptCache.get(src);
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      if (existing.dataset.loaded) resolve();
      return;
    }
    const tag = document.createElement("script");
    tag.src = src;
    tag.async = true;
    tag.onload = () => {
      tag.dataset.loaded = "1";
      resolve();
    };
    tag.onerror = reject;
    document.head.appendChild(tag);
  });
  scriptCache.set(src, promise);
  return promise;
}

async function ensureThree() {
  await loadScript(`${CDN_BASE}/build/three.min.js`);
  await Promise.all([
    loadScript(`${CDN_BASE}/examples/js/controls/OrbitControls.js`),
    loadScript(`${CDN_BASE}/examples/js/loaders/STLLoader.js`),
    loadScript(`${CDN_BASE}/examples/js/loaders/OBJLoader.js`),
    loadScript(`${CDN_BASE}/examples/js/loaders/GLTFLoader.js`),
  ]);
  return window.THREE;
}

/** Guesses the loader to use from a filename/URL's extension. */
export function guessCadKind(name) {
  const ext = (name || "").split(".").pop()?.toLowerCase();
  if (ext === "stl") return "stl";
  if (ext === "obj") return "obj";
  if (ext === "gltf" || ext === "glb") return "gltf";
  return null;
}

export default function CADViewer({ url, kind, onClose }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let renderer, scene, camera, controls, frameId, resizeObserver;

    (async () => {
      try {
        const THREE = await ensureThree();
        if (disposed || !containerRef.current) return;

        const container = containerRef.current;
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf4f2ee);

        camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 5000);
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const dir1 = new THREE.DirectionalLight(0xffffff, 0.7);
        dir1.position.set(1, 1, 1);
        scene.add(dir1);
        const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
        dir2.position.set(-1, -0.5, -1);
        scene.add(dir2);

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        function fitCameraToObject(object) {
          const box = new THREE.Box3().setFromObject(object);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          object.position.sub(center);
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const distance = maxDim * 2.2;
          camera.position.set(distance, distance * 0.7, distance);
          camera.near = maxDim / 100;
          camera.far = maxDim * 100;
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.update();
        }

        function onLoaded(object) {
          if (disposed) return;
          scene.add(object);
          fitCameraToObject(object);
          setStatus("ready");
        }
        function onError(err) {
          console.error("CAD load failed:", err);
          if (!disposed) {
            setError("Couldn't load that file — it may not be a valid model, or the format isn't supported yet.");
            setStatus("error");
          }
        }

        if (kind === "stl") {
          new THREE.STLLoader().load(
            url,
            (geometry) => {
              const material = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.15, roughness: 0.55 });
              onLoaded(new THREE.Mesh(geometry, material));
            },
            undefined,
            onError
          );
        } else if (kind === "obj") {
          new THREE.OBJLoader().load(url, onLoaded, undefined, onError);
        } else if (kind === "gltf") {
          new THREE.GLTFLoader().load(url, (gltf) => onLoaded(gltf.scene), undefined, onError);
        } else {
          onError(new Error("Unsupported CAD format"));
        }

        function animate() {
          frameId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        }
        animate();

        resizeObserver = new ResizeObserver(() => {
          if (!container || !renderer || !camera) return;
          camera.aspect = container.clientWidth / container.clientHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(container.clientWidth, container.clientHeight);
        });
        resizeObserver.observe(container);
      } catch (err) {
        console.error("Couldn't load the 3D viewer:", err);
        if (!disposed) {
          setError("Couldn't load the 3D viewer — check your connection and try again.");
          setStatus("error");
        }
      }
    })();

    return () => {
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      controls?.dispose?.();
      if (renderer) {
        renderer.dispose();
        renderer.domElement?.remove();
      }
    };
  }, [url, kind]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 14, width: "min(880px, 100%)", height: "min(600px, 100%)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--s-border)" }}>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13 }}>3D preview</span>
          <button type="button" onClick={onClose} className="ghost" style={{ marginLeft: "auto" }}>
            Close
          </button>
        </div>
        <div ref={containerRef} style={{ flex: 1, position: "relative" }}>
          {status === "loading" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--s-text-3)" }}>
              Loading model…
            </div>
          )}
          {status === "error" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#e5534b", padding: 20, textAlign: "center" }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
