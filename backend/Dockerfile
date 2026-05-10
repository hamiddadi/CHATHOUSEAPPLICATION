# ─── Build stage ───────────────────────────────────────
# mediasoup compiles C++ from source, so we need python3 + make + g++ here.
# The resulting `node_modules` (including the native mediasoup-worker binary)
# is copied wholesale into the runtime image to avoid re-compiling there.
FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl python3 python3-pip make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ENV PYTHON=/usr/bin/python3

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

RUN npx prisma generate
RUN npm run build

# Drop dev dependencies from node_modules in-place so we can copy a slim
# prod-only tree into the runner.
RUN npm prune --omit=dev

# ─── Prod stage ────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# openssl for Prisma engines. python3 is kept because mediasoup-worker runs
# as a separate native process — a few runtime tools (libstdc++, libatomic)
# are pulled in by the base image already.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl tini && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

USER node

EXPOSE 4000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/app.js"]
