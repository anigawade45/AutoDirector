# ==============================================================================
# Production Dockerfile for AI-Native Video Creation Platform Frontend Web App
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy monorepo manifests
COPY package*.json tsconfig.base.json ./
COPY shared/package*.json ./shared/
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN npm install

# Copy source
COPY shared/ ./shared/
COPY frontend/ ./frontend/

# Build shared library and Vite frontend bundle
RUN npm run build:shared && npm run build:frontend

# ==============================================================================
# Nginx Static Web Server Stage
# ==============================================================================
FROM nginx:alpine AS runner

# Remove default Nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy built Vite assets
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
