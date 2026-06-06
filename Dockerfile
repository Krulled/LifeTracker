# ── Stage 1: build React frontend ────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ───────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-build /build/dist /app/frontend/dist

# Fly.io persistent volume will be mounted at /data
RUN mkdir -p /data

ENV PYTHONUNBUFFERED=1
ENV DB_PATH=/data/sleep_tracker.db

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "120", "app:app"]
