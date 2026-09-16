"use client";

// ✏️ INVENT: type any thing. It gets sized up, given an icon, and priced —
// then it's a card in your hand for the rest of the run. This is the ONLY way
// to get things: nothing is dealt.

import { useEffect, useRef, useState } from "react";

const SPARKS = [
  "a vacuum that only sucks up ghosts",
  "an extremely polite security guard",
  "grandma's disappointed sigh",
  "a moat of hot soup",
  "ten thousand rubber bands",
  "a very judgmental owl",
  "a sprinkler full of lemonade",
];

export default function InventModal({
  slotsLeft,
  onInvent,
  onClose,
}: {
  slotsLeft: number;
  onInvent: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spark] = useState(() => SPARKS[Math.floor(Math.random() * SPARKS.length)]);
  const inputRef = useRef<HTMLInputElement>(null);

  // the input is disabled while the judge works, which drops focus — take it back
  // so a rejected idea can be edited (or escaped) without reaching for the mouse
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onInvent(text);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "the judge is unavailable — try again");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(460px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
        <h1>
          ✏️ invent <em>anything</em>
        </h1>
        <p style={{ fontSize: 16, color: "var(--ink-soft)" }}>
          nothing comes pre-made — every thing you fight with is one you typed. it&apos;ll get
          sized up against today&apos;s stuff and priced on the spot. clever beats powerful.
        </p>
        <input
          ref={inputRef}
          className="invent-input"
          autoFocus
          maxLength={60}
          placeholder={spark}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
        />
        {error && <p style={{ color: "var(--red)", fontSize: 15, marginTop: 6 }}>{error}</p>}
        <div className="btn-row">
          <button className="sketch-btn primary" onClick={submit} disabled={busy || text.trim().length < 3}>
            {busy ? "⚖️ sizing it up…" : "⚡ MAKE IT REAL"}
          </button>
          <button className="sketch-btn" onClick={onClose} disabled={busy}>
            never mind
          </button>
          <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>
            {slotsLeft} slot{slotsLeft === 1 ? "" : "s"} left in your hand
          </span>
        </div>
      </div>
    </div>
  );
}
