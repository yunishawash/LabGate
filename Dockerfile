# ── LabGate ────────────────────────────────────────────────────────────────
# Multi-stage: the runner carries the standalone server and nothing else — no
# source, no dev dependencies, no package manager. Smaller is not the point;
# the point is that a production container holds nothing worth stealing and
# nothing that can be run by accident.

# --- deps ------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# Only the manifests, so this layer is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

# --- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# The build needs these present but never uses their VALUES: Next evaluates
# module-level code while prerendering, and a missing AUTH_SECRET throws there.
#
# Set on the RUN line rather than with ENV, so they exist for the build and are
# recorded nowhere. `ENV AUTH_SECRET=…` would sit in this stage's image metadata
# for anyone with the layer — a placeholder today, and whatever somebody
# substitutes tomorrow. Real values arrive at runtime from the environment.
RUN AUTH_SECRET=build-placeholder \
    MONGODB_URI=mongodb://placeholder:27017/build \
    npm run build

# --- runner ----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Never root. A container that is compromised should not also be privileged.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S labgate -G nodejs

# `output: "standalone"` emits a server plus the node_modules it needs — and,
# less obviously, a copy of the ENTIRE project directory alongside it. Source,
# config, docs, everything that was in the build context.
COPY --from=build --chown=labgate:nodejs /app/.next/standalone ./

# So prune it. `.dockerignore` already keeps the worst of it out of the context
# (see the note about `backups/` there), but that only works for as long as
# nobody adds a directory and forgets to list it — and the failure mode is
# silent. This second pass is scoped to what the runtime actually needs:
# server.js, .next, node_modules, public, package.json.
RUN rm -rf ./src ./scripts ./ops ./attachments ./backups \
           ./*.md ./eslint.config.mjs ./vitest.config.ts ./components.json \
           ./postcss.config.mjs ./tsconfig.json ./tsconfig.tsbuildinfo
COPY --from=build --chown=labgate:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=labgate:nodejs /app/public ./public

# The uploads directory is a MOUNT POINT, not image content. Anything written
# here without a volume behind it disappears on the next deploy — which is how
# QC attachments get lost silently.
RUN mkdir -p /uploads && chown labgate:nodejs /uploads
ENV UPLOAD_DIR=/uploads
VOLUME ["/uploads"]

USER labgate
EXPOSE 3001

# Checks the app, not the port: a process that is listening but cannot reach
# Mongo is down as far as anybody using it is concerned.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.status===200||r.status===401?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
