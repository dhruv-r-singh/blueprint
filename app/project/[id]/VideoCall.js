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
} from "firebase/firestore";
import { db } from "../../../lib/firebase";

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

export default function VideoCall({ projectId }) {
  const [inCall, setInCall] = useState(false);
  const [status, setStatus] = useState("Not connected");
  const [micOff, setMicOff] = useState(false);
  const [camOff, setCamOff] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const unsubsRef = useRef([]);

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

  async function startCall() {
    setInCall(true);
    setStatus("Requesting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { noiseSuppression: true, echoCancellation: true },
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
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
    cleanupListeners();
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setMicOff(false);
    setCamOff(false);
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

  return (
    <div style={{ border: "1px solid var(--s-border)", background: "var(--s-bg-side)", marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: inCall ? "1px solid var(--s-border)" : "none",
        }}
      >
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: "var(--s-text-3)" }}>
          {status}
        </span>
        {!inCall ? (
          <button
            onClick={startCall}
            style={{
              marginLeft: "auto",
              padding: "7px 14px",
              background: "#5fbf8f",
              color: "#0a2419",
              border: "none",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Start call
          </button>
        ) : (
          <button
            onClick={endCall}
            style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--s-text-3)", fontSize: 18, cursor: "pointer" }}
          >
            ×
          </button>
        )}
      </div>

      {inCall && (
        <>
          <div style={{ position: "relative", width: "100%", height: 320, background: "#000" }}>
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
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 14, padding: 12 }}>
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
            <button onClick={endCall} style={ctrlBtnStyle(true)} aria-label="Leave call">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 9c-3 0-5.6.9-7.7 2.4a1.3 1.3 0 0 0-.2 1.9l1.8 2.2c.4.5 1.1.6 1.6.3.9-.6 1.9-1 3-1.3l.4-1.8a1 1 0 0 1 1-.8h.2a1 1 0 0 1 1 .8l.4 1.8c1.1.3 2.1.7 3 1.3.5.3 1.2.2 1.6-.3l1.8-2.2a1.3 1.3 0 0 0-.2-1.9C17.6 9.9 15 9 12 9z" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
