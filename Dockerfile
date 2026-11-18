FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# Prisma generation needs a URL to parse config, but never connects during build.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Retain Prisma CLI for Railway's pre-deploy migrations and tsx for admin setup.
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
