import asyncio
import logging
import mimetypes
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import consultas as db
from server import voz
from server.agente import Jarvis

log = logging.getLogger("uvicorn.error")

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")

DASHBOARD = Path(__file__).resolve().parent.parent / "dashboard"
CAMPOS_META = {"sensor_id", "tripulante_id", "tiempo", "simulado"}

jarvis: Jarvis | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global jarvis
    await db.pool.open()
    await db.cargar_catalogos()
    jarvis = Jarvis()
    asyncio.create_task(precargar_voz())
    yield
    await db.pool.close()


async def precargar_voz():
    try:
        await asyncio.to_thread(voz.precargar)
        log.info("voz lista: whisper y piper cargados")
    except Exception as e:
        log.warning(f"voz no disponible: {e}")


app = FastAPI(title="Monitor de salud de astronautas", lifespan=lifespan)


def normalizar(msg: dict) -> list[tuple]:
    tiempo = db.a_tiempo(msg.get("tiempo"))
    tripulante = msg.get("tripulante_id", "T1")
    sensor = msg.get("sensor_id")
    simulado = bool(msg.get("simulado", False))
    filas = []
    for clave, valor in msg.items():
        if clave in CAMPOS_META or clave not in db.indicadores:
            continue
        if isinstance(valor, bool) or not isinstance(valor, (int, float)):
            continue
        filas.append((tiempo, db.dueno(clave, tripulante), clave, float(valor), sensor, simulado))
    return filas


@app.websocket("/ws/sensor")
async def ws_sensor(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = await ws.receive_json()
            mensajes = msg if isinstance(msg, list) else [msg]
            filas = [f for m in mensajes for f in normalizar(m)]
            if filas:
                await db.insertar_lecturas(filas)
            await ws.send_json({"ok": True, "insertadas": len(filas)})
    except WebSocketDisconnect:
        pass


@app.get("/api/version")
async def version():
    return await db.version()


@app.get("/api/tripulantes")
async def tripulantes():
    return list(db.tripulantes.values())


@app.get("/api/indicadores")
async def indicadores():
    return list(db.indicadores.values())


@app.get("/api/estado")
async def estado(tripulante_id: str = "T1"):
    return await db.estado(tripulante_id)


@app.get("/api/serie")
async def serie(
    indicadores_csv: str = Query(..., alias="indicadores"),
    tripulante_id: str = "T1",
    rango: str = "tiempo_real",
):
    if rango not in db.RANGOS:
        raise HTTPException(400, f"rango inválido; usa uno de {list(db.RANGOS)}")
    pedidos = [i.strip() for i in indicadores_csv.split(",") if i.strip()]
    desconocidos = [i for i in pedidos if i not in db.indicadores]
    if desconocidos:
        raise HTTPException(400, f"indicadores desconocidos: {desconocidos}")
    series = await db.serie(pedidos, tripulante_id, rango)
    return {"rango": rango, "tripulante_id": tripulante_id, "series": series}


@app.get("/api/comandos")
async def comandos(desde: int = 0):
    return await db.comandos_desde(desde)


class Pregunta(BaseModel):
    mensaje: str
    tripulante_id: str = "T1"
    sesion: str = "default"


@app.post("/api/chat")
async def chat(p: Pregunta):
    if p.tripulante_id not in db.tripulantes:
        raise HTTPException(400, f"tripulante desconocido: {p.tripulante_id}")
    try:
        return await jarvis.responder(p.mensaje, p.tripulante_id, p.sesion)
    except Exception as e:
        raise HTTPException(502, f"error del modelo: {type(e).__name__}: {e}")


@app.post("/api/voz")
async def hablar(
    audio: UploadFile = File(...),
    tripulante_id: str = Form("T1"),
    sesion: str = Form("default"),
):
    if tripulante_id not in db.tripulantes:
        raise HTTPException(400, f"tripulante desconocido: {tripulante_id}")
    t0 = time.perf_counter()
    try:
        texto, idioma = await voz.transcribir(await audio.read())
    except Exception as e:
        raise HTTPException(500, f"error al transcribir: {type(e).__name__}: {e}")
    if not texto:
        raise HTTPException(422, "no se entendió el audio; intenta de nuevo")
    t1 = time.perf_counter()
    try:
        r = await jarvis.responder(texto, tripulante_id, sesion)
    except Exception as e:
        raise HTTPException(502, f"error del modelo: {type(e).__name__}: {e}")
    t2 = time.perf_counter()
    try:
        audio_b64 = await voz.sintetizar(r["respuesta"], idioma)
    except Exception as e:
        log.warning(f"no se pudo sintetizar: {e}")
        audio_b64 = None
    t3 = time.perf_counter()
    tiempos = {"whisper": round(t1 - t0, 2), "modelo": round(t2 - t1, 2), "piper": round(t3 - t2, 2)}
    log.info(f"voz [{idioma}] tiempos (s): {tiempos}")
    return {"transcripcion": texto, "idioma": idioma, **r, "audio": audio_b64, "tiempos": tiempos}


app.mount("/", StaticFiles(directory=DASHBOARD, html=True), name="dashboard")
