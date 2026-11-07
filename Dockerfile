FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3
COPY . .
RUN npx nuxt prepare && npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/app.sqlite SCHEDULER_ENABLED=false
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/.output ./.output
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
