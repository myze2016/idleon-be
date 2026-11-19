/** Fields needed to display Google players without exposing their internal username. */
export const playerNameSelect = {
  username: true, name: true, googleSubject: true,
  characters: { where: { isStarter: true }, take: 1, select: { name: true, weapon: true } },
} as const;

export function playerIdentity(user: { username: string; name: string; googleSubject: string | null; characters: { name: string }[] }) {
  if (!user.googleSubject) return { username: user.username, name: user.name };
  const name = user.characters[0]?.name || user.name || "Adventurer";
  return { username: name, name };
}
