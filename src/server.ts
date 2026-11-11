import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

await prisma.$connect();
await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
const server = app.listen(env.port);
server.on("listening", () => {
  console.log(`API listening on http://localhost:${env.port}`);
});
server.on("error", (error) => {
  console.error("Failed to start API:", error);
  process.exitCode = 1;
});

function shutdown() {
  const timeout = setTimeout(() => process.exit(1), 10_000);
  timeout.unref();
  server.close(async (error) => {
    await prisma.$disconnect();
    clearTimeout(timeout);
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
  });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
