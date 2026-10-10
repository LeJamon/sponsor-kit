FROM node:24-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build

COPY . .
RUN ACME_EMBEDDED_WORKER=false NITRO_PRESET=node-server npm run build

# This target contains the migration and bootstrap tooling. Keep it separate
# from the runtime image and provide all settings at `docker run` time.
FROM dependencies AS tools

COPY . .
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node"]

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /app/.output ./.output

USER node

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
