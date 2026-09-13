# EMITTED ARTIFACT (spike): what `klaridian deploy --target fly` would write.
# Multi-stage: build the esbuild bundle, then run it on a slim node base.
# The generated server is ESM, esbuild-bundled to dist/server.bundle.js,
# engines.node >=20 -> pin node:22-slim.

# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Only the self-contained bundle is needed at runtime (esbuild inlined deps).
COPY --from=build /app/dist/server.bundle.js ./dist/server.bundle.js
COPY package.json ./

# Deploy-target contract (the emitter must set these so the server is reachable):
#  - PORT: platform-injected; server must bind it (see FINDINGS: currently hardcoded 3000).
#  - KLARIDIAN_BIND_HOST=0.0.0.0: bind all interfaces, not loopback.
#  - KLARIDIAN_ALLOWED_HOSTS: public hostname(s) so Host-header validation passes.
ENV PORT=3000 \
    KLARIDIAN_BIND_HOST=0.0.0.0

EXPOSE 3000
CMD ["node", "dist/server.bundle.js"]
