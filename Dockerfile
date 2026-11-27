# Payment Desk: the no-key scripted demo in a container.
#
#   docker build -t payment-desk .
#   docker run --rm -p 127.0.0.1:8799:8799 payment-desk
#
# Then open http://localhost:8799. Nothing here needs an API key, a model or a database: the Mozaik runtime, the agents,
# their tools, the controls and the enforcement run for real, and the agents' answers are predefined text.
# State is kept in memory only and is gone when the container stops.
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Scripted, nothing persisted, no telemetry credentials. HOST=0.0.0.0 is the address inside the container; publish the
# port to 127.0.0.1 on the host (as above) unless you mean to expose it.
ENV DESK_SCRIPTED=1 \
    DESK_PERSIST=off \
    LAB_PERSIST=off \
    MOZAIK_CREDENTIALS_FILE=/nonexistent \
    NODE_ENV=production \
    API_PORT=8799 \
    HOST=0.0.0.0

EXPOSE 8799
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=4 CMD node -e "fetch('http://127.0.0.1:8799/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "--import", "tsx", "server/index.ts"]
