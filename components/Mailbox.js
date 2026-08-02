"use client";

// Persistent bottom-right mailbox button, mounted once in TopNav so it's
// on every signed-in page. Shows a badge for unread "message requests" (see
// MessageRequestModal) addressed to this user, and a panel to read them.
//
// Deliberately just `where("toUid", "==", user.uid)` with no `orderBy` —
// combining an equality filter on one field with an orderBy on a different
// field needs a Firestore composite index, which this app avoids relying on
// (see app/page.js's redirect-lookup comment for the same reasoning).
// Sorting happens client-side instead, same pattern used there.

import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { IconMailbox } from "./icons";

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
  const [requests, setRequests] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "messageRequests"), where("toUid", "==", user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setRequests(list);
      },
      (err) => {
        // Missing the messageRequests Firestore rule shows up as
        // permission-denied here — fail quiet (empty mailbox) instead of
        // ever taking the rest of the topbar down with it.
        console.error("Mailbox listener failed:", err);
        setRequests([]);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!user) return null;

  const unreadCount = requests.filter((r) => !r.read).length;

  function markRead(r) {
    if (r.read) return;
    updateDoc(doc(db, "messageRequests", r.id), { read: true }).catch((err) =>
      console.error("Couldn't mark that as read:", err)
    );
  }

  return (
    <div ref={ref} style={{ position: "fixed", bottom: 20, right: 20, zIndex: 300 }}>
      {open && (
        <div
          className="shell-card"
          style={{ position: "absolute", bottom: "calc(100% + 12px)", right: 0, width: 320, maxHeight: 420, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--s-border)", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13 }}>
            Mailbox
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {requests.length === 0 && (
              <p style={{ fontSize: 12.5, color: "var(--s-text-3)", padding: 16 }}>No message requests yet.</p>
            )}
            {requests.map((r) => (
              <div
                key={r.id}
                onClick={() => markRead(r)}
                style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--s-border)",
                  cursor: r.read ? "default" : "pointer",
                  background: r.read ? "transparent" : "var(--s-bg-hover)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  {!r.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--s-amber)", flex: "none" }} />}
                  <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.subject}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--s-text-3)", flex: "none" }}>{timeAgo(r.createdAt?.toMillis?.())}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--s-text-3)", marginBottom: 3 }}>From {r.fromName || "Someone"}</div>
                <div style={{ fontSize: 12, color: "var(--s-text-2)", lineHeight: 1.4 }}>{r.message}</div>
              </div>
            ))}
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
