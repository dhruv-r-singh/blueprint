"use client";

// Custom-styled replacement for the browser's native <video controls> —
// used for video attachments in chat, since native controls render
// differently (and look out of place) across Chrome/Safari/Firefox/Electron.

import { useRef, useState } from "react";
import { IconPlay, IconPause, IconVolume, IconExpand } from "./icons";

function fmt(t) {
  if (!isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export default function VideoPlayer({ src, style }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [hover, setHover] = useState(false);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  function seek(e) {
    const v = videoRef.current;
    const val = Number(e.target.value);
    if (v) v.currentTime = val;
    setCurrent(val);
  }

  function changeVolume(e) {
    const val = Number(e.target.value);
    const v = videoRef.current;
    setVolume(val);
    setMuted(val === 0);
    if (v) {
      v.volume = val;
      v.muted = val === 0;
    }
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }

  const pct = duration ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: 320,
        maxWidth: "100%",
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid var(--s-border)",
        background: "#000",
        ...style,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <video
        ref={videoRef}
        src={src}
        style={{ width: "100%", maxHeight: 260, display: "block", cursor: "pointer" }}
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />
      <div className="shell-video-controls" style={{ opacity: hover || !playing ? 1 : 0 }}>
        <button type="button" className="shell-video-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
        </button>
        <span className="shell-video-time">
          {fmt(current)} / {fmt(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          onChange={seek}
          className="shell-video-seek"
          style={{ background: `linear-gradient(to right, var(--s-amber) ${pct}%, rgba(255,255,255,0.3) ${pct}%)` }}
          aria-label="Seek"
        />
        <button type="button" className="shell-video-btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
          <IconVolume size={13} muted={muted} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={changeVolume}
          className="shell-video-volume"
          aria-label="Volume"
        />
        <button type="button" className="shell-video-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
          <IconExpand size={13} />
        </button>
      </div>
    </div>
  );
}
