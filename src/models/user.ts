export interface User {
  id: string;
  username: string;
  name: string;
  role: "admin" | "player";
  donationTier: number;
}

declare module "express-session" {
  interface SessionData { user?: User; }
}
