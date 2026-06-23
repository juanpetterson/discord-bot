FROM node:22-bookworm-slim

# Build tooling for native modules (@discordjs/opus etc.). On Debian (glibc)
# prebuilt binaries are usually available, so this is just a safe fallback.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

EXPOSE 8080

CMD [ "npm", "run", "start" ]
