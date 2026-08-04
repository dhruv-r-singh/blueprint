"use client";

import { useEffect, useRef, useState } from "react";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  deleteDoc,
  getDocs,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { uploadFile } from "../../../lib/storage";
import { IconSparkle } from "../../components/icons";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  ],
};

function ctrlBtnStyle(danger) {
  return {
    width: 42,
    height: 42,
    borderRadius: "50%",
    background: danger ? "#e5534b" : "var(--s-bg-elevated)",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

export default function VideoCall({ projectId, meetingId, onOpenActivities, startSignal, preferredMicId, preferredCamId, joinMicMuted, joinCamOff, autoRecord }) {
  const [inCall, setInCall] = useState(false);
  const [status, setStatus] = useState("Not connected");
  const [micOff, setMicOff] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [micDevices, setMicDevices] = useState([]);
  const [camDevices, setCamDevices] = useState([]);
  // Local-recording state (see startRecording below) — `recording` is
  // whether *this* browser is currently capturing; `remoteRecording` is
  // filled in from the meeting message doc whenever *anyone* (including
  // this user, via their own write) is recording, so the "Recording…"
  // indicator shows for every participant, not just whoever hit the button.
  const [recording, setRecording] = useState(false);
  const [recordUploading, setRecordUploading] = useState(false);
  const [remoteRecording, setRemoteRecording] = useState(null); // { by, byName } | null
  // Seeded from the "Voice & Video" preferences page (/account) if set —
  // still just a starting point, the in-call device picker can always
  // override it for this session.
  const [selectedMicId, setSelectedMicId] = useState(preferredMicId || "");
  const [selectedCamId, setSelectedCamId] = useState(preferredCamId || "");
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const cameraTrackRef = useRef(null); // kept so screen-share can hand the camera track back
  const unsubsRef = useRef([]);
  const callFrameRef = useRef(null);
  const recorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordCanvasRef = useRef(null);
  const recordRafRef = useRef(null);
  const recordAudioCtxRef = useRef(null);
  const recordStartRef = useRef(0);
  const autoRecordTriedRef = useRef(false); // guards against re-triggering auto-record every re-render while in the same call

  const roomId = `call-${projectId}`;

  function cleanupListeners() {
    unsubsRef.current.forEach((u) => u());
    unsubsRef.current = [];
  }

  async function clearRoomDocs(callDocRef) {
    const callerCands = await getDocs(collection(callDocRef, "callerCandidates"));
    const calleeCands = await getDocs(collection(callDocRef, "calleeCandidates"));
    for (const d of callerCands.docs) await deleteDoc(d.ref);
    for (const d of calleeCands.docs) await deleteDoc(d.ref);
    await setDoc(callDocRef, {});
  }

  function createPeerConnection() {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
    const remoteStream = new MediaStream();
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => remoteStream.addTrack(track));
      setStatus("Connected");
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setStatus("Connected");
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") setStatus("Connection lost");
    };
    return pc;
  }

  async function becomeCaller(callDocRef) {
    setStatus("Waiting for someone to join…");
    const pc = createPeerConnection();
    const callerCandidates = collection(callDocRef, "callerCandidates");
    pc.onicecandidate = (event) => {
      if (event.candidate) addDoc(callerCandidates, event.candidate.toJSON());
    };
    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);
    await setDoc(callDocRef, { offer: { type: offerDescription.type, sdp: offerDescription.sdp } });

    const unsubDoc = onSnapshot(callDocRef, (snap) => {
      const data = snap.data();
      if (!pc.currentRemoteDescription && data && data.answer) {
        pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });
    unsubsRef.current.push(unsubDoc);

    const unsubCandidates = onSnapshot(collection(callDocRef, "calleeCandidates"), (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      });
    });
    unsubsRef.current.push(unsubCandidates);
  }

  async function becomeCallee(callDocRef, offer) {
    setStatus("Joining…");
    const pc = createPeerConnection();
    const calleeCandidates = collection(callDocRef, "calleeCandidates");
    pc.onicecandidate = (event) => {
      if (event.candidate) addDoc(calleeCandidates, event.candidate.toJSON());
    };
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);
    await updateDoc(callDocRef, { answer: { type: answerDescription.type, sdp: answerDescription.sdp } });

    const unsubCandidates = onSnapshot(collection(callDocRef, "callerCandidates"), (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      });
    });
    unsubsRef.current.push(unsubCandidates);
  }

  async function refreshDeviceList() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(devices.filter((d) => d.kind === "audioinput"));
      setCamDevices(devices.filter((d) => d.kind === "videoinput"));
    } catch (err) {
      console.error("Couldn't list devices:", err);
    }
  }

  async function startCall() {
    setInCall(true);
    setStatus("Requesting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedCamId ? { deviceId: { exact: selectedCamId } } : true,
        audio: selectedMicId
          ? { deviceId: { exact: selectedMicId }, noiseSuppression: true, echoCancellation: true }
          : { noiseSuppression: true, echoCancellation: true },
      });
      localStreamRef.current = stream;
      cameraTrackRef.current = stream.getVideoTracks()[0] || null;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      // Labels are only populated after permission is granted, so refresh
      // the device list now that we have mic/camera access.
      refreshDeviceList();
      const camTrack = stream.getVideoTracks()[0];
      const micTrack = stream.getAudioTracks()[0];
      if (camTrack) setSelectedCamId(camTrack.getSettings().deviceId || "");
      if (micTrack) setSelectedMicId(micTrack.getSettings().deviceId || "");
      // "Join with camera off / mic muted" preferences (Preferences → Voice
      // & Video) — disable the tracks right away rather than requesting a
      // stream without them, so switching either back on mid-call doesn't
      // need to re-request media.
      if (joinCamOff && camTrack) {
        camTrack.enabled = false;
        setCamOff(true);
      }
      if (joinMicMuted && micTrack) {
        micTrack.enabled = false;
        setMicOff(true);
      }
    } catch (err) {
      setStatus("Camera/mic permission denied");
      setInCall(false);
      return;
    }

    const callDocRef = doc(db, "calls", roomId);
    const snap = await getDoc(callDocRef);
    const data = snap.exists() ? snap.data() : null;

    if (!data || !data.offer || data.answer) {
      await clearRoomDocs(callDocRef);
      await becomeCaller(callDocRef);
    } else {
      await becomeCallee(callDocRef, data.offer);
    }
  }

  function endCall() {
    if (recorderRef.current) stopRecording(); // flushes + uploads via the recorder's onstop -> finishRecording
    autoRecordTriedRef.current = false;
    cleanupListeners();
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    cameraTrackRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (document.fullscreenElement) document.exitFullscreen?.();
    setMicOff(false);
    setCamOff(false);
    setScreenSharing(false);
    setDeviceMenuOpen(false);
    setInCall(false);
    setStatus("Not connected");
  }

  useEffect(() => {
    return () => endCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMic() {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getAudioTracks()[0];
    track.enabled = !track.enabled;
    setMicOff(!track.enabled);
  }

  function toggleCam() {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    track.enabled = !track.enabled;
    setCamOff(!track.enabled);
  }

  /** Swaps the outgoing audio track for one from a different microphone, mid-call. */
  async function switchMic(deviceId) {
    setSelectedMicId(deviceId);
    setDeviceMenuOpen(false);
    if (!localStreamRef.current) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, noiseSuppression: true, echoCancellation: true },
      });
      const newTrack = newStream.getAudioTracks()[0];
      const oldTrack = localStreamRef.current.getAudioTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "audio");
      if (sender) await sender.replaceTrack(newTrack);
      if (oldTrack) {
        oldTrack.stop();
        localStreamRef.current.removeTrack(oldTrack);
      }
      newTrack.enabled = !micOff;
      localStreamRef.current.addTrack(newTrack);
    } catch (err) {
      console.error("Couldn't switch microphone:", err);
    }
  }

  /** Swaps the outgoing video track for one from a different camera, mid-call. */
  async function switchCam(deviceId) {
    setSelectedCamId(deviceId);
    setDeviceMenuOpen(false);
    if (!localStreamRef.current || screenSharing) return; // don't fight with an active screen share
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const oldTrack = localStreamRef.current.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);
      if (oldTrack) {
        oldTrack.stop();
        localStreamRef.current.removeTrack(oldTrack);
      }
      newTrack.enabled = !camOff;
      localStreamRef.current.addTrack(newTrack);
      cameraTrackRef.current = newTrack;
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    } catch (err) {
      console.error("Couldn't switch camera:", err);
    }
  }

  async function toggleScreenShare() {
    if (screenSharing) {
      stopScreenShare();
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = display.getVideoTracks()[0];
      screenStreamRef.current = display;
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(screenTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = display;
      setScreenSharing(true);
      // If the user stops sharing via the browser's own "Stop sharing" UI
      // (rather than our button), fall back to the camera automatically.
      screenTrack.onended = () => stopScreenShare();
    } catch (err) {
      console.error("Screen share failed or was cancelled:", err);
    }
  }

  async function stopScreenShare() {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setScreenSharing(false);
    const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
    if (sender && cameraTrackRef.current) await sender.replaceTrack(cameraTrackRef.current);
    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
  }

  /**
   * Local recording — there's no server-side SFU here (this is a plain P2P
   * call), so "recording the meeting" means compositing what's already on
   * screen (remote video full-frame, local video as a corner picture-in-
   * picture, both parties' audio mixed together) into one MediaStream via a
   * hidden canvas + an AudioContext mix bus, and running that through
   * MediaRecorder — same Blob-to-Storage pattern the voice messages use.
   */
  async function startRecording() {
    if (!meetingId || recording) return;
    const uid = auth.currentUser?.uid;
    const name = auth.currentUser?.displayName || auth.currentUser?.email || "Unknown";
    if (!uid) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 540;
      recordCanvasRef.current = canvas;
      const ctx = canvas.getContext("2d");
      const drawFrame = () => {
        if (!ctx) return;
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const remoteVideo = remoteVideoRef.current;
        const localVideo = localVideoRef.current;
        if (remoteVideo && remoteVideo.videoWidth) {
          ctx.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);
        }
        if (localVideo && localVideo.videoWidth) {
          const pw = canvas.width * 0.22;
          const ph = canvas.height * 0.22;
          ctx.drawImage(localVideo, canvas.width - pw - 14, canvas.height - ph - 14, pw, ph);
        }
        recordRafRef.current = requestAnimationFrame(drawFrame);
      };
      drawFrame();

      const canvasStream = canvas.captureStream(25);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      recordAudioCtxRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();
      const localAudioTracks = localStreamRef.current?.getAudioTracks() || [];
      if (localAudioTracks.length) {
        audioCtx.createMediaStreamSource(new MediaStream(localAudioTracks)).connect(dest);
      }
      const remoteAudioTracks = remoteVideoRef.current?.srcObject?.getAudioTracks?.() || [];
      if (remoteAudioTracks.length) {
        audioCtx.createMediaStreamSource(new MediaStream(remoteAudioTracks)).connect(dest);
      }

      const mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";
      const recorder = new MediaRecorder(mixedStream, { mimeType });
      recordChunksRef.current = [];
      recordStartRef.current = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      recorder.onstop = () => finishRecording();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);

      const meetingRef = doc(db, "projects", projectId, "messages", meetingId);
      await updateDoc(meetingRef, { recordingActive: true, recordingBy: uid, recordingByName: name });
    } catch (err) {
      console.error("Couldn't start recording:", err);
      if (recordRafRef.current) cancelAnimationFrame(recordRafRef.current);
      recordRafRef.current = null;
      recordAudioCtxRef.current?.close().catch(() => {});
      recordAudioCtxRef.current = null;
    }
  }

  /** Stops the MediaRecorder — the actual upload/save happens in its onstop handler (finishRecording), once the last chunk is flushed. */
  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  function toggleRecording() {
    if (recording) stopRecording();
    else startRecording();
  }

  /** Uploads the finished recording and appends it to the meeting message's `recordings` list, attributed to whoever recorded it. */
  async function finishRecording() {
    if (recordRafRef.current) cancelAnimationFrame(recordRafRef.current);
    recordRafRef.current = null;
    recordAudioCtxRef.current?.close().catch(() => {});
    recordAudioCtxRef.current = null;
    const durationSec = Math.round((Date.now() - recordStartRef.current) / 1000);
    const blob = new Blob(recordChunksRef.current, { type: "video/webm" });
    recordChunksRef.current = [];
    setRecording(false);

    const uid = auth.currentUser?.uid;
    const name = auth.currentUser?.displayName || auth.currentUser?.email || "Unknown";
    if (!meetingId || !uid) return;
    const meetingRef = doc(db, "projects", projectId, "messages", meetingId);
    if (blob.size === 0) {
      await updateDoc(meetingRef, { recordingActive: false, recordingBy: null, recordingByName: null }).catch(() => {});
      return;
    }
    setRecordUploading(true);
    try {
      const path = `projects/${projectId}/meetings/${meetingId}/recording-${Date.now()}.webm`;
      const url = await uploadFile(path, blob, () => {});
      await updateDoc(meetingRef, {
        recordingActive: false,
        recordingBy: null,
        recordingByName: null,
        recordings: arrayUnion({ url, by: uid, byName: name, durationSec, at: Date.now() }),
      });
    } catch (err) {
      console.error("Couldn't upload the recording:", err);
      await updateDoc(meetingRef, { recordingActive: false, recordingBy: null, recordingByName: null }).catch(() => {});
    } finally {
      setRecordUploading(false);
    }
  }

  function toggleFullscreen() {
    const el = callFrameRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch((err) => console.error("Couldn't enter fullscreen:", err));
    } else {
      document.exitFullscreen?.();
    }
  }

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", refreshDeviceList);
      return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDeviceList);
    }
  }, []);

  // Lets a parent (the chat composer's "+" menu) start a meeting from
  // outside this component — bump startSignal (e.g. Date.now()) to trigger
  // it, same as clicking "Start meeting" here directly.
  useEffect(() => {
    if (startSignal) startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  // Tracks this user as a participant on the meeting's chat message while
  // in the call, and marks the meeting "ended" once the last participant
  // leaves — this is what makes the chat card (and Files) flip from "in
  // progress" to "Ended" for everyone, not just the person who leaves.
  useEffect(() => {
    if (!inCall || !meetingId) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const meetingRef = doc(db, "projects", projectId, "messages", meetingId);
    updateDoc(meetingRef, { participantUids: arrayUnion(uid), status: "live" }).catch(() => {});
    return () => {
      (async () => {
        try {
          await updateDoc(meetingRef, { participantUids: arrayRemove(uid) });
          const snap = await getDoc(meetingRef);
          const remaining = snap.data()?.participantUids || [];
          if (remaining.length === 0) {
            await updateDoc(meetingRef, { status: "ended", endedAt: serverTimestamp() });
          }
        } catch (err) {
          console.error("Couldn't update meeting participants:", err);
        }
      })();
    };
  }, [inCall, meetingId, projectId]);

  // Shows the "Recording…" indicator to every participant, not just
  // whoever's browser is actually capturing (recordingActive/recordingBy
  // are written by startRecording/finishRecording above).
  useEffect(() => {
    if (!inCall || !meetingId) {
      setRemoteRecording(null);
      return;
    }
    const meetingRef = doc(db, "projects", projectId, "messages", meetingId);
    const unsub = onSnapshot(meetingRef, (snap) => {
      const data = snap.data();
      setRemoteRecording(data?.recordingActive ? { by: data.recordingBy, byName: data.recordingByName } : null);
    });
    return () => unsub();
  }, [inCall, meetingId, projectId]);

  // "Auto-record my meetings" (Preferences → Voice & Video) — starts
  // recording automatically once the local stream is up. Guarded by
  // autoRecordTriedRef so it only fires once per call, not on every
  // re-render while autoRecord stays true.
  useEffect(() => {
    if (inCall && meetingId && autoRecord && !autoRecordTriedRef.current) {
      autoRecordTriedRef.current = true;
      const t = setTimeout(() => startRecording(), 800);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCall, meetingId, autoRecord]);

  // No meeting in progress and nothing pending — render nothing at all.
  // Starting a meeting now lives in the chat composer's "+" menu ("Start a
  // meeting"), so there's no need for a persistent bar sitting above the
  // chat just to hold a single button.
  if (!inCall) return null;

  return (
    <div
      ref={callFrameRef}
      style={{
        border: "1px solid var(--s-border)",
        background: "var(--s-bg-side)",
        marginBottom: 20,
        display: "flex",
        flexDirection: "column",
        height: isFullscreen ? "100vh" : "auto",
      }}
    >
      <div style={{ position: "relative", width: "100%", flex: isFullscreen ? "1 1 auto" : "none", height: isFullscreen ? "auto" : 320, minHeight: 0, background: "#000" }}>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", background: "#111" }}
            />
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                position: "absolute",
                bottom: 10,
                right: 10,
                width: 110,
                height: 74,
                objectFit: "cover",
                borderRadius: 8,
                border: "2px solid var(--s-bg-side)",
                background: "#111",
                transform: "scaleX(-1)",
              }}
            />
            <span
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                padding: "4px 10px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 11,
              }}
            >
              {status}
            </span>
            {remoteRecording && (
              <span
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "rgba(229,83,75,0.85)",
                  color: "#fff",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 11,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />
                Recording{remoteRecording.by === auth.currentUser?.uid ? "" : ` — ${remoteRecording.byName}`}
              </span>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 14, padding: 12, position: "relative", flexWrap: "wrap", flex: "none" }}>
            {meetingId && (
              <button
                onClick={toggleRecording}
                style={ctrlBtnStyle(recording)}
                aria-label={recording ? "Stop recording" : "Record this meeting"}
                title={recordUploading ? "Saving recording…" : recording ? "Stop recording" : "Record this meeting"}
                disabled={recordUploading}
              >
                {recording ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="7" />
                  </svg>
                )}
              </button>
            )}
            <button onClick={toggleMic} style={ctrlBtnStyle(micOff)} aria-label="Toggle microphone">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
            <button onClick={toggleCam} style={ctrlBtnStyle(camOff)} aria-label="Toggle camera">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="14" height="12" rx="2" />
                <path d="M23 7l-7 5 7 5V7z" />
              </svg>
            </button>

            <div style={{ position: "relative" }}>
              <button
                onClick={() => setDeviceMenuOpen((v) => !v)}
                style={ctrlBtnStyle(false)}
                aria-label="Choose microphone/camera"
                title="Choose microphone/camera"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 0 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z" />
                </svg>
              </button>
              {deviceMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    bottom: 50,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "var(--s-bg-side)",
                    border: "1px solid var(--s-border)",
                    borderRadius: 10,
                    padding: 10,
                    width: 240,
                    boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                    zIndex: 30,
                  }}
                >
                  <label style={{ display: "block", fontSize: 10, color: "var(--s-text-3)", marginBottom: 3 }}>Microphone</label>
                  <select
                    value={selectedMicId}
                    onChange={(e) => switchMic(e.target.value)}
                    style={{ width: "100%", marginBottom: 10, background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 6, padding: 6, color: "var(--s-text)", fontSize: 12 }}
                  >
                    {micDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>
                    ))}
                  </select>
                  <label style={{ display: "block", fontSize: 10, color: "var(--s-text-3)", marginBottom: 3 }}>Camera</label>
                  <select
                    value={selectedCamId}
                    onChange={(e) => switchCam(e.target.value)}
                    disabled={screenSharing}
                    style={{ width: "100%", background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 6, padding: 6, color: "var(--s-text)", fontSize: 12 }}
                  >
                    {camDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera"}</option>
                    ))}
                  </select>
                  {screenSharing && (
                    <div style={{ fontSize: 10, color: "var(--s-text-3)", marginTop: 6 }}>Camera switching is off while screen sharing.</div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={toggleScreenShare}
              style={ctrlBtnStyle(false)}
              aria-label={screenSharing ? "Stop screen share" : "Share your screen"}
              title={screenSharing ? "Stop screen share" : "Share your screen"}
            >
              {screenSharing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--s-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="18" x2="12" y2="21" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="18" x2="12" y2="21" />
                </svg>
              )}
            </button>

            {onOpenActivities && (
              <button onClick={onOpenActivities} style={ctrlBtnStyle(false)} aria-label="Open whiteboard" title="Whiteboard">
                <IconSparkle size={16} />
              </button>
            )}

            <button onClick={toggleFullscreen} style={ctrlBtnStyle(false)} aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {isFullscreen ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
                </svg>
              )}
            </button>

            <button onClick={endCall} style={ctrlBtnStyle(true)} aria-label="Leave meeting">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 9c-3 0-5.6.9-7.7 2.4a1.3 1.3 0 0 0-.2 1.9l1.8 2.2c.4.5 1.1.6 1.6.3.9-.6 1.9-1 3-1.3l.4-1.8a1 1 0 0 1 1-.8h.2a1 1 0 0 1 1 .8l.4 1.8c1.1.3 2.1.7 3 1.3.5.3 1.2.2 1.6-.3l1.8-2.2a1.3 1.3 0 0 0-.2-1.9C17.6 9.9 15 9 12 9z" />
              </svg>
            </button>
          </div>
    </div>
  );
}
