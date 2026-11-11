export const BASE_LEVEL_EXP = 10;
export const EXP_GROWTH = 2;
export const WISHES_PER_LEVEL = 100;

export function accountProgress(experience: number) {
  let level = 1, remaining = experience, required = BASE_LEVEL_EXP;
  while (remaining >= required) {
    remaining -= required;
    level++;
    required *= EXP_GROWTH;
  }
  return {
    level,
    totalExp: experience,
    exp: remaining,
    expToNextLevel: required,
  };
}

export function levelUpReward(beforeExp: number, afterExp: number) {
  const levelsGained = Math.max(0, accountProgress(afterExp).level - accountProgress(beforeExp).level);
  return { levelsGained, wishEarned: levelsGained * WISHES_PER_LEVEL };
}
