FROM node:20-alpine
RUN apk add --no-cache openssl

# Litestream backs up /data/dev.sqlite (Shopify sessions) to the Tigris bucket.
# It is a Go binary, not an npm package, so `npx litestream` never worked.
COPY --from=litestream/litestream:0.3.13 /usr/local/bin/litestream /usr/local/bin/litestream

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npx prisma generate --schema=prisma/session/schema.prisma

RUN npm run build

CMD ["npm", "run", "docker-start"]
