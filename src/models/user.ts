export interface User {
  id: string;
  username: string;
  name: string;
  role: "admin" | "player";
}

declare module "express-session" {
  interface SessionData { user?: User; }
}
