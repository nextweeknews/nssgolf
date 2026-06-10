FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY bot ./bot

CMD ["npm", "run", "discord:global-ranks"]
