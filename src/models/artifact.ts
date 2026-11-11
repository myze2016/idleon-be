import { baseStats } from "./character-stats.js";
import type { WeaponType } from "./character.js";
import { characterUpgrades } from "./character-upgrade.js";

export const artifactCatalog = [
  { stat: "hp", name: "Vitality Gem", label: "HP" },
  { stat: "mp", name: "Mana Crystal", label: "MP" },
  { stat: "atk", name: "Power Fang", label: "ATK" },
  { stat: "def", name: "Iron Crest", label: "DEF" },
  { stat: "magic", name: "Arcane Orb", label: "Magic" },
  { stat: "magicDef", name: "Ward Rune", label: "Magic DEF" },
  { stat: "speed", name: "Wind Feather", label: "Speed" },
] as const;
export const ARTIFACT_PRICE = 1_000;
export const ARTIFACT_BONUS = 5;
export type ArtifactStat = typeof artifactCatalog[number]["stat"];
export function effectiveStats(weapon: WeaponType, artifact?: { stat: string } | null, upgradeLevel = 0) {
  const stats = { ...baseStats[weapon] };
  if (artifact && artifactCatalog.some((item) => item.stat === artifact.stat)) stats[artifact.stat as ArtifactStat] += ARTIFACT_BONUS;
  const upgrade = characterUpgrades[weapon];
  if (upgrade) stats[upgrade.stat] += upgrade.amount * upgradeLevel;
  return stats;
}
