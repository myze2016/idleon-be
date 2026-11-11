import type { WeaponType } from "./character.js";
import type { CharacterStats } from "./character-stats.js";

export const UPGRADE_COST = 1_000;
export const characterUpgrades: Partial<Record<WeaponType, { stat: Exclude<keyof CharacterStats, "range">; label: string; amount: number }>> = {
  rifle: { stat: "atk", label: "ATK", amount: 5 },
  "great-sword": { stat: "atk", label: "ATK", amount: 5 },
  book: { stat: "mp", label: "MP", amount: 10 },
  staff: { stat: "magic", label: "Magic", amount: 5 },
  axe: { stat: "atk", label: "ATK", amount: 5 },
  spear: { stat: "atk", label: "ATK", amount: 5 },
  "dual-gun": { stat: "speed", label: "Speed", amount: 5 },
  bow: { stat: "speed", label: "Speed", amount: 5 },
};
