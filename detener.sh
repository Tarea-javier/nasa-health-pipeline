#!/usr/bin/env bash
pkill -f "sim/simulador.py" && echo "simulador detenido"
if [ "$1" != "sim" ]; then
  pkill -f "uvicorn server.main:app" && echo "servidor detenido"
fi
