# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Prisma needs OpenSSL present to detect the correct query engine on Alpine
RUN apk add --no-cache openssl

# Install dependencies (including dev) for build + prisma generate
COPY package.json ./
RUN npm install --no-audit --no-fund

# Generate Prisma client, then compile
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma migrate/query engines require OpenSSL at runtime on Alpine
RUN apk add --no-cache openssl

# Copy installed deps (includes prisma CLI for migrate deploy) and build output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
