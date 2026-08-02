"use client";

// Small compose modal used for "request to message" — a subject + message
// sent as a one-off request rather than dropping straight into a project's
// team chat (which assumes you're already teammates). Reused for both
// messaging a real teammate (has a real `toUid`, shows up in their Mailbox)
// and "messaging" a seed candidate on the Matches tab (no real account
// behind it, so it's saved as an outreach record but never actually
// delivered anywhere — see the note rendered when `toUid` is null).

import { useState } from "react";

export default function MessageRequestModal({ toLabel, toUid, onClose, onSend }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSending(true);
    setError("");
    try {
      await onSend({ subject: subject.trim(), message: message.trim() });
      setSent(true);
    } catch (err) {
      setError(err.message || "Couldn't send that request. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={onClose}
    >
      <div className="shell-card" style={{ width: "min(440px, 100%)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Request sent</div>
            <p style={{ fontSize: 13, color: "var(--s-text-2)", marginBottom: 18 }}>
              {toUid
                ? `${toLabel} will see it the next time they check their mailbox.`
                : `Saved as an outreach note on ${toLabel}'s card. This is a seed profile, not a real account, so there's no one to actually deliver it to.`}
            </p>
            <button type="button" onClick={onClose} className="shell-task-add-btn" style={{ padding: "8px 18px" }}>
              Done
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              Message {toLabel}
            </div>
            <p style={{ fontSize: 12, color: "var(--s-text-3)", marginBottom: 16 }}>
              {toUid
                ? "Sends as a request, not a direct message — they'll see it in their mailbox and can take it from there."
                : "This is a seed profile for demo purposes, not a real account — this saves as a note rather than actually reaching anyone."}
            </p>
            {error && <p className="notice" style={{ marginBottom: 12 }}>{error}</p>}
            <label style={{ fontSize: 11, color: "var(--s-text-3)", display: "block", marginBottom: 6 }}>Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What's this about?"
              className="shell-input"
              style={{ width: "100%", marginBottom: 14 }}
              autoFocus
            />
            <label style={{ fontSize: 11, color: "var(--s-text-3)", display: "block", marginBottom: 6 }}>Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Say a bit about why you're reaching out."
              rows={4}
              className="shell-input"
              style={{ width: "100%", marginBottom: 18, resize: "vertical", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={sending || !subject.trim() || !message.trim()} className="shell-task-add-btn" style={{ padding: "8px 18px" }}>
                {sending ? "Sending…" : "Send request"}
              </button>
              <button type="button" onClick={onClose} className="ghost">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
