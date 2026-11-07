# ==============================================================================
# Production Dockerfile for AI-Native Video Creation Platform Backend & Workers
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install native build tools for compiling Node.js addons
RUN apk add --no-cache python3 make g++ git

# Copy monorepo manifests
COPY package*.json tsconfig.base.json ./
COPY shared/package*.json ./shared/
COPY backend/package*.json ./backend/

# Install all dependencies (including devDependencies for TypeScript compilation)
RUN npm install

# Copy source code
COPY shared/ ./shared/
COPY backend/ ./backend/

# Build TypeScript distributions
RUN npm run build:shared && npm run build:backend

# Prune devDependencies to reduce image size
RUN npm prune --omit=dev

# ==============================================================================
# Final Production Runtime Stage
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install production runtime dependencies: FFmpeg, ffprobe, fontconfig, and standard fonts
RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    ttf-dejavu \
    ttf-freefont \
    wget \
    ca-certificates \
    tzdata

ENV NODE_ENV=production
ENV PORT=4000
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

# Copy production node_modules and built code from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/package*.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/backend/dist ./backend/dist

# Create scratch directory for render isolation
RUN mkdir -p /tmp/renders && chmod 777 /tmp/renders

EXPOSE 4000

# Default entrypoint runs API server (workers override command in docker-compose.prod.yml)
CMD ["node", "backend/dist/server.js"]

