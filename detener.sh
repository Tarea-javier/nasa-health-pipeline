#!/usr/bin/env bash
case "$1" in
  sim) pkill -f "sim/simulador.py" && echo "simulador detenido" ;;
  fit3) pkill -f "sensores/fit3.py" && echo "puente Fit3 detenido" ;;
  *)
    pkill -f "sim/simulador.py" && echo "simulador detenido"
    pkill -f "sensores/fit3.py" && echo "puente Fit3 detenido"
    pkill -f "uvicorn server.main:app" && echo "servidor detenido"
    ;;
esac
true
