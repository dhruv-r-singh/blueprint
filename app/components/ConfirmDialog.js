"use client";

// Shared in-app confirmation panel — replaces every window.confirm() call
// in the app. Native confirm() renders as the browser/OS's own dialog
// chrome (title bar, system font, "This page says" boilerplate), which
// looks jarring next to the rest of the app's styling — this matches the
// same overlay + .shell-card panel pattern already used for every other
// modal (see components/MessageRequestModal.js). Pair with the
// askConfirm() promise helper defined alongside the `confirmDialog` state
// in whichever page renders this (project/[id]/page.js, account/page.js).
export default function ConfirmDialog({ message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = true, onConfirm, onCancel }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={onCancel}
    >
      <div className="shell-card" style={{ width: "min(420px, 100%)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <p style={{ fontSize: 13.5, color: "var(--s-text)", marginBottom: 20, lineHeight: 1.5, whiteSpace: "pre-line" }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} className="ghost">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={danger ? "shell-btn-danger" : "shell-task-add-btn"}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
