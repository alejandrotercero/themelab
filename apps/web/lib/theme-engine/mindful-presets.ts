// Bundled starting palettes for the /mindfulpalettes generator, drawn from Alex
// Cristache's #MindfulPalettes (https://x.com/AlexCristache) and mapped onto our
// 2 light · 2 accent · 2 dark input contract. The original palettes read
// lightest→darkest; we take the two lightest as the light neutrals, the two most
// chromatic as the accents, and the two darkest as the dark anchors. A few
// palettes carry only one near-black; for those the second dark is a hand-picked
// shade ~8–10% darker so the neutral ramp still spans the full range.

import type { MindfulColors } from "./transpile";

export interface MindfulPreset {
  id: string;
  name: string;
  colors: MindfulColors;
}

export const MINDFUL_PRESETS: MindfulPreset[] = [
  {
    id: "ateneo",
    name: "Ateneo",
    colors: {
      light1: "#F6F7ED", // Praxeti White
      light2: "#ACDFDD", // Blue Light
      accent1: "#0F63B3", // Les Cavaliers Beach
      accent2: "#FFDF4F", // Backlit Lemon
      dark1: "#003A6C", // Ateneo Blue
      dark2: "#00284A", // derived (~10% darker navy)
    },
  },
  {
    id: "magical-moonlight",
    name: "Magical Moonlight",
    colors: {
      light1: "#F0EEEB", // Magical Moonlight
      light2: "#B9A5BD", // Viola Sororia
      accent1: "#355E4B", // Wine Leaf
      accent2: "#E8C47A", // Golden Thread
      dark1: "#10252A", // Sunken Ship
      dark2: "#234537", // Burnham
    },
  },
  {
    id: "white-chalk",
    name: "White Chalk",
    colors: {
      light1: "#F6F4F1", // White Chalk
      light2: "#EBE1C9", // Basmati White
      accent1: "#F34723", // Chinese Goldfish
      accent2: "#AEC3C4", // Dover Surf
      dark1: "#391531", // Celestial Canvas
      dark2: "#841B2D", // Antique Ruby
    },
  },
  {
    id: "white-glove",
    name: "White Glove",
    colors: {
      light1: "#F0EFED", // White Glove
      light2: "#E0DEB8", // Tropical Tale
      accent1: "#017C85", // Cote D'Azur
      accent2: "#ED9181", // Sierra Pink
      dark1: "#222233", // Black Velvet
      dark2: "#15151F", // derived (~10% darker)
    },
  },
];
