// Biomes: TypeSafe judges which landscape today's invaders would march through
// (one Choice per day, cached globally); the style drives paper tone, path
// colors, and scenery. Pure data — the judgment happens in /api/theme.

export type BiomeStyle = {
  label: string;
  paper: string;
  pathFill: string;
  pathEdge: string;
  dash: string;
  /** Decoration slots map onto these (Decoration.slot % length). */
  decor: string[];
};

export const BIOMES: Record<string, BiomeStyle> = {
  meadow: {
    label: "the meadow",
    paper: "#fbf7ec",
    pathFill: "#efe3c8",
    pathEdge: "#b3986e",
    dash: "rgba(179,152,110,0.55)",
    decor: ["🌳", "🌼", "🌾", "🍄", "🌳", "🌼"],
  },
  forest: {
    label: "the deep woods",
    paper: "#f2f6ea",
    pathFill: "#e6dfc2",
    pathEdge: "#7f925f",
    dash: "rgba(127,146,95,0.55)",
    decor: ["🌲", "🌲", "🌳", "🍄", "🪨", "🌲"],
  },
  desert: {
    label: "the dunes",
    paper: "#fdf5dd",
    pathFill: "#f2e0b0",
    pathEdge: "#c2a05e",
    dash: "rgba(194,160,94,0.6)",
    decor: ["🌵", "🪨", "🌾", "🌵", "🪨", "🌵"],
  },
  tundra: {
    label: "the frozen waste",
    paper: "#f1f6f8",
    pathFill: "#e4edf2",
    pathEdge: "#8fb0c2",
    dash: "rgba(143,176,194,0.6)",
    decor: ["🌲", "🪨", "❄️", "🌲", "❄️", "🪨"],
  },
  swamp: {
    label: "the bog",
    paper: "#eef2e2",
    pathFill: "#dde2c2",
    pathEdge: "#7d8b57",
    dash: "rgba(125,139,87,0.55)",
    decor: ["🍄", "🌾", "🌳", "🍄", "🌾", "🍄"],
  },
};

export const DEFAULT_BIOME = "meadow";

export const BIOME_QUESTION = {
  instructions: "Which landscape would this bunch of invaders most likely march through?",
  criteria: {
    meadow: "sunny grassland with flowers",
    forest: "deep woods, pines and mushrooms",
    desert: "sand dunes, cacti and dry rock",
    tundra: "snow and ice, frozen ground",
    swamp: "murky wetland, reeds and bog",
  } as Record<string, string>,
};
