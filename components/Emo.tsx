"use client";

// Consistent doodle-style emoji via OpenMoji SVGs, with system-emoji fallback.

import { emoSrc, splitGraphemes } from "@/lib/emo";
import type { CSSProperties } from "react";

export default function Emo({
  e,
  size = 24,
  style,
}: {
  e: string;
  size?: number;
  style?: CSSProperties;
}) {
  const parts = splitGraphemes(e);
  if (parts.length > 1) {
    const s = Math.round(size * (parts.length === 2 ? 0.62 : 0.5));
    return (
      <span style={{ display: "inline-flex", alignItems: "center", ...style }}>
        {parts.slice(0, 3).map((p, i) => (
          <Emo key={i} e={p} size={s} />
        ))}
      </span>
    );
  }
  const src = emoSrc(e);
  if (!src)
    return (
      <span style={{ fontSize: size * 0.82, lineHeight: 1, ...style }}>{e}</span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt={e}
      draggable={false}
      style={{ verticalAlign: "-0.18em", display: "inline-block", ...style }}
    />
  );
}
