# spamcha — the invisible, trainable, local antispam as a service.
# Build:  docker build -t spamcha .
# Run:    docker run -d --name spamcha -p 127.0.0.1:8788:8788 \
#           -v spamcha-data:/datos \
#           -e SPAMCHA_SECRET="a long random phrase of your own" \
#           spamcha
# The volume holds your private assets: model, quarantine, verdict log, feeds.
# Bind to 127.0.0.1 — the service reads private data and has no built-in auth.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/feeds ./feeds
RUN mkdir -p /datos && chown -R node:node /datos
VOLUME /datos
EXPOSE 8788
USER node
CMD ["node", "dist/cli.js", "serve", \
  "--host", "0.0.0.0", \
  "--port", "8788", \
  "--model", "/datos/spamcha.json", \
  "--quarantine", "/datos/spamcha-quarantine.jsonl", \
  "--log", "/datos/spamcha-log.jsonl", \
  "--feeds-dir", "/datos/feeds"]
