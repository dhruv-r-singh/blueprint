"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Text input with a "type to search" dropdown underneath it.
 *
 * - `search(query)` returns an array of items for the current text.
 * - `getKey(item)` / `getLabel(item)` / `getSublabel(item)` pull display bits
 *   out of whatever shape the items are (plain strings or {code,title} objects).
 * - `onSelect(item)` fires when a suggestion is chosen (click or Enter).
 * - Arrow keys move the highlighted row, Escape closes, Enter selects the
 *   highlighted row (or submits normally if the dropdown is closed).
 */
export default function Autocomplete({
  value,
  onChange,
  onSelect,
  search,
  getKey = (i) => (typeof i === "string" ? i : i.title),
  getLabel = (i) => (typeof i === "string" ? i : i.title),
  getSublabel = (i) => (typeof i === "string" ? "" : i.abbr || i.code || ""),
  placeholder,
  className,
  style,
  inputStyle,
  autoFocus,
  onEnter,
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);

  useEffect(() => {
    const results = search(value);
    setItems(results);
    setHighlight(0);
    if (results.length > 0 && document.activeElement === rootRef.current?.querySelector("input")) {
      setOpen(true);
    } else if (results.length === 0) {
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    function onClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function choose(item) {
    onSelect(item);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open || items.length === 0) {
      // Dropdown closed / no matches — let the caller handle Enter as a
      // free-form submit (e.g. adding a skill that isn't in the catalog).
      if (e.key === "Enter" && onEnter) onEnter(e);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={className} style={{ position: "relative", ...style }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        style={inputStyle}
      />
      {open && items.length > 0 && (
        <div className="ac-dropdown">
          {items.map((item, i) => (
            <div
              key={getKey(item)}
              className={"ac-row" + (i === highlight ? " active" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <span>{getLabel(item)}</span>
              {getSublabel(item) && <span className="ac-sub">{getSublabel(item)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
