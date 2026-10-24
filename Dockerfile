FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY --chown=node:node package.json server.mjs pdf-worker.py index.html styles.css app.js merge.js api.js config.js ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PDF_PYTHON=/opt/venv/bin/python PYTHONDONTWRITEBYTECODE=1
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
