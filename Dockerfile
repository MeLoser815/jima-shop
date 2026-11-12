# syntax=docker/dockerfile:1

# 即码小店：多阶段构建。最终镜像以非 root 运行单个 API 进程，
# 托管前端构建产物，SQLite 数据写入 /data。生产环境不会写入演示数据。

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.34.6

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
COPY apps/web apps/web
RUN pnpm --filter @jima/api build \
  && pnpm --filter @jima/web build \
  && pnpm --filter @jima/api deploy --prod --legacy /out/api \
  && mkdir -p /out/api/dist \
  && cp -a apps/api/dist/. /out/api/dist/

FROM node:${NODE_VERSION}-bookworm-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/apps/api /app/apps/web /data
COPY --from=build /out/api /app/apps/api
COPY --from=build /app/apps/web/dist /app/apps/web/dist
COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh \
  && chown -R node:node /app /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3333 \
    DATABASE_PATH=/data/jima.db

WORKDIR /app/apps/api
EXPOSE 3333
VOLUME ["/data"]
USER root
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
