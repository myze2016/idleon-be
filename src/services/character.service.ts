import { weaponTypes, type Character, type WeaponType } from "../models/character.js";
import { createCharacter } from "../repositories/character.repository.js";
import { HttpError } from "../utils/http-error.js";

export function validateCharacter(input: unknown): Character {
  const { name, weapon } = (input ?? {}) as Partial<Character>;
  if (typeof name !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N} '-]{1,23}$/u.test(name.trim())) {
    throw new HttpError(400, "Use 2–24 letters, numbers, spaces, apostrophes, or hyphens for your name");
  }
  if (!weaponTypes.includes(weapon as typeof weaponTypes[number])) throw new HttpError(400, "Choose a valid weapon type");
  return { name: name.trim(), weapon: weapon as WeaponType };
}

export function registerCharacter(userId: string, input: unknown) {
  return createCharacter(userId, validateCharacter(input));
}
