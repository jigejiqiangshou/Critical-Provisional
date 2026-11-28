FROM node:24.22.3-trixie-slim@sha256:4d00acb4bcc42c454c4eb801526f7ad7f772ea3bd4fd168c5cc2e384abcbb9d4

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates chromium curl fonts-noto-cjk git jq python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca,uid=1000 \
    if [ -f /run/secrets/npm_ca ]; then \
        export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; \
    fi \
    && npm ci

COPY --chown=node:node . .
RUN npm run build

EXPOSE 4173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
