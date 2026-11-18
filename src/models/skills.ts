import type { WeaponType } from "./character.js";
import { currentBalance } from "./balance-context.js";

export const COUNTER_CHANCE = 0.3;
export const CRITICAL_CHANCE = 0.3;
export const CRITICAL_MULTIPLIER = 2;

export interface SkillDefinition {
  id: string; name: string; description: string; passive: boolean;
  mpCost: number; hpCost: number; baseCastTime: number; cooldown: number;
  damage?: { base: number; stat: "atk" | "magic" };
  power?: number; duration?: number; chance?: number; multiplier?: number; bounces?: number;
}
const damagingSkills: Record<string, { base: number; stat: "atk" | "magic" }> = {
  "bouncing-glaive": { base: 20, stat: "atk" },
  freeze: { base: 20, stat: "magic" }, "freeze-all": { base: 20, stat: "magic" },
  fireball: { base: 20, stat: "magic" }, inferno: { base: 20, stat: "magic" },
  "throw-spear": { base: 20, stat: "atk" }, charge: { base: 40, stat: "atk" },
  "heavy-blow": { base: 40, stat: "atk" }, "berserker-blow": { base: 60, stat: "atk" },
  slash: { base: 30, stat: "atk" }, "long-shot": { base: 40, stat: "atk" },
};
function active(id: string, name: string, description: string, mpCost: number, hpCost = 0): SkillDefinition {
  const damage = damagingSkills[id];
  const damageType = damage?.stat === "magic" ? "magic" : "physical";
  const scaledDescription = damage ? description.replace(`${damage.base} ${damageType} damage`, `(${damage.base} + current ${damage.stat === "atk" ? "ATK" : "Magic"}) ${damageType} damage before defense`) : description;
  return { id, name, description: scaledDescription, passive: false, mpCost, hpCost, baseCastTime: 1, cooldown: 5, ...(damage ? { damage } : {}) };
}
function passive(id: string, name: string, description: string): SkillDefinition {
  return { id, name, description, passive: true, mpCost: 0, hpCost: 0, baseCastTime: 0, cooldown: 0 };
}

export const defaultSkills: Record<WeaponType, [SkillDefinition, SkillDefinition]> = {
  glaive: [passive("cleaving-glaive", "Twin Strike", "Basic attacks hit up to two living enemies."), { ...active("bouncing-glaive", "Bouncing Glaive", "Deal 20 physical damage, then bounce up to four times between different living enemies. Ends if no other target remains.", 20), cooldown: 3 }],
  "ice-staff": [{ ...active("freeze", "Freeze", "Deal 20 magic damage and stun the target for 2 seconds.", 10), cooldown: 1 }, { ...active("freeze-all", "Freeze All", "Deal 20 magic damage to all enemies and stun each for 2 seconds.", 30), cooldown: 5 }],
  "dual-axe": [passive("bleed", "Bleed", "Every successful hit adds a bleed stack. Each stack deals 5 damage per second until the enemy dies or battle ends."), { ...active("axe-frenzy", "Axe Frenzy", "Increase Speed by 40 for 3 seconds.", 50), cooldown: 5 }],
  "sword-and-shield": [passive("block", "Block", "30% chance to block an incoming attack."), passive("counter", "Counterattack", "After blocking, 30% chance to counterattack.")],
  bow: [passive("poison", "Poison", "Basic attacks poison the enemy for 5 HP per second for 5 seconds. Refreshes without stacking."), active("shackle", "Shackle", "Stun the enemy for 1 second.", 25)],
  wand: [active("heal", "Heal", "Restore 30 HP to the living ally with the lowest HP.", 25), active("mass-heal", "Mass Heal", "Restore 20 HP to all living allies.", 0)],
  staff: [active("fireball", "Fireball", "Deal 20 magic damage.", 10), active("inferno", "Inferno", "Deal 20 magic damage to all enemies.", 30)],
  book: [active("attack-buff", "Attack Blessing", "Increase a random living ally's attack by 5 for 7 seconds.", 10), active("speed-buff", "Haste", "Increase a random living ally's speed by 20 for 7 seconds.", 30)],
  spear: [active("throw-spear", "Throw Spear", "Ranged attack dealing 20 physical damage.", 10), active("charge", "Charge", "Deal 40 physical damage.", 10)],
  axe: [active("heavy-blow", "Heavy Blow", "Deal 40 physical damage.", 10), active("berserker-blow", "Berserker Blow", "Deal 60 physical damage. Requires more than 30 HP.", 10, 30)],
  "great-sword": [active("slash", "Slash", "Deal 30 physical damage.", 10), active("hero", "Hero", "Increase your attack and defense by 20 for 7 seconds.", 10)],
  rifle: [active("long-shot", "Long Shot", "Charge for a base 1 second and deal 40 physical damage.", 10), passive("critical", "Critical Skills", "Damaging skills have a 30% chance to deal 2x critical damage.")],
  "dual-gun": [passive("double-attack", "Dual Shot", "30% chance for a basic attack to hit twice."), active("burst-fire", "Burst Fire", "Increase your speed by 40 for 3 seconds.", 30)],
  "dual-knife": [passive("double-attack", "Dual Shot", "30% chance for a basic attack to hit twice."), active("burst-fire", "Burst Fire", "Increase your speed by 40 for 3 seconds.", 30)],
};

const effects: Record<string, Partial<SkillDefinition>> = {
  freeze: { duration: 2 }, "freeze-all": { duration: 2 }, shackle: { duration: 1 },
  heal: { power: 30 }, "mass-heal": { power: 20 },
  "attack-buff": { power: 5, duration: 7 }, "speed-buff": { power: 20, duration: 7 },
  hero: { power: 20, duration: 7 }, "burst-fire": { power: 40, duration: 3 }, "axe-frenzy": { power: 40, duration: 3 },
  poison: { power: 5, duration: 5 }, bleed: { power: 5 }, block: { chance: .3 }, counter: { chance: .3 },
  critical: { chance: .3, multiplier: 2 }, "double-attack": { chance: .3 }, "bouncing-glaive": { bounces: 4 },
};
for (const pair of Object.values(defaultSkills)) for (const skill of pair) Object.assign(skill, effects[skill.id]);
export const skills = new Proxy(defaultSkills, {
  get(target, key: string) {
    const pair = target[key as WeaponType];
    return pair?.map(skill => {
      const configured = currentBalance()?.skills[skill.id];
      if (!configured || JSON.stringify(configured) === JSON.stringify(skill)) return skill;
      return { ...configured, description: describeSkill(configured) };
    }) as typeof pair;
  },
});
function describeSkill(skill: SkillDefinition) {
  const damage = skill.damage ? `Deal (${skill.damage.base} + current ${skill.damage.stat === "atk" ? "ATK" : "Magic"}) ${skill.damage.stat === "atk" ? "physical" : "magic"} damage before defense.` : "";
  const descriptions: Record<string, string> = {
    "bouncing-glaive": `${damage} Bounce up to ${skill.bounces} extra times between different living enemies.`,
    freeze: `${damage} Stun the target for ${skill.duration} seconds.`,
    "freeze-all": `${damage} Hit and stun all enemies for ${skill.duration} seconds.`,
    inferno: `${damage} Hits all enemies.`,
    shackle: `Stun the enemy for ${skill.duration} seconds.`,
    heal: `Restore ${skill.power} HP to the living ally with the lowest HP.`,
    "mass-heal": `Restore ${skill.power} HP to all living allies.`,
    "attack-buff": `Increase a random living ally's attack by ${skill.power} for ${skill.duration} seconds.`,
    "speed-buff": `Increase a random living ally's speed by ${skill.power} for ${skill.duration} seconds.`,
    hero: `Increase your attack and defense by ${skill.power} for ${skill.duration} seconds.`,
    "burst-fire": `Increase your speed by ${skill.power} for ${skill.duration} seconds.`,
    "axe-frenzy": `Increase your speed by ${skill.power} for ${skill.duration} seconds.`,
    poison: `Basic attacks poison the enemy for ${skill.power} HP per second for ${skill.duration} seconds. Refreshes without stacking.`,
    bleed: `Every successful hit adds a bleed stack. Each stack deals ${skill.power} damage per second until the enemy dies or battle ends.`,
    block: `${Number(((skill.chance ?? 0) * 100).toFixed(2))}% chance to block an incoming attack.`,
    counter: `After blocking, ${Number(((skill.chance ?? 0) * 100).toFixed(2))}% chance to counterattack.`,
    critical: `Damaging skills have a ${Number(((skill.chance ?? 0) * 100).toFixed(2))}% chance to deal ${skill.multiplier}x critical damage.`,
    "double-attack": `${Number(((skill.chance ?? 0) * 100).toFixed(2))}% chance for a basic attack to hit twice.`,
    "berserker-blow": `${damage} Requires more than ${skill.hpCost} HP.`,
  };
  return descriptions[skill.id] ?? (damage || skill.description);
}
export function skillValue(id: string, field: "power" | "duration" | "chance" | "multiplier" | "bounces") {
  const skill = currentBalance()?.skills[id] ?? Object.values(defaultSkills).flat().find(skill => skill.id === id);
  return skill?.[field] ?? 0;
}

export function characterSkills(weapon: WeaponType, skill2Unlocked: boolean) {
  return skills[weapon].map((skill, i) => ({ ...skill, unlocked: i === 0 || skill2Unlocked }));
}

/** Reserve mana only for an unlocked active Skill 2 that can eventually be afforded. */
export function savesManaForSkill2(skill: SkillDefinition | undefined, unlocked: boolean | undefined,
  mp: number, maxMp: number, hp: number, readyAt: number, at: number) {
  return !!skill && !!unlocked && !skill.passive && at >= readyAt && hp > skill.hpCost
    && mp < skill.mpCost && maxMp >= skill.mpCost;
}
