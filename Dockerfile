# brmonk — AI browser automation agent
# This image runs the brmonk agent + web UI.
# The browser runs on the HOST machine; brmonk connects to it
# via Chrome DevTools Protocol (CDP) or Playwright MCP over HTTP.

FROM node:22-slim

WORKDIR /app

# Install system deps needed by some npm packages (no Chromium needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy built backend
COPY dist/ ./dist/

# Copy built frontend
COPY web/dist/ ./web/dist/

# Data volume for memory/config persistence
VOLUME /data

# Environment defaults (override in docker-compose or .env)
ENV BRMONK_MEMORY_DIR=/data \
    BRMONK_SKILLS_DIR=/data/skills \
    BRMONK_HEADLESS=true \
    NODE_ENV=production

# Web UI port
EXPOSE 3333

# Start the web server by default
CMD ["node", "dist/cli.js", "web", "--port", "3333"]
