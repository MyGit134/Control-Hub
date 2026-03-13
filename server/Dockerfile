FROM node:20-alpine

WORKDIR /app

COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev

COPY server ./server
COPY web ./web

WORKDIR /app/server
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "src/index.js"]

