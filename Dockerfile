FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:node

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start:node"]
