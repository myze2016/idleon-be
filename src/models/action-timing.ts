export const DEFAULT_ATTACK_INTERVAL = 1;
export const DEFAULT_SPELL_CAST_TIME = 1;

export function actionDuration(speed: number, baseSeconds = 1) {
  const effectiveSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  return baseSeconds / (1 + effectiveSpeed / 100);
}

export function spellCastTime(speed: number, baseSeconds = DEFAULT_SPELL_CAST_TIME) {
  return actionDuration(speed, baseSeconds);
}

export function actionTiming(speed: number) {
  return {
    attackInterval: actionDuration(speed, DEFAULT_ATTACK_INTERVAL),
    baseSpellCastTime: DEFAULT_SPELL_CAST_TIME,
    spellCastTime: spellCastTime(speed),
  };
}
