"use client";

// A short spotlight tour shown once, the first time someone lands inside a
// project. Finds each step's target by a `data-tour="<selector>"` attribute
// already present on the real UI element (see project/[id]/page.js and
// TopNav.js) and draws a highlight ring around it using the classic
// "oversized box-shadow" spotlight trick — no overlay library needed.

import { useEffect, useState } from "react";

export default function GuidedTour({ steps, onDone }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    function measure() {
      const el = document.querySelector(`[data-tour="${steps[i].selector}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    }
    measure();
    window.addEventListener("resize", measure);
    // The sidebar's dropdown/panel can shift layout after mount — a couple
    // of retries covers late-mounting targets without a heavier observer.
    const t1 = setTimeout(measure, 150);
    const t2 = setTimeout(measure, 400);
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [i, steps]);

  function next() {
    if (i < steps.length - 1) setI((v) => v + 1);
    else onDone();
  }

  const step = steps[i];
  const pad = 8;
  const cardWidth = 290;

  let cardTop, cardLeft, cardTransform;
  if (rect) {
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeBelow = spaceBelow > 180;
    cardTop = placeBelow ? rect.bottom + 14 : Math.max(16, rect.top - 14);
    cardLeft = Math.min(Math.max(rect.left, 16), window.innerWidth - cardWidth - 16);
    cardTransform = placeBelow ? "none" : "translateY(-100%)";
  } else {
    cardTop = "50%";
    cardLeft = "50%";
    cardTransform = "translate(-50%, -50%)";
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, pointerEvents: "none" }}>
      {rect ? (
        <div
          style={{
            position: "fixed",
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            borderRadius: 10,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.68)",
            border: "2px solid var(--s-amber)",
            pointerEvents: "none",
            transition: "top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease",
          }}
        />
      ) : (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.68)", pointerEvents: "none" }} />
      )}

      {/* Wrapper above is pointer-events:none — otherwise this full-screen
          layer silently blocks clicks on anything not inside the small
          highlighted rect, including the account menu's Profile/Preferences
          links once they're open (they render below the spotlighted button,
          outside its rect). Only this card should ever intercept clicks. */}
      <div
        className="shell-card"
        style={{
          position: "fixed",
          width: cardWidth,
          top: cardTop,
          left: cardLeft,
          transform: cardTransform,
          zIndex: 501,
          padding: 18,
          pointerEvents: "auto",
        }}
      >
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
          {step.title}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--s-text-2)", lineHeight: 1.5, marginBottom: 16 }}>
          {step.body}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" className="ghost" onClick={onDone} style={{ fontSize: 11.5 }}>
            Skip tour
          </button>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--s-text-3)" }}>{i + 1} / {steps.length}</span>
            <button type="button" className="shell-task-add-btn" style={{ padding: "6px 16px", fontSize: 12 }} onClick={next}>
              {i < steps.length - 1 ? "Next" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
