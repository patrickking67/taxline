# Taxline agent service — container image for any Node host (Fly.io, Render, …).
#
# Built from the REPO ROOT context, NOT service/: the fleet retrieves over
# ../knowledge-base at runtime (KB_ROOT resolves to a sibling of service/), so
# both directories must live in the image.
#
#   docker build -t taxline-service .     # from repo root
#   docker run -p 8787:8787 --env-file service/.env taxline-service
#   fly deploy                            # uses this Dockerfile (see fly.toml)
FROM node:22-alpine

WORKDIR /app

# Install service deps first so this layer caches across code changes.
COPY service/package.json service/package-lock.json ./service/
RUN npm --prefix service ci

# Application code + the knowledge base it reads.
COPY service/ ./service/
COPY knowledge-base/ ./knowledge-base/

ENV PORT=8787
EXPOSE 8787

# Persistent vector memory is written to /app/service/.data — mount a volume there
# (fly.toml does this) so remember()'d findings survive restarts and redeploys.
# Liveness probe hits the /health endpoint (reports config + memory snapshot).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 || exit 1

# Runs tsx src/server.ts. The server auto-builds the memory index on first boot
# if the store is empty, and degrades to offline mode without ANTHROPIC_API_KEY.
CMD ["npm", "--prefix", "service", "run", "start"]
