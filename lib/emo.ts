// OpenMoji asset lookup (art © OpenMoji, CC BY-SA 4.0 — openmoji.org).
// Falls back to system emoji when an icon is missing from the manifest.

import manifest from "./openmoji-manifest.json";

const M = manifest as Record<string, string>;

export function emoSrc(emoji: string): string | null {
  const f = M[emoji];
  return f ? `/openmoji/${f}` : null;
}

/** Split a (possibly multi-emoji fusion) string into individual emoji. */
export function splitGraphemes(s: string): string[] {
  return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s)]
    .map((x) => x.segment)
    .filter((x) => x.trim().length > 0);
}
