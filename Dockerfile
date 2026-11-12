# Build from the project root (the folder that holds backend/ and frontend/).
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Vite bakes VITE_* values into the page at build time, so the Google client ID must be passed here.
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

FROM python:3.13-slim
WORKDIR /srv
ENV PYTHONUNBUFFERED=1
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist ./static
EXPOSE 8000
# Prepare the database (see bootstrap_db.py), then start the server. $PORT is set by most hosts.
CMD ["sh", "-c", "python bootstrap_db.py && python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]