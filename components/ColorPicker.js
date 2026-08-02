"use client";

// A real custom color picker — a draggable saturation/value square plus a
// hue strip — instead of asking someone to type a hex code. Renders its own
// gradients with plain <canvas>/CSS, no extra dependency.

import { useEffect, useRef, useState } from "react";

function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) return { h: 210, s: 0.55, v: 0.85 };
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export default function ColorPicker({ value, onChange }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const svRef = useRef(null);
  const hueRef = useRef(null);
  const draggingRef = useRef(null); // "sv" | "hue" | null

  // Only re-sync from an external value change (e.g. a preset swatch was
  // clicked) — not on every internal drag, or the square would fight the
  // user's own pointer position.
  const lastEmittedRef = useRef(value);
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    setHsv(hexToHsv(value));
  }, [value]);

  function emit(next) {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    lastEmittedRef.current = hex;
    onChange(hex);
  }

  function pickFromSv(clientX, clientY) {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    emit({ ...hsv, s: x, v: 1 - y });
  }

  function pickFromHue(clientX) {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    emit({ ...hsv, h: x * 360 });
  }

  useEffect(() => {
    function onMove(e) {
      if (!draggingRef.current) return;
      const point = e.touches ? e.touches[0] : e;
      if (draggingRef.current === "sv") pickFromSv(point.clientX, point.clientY);
      else pickFromHue(point.clientX);
    }
    function onUp() {
      draggingRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsv]);

  const hueHex = hsvToHex(hsv.h, 1, 1);
  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);

  return (
    <div className="shell-colorpicker">
      <div
        ref={svRef}
        className="shell-colorpicker-sv"
        style={{
          position: "relative",
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
        }}
        onMouseDown={(e) => {
          draggingRef.current = "sv";
          pickFromSv(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          draggingRef.current = "sv";
          const t = e.touches[0];
          pickFromSv(t.clientX, t.clientY);
        }}
      >
        <span
          style={{
            position: "absolute",
            left: `calc(${hsv.s * 100}% - 7px)`,
            top: `calc(${(1 - hsv.v) * 100}% - 7px)`,
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "2px solid #fff",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        />
      </div>

      <div className="shell-colorpicker-side">
        <div
          ref={hueRef}
          className="shell-colorpicker-hue"
          style={{
            position: "relative",
            background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          }}
          onMouseDown={(e) => {
            draggingRef.current = "hue";
            pickFromHue(e.clientX);
          }}
          onTouchStart={(e) => {
            draggingRef.current = "hue";
            pickFromHue(e.touches[0].clientX);
          }}
        >
          <span
            style={{
              position: "absolute",
              left: `calc(${(hsv.h / 360) * 100}% - 8px)`,
              top: -1,
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "2px solid #fff",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
              background: hueHex,
              pointerEvents: "none",
            }}
          />
        </div>

        <div className="shell-colorpicker-preview">
          <span className="shell-colorpicker-swatch" style={{ background: currentHex }} />
          <span style={{ fontSize: 12.5, color: "var(--s-text-2)", fontFamily: "'DM Sans', sans-serif" }}>
            Drag to pick a shade
          </span>
        </div>
      </div>
    </div>
  );
}
