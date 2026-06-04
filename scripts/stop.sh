#!/usr/bin/env bash
# Stop all local dev services started by scripts/dev.sh
set -e

echo "▶ Killing Metro (port 8081)..."
for pid in $(netstat -ano 2>/dev/null | grep ':8081.*LISTENING' | awk '{print $5}' | sort -u); do
  taskkill //PID "$pid" //F >/dev/null 2>&1 || true
done

echo "▶ Killing backend (port 4000)..."
for pid in $(netstat -ano 2>/dev/null | grep ':4000.*LISTENING' | awk '{print $5}' | sort -u); do
  taskkill //PID "$pid" //F >/dev/null 2>&1 || true
done

echo "▶ Stopping Docker services..."
docker compose -f "$(dirname "$0")/../backend/docker-compose.yml" stop

echo "Done."
