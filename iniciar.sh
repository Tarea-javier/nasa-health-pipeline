#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
mkdir -p logs

sudo docker compose up -d db

if ! pgrep -f "uvicorn server.main:app" >/dev/null; then
  nohup .venv/bin/uvicorn server.main:app --host 0.0.0.0 --port 8000 --no-access-log > logs/server.log 2>&1 &
fi

for i in $(seq 30); do
  curl -sf localhost:8000/api/version >/dev/null && break
  sleep 1
done

if [ "$1" != "--sin-sim" ] && ! pgrep -f "sim/simulador.py" >/dev/null; then
  PYTHONUNBUFFERED=1 nohup .venv/bin/python sim/simulador.py --cada-evento 600 --omitir T1:hr > logs/sim.log 2>&1 &
fi

if ! pgrep -f "sensores/fit3.py" >/dev/null; then
  PYTHONUNBUFFERED=1 nohup .venv/bin/python sensores/fit3.py --tripulante T1 > logs/fit3.log 2>&1 &
fi

echo "dashboard: http://localhost:8000"
echo "logs:      tail -f logs/server.log logs/sim.log logs/fit3.log"
