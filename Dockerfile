FROM node:20-slim

WORKDIR /app

# Minimal install — scorer uses only built-in fetch (Node 18+), no Midnight SDK needed
RUN npm install -g tsx@4

COPY scripts/nightid-api.ts scripts/
COPY scripts/night-id-scorer.ts scripts/

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["tsx", "scripts/nightid-api.ts"]
