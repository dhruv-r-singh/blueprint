"use client";

// Lightweight crop/rotate/scale editor for profile pictures. No external
// cropper library — just a canvas the user can rotate and zoom, rendered
// live, exported to a square JPEG blob on save. Circular framing is done
// with CSS border-radius wherever the result is displayed (matches how
// avatars already render elsewhere in the app), so this doesn't need to
// clip pixels itself.

import { useEffect, useRef, useState } from "react";

const OUTPUT_SIZE = 320;

export default function AvatarEditor({ file, onCancel, onSave, saving, error }) {
  const [imgEl, setImgEl] = useState(null);
  const [rotation, setRotation] = useState(0); // degrees, -180..180
  const [zoom, setZoom] = useState(1); // 1 = fit-to-cover, up to 3x
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!imgEl || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    ctx.save();
    ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const baseScale = Math.max(OUTPUT_SIZE / imgEl.width, OUTPUT_SIZE / imgEl.height);
    const scale = baseScale * zoom;
    ctx.scale(scale, scale);
    ctx.drawImage(imgEl, -imgEl.width / 2, -imgEl.height / 2);
    ctx.restore();
  }, [imgEl, rotation, zoom]);

  function handleSave() {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob((blob) => blob && onSave(blob), "image/jpeg", 0.92);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        style={{
          background: "var(--s-bg-side)",
          border: "1px solid var(--s-border)",
          borderRadius: 14,
          padding: 24,
          width: 360,
          maxWidth: "100%",
        }}
      >
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
          Edit photo
        </p>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          {imgEl ? (
            <canvas
              ref={canvasRef}
              width={OUTPUT_SIZE}
              height={OUTPUT_SIZE}
              style={{ width: 200, height: 200, borderRadius: "50%", background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)" }}
            />
          ) : (
            <div style={{ width: 200, height: 200, borderRadius: "50%", background: "var(--s-bg-elevated)" }} />
          )}
        </div>

        <label style={{ display: "block", fontSize: 11, color: "var(--s-text-3)", marginBottom: 4 }}>
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "block", fontSize: 11, color: "var(--s-text-3)", marginBottom: 18 }}>
          Rotate
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={rotation}
            onChange={(e) => setRotation(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>

        {error && <p style={{ fontSize: 11, color: "#e5534b", marginBottom: 10 }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onCancel} className="ghost" disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !imgEl}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
