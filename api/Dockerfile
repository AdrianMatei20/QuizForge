# syntax=docker/dockerfile:1
# The API: built with every dependency, run with production dependencies only,
# as the unprivileged "node" user. The entrypoint migrates (and optionally
# seeds) before starting. Secrets such as LLM_API_KEY are never in the image:
# .dockerignore keeps .env* out, and they arrive as environment variables at
# run time.

FROM node:22.23.2-alpine3.23 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22.23.2-alpine3.23 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22.23.2-alpine3.23 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Read at run time: prompt files, prices, the sample lessons, and the fake
# provider's answers (the demo mode runs on them).
COPY prompts ./prompts
COPY config ./config
COPY fixtures ./fixtures
COPY test/fixtures/llm ./test/fixtures/llm
COPY --chmod=755 docker-entrypoint.sh ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
