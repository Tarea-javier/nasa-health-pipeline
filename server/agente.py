import os
from datetime import datetime, timezone
from typing import Literal

from langchain_core.messages import SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from server import consultas as db

ETIQUETA_RANGO = {
    "tiempo_real": "últimos 5 minutos",
    "1h": "última hora",
    "24h": "últimas 24 horas",
    "7d": "últimos 7 días",
    "30d": "últimos 30 días",
    "1y": "último año",
}


def crear_modelo():
    extra = {}
    if os.getenv("LLM_THINKING"):
        extra["thinking"] = {"type": os.environ["LLM_THINKING"]}
    return ChatOpenAI(
        model=os.getenv("LLM_MODEL", "deepseek-flash"),
        base_url=os.getenv("LLM_BASE_URL", "https://api.deepseek.com"),
        api_key=os.getenv("LLM_API_KEY"),
        temperature=0.2,
        timeout=60,
        max_retries=2,
        extra_body=extra or None,
    )


def prompt_sistema(tripulante_id: str) -> str:
    t = db.tripulantes.get(tripulante_id, {"nombre": tripulante_id, "rol": ""})
    catalogo = "\n".join(
        f"- {i['id']}: {i['nombre']} ({i['unidad']}), normal {i['normal_min']}–{i['normal_max']}"
        for i in db.indicadores.values()
    )
    tripulacion = "\n".join(f"- {k}: {v['nombre']}, {v['rol']}" for k, v in db.tripulantes.items())
    ahora = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"""You are Jarvis, the onboard health assistant of a space mission.

You are talking to {t['nombre']} (id {tripulante_id}). Current time: {ahora}.

Crew:
{tripulacion}

Available indicators:
{catalogo}

Rules:
- Always reply in the same language as the user's last message: English or Spanish. If they write in English, answer in English; if they write in Spanish, answer in Spanish.
- Always use the tools to get data. Never make up values.
- The status of each indicator (normal, precaucion = caution, alerta = alert) is computed by the system; report it as given, do not reinterpret it.
- If the user asks to see, show or plot something, call mostrar_grafica in addition to answering.
- Answer in at most three sentences, in plain text, with no markdown or lists, because the answer is read aloud.
- Do not give medical diagnoses. If there is an alert, say so clearly and suggest following the mission protocol or contacting the flight surgeon.
- If there is no data for what they ask, say so."""


def crear_herramientas(tripulante_por_defecto: str):
    Indicador = Literal[tuple(db.indicadores)]
    Rango = Literal[tuple(db.RANGOS)]
    Tripulante = Literal[tuple(db.tripulantes)]

    @tool
    async def estado_actual(tripulante_id: Tripulante = tripulante_por_defecto) -> list[dict]:
        """Último valor de cada indicador de un tripulante y de la cabina, con su estado
        (normal, precaucion, alerta, sin_datos) y hace cuántos segundos se midió."""
        ahora = datetime.now(timezone.utc)
        salida = []
        for f in await db.estado(tripulante_id):
            i = db.indicadores[f["indicador"]]
            salida.append(
                {
                    "indicador": f["indicador"],
                    "nombre": i["nombre"],
                    "valor": None if f["valor"] is None else round(f["valor"], i["decimales"]),
                    "unidad": i["unidad"],
                    "estado": f["estado"],
                    "hace_segundos": None if f["tiempo"] is None else int((ahora - f["tiempo"]).total_seconds()),
                }
            )
        return salida

    @tool
    async def consultar_serie(
        indicador: Indicador, rango: Rango = "24h", tripulante_id: Tripulante = tripulante_por_defecto
    ) -> dict:
        """Resumen de un indicador en un periodo: promedio, mínimo, máximo, último valor y
        porcentaje del tiempo fuera del rango normal. Rangos: tiempo_real (5 min), 1h, 24h, 7d, 30d, 1y."""
        return await db.resumen(indicador, tripulante_id, rango)

    @tool
    async def mostrar_grafica(
        indicador: Indicador, rango: Rango = "24h", tripulante_id: Tripulante = tripulante_por_defecto
    ) -> str:
        """Cambia el dashboard para mostrar la gráfica de un indicador en un periodo y para un tripulante."""
        await db.crear_comando("mostrar", {"indicador": indicador, "rango": rango, "tripulante_id": tripulante_id})
        nombre = db.indicadores[indicador]["nombre"]
        return f"Dashboard mostrando {nombre} de {db.tripulantes[tripulante_id]['nombre']}, {ETIQUETA_RANGO[rango]}."

    return [estado_actual, consultar_serie, mostrar_grafica]


class Jarvis:
    def __init__(self, modelo=None):
        self.modelo = modelo or crear_modelo()
        self.memoria = InMemorySaver()
        self._grafos: dict[str, object] = {}

    def _grafo(self, tripulante_id: str):
        if tripulante_id in self._grafos:
            return self._grafos[tripulante_id]
        herramientas = crear_herramientas(tripulante_id)
        llm = self.modelo.bind_tools(herramientas)

        async def pensar(state: MessagesState):
            mensajes = [SystemMessage(prompt_sistema(tripulante_id)), *state["messages"]]
            return {"messages": [await llm.ainvoke(mensajes)]}

        g = StateGraph(MessagesState)
        g.add_node("pensar", pensar)
        g.add_node("tools", ToolNode(herramientas))
        g.add_edge(START, "pensar")
        g.add_conditional_edges("pensar", tools_condition)
        g.add_edge("tools", "pensar")
        grafo = g.compile(checkpointer=self.memoria)
        self._grafos[tripulante_id] = grafo
        return grafo

    async def responder(self, mensaje: str, tripulante_id: str, sesion: str) -> dict:
        grafo = self._grafo(tripulante_id)
        config = {"configurable": {"thread_id": f"{sesion}:{tripulante_id}"}, "recursion_limit": 12}
        antes = len((await grafo.aget_state(config)).values.get("messages", []))
        salida = await grafo.ainvoke({"messages": [("user", mensaje)]}, config)
        nuevos = salida["messages"][antes:]
        herramientas = [tc["name"] for m in nuevos for tc in getattr(m, "tool_calls", None) or []]
        return {"respuesta": salida["messages"][-1].content, "herramientas": herramientas}
