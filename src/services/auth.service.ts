import { findUserByUsername } from "../repositories/user.repository.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import type { User } from "../models/user.js";

const dummyHash = hashPassword("invalid-account");

export async function authenticate(username: string, password: string): Promise<User | null> {
  const user = await findUserByUsername(username);
  const matches = await verifyPassword(password, user?.passwordHash ?? await dummyHash);
  if (!user || !matches) return null;
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}
