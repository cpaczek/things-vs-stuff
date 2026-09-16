// Downloads OpenMoji color SVGs (CC BY-SA 4.0, https://openmoji.org) for every
// emoji used by the game into public/openmoji/, and writes lib/openmoji-manifest.json.
// Run: node tools/fetch-openmoji.mjs

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "public", "openmoji");
mkdirSync(OUT, { recursive: true });

// Collect emoji from the pools (regex over source — avoids TS import machinery)
// plus the fixed UI set used by the renderer/HUD.
const poolSrc = readFileSync(join(ROOT, "lib", "pools.ts"), "utf8");
const emojiFields = [...poolSrc.matchAll(/emoji:\s*"([^"]+)"/g)].map((m) => m[1]);
const UI_EMOJI = ["🏠", "❤️", "⚡", "🌊", "🤔", "☠️", "🐌", "💚", "🎲", "📋", "🗼", "⭐", "💀", "🎉", "🌲", "🌳", "🌵", "🌼", "🍄", "🪨", "🌾", "🔥", "💧", "💨", "🕳️", "🔨", "💦", "🚒", "✏️"];
const all = [...new Set([...emojiFields, ...UI_EMOJI])];

const hexOf = (emoji, keepVS) =>
  [...emoji]
    .map((c) => c.codePointAt(0))
    .filter((cp) => keepVS || cp !== 0xfe0f)
    .map((cp) => cp.toString(16).toUpperCase())
    .join("-");

const CDN = "https://cdn.jsdelivr.net/npm/openmoji@15.1.0/color/svg";

async function tryFetch(hex) {
  const res = await fetch(`${CDN}/${hex}.svg`);
  if (!res.ok) return null;
  return await res.text();
}

const manifest = {};
const misses = [];
for (const emoji of all) {
  const candidates = [...new Set([hexOf(emoji, true), hexOf(emoji, false)])];
  let saved = false;
  for (const hex of candidates) {
    const file = `${hex}.svg`;
    if (existsSync(join(OUT, file))) {
      manifest[emoji] = file;
      saved = true;
      break;
    }
    const svg = await tryFetch(hex);
    if (svg) {
      writeFileSync(join(OUT, file), svg);
      manifest[emoji] = file;
      saved = true;
      break;
    }
  }
  if (!saved) misses.push(emoji);
  process.stdout.write(saved ? "." : "x");
}
console.log();

writeFileSync(
  join(ROOT, "lib", "openmoji-manifest.json"),
  JSON.stringify(manifest, null, 1)
);
console.log(`saved ${Object.keys(manifest).length}/${all.length} → public/openmoji/`);
if (misses.length) console.log("MISSES:", misses.join(" "));
