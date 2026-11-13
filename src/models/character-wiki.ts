import { weaponTypes, specialWeaponTypes, type WeaponType } from "./character.js";
import { baseStats } from "./character-stats.js";
import { skills } from "./skills.js";
import { characterUpgrades, UPGRADE_COST } from "./character-upgrade.js";
import { actionTiming } from "./action-timing.js";

const names: Record<WeaponType, string> = {
  "sword-and-shield": "Sword and Shield", bow: "Bow", wand: "Wand", staff: "Staff", book: "Book",
  spear: "Spear", axe: "Axe", rifle: "Rifle", "dual-gun": "Dual Gun", "great-sword": "Great Sword", "dual-knife": "Assassin",
  glaive: "Kent", "ice-staff": "Juan", "dual-axe": "Jeffrey",
};
export function characterWiki() {
  return [...weaponTypes, ...specialWeaponTypes].map((weapon) => ({
    id: weapon, name: names[weapon], special: (specialWeaponTypes as readonly string[]).includes(weapon),
    stats: { ...baseStats[weapon] }, timing: actionTiming(baseStats[weapon].speed),
    upgrade: characterUpgrades[weapon] ? { ...characterUpgrades[weapon], cost: UPGRADE_COST } : null,
    skills: skills[weapon].map((skill, index) => ({ ...skill, slot: index + 1, unlockCost: index === 0 ? 0 : 1000 })),
  }));
}
