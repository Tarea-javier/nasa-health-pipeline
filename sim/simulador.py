import argparse
import asyncio
import json
import math
import os
import random
import time
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv()

WS_URL = os.getenv("WS_URL", "ws://localhost:8000/ws/sensor")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://nasa:nasa@localhost:5433/salud")

TRIPULANTES = {
    "T1": {"hr": 66, "temp": 36.9, "sis": 112, "dia": 71, "glucosa": 94},
    "T2": {"hr": 72, "temp": 37.0, "sis": 108, "dia": 69, "glucosa": 99},
}

EVENTOS = {
    "taquicardia": {"duracion": 60, "msg": "frecuencia cardiaca elevada"},
    "desaturacion": {"duracion": 45, "msg": "caída de oxígeno en sangre"},
    "co2_alto": {"duracion": 90, "msg": "CO₂ alto en cabina"},
    "tormenta_solar": {"duracion": 60, "msg": "pico de radiación"},
    "fiebre": {"duracion": 120, "msg": "temperatura corporal alta"},
}


def hora_del_dia(ts: float) -> float:
    d = datetime.fromtimestamp(ts)
    return d.hour + d.minute / 60 + d.second / 3600


def circadiano(ts: float, pico: float) -> float:
    return math.sin(2 * math.pi * (hora_del_dia(ts) - pico + 6) / 24)


def en_ejercicio(ts: float) -> bool:
    h = hora_del_dia(ts)
    return 10 <= h < 11 or 18 <= h < 19


def despues_de_comer(ts: float) -> float:
    h = hora_del_dia(ts)
    return max((math.exp(-(h - c) / 1.2) for c in (8, 13, 19) if h >= c), default=0.0)


def vitales(tid: str, ts: float, eventos: dict, tripulante_evento: str | None) -> dict:
    b = TRIPULANTES[tid]
    afectado = tripulante_evento == tid
    ejercicio = en_ejercicio(ts)
    hr = b["hr"] + 6 * circadiano(ts, 16) + random.gauss(0, 2) + (45 if ejercicio else 0)
    spo2 = min(100, 97.6 + random.gauss(0, 0.5))
    temp = b["temp"] + 0.3 * circadiano(ts, 18) + random.gauss(0, 0.04) + (0.5 if ejercicio else 0)
    if afectado and "taquicardia" in eventos:
        hr += 55
    if afectado and "desaturacion" in eventos:
        spo2 = 88.5 + random.gauss(0, 0.6)
    if afectado and "fiebre" in eventos:
        temp = 38.6 + random.gauss(0, 0.05)
    return {"hr": round(hr), "spo2": round(spo2, 1), "temp_corporal": round(temp, 2)}


def presion(tid: str) -> dict:
    b = TRIPULANTES[tid]
    return {"presion_sis": round(b["sis"] + random.gauss(0, 5)), "presion_dia": round(b["dia"] + random.gauss(0, 4))}


def glucosa(tid: str, ts: float) -> dict:
    return {"glucosa": round(TRIPULANTES[tid]["glucosa"] + 35 * despues_de_comer(ts) + random.gauss(0, 6))}


def cabina(ts: float, eventos: dict) -> dict:
    co2 = 2.2 + 0.3 * circadiano(ts, 14) + random.gauss(0, 0.08)
    rad = 22 + random.gauss(0, 2.5)
    if "co2_alto" in eventos:
        co2 = 4.4 + random.gauss(0, 0.1)
    if "tormenta_solar" in eventos:
        rad = 160 + random.gauss(0, 20)
    return {
        "co2": round(co2, 2),
        "temp_cabina": round(22.5 + 0.4 * circadiano(ts, 15) + random.gauss(0, 0.1), 1),
        "humedad": round(45 + random.gauss(0, 2)),
        "radiacion": round(rad, 1),
    }


def diarios() -> dict:
    return {"sueno_horas": round(min(9, max(4.5, random.gauss(6.3, 0.6))), 1), "animo": random.choice([3, 4, 4, 4, 5])}


OMITIR: set[tuple[str, str]] = set()


def registro(tid: str, ts: float, valores: dict) -> dict:
    valores = {k: v for k, v in valores.items() if (tid, k) not in OMITIR}
    return {"tripulante_id": tid, "sensor_id": "simulador", "tiempo": ts, "simulado": True, **valores}


async def en_vivo(intervalo: float, cada_evento: float, sin_eventos: bool):
    from websockets.asyncio.client import connect

    activos: dict[str, float] = {}
    quien: str | None = None
    proximo_evento = time.time() + cada_evento
    ultimo_bp = ultimo_glu = 0.0

    while True:
        try:
            async with connect(WS_URL) as ws:
                print(f"conectado a {WS_URL}")
                while True:
                    ts = time.time()
                    activos = {k: v for k, v in activos.items() if v > ts}
                    if not sin_eventos and ts >= proximo_evento:
                        nombre = random.choice(list(EVENTOS))
                        quien = random.choice(list(TRIPULANTES))
                        activos[nombre] = ts + EVENTOS[nombre]["duracion"]
                        proximo_evento = ts + cada_evento
                        print(f"EVENTO {nombre} ({EVENTOS[nombre]['msg']}) en {quien}, {EVENTOS[nombre]['duracion']} s")

                    lote = [registro(t, ts, vitales(t, ts, activos, quien)) for t in TRIPULANTES]
                    lote.append(registro("cabina", ts, cabina(ts, activos)))
                    if ts - ultimo_bp >= 60:
                        lote += [registro(t, ts, presion(t)) for t in TRIPULANTES]
                        ultimo_bp = ts
                    if ts - ultimo_glu >= 300:
                        lote += [registro(t, ts, glucosa(t, ts)) for t in TRIPULANTES]
                        ultimo_glu = ts

                    await ws.send(json.dumps(lote))
                    resp = json.loads(await ws.recv())
                    print(f"{time.strftime('%H:%M:%S')}  insertadas={resp['insertadas']}  eventos={list(activos)}")
                    await asyncio.sleep(intervalo)
        except Exception as e:
            print(f"sin conexión con el servidor ({type(e).__name__}); reintentando en 3 s")
            await asyncio.sleep(3)


def historial(dias: int):
    import psycopg

    ahora = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    inicio = (ahora - timedelta(days=dias)).replace(minute=0)
    filas = []

    def agregar(tid: str, t: datetime, valores: dict):
        for ind, v in valores.items():
            filas.append((t, tid, ind, float(v), "simulador", True))

    t = inicio
    while t < ahora:
        ts = t.timestamp()
        paso = timedelta(minutes=1) if ahora - t <= timedelta(days=2) else timedelta(minutes=15)
        for tid in TRIPULANTES:
            agregar(tid, t, vitales(tid, ts, {}, None))
            if t.minute % 30 == 0:
                agregar(tid, t, presion(tid))
                agregar(tid, t, glucosa(tid, ts))
            if datetime.fromtimestamp(ts).hour == 7 and t.minute == 0:
                agregar(tid, t, diarios())
        agregar("cabina", t, cabina(ts, {}))
        t += paso

    print(f"insertando {len(filas):,} lecturas de {dias} días...")
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            with cur.copy(
                "COPY lecturas (tiempo, tripulante_id, indicador, valor, sensor_id, simulado) FROM STDIN"
            ) as copy:
                for fila in filas:
                    copy.write_row(fila)
            cur.execute("UPDATE metadata SET version = version + 1, actualizado = now() WHERE tabla = 'lecturas'")
        print("actualizando agregado continuo...")
        conn.execute("CALL refresh_continuous_aggregate('lecturas_1min', NULL, NULL)")
    print("listo")


def main():
    p = argparse.ArgumentParser(description="Simulador de signos vitales y ambiente de cabina")
    p.add_argument("--historial", type=int, metavar="DIAS", help="carga DIAS de historial directo a la base y termina")
    p.add_argument("--intervalo", type=float, default=1.0, help="segundos entre envíos en vivo")
    p.add_argument("--cada-evento", type=float, default=180, help="segundos entre eventos anómalos")
    p.add_argument("--sin-eventos", action="store_true", help="no generar eventos anómalos")
    p.add_argument(
        "--omitir", action="append", default=[], metavar="TRIPULANTE:INDICADOR",
        help="no simular ese indicador porque lo manda un sensor real, p. ej. --omitir T1:hr",
    )
    a = p.parse_args()
    OMITIR.update(tuple(x.split(":", 1)) for x in a.omitir)

    if a.historial:
        historial(a.historial)
    else:
        asyncio.run(en_vivo(a.intervalo, a.cada_evento, a.sin_eventos))


if __name__ == "__main__":
    main()
