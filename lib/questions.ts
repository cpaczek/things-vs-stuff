// THE AUDIT SURFACE.
// Every TypeSafe question string, every threshold, and every judged-value → game-stat
// mapping lives in this one module. Tuning the game is a constant edit here — never a
// reworded question buried in a call site.

// ---------------------------------------------------------------------------
// Question text
// ---------------------------------------------------------------------------

/** Global tower-behavior questions, asked once per concept (speculatively). */
export const TOWER_QUESTIONS: Record<string, string> = {
  slows: "Would this defense slow attackers down or hold them in place?",
  splash:
    "Would this defense hit many attackers at once rather than a single target?",
  reach: "Does this defense affect things far away from it?",
  rapid: "Does this defense act quickly and repeatedly rather than slowly?",
  wild: "Is this defense chaotic and hard to control?",
};

/** Per-enemy matchup questions (speculative fan-out: asked for every enemy type at once). */
export const effQuestion = (enemyDoc: string) =>
  `Would this defense plausibly damage, destroy, or stop ${enemyDoc}?`;

export const feedsQuestion = (enemyDoc: string) =>
  `Would this defense accidentally strengthen, heal, or empower ${enemyDoc}?`;

export const methodQuestion = (enemyDoc: string) =>
  `How would this defense primarily affect ${enemyDoc}?`;

/** Choice options for HOW a defense affects an enemy — each method drives its own VFX. */
export const METHODS: Record<string, string> = {
  shatter: "breaks it to pieces",
  burn: "fire or heat damage",
  soak: "drenches, douses, or rusts it",
  shred: "cuts, tears, or slices it",
  blunt: "raw impact force",
  zap: "electric shock",
  freeze: "freezes or chills it solid",
  repel: "pushes, deflects, or scares it away",
  none: "no meaningful effect",
};

export type Method = keyof typeof METHODS;

// ---------------------------------------------------------------------------
// Judged value → game stat mapping (pure code, unit-testable offline)
// ---------------------------------------------------------------------------

export const STATS = {
  /** Damage per shot = SHOT_BASE * eff^2 * 3 — squares reward strong matchups. */
  SHOT_BASE: 9,
  /** Below this effectiveness a matchup badge reads "useless". */
  EFF_FLOOR: 0.3,
  /** Above this, the tower literally heals that enemy type on hit ("FEEDS them"). */
  FEEDS_THRESHOLD: 0.66,
  FEEDS_HEAL: 12,

  /** Range in board px: RANGE_MIN + reach * RANGE_SPAN. */
  RANGE_MIN: 70,
  RANGE_SPAN: 100,

  /** Fire rate in shots/sec: RATE_MIN + rapid * RATE_SPAN. */
  RATE_MIN: 0.8,
  RATE_SPAN: 1.9,

  /** splash > threshold → AoE hits, radius scaled by the probability (a real archetype, not the default). */
  SPLASH_THRESHOLD: 0.75,
  SPLASH_RADIUS: 45,

  /** slows > threshold → hits also slow: speed *= (1 - slows * SLOW_MAX) for SLOW_DUR s. */
  SLOW_THRESHOLD: 0.7,
  SLOW_MAX: 0.55,
  SLOW_DUR: 0.7,

  /** wild > threshold → each shot may misfire: the shot WHIFFS (real DPS loss). */
  WILD_THRESHOLD: 0.55,
  WILD_MISFIRE: 0.35,

  /** Fused concepts hit harder per component (2 → ×1.5, 3 → ×2.1). */
  FUSION_DMG_BONUS: [1, 1.5, 2.1],

  /** Method mechanics: repel knockback px (scaled by methodP), burn DoT, zap chain. */
  REPEL_KNOCKBACK: 55,
  BURN_DURATION: 2.5,
  BURN_DPS_FRAC: 0.35,
  ZAP_CHAIN_RADIUS: 85,
  ZAP_CHAIN_FRAC: 0.5,
  FREEZE_SLOW: 0.4,
} as const;

/**
 * Combat effectiveness blends two judged signals: the direct effectiveness Noul
 * and the method Choice's P(none) — the distribution is the sharper matchup signal
 * (verified: opera vs glass reads eff 0.23 but shatter 0.65 / low none).
 */
export const combatEff = (eff: number, pNone: number) =>
  0.45 * eff + 0.55 * (1 - pNone);

export const damagePerShot = (eff: number, pNone: number) => {
  const e = combatEff(eff, pNone);
  return Math.max(1, Math.round(STATS.SHOT_BASE * e * e * 3));
};

export const rangeFor = (reach: number) =>
  STATS.RANGE_MIN + reach * STATS.RANGE_SPAN;

export const fireRateFor = (rapid: number) =>
  STATS.RATE_MIN + rapid * STATS.RATE_SPAN;

export const splashRadiusFor = (splash: number) =>
  splash > STATS.SPLASH_THRESHOLD ? STATS.SPLASH_RADIUS * splash : 0;

export const slowFactorFor = (slows: number) =>
  slows > STATS.SLOW_THRESHOLD ? slows * STATS.SLOW_MAX : 0;

export const misfireChanceFor = (wild: number) =>
  wild > STATS.WILD_THRESHOLD ? wild * STATS.WILD_MISFIRE : 0;

export const feedsHealFor = (feeds: number) =>
  feeds > STATS.FEEDS_THRESHOLD ? STATS.FEEDS_HEAL : 0;

// ---------------------------------------------------------------------------
// Pricing — the judge sets the price. Strong verdicts cost more; overpowered
// inventions price themselves out. All in code, tunable here.
// ---------------------------------------------------------------------------

import type { StatBlock } from "../game/types";

export function priceFor(stats: StatBlock): number {
  const matchups = Object.values(stats.perEnemy);
  const effs = matchups
    .filter((m) => feedsHealFor(m.feeds) === 0)
    .map((m) => combatEff(m.eff, m.pNone));
  const avg = effs.length ? effs.reduce((a, b) => a + b, 0) / effs.length : 0.1;
  // superlinear in average power: specialists stay cheap, do-everything
  // concepts price themselves out of the early game entirely
  let p = 12 + Math.pow(avg, 2.6) * fireRateFor(stats.rapid) * 38;
  if (splashRadiusFor(stats.splash) > 0) p += 9;
  if (slowFactorFor(stats.slows) > 0) p += 6;
  p += rangeFor(stats.reach) * 0.06;
  p -= misfireChanceFor(stats.wild) * 30;
  return Math.max(12, Math.min(120, Math.round(p)));
}

// ---------------------------------------------------------------------------
// Invention policing — the judge is skeptical of munchkins. Vague wishes and
// omnipotence claims get OVERRULED instead of priced.
// ---------------------------------------------------------------------------

export const POLICE_QUESTIONS: Record<
  string,
  { instructions: string; criteria: { true: string; false: string } }
> = {
  absurd: {
    instructions:
      "Does this claim unlimited or universal power rather than being a specific thing?",
    criteria: {
      true: "claims to be invincible, all-powerful, or to beat/destroy everything; or ties an ordinary object to an unlimited, unconditional effect ('stops anything', 'blocks all damage', 'kills whatever it touches')",
      false:
        "a specific object, creature, or machine with particular, bounded abilities — even if strong, magical, or fanciful (naming a concrete noun does NOT excuse an unlimited claim)",
    },
  },
  vague: {
    instructions: "Is this a wish or effect with no actual thing behind it?",
    criteria: {
      true: "no nameable object or creature — just an outcome or power, like 'something that always wins'",
      false:
        "names an actual object, creature, or contraption, however weird or specialized (conditional behaviors are fine)",
    },
  },
};

export const POLICE = {
  ABSURD_MAX: 0.5,
  VAGUE_MAX: 0.7,
} as const;

export const POLICE_REJECTIONS = {
  absurd: "⚖️ OVERRULED — “too good to be true.” invent something real.",
  vague: "⚖️ OVERRULED — that's a wish, not a thing. be specific!",
} as const;

/** Icon palette the judge picks from for invented things (all present in the OpenMoji set). */
export const ICON_EMOJI = [
  "🔥", "💧", "⚡", "❄️", "💨", "🌪️", "☀️", "🕳️", "🧲", "🔨", "✂️", "🎤",
  "🐈", "🐝", "🐙", "👵", "🦆", "🎺", "📻", "💡", "🪞", "🍌", "🥋", "🚒",
] as const;

export const ICON_CHOICES: Record<string, null> = Object.fromEntries(
  ICON_EMOJI.map((e) => [e, null])
);

export const iconQuestion = "Which icon best represents this thing?";

// ---------------------------------------------------------------------------
// Fusion grammar — HOW two things combine changes what the fusion IS.
// (a = the thing dropped ONTO, b = the thing dragged.)
// ---------------------------------------------------------------------------

export type FusionGrammar = {
  id: string;
  name: (a: string, b: string) => string;
  doc: (a: string, b: string) => string;
};

export const FUSION_GRAMMARS: FusionGrammar[] = [
  {
    id: "fuse",
    name: (a, b) => `${a} × ${b}`,
    doc: (a, b) => `a fusion of ${a} and ${b}`,
  },
  {
    id: "riding",
    name: (a, b) => `${b} riding ${a}`,
    doc: (a, b) => `${b} riding ${a}`,
  },
  {
    id: "made_of",
    name: (a, b) => `${a} made of ${b}`,
    doc: (a, b) => `${a} made of ${b}`,
  },
  {
    id: "inside",
    name: (a, b) => `${b} trapped inside ${a}`,
    doc: (a, b) => `${b} trapped inside ${a}`,
  },
  {
    id: "powered",
    name: (a, b) => `${a} powered by ${b}`,
    doc: (a, b) => `${a} powered by ${b}`,
  },
];
