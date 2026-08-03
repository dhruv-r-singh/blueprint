"use client";

// Persistent bottom-right mailbox button, mounted once in TopNav so it's
// on every signed-in page. Shows a badge for unread "message requests" (see
// MessageRequestModal) addressed to this user, and a panel to read/respond
// to them.
//
// A message request starts as a one-way "pending" note from a stranger.
// Nothing resembling real back-and-forth chat happens until the recipient
// explicitly Accepts it — only then does a small reply thread (capped at
// MAX_THREAD_LENGTH total messages) unlock on both sides. Deny just closes
// it out with no reply option. This is deliberately NOT full chat: no
// realtime typing, no attachments, just a short capped exchange — see the
// "quite limited" framing in the original request.
//
// Deliberately just `where(...)` with no `orderBy` — combining an equality
// filter on one field with an orderBy on a different field needs a
// Firestore composite index, which this app avoids relying on (see
// app/page.js's redirect-lookup comment for the same reasoning). Sorting
// happens client-side instead, same pattern used there. For the same
// reason, "requests I sent" and "requests sent to me" are two separate
// listeners merged client-side rather than one OR query.

import { useEffect, useRef, useState } from "react";
import { arrayUnion, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { IconMailbox } from "./icons";

const MAX_THREAD_LENGTH = 8;

function timeAgo(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function Mailbox({ user }) {
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [open, setOpen] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [busy, setBusy] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!user?.uid) return;
    const qIn = query(collection(db, "messageRequests"), where("toUid", "==", user.uid));
    const unsubIn = onSnapshot(
      qIn,
      (snap) => setIncoming(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        // Missing the messageRequests Firestore rule shows up as
        // permission-denied here — fail quiet (empty mailbox) instead of
        // ever taking the rest of the topbar down with it.
        console.error("Mailbox listener failed:", err);
        setIncoming([]);
      }
    );
    const qOut = query(collection(db, "messageRequests"), where("fromUid", "==", user.uid));
    const unsubOut = onSnapshot(
      qOut,
      (snap) => setOutgoing(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error("Mailbox (sent) listener failed:", err);
        setOutgoing([]);
      }
    );
    return () => {
      unsubIn();
      unsubOut();
    };
  }, [user?.uid]);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!user) return null;

  const requests = [
    ...incoming.map((r) => ({ ...r, direction: "in" })),
    ...outgoing.map((r) => ({ ...r, direction: "out" })),
  ].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  const unreadCount = incoming.filter((r) => !r.read).length;

  function markRead(r) {
    if (r.direction !== "in" || r.read) return;
    updateDoc(doc(db, "messageRequests", r.id), { read: true }).catch((err) =>
      console.error("Couldn't mark that as read:", err)
    );
  }

  async function respond(r, status) {
    setBusy(r.id);
    try {
      await updateDoc(doc(db, "messageRequests", r.id), { status, read: true });
    } catch (err) {
      console.error(`Couldn't ${status === "accepted" ? "accept" : "decline"} that request:`, err);
    } finally {
      setBusy(null);
    }
  }

  async function sendReply(r) {
    const text = (replyDrafts[r.id] || "").trim();
    if (!text) return;
    setBusy(r.id);
    try {
      await updateDoc(doc(db, "messageRequests", r.id), {
        replies: arrayUnion({ from: user.uid, text, at: Date.now() }),
      });
      setReplyDrafts((d) => ({ ...d, [r.id]: "" }));
    } catch (err) {
      console.error("Couldn't send that reply:", err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} style={{ position: "fixed", bottom: 20, right: 20, zIndex: 300 }}>
      {open && (
        <div
          className="shell-card"
          style={{ position: "absolute", bottom: "calc(100% + 12px)", right: 0, width: 340, maxHeight: 460, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--s-border)", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13 }}>
            Mailbox
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {requests.length === 0 && (
              <p style={{ fontSize: 12.5, color: "var(--s-text-3)", padding: 16 }}>No message requests yet.</p>
            )}
            {requests.map((r) => {
              const replies = r.replies || [];
              const threadLength = 1 + replies.length;
              const atLimit = threadLength >= MAX_THREAD_LENGTH;
              return (
                <div
                  key={r.direction + r.id}
                  onClick={() => markRead(r)}
                  style={{
                    padding: "12px 14px",
                    borderBottom: "1px solid var(--s-border)",
                    cursor: r.direction === "in" && !r.read ? "pointer" : "default",
                    background: r.direction === "in" && !r.read ? "var(--s-bg-hover)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    {r.direction === "in" && !r.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--s-amber)", flex: "none" }} />}
                    <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.subject}
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--s-text-3)", flex: "none" }}>{timeAgo(r.createdAt?.toMillis?.())}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)", marginBottom: 6 }}>
                    {r.direction === "in" ? `From ${r.fromName || "Someone"}` : `To ${r.toLabel || "Someone"}`}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--s-text-2)", lineHeight: 1.4, marginBottom: 6 }}>{r.message}</div>

                  {(!r.status || r.status === "pending") && r.direction === "in" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => respond(r, "accepted")}
                        className="shell-task-add-btn"
                        style={{ fontSize: 11, padding: "4px 12px", height: 28 }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => respond(r, "denied")}
                        className="shell-btn-outline"
                        style={{ fontSize: 11, padding: "4px 12px", height: 28 }}
                      >
                        Deny
                      </button>
                    </div>
                  )}

                  {(!r.status || r.status === "pending") && r.direction === "out" && (
                    <div style={{ fontSize: 11, color: "var(--s-text-3)", fontStyle: "italic" }}>Waiting for them to accept…</div>
                  )}

                  {r.status === "denied" && (
                    <div style={{ fontSize: 11, color: "var(--s-text-3)" }}>Declined</div>
                  )}

                  {r.status === "accepted" && (
                    <div onClick={(e) => e.stopPropagation()}>
                      {replies.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "6px 0", paddingLeft: 8, borderLeft: "2px solid var(--s-border)" }}>
                          {replies.map((rep, i) => (
                            <div key={i} style={{ fontSize: 11.5 }}>
                              <span style={{ color: "var(--s-text-3)" }}>{rep.from === user.uid ? "You: " : ""}</span>
                              <span style={{ color: "var(--s-text-2)" }}>{rep.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {atLimit ? (
                        <div style={{ fontSize: 10.5, color: "var(--s-text-3)", fontStyle: "italic", marginTop: 4 }}>
                          This is a limited exchange — the thread is capped here.
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <input
                            value={replyDrafts[r.id] || ""}
                            onChange={(e) => setReplyDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), sendReply(r))}
                            placeholder="Reply…"
                            className="shell-input"
                            style={{ flex: 1, fontSize: 11.5, padding: "6px 8px" }}
                          />
                          <button
                            type="button"
                            disabled={busy === r.id || !(replyDrafts[r.id] || "").trim()}
                            onClick={() => sendReply(r)}
                            className="shell-task-add-btn"
                            style={{ fontSize: 11, padding: "0 10px" }}
                          >
                            Send
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Mailbox"
        style={{
          position: "relative",
          width: 46,
          height: 46,
          borderRadius: "50%",
          background: "var(--s-bg-elevated)",
          border: "1px solid var(--s-border)",
          color: "var(--s-text-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
        }}
      >
        <IconMailbox size={19} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: "0 4px",
              borderRadius: 999,
              background: "#e5534b",
              color: "#fff",
              fontSize: 10.5,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
