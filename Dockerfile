# Base stage
FROM oven/bun:1 AS base
RUN apt-get update && apt-get install -y \
    sqlite3 \
    libsqlite3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

# Development stage
FROM deps AS development
COPY . .
ENV NODE_ENV=development
EXPOSE 3000
CMD ["bun", "run", "dev"]

# Builder stage
FROM deps AS builder
COPY . .
RUN bun run build

# Production stage
FROM base AS production
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json entrypoint.sh ./
RUN chmod +x entrypoint.sh
ENV NODE_ENV=production
VOLUME ["/root/.cache/qmd", "/app/kb"]
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["mcp"]
