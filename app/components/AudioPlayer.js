"use client";

// Custom-styled replacement for the browser's native <audio controls> —
// used for both audio-file attachments and recorded voice messages in
// chat, matching VideoPlayer's look/pattern instead of each browser's
// wildly different native audio widget.

import { useEffect, useRef, useState } from "react";
import { IconPlay, IconPause, IconVolume, IconMic } from "./icons";

function fmt(t) {
  if (!isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export default function AudioPlayer({ src, voice = false, style, autoPlay = false }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(false);

  // "Autoplay voice messages" (Preferences → Notifications → Composing) —
  // the parent only ever flips `autoPlay` true for a message that just
  // arrived (never for ones already in history), so this only fires once
  // per real new voice message. Browsers may still block it if the tab
  // hasn't had a user gesture yet — that's fine, it just stays paused.
  useEffect(() => {
    if (autoPlay) audioRef.current?.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay]);

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  }

  // Same Infinity-duration workaround as VideoPlayer — MediaRecorder webm
  // blobs (voice messages) commonly need a forced seek before the browser
  // will report a real duration.
  function handleLoadedMetadata(e) {
    const a = e.currentTarget;
    if (a.duration === Infinity || Number.isNaN(a.duration)) {
      const onTimeUpdate = () => {
        a.currentTime = 0;
        a.removeEventListener("timeupdate", onTimeUpdate);
        setDuration(a.duration === Infinity ? 0 : a.duration);
      };
      a.addEventListener("timeupdate", onTimeUpdate);
      a.currentTime = 1e9;
    } else {
      setDuration(a.duration);
    }
  }

  function seek(e) {
    const a = audioRef.current;
    const val = Number(e.target.value);
    if (a) a.currentTime = val;
    setCurrent(val);
  }

  function changeVolume(e) {
    const val = Number(e.target.value);
    const a = audioRef.current;
    setVolume(val);
    setMuted(val === 0);
    if (a) {
      a.volume = val;
      a.muted = val === 0;
    }
  }

  function toggleMute() {
    const a = audioRef.current;
    if (!a) return;
    a.muted = !a.muted;
    setMuted(a.muted);
  }

  const pct = duration ? Math.min(100, (current / duration) * 100) : 0;

  if (error) {
    return (
      <div className="shell-audio-player" style={{ color: "var(--s-text-3)", fontSize: 12, ...style }}>
        Couldn&rsquo;t load this audio.
      </div>
    );
  }

  return (
    <div className="shell-audio-player" style={style}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setPlaying(false)}
        onError={() => setError(true)}
        style={{ display: "none" }}
      />
      <button type="button" className="shell-audio-play-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <IconPause size={13} /> : voice ? <IconMic size={13} /> : <IconPlay size={13} />}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={current}
        onChange={seek}
        className="shell-audio-seek"
        style={{ background: `linear-gradient(to right, var(--s-amber) ${pct}%, var(--s-border) ${pct}%)` }}
        aria-label="Seek"
      />
      <span className="shell-audio-time">{fmt(current || 0)} / {fmt(duration)}</span>
      <button type="button" className="shell-audio-play-btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
        <IconVolume size={12} muted={muted} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={changeVolume}
        className="shell-audio-volume"
        aria-label="Volume"
      />
    </div>
  );
}
