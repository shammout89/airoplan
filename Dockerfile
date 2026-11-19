# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY . .
RUN npm run build:docker

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PUBLIC_URL=http://localhost:8080 \
    AEROPLAN_DATA_DIR=/var/lib/aeroplan \
    VINEXT_TRUST_PROXY=0
WORKDIR /app
# Retain the locked framework packages used by its Node production server.
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist-node ./dist-node
COPY --from=build --chown=node:node /app/selfhost ./selfhost
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/release.json ./release.json
RUN mkdir -p /var/lib/aeroplan && chown node:node /var/lib/aeroplan
USER node
VOLUME ["/var/lib/aeroplan"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "selfhost/healthcheck.mjs"]
CMD ["node", "selfhost/server.mjs"]
