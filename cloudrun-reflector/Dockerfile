# Official Microsoft Playwright image includes Chromium + all system libraries for WebRTC, Canvas & WebCrypto
FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Install ttyd (interactive web terminal over WebSocket)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates procps && \
    curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64" -o /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs hermes.yaml hermes-cli.mjs start-hermes-shell.sh ./
RUN mkdir -p /root/.hermes && \
    cp /app/hermes.yaml /root/.hermes/config.yaml && \
    sed -i 's/\r$//' /app/start-hermes-shell.sh /app/hermes-cli.mjs && \
    chmod +x /app/start-hermes-shell.sh /app/hermes-cli.mjs && \
    ln -sf /app/hermes-cli.mjs /usr/local/bin/hermes

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.mjs"]
