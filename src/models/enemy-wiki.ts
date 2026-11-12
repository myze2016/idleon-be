import { enemies, enemyPools, enemyRewards, type EnemyType, type EnemyStats } from "./enemy.js";
import { deepSeaFloors } from "./deepsea.js";
import { actionDuration } from "./action-timing.js";

interface WikiSkill { name: string; description: string; mana: number; cooldown: number | null; damage?: number; damageType?: "Physical" | "Magic"; duration?: number }

function enemySkills(stats: EnemyStats): WikiSkill[] {
  const result: WikiSkill[] = [];
  if (stats.blockChance) result.push({ name: "Block", description: `${Math.round(stats.blockChance * 100)}% chance to block direct attacks.`, mana: 0, cooldown: null });
  if (stats.bubbleBeam) result.push({ name: "Bubble Beam", description: "Hits the first living character. Damage is reduced by special defense.", ...stats.bubbleBeam, damageType: "Magic" });
  const area = stats.burnAll ?? stats.slashAll;
  if (area) result.push({ name: stats.burnAll ? "Burn All" : "Slash All", description: "Hits every living character. Replaces a basic attack while enough mana remains.", ...area, damageType: stats.burnAll ? "Magic" : "Physical", cooldown: actionDuration(stats.speed) });
  const skill = stats.skill;
  if (skill) {
    const descriptions = {
      guard: "+10 Defense while Guard Mode is active.",
      shield: "Heals 5 HP after each direct hit while the shield is active. Cannot revive after lethal damage.",
      shot: `Hits the ${skill.farthest ? "farthest (last living)" : "first living"} character.`,
      "heal-all": "Restores up to 50 HP to each injured living fishpeople ally, including the caster. Does not heal Baracudon.",
      "heal-self": "Restores up to 50 HP to itself when injured.",
      summon: "Summons a Fishpeople Knight into the battle. Each summoned Knight grants its normal rewards when defeated.",
    };
    result.push({ name: skill.name, description: descriptions[skill.kind], mana: skill.mana, cooldown: skill.cooldown,
      ...(skill.duration ? { duration: skill.duration } : {}),
      ...(skill.damage !== undefined ? { damage: skill.damage, damageType: skill.magic ? "Magic" as const : "Physical" as const } : {}) });
  }
  return result;
}

export function enemyWiki() {
  const locationNames: Record<string, string> = { meadow: "Meadow", forest: "Forest", harbor: "Harbor · Day", tourney: "Zugwangs Battle Tourney", ...Object.fromEntries(Object.entries(deepSeaFloors).map(([id, floor]) => [id, floor.name])) };
  const bosses: Partial<Record<EnemyType, string>> = { "mutant-boar": "Meadow", "coco-klan-chief": "Forest", "fishpeople-guide": "Harbor · Day and Night", zugwang: "Zugwangs Battle Tourney", "demon-prince": "Zugwangs Battle Tourney · Yellow spectator", ...Object.fromEntries(Object.values(deepSeaFloors).map((floor) => [floor.boss, floor.name])) };
  return (Object.keys(enemies) as EnemyType[]).map((id) => {
    const enemy = enemies[id], { hp, mp, atk, def, magic, magicDef, speed, range } = enemy.stats;
    const locations = Object.entries(enemyPools).filter(([, pool]) => (pool as string[]).includes(id)).map(([location]) => locationNames[location]);
    if (["crab-night", "fishpeople-spearman", "fishpeople-hunter", "fishpeople-magos"].includes(id)) locations.push("Harbor · Night");
    if (bosses[id]) locations.push(bosses[id]!);
    return { id, name: enemy.name, boss: enemyRewards(id).boss, locations, stats: { hp, mp, atk, def, magic, magicDef, speed, range },
      gold: enemy.gold, experience: 1, attackInterval: actionDuration(speed), skills: enemySkills(enemy.stats),
      note: id === "fishpeople-rider" ? "Rides a barracuda." : id === "baracudon" ? "A giant barracuda." : id === "crab-day" ? "Day variant: midnight–noon, Asia/Manila." : id === "crab-night" ? "Night variant: noon–midnight, Asia/Manila." : null };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
