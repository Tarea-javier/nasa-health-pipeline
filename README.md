# ADAM: Astronaut Health Monitor — Simulated pipeline

```
simulador / bridge.py ──WebSocket──► FastAPI ──► TimescaleDB ◄──polling 1 s── dashboard
                                        ▲                                          │
                                        └──── /api/chat ◄── ADAM (LangGraph) ◄───┘
```

## Structure

```
nasa-health-pipeline/
├── .env                    local configuration with the API key (not pushed to git)
├── .env.example            template for the .env
├── docker-compose.yml      TimescaleDB on port 5433
├── db/001_init.sql         schema: tripulantes, indicadores, lecturas, metadata, lecturas_1min
├── db/002_comandos_ui.sql  commands that ADAM sends to the dashboard
├── server/main.py          FastAPI: ingestion, API, chat, and dashboard
├── server/consultas.py     database queries, shared by the API and the tools
├── server/agente.py        ADAM: LangGraph graph, tools, and model
├── sim/simulador.py        live data over WebSocket or direct history load into the database
├── dashboard/index.html    dashboard and chat with no external dependencies
└── requirements.txt
```

## Database

- `lecturas`: hypertable in large format (`tiempo, tripulante_id, indicador, valor, sensor_id, simulado`). Adding a new indicator is done by adding a new line in `indicadores`; it does not affect the structure.
- `metadata`: one line per table with `version` and `actualizado`. Each insertion uploads the version in the same transaccion. The dashboard checks `/api/version` each second and only asks for data again once the version changes.
- `lecturas_1min`: continuous upload each minute for the 24 hours to 1 year range.
- `indicadores`: parameters `normal` and `alerta` that the dashboard uses for its color code. They are reference values for the demo and will be adjusted for this table.
- The cabin data is saved in `tripulante_id = 'cabina'`.

## Startup (Arch)

1. Docker, only once:

```bash
sudo pacman -S --needed docker docker-compose
sudo systemctl start docker
```

2. Database:

```bash
cd nasa-health-pipeline
sudo docker compose up -d
sudo docker compose logs -f db
```

Wait to see `database system is ready to accept connections` and exit with `Ctrl+C`.

3. Python Environment:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

4. Simulated History (Optional, made for the 7d, 30d and 1y view):

```bash
python sim/simulador.py --historial 365
```

5. Server (terminal 1):

```bash
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

6. Live Simulation (terminal 2):

```bash
python sim/simulador.py
```

7. Dashboard: http://localhost:8000

Accept parameters in the URL: `http://localhost:8000/?tripulante=T2&rango=24h`.

## Simulator

| Option | Effect |
|---|---|
| `--historial DIAS` | Loads DIAS days of history directly into the database and exits |
| `--intervalo 1` | Seconds between live submissions |
| `--cada-evento 180` | Seconds between anomalous events |
| `--sin-eventos` | No anomalous events |

Events: tachycardia, desaturation, fever, high CO₂, and radiation spike. All simulated readings are saved with `simulado = true`.

## WebSocket message format

A single object or a list of objects. Each numeric key present in `indicadores` is saved as a reading:

`tiempo` is optional (epoch in seconds or ISO 8601); if missing, the server time is used. The ESP32 and the Apple Watch `bridge.py` send to this same endpoint.

## API

| Route | Returns |
|---|---|
| `GET /api/version` | Version and time of the last write |
| `GET /api/estado?tripulante_id=T1` | Latest value of each indicator with its status |
| `GET /api/serie?indicadores=hr,co2&tripulante_id=T1&rango=24h` | Series; ranges: `tiempo_real`, `1h`, `24h`, `7d`, `30d`, `1y` |
| `GET /api/tripulantes`, `GET /api/indicadores` | Catalogs |

## ADAM

LangGraph graph with one model node and one `ToolNode`. Per-session and per-crew-member memory using `InMemorySaver`.

| Tool | What it does |
|---|---|
| `estado_actual` | Latest value and status (normal, caution, alert) of each indicator |
| `consultar_serie` | Average, minimum, maximum, latest value, and % out of range over a period |
| `mostrar_grafica` | Inserts a command into `comandos_ui`; the dashboard applies it on its next 1 s cycle |

The status of each indicator is calculated by the server using the ranges in the `indicadores` table; the model only reports it.

Configuration in `.env`:

| Variable | Value |
|---|---|
| `LLM_BASE_URL` | `https://api.deepseek.com` (or `http://localhost:11434/v1` for Ollama) |
| `LLM_MODEL` | `deepseek-flash` |
| `LLM_API_KEY` | your key |
| `LLM_THINKING` | `disabled` for fast responses; empty to not send the parameter |

Direct test:

```bash
curl -s -X POST localhost:8000/api/chat -H 'Content-Type: application/json' \
  -d '{"mensaje": "How are my vital signs?", "tripulante_id": "T1"}'
```

## Updating an existing database

The scripts in `db/` only run when the volume is created. If the database already existed, apply the new migrations manually:

```bash
sudo docker exec -i nasa-db psql -U nasa -d salud < db/002_comandos_ui.sql
```

## Resetting the database from scratch

Delete the volume and recreate it; the scripts in `db/` run again:

```bash
sudo docker compose down -v
sudo docker compose up -d
```

## How to set up the Dashboard
Follow the following [Link](https://github.com/Tarea-javier/landing_nasa_dashboard) for instructions. 

## Demo
[Link to the demo of ADAM!](https://tarea-javier.github.io/landing_nasa_dashboard/)
