# Monitor de salud de astronautas — pipeline con datos simulados

```
simulador / bridge.py ──WebSocket──► FastAPI ──► TimescaleDB ◄──polling 1 s── dashboard
                                        ▲                                          │
                                        └──── /api/chat ◄── Jarvis (LangGraph) ◄───┘
```

## Estructura

```
nasa-health-pipeline/
├── .env                    configuración local con la API key (no se sube a git)
├── .env.example            plantilla del .env
├── docker-compose.yml      TimescaleDB en el puerto 5433
├── db/001_init.sql         esquema: tripulantes, indicadores, lecturas, metadata, lecturas_1min
├── db/002_comandos_ui.sql  comandos que Jarvis manda al dashboard
├── server/main.py          FastAPI: ingesta, API, chat y dashboard
├── server/consultas.py     consultas a la base, compartidas por la API y las tools
├── server/agente.py        Jarvis: grafo de LangGraph, tools y modelo
├── sim/simulador.py        datos en vivo por WebSocket o historial directo a la base
├── dashboard/index.html    dashboard y chat sin dependencias externas
└── requirements.txt
```

## Base de datos

- `lecturas`: hypertable en formato largo (`tiempo, tripulante_id, indicador, valor, sensor_id, simulado`). Agregar un indicador nuevo es insertar una fila en `indicadores`; no cambia el esquema.
- `metadata`: una fila por tabla con `version` y `actualizado`. Cada inserción sube la versión en la misma transacción. El dashboard consulta `/api/version` cada segundo y solo vuelve a pedir datos cuando la versión cambió.
- `lecturas_1min`: agregado continuo por minuto para los rangos de 24 h a 1 año.
- `indicadores`: rangos `normal` y `alerta` que usa el dashboard para el código de colores. Son valores de referencia para la demo y se ajustan en esta tabla.
- El ambiente de la cabina se guarda con `tripulante_id = 'cabina'`.

## Arranque (Arch)

1. Docker, una sola vez:

```bash
sudo pacman -S --needed docker docker-compose
sudo systemctl start docker
```

2. Base de datos:

```bash
cd nasa-health-pipeline
sudo docker compose up -d
sudo docker compose logs -f db
```

Espera a ver `database system is ready to accept connections` y sal con `Ctrl+C`.

3. Entorno de Python:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

4. Historial simulado (opcional, para las vistas de 7 d, 30 d y 1 año):

```bash
python sim/simulador.py --historial 365
```

5. Servidor (terminal 1):

```bash
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

6. Simulador en vivo (terminal 2):

```bash
python sim/simulador.py
```

7. Dashboard: http://localhost:8000

Acepta parámetros en la URL: `http://localhost:8000/?tripulante=T2&rango=24h`.

## Simulador

| Opción | Efecto |
|---|---|
| `--historial DIAS` | Carga DIAS de historial directo a la base y termina |
| `--intervalo 1` | Segundos entre envíos en vivo |
| `--cada-evento 180` | Segundos entre eventos anómalos |
| `--sin-eventos` | Sin eventos anómalos |

Eventos: taquicardia, desaturación, fiebre, CO₂ alto y pico de radiación. Todas las lecturas simuladas se guardan con `simulado = true`.

## Formato de mensaje del WebSocket

Un objeto o una lista de objetos. Cada clave numérica que exista en `indicadores` se guarda como una lectura:

```json
{"tripulante_id": "T1", "sensor_id": "esp32", "tiempo": 1794650366.2, "hr": 72, "spo2": 98}
```

`tiempo` es opcional (epoch en segundos o ISO 8601); si falta, se usa la hora del servidor. El ESP32 y `bridge.py` del Apple Watch mandan a este mismo endpoint.

## API

| Ruta | Devuelve |
|---|---|
| `GET /api/version` | Versión y hora de la última escritura |
| `GET /api/estado?tripulante_id=T1` | Último valor de cada indicador con su estado |
| `GET /api/serie?indicadores=hr,co2&tripulante_id=T1&rango=24h` | Series; rangos: `tiempo_real`, `1h`, `24h`, `7d`, `30d`, `1y` |
| `GET /api/tripulantes`, `GET /api/indicadores` | Catálogos |

## Jarvis

Grafo de LangGraph con un nodo de modelo y un `ToolNode`. Memoria por sesión y tripulante con `InMemorySaver`.

| Tool | Qué hace |
|---|---|
| `estado_actual` | Último valor y estado (normal, precaución, alerta) de cada indicador |
| `consultar_serie` | Promedio, mínimo, máximo, último valor y % fuera de rango en un periodo |
| `mostrar_grafica` | Inserta un comando en `comandos_ui`; el dashboard lo aplica en su siguiente ciclo de 1 s |

El estado de cada indicador lo calcula el servidor con los rangos de la tabla `indicadores`; el modelo solo lo reporta.

Configuración en `.env`:

| Variable | Valor |
|---|---|
| `LLM_BASE_URL` | `https://api.deepseek.com` (o `http://localhost:11434/v1` para Ollama) |
| `LLM_MODEL` | `deepseek-flash` |
| `LLM_API_KEY` | tu key |
| `LLM_THINKING` | `disabled` para respuestas rápidas; vacío para no enviar el parámetro |

Prueba directa:

```bash
curl -s -X POST localhost:8000/api/chat -H 'Content-Type: application/json' \
  -d '{"mensaje": "¿Cómo están mis signos vitales?", "tripulante_id": "T1"}'
```

## Actualizar una base ya creada

Los scripts de `db/` solo corren cuando se crea el volumen. Si la base ya existía, aplica las migraciones nuevas a mano:

```bash
sudo docker exec -i nasa-db psql -U nasa -d salud < db/002_comandos_ui.sql
```

## Reiniciar la base desde cero

Borra el volumen y vuelve a crearlo; los scripts de `db/` corren de nuevo:

```bash
sudo docker compose down -v
sudo docker compose up -d
```
