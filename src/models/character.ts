export const weaponTypes = ["sword-and-shield", "bow", "wand", "staff", "book", "spear", "axe", "rifle", "dual-gun", "great-sword", "dual-knife"] as const;
export type WeaponType = typeof weaponTypes[number];

export interface Character {
  name: string;
  weapon: WeaponType;
}
