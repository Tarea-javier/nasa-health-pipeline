import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://nasa:nasa@localhost:5433/salud")

RANGOS = {
    "tiempo_real": {"ventana": "5 minutes", "bucket": None, "tabla": "lecturas"},
    "1h": {"ventana": "1 hour", "bucket": "10 seconds", "tabla": "lecturas"},
    "24h": {"ventana": "24 hours", "bucket": "5 minutes", "tabla": "lecturas_1min"},
    "7d": {"ventana": "7 days", "bucket": "30 minutes", "tabla": "lecturas_1min"},
    "30d": {"ventana": "30 days", "bucket": "2 hours", "tabla": "lecturas_1min"},
    "1y": {"ventana": "365 days", "bucket": "1 day", "tabla": "lecturas_1min"},
}

pool = AsyncConnectionPool(DATABASE_URL, open=False, kwargs={"row_factory": dict_row})
indicadores: dict[str, dict] = {}
tripulantes: dict[str, dict] = {}


async def cargar_catalogos() -> None:
    async with pool.connection() as conn:
        ind = await (await conn.execute("SELECT * FROM indicadores")).fetchall()
        trip = await (
            await conn.execute("SELECT id, nombre, rol FROM tripulantes WHERE tipo = 'tripulante' ORDER BY id")
        ).fetchall()
    indicadores.update({r["id"]: r for r in ind})
    tripulantes.update({r["id"]: r for r in trip})


def dueno(indicador: str, tripulante_id: str) -> str:
    return "cabina" if indicadores[indicador]["categoria"] == "ambiente" else tripulante_id


def estado_de(indicador: str, valor: float | None) -> str:
    if valor is None:
        return "sin_datos"
    i = indicadores[indicador]
    if (i["alerta_min"] is not None and valor < i["alerta_min"]) or (
        i["alerta_max"] is not None and valor > i["alerta_max"]
    ):
        return "alerta"
    if (i["normal_min"] is not None and valor < i["normal_min"]) or (
        i["normal_max"] is not None and valor > i["normal_max"]
    ):
        return "precaucion"
    return "normal"


def a_tiempo(valor) -> datetime:
    if valor is None:
        return datetime.now(timezone.utc)
    if isinstance(valor, (int, float)):
        return datetime.fromtimestamp(valor, timezone.utc)
    return datetime.fromisoformat(valor)


async def insertar_lecturas(filas: list[tuple]) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.executemany(
                "INSERT INTO lecturas (tiempo, tripulante_id, indicador, valor, sensor_id, simulado) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                filas,
            )
            await cur.execute(
                "UPDATE metadata SET version = version + 1, actualizado = now() WHERE tabla = 'lecturas'"
            )


async def version() -> dict:
    async with pool.connection() as conn:
        fila = await (
            await conn.execute(
                "SELECT version, actualizado, (SELECT coalesce(max(id), 0) FROM comandos_ui) AS comando "
                "FROM metadata WHERE tabla = 'lecturas'"
            )
        ).fetchone()
    return fila


async def estado(tripulante_id: str) -> list[dict]:
    sql = """
        SELECT i.id AS indicador, x.valor, x.tiempo, x.simulado
        FROM indicadores i
        LEFT JOIN LATERAL (
            SELECT valor, tiempo, simulado
            FROM lecturas l
            WHERE l.indicador = i.id
              AND l.tripulante_id = CASE WHEN i.categoria = 'ambiente' THEN 'cabina' ELSE %(t)s END
            ORDER BY l.tiempo DESC
            LIMIT 1
        ) x ON TRUE
        ORDER BY i.id
    """
    async with pool.connection() as conn:
        filas = await (await conn.execute(sql, {"t": tripulante_id})).fetchall()
    return [{**f, "estado": estado_de(f["indicador"], f["valor"])} for f in filas]


async def serie(pedidos: list[str], tripulante_id: str, rango: str) -> dict[str, list]:
    cfg = RANGOS[rango]
    if cfg["tabla"] == "lecturas" and cfg["bucket"] is None:
        sql = """
            SELECT tiempo AS t, valor AS v FROM lecturas
            WHERE tripulante_id = %(t)s AND indicador = %(i)s AND tiempo > now() - %(w)s::interval
            ORDER BY tiempo
        """
    elif cfg["tabla"] == "lecturas":
        sql = """
            SELECT time_bucket(%(b)s::interval, tiempo) AS t, avg(valor) AS v FROM lecturas
            WHERE tripulante_id = %(t)s AND indicador = %(i)s AND tiempo > now() - %(w)s::interval
            GROUP BY 1 ORDER BY 1
        """
    else:
        sql = """
            SELECT time_bucket(%(b)s::interval, bucket) AS t,
                   sum(promedio * n) / sum(n) AS v
            FROM lecturas_1min
            WHERE tripulante_id = %(t)s AND indicador = %(i)s AND bucket > now() - %(w)s::interval
            GROUP BY 1 ORDER BY 1
        """
    resultado = {}
    async with pool.connection() as conn:
        for ind in pedidos:
            params = {"t": dueno(ind, tripulante_id), "i": ind, "w": cfg["ventana"], "b": cfg["bucket"]}
            filas = await (await conn.execute(sql, params)).fetchall()
            resultado[ind] = [[int(f["t"].timestamp() * 1000), round(f["v"], 3)] for f in filas]
    return resultado


async def resumen(indicador: str, tripulante_id: str, rango: str) -> dict:
    cfg = RANGOS[rango]
    sql = """
        SELECT count(*) AS n, avg(valor) AS promedio, min(valor) AS minimo, max(valor) AS maximo,
               count(*) FILTER (WHERE valor < %(nmin)s OR valor > %(nmax)s) AS fuera_de_rango,
               (array_agg(valor ORDER BY tiempo DESC))[1] AS ultimo
        FROM lecturas
        WHERE tripulante_id = %(t)s AND indicador = %(i)s AND tiempo > now() - %(w)s::interval
    """
    i = indicadores[indicador]
    params = {
        "t": dueno(indicador, tripulante_id),
        "i": indicador,
        "w": cfg["ventana"],
        "nmin": i["normal_min"] if i["normal_min"] is not None else float("-inf"),
        "nmax": i["normal_max"] if i["normal_max"] is not None else float("inf"),
    }
    async with pool.connection() as conn:
        f = await (await conn.execute(sql, params)).fetchone()
    if not f["n"]:
        return {"indicador": indicador, "rango": rango, "sin_datos": True}
    d = i["decimales"]

    def r(v, dec):
        return int(round(v)) if dec == 0 else round(v, dec)

    return {
        "indicador": indicador,
        "nombre": i["nombre"],
        "unidad": i["unidad"],
        "rango": rango,
        "lecturas": f["n"],
        "promedio": round(f["promedio"], d + 1),
        "minimo": r(f["minimo"], d),
        "maximo": r(f["maximo"], d),
        "ultimo": r(f["ultimo"], d),
        "estado_ultimo": estado_de(indicador, f["ultimo"]),
        "porcentaje_fuera_de_rango_normal": round(100 * f["fuera_de_rango"] / f["n"], 1),
        "rango_normal": [i["normal_min"], i["normal_max"]],
    }


async def crear_comando(accion: str, params: dict) -> int:
    async with pool.connection() as conn:
        fila = await (
            await conn.execute(
                "INSERT INTO comandos_ui (accion, params) VALUES (%s, %s) RETURNING id", (accion, Jsonb(params))
            )
        ).fetchone()
    return fila["id"]


async def comandos_desde(ultimo: int) -> list[dict]:
    async with pool.connection() as conn:
        return await (
            await conn.execute(
                "SELECT id, accion, params FROM comandos_ui WHERE id > %s ORDER BY id", (ultimo,)
            )
        ).fetchall()
