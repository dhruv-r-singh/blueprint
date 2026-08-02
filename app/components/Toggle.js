"use client";

/** Small on/off switch matching the app's dark/amber theme. */
export default function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={"toggle" + (checked ? " on" : "")}
    >
      <span className="toggle-knob" />
    </button>
  );
}
