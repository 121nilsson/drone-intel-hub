FROM node:22-alpine AS build
WORKDIR /app
# Lockfile first so the install layer is only re-run when the dependencies change.
# `npm ci` installs exactly what the lockfile pins and fails when it is out of sync with
# package.json - unlike a plain `npm install`, which would silently resolve something newer.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build for a plain Node server instead of the default Cloudflare target.
ENV NITRO_PRESET=node-server
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/.output ./.output
# Read from disk at runtime, relative to the working directory: the migration runner applies
# /migrations at start, and the rule sandbox replays the checked-in git corpus.
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/src/test/fixtures ./src/test/fixtures
ENV NODE_ENV=production PORT=3010
EXPOSE 3010
CMD ["node", ".output/server/index.mjs"]
