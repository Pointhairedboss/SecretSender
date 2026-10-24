# Official Microsoft Playwright image includes Chromium + all system libraries for WebRTC, Canvas & WebCrypto
FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs hermes.yaml ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.mjs"]
