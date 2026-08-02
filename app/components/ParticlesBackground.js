"use client";

// Lightweight canvas particle field for the intro page's background —
// inspired by reactbits.dev's "Particles" background component, but
// reimplemented in plain <canvas> + requestAnimationFrame instead of their
// actual OGL/WebGL-based one. Reason: their component ships as source you
// drop into a project and depends on the `ogl` package, which isn't in
// this app's dependencies — and given how much friction adding even one
// new npm package has been for this repo's GitHub-web-upload workflow,
// this trades a little visual fidelity (no true 3D depth/glow) for zero
// new dependencies. Same parameters as requested where they map 1:1:
// particleCount, speed, disableRotation (points have no orientation here,
// so trivially true), moveParticlesOnHover (off — no mouse tracking).
import { useEffect, useRef } from "react";

export default function ParticlesBackground({
  particleCount = 300,
  speed = 0.3,
  color = "#e7e8ea",
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf = null;
    let particles = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    }

    function seed() {
      particles = Array.from({ length: particleCount }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random(), // depth, 0=far/small/dim, 1=near/big/bright
        vx: (Math.random() - 0.5) * speed * dpr,
        vy: (Math.random() - 0.5) * speed * dpr,
      }));
    }

    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        const radius = (0.6 + p.z * 1.6) * dpr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.15 + p.z * 0.45;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    resize();
    seed();
    frame();

    function onResize() {
      resize();
      seed();
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [particleCount, speed, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}
