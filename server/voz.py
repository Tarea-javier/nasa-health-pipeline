import asyncio
import base64
import io
import logging
import os
import wave
from functools import lru_cache
from pathlib import Path

from faster_whisper import WhisperModel, decode_audio
from piper import PiperVoice

RAIZ = Path(__file__).resolve().parent.parent
log = logging.getLogger("uvicorn.error")

IDIOMAS = ("es", "en")

VOCABULARIO = {
    "es": (
        "Adam, ¿cómo están mis signos vitales? Frecuencia cardiaca, oxígeno en sangre, "
        "temperatura corporal, presión arterial, glucosa, horas de sueño, estado de ánimo, "
        "CO₂ en cabina, radiación, humedad, Comandante Ríos, Dra. Vega. "
        "Muéstrame la gráfica de la última hora, de 24 horas, de la última semana, del mes, del año."
    ),
    "en": (
        "Adam, how are my vital signs? Heart rate, blood oxygen, body temperature, blood pressure, "
        "glucose, sleep, mood, cabin CO2, radiation, humidity, Commander Ríos, Dr. Vega. "
        "Show me the chart for the last hour, the last 24 hours, the last week, the month, the year."
    ),
}

VOCES = {
    "es": os.getenv("PIPER_VOICE", "voces/es_MX-claude-high.onnx"),
    "en": os.getenv("PIPER_VOICE_EN", "voces/en_US-ryan-high.onnx"),
}


@lru_cache(maxsize=1)
def _whisper() -> WhisperModel:
    return WhisperModel(
        os.getenv("WHISPER_MODEL", "small"),
        device=os.getenv("WHISPER_DEVICE", "cpu"),
        compute_type=os.getenv("WHISPER_COMPUTE", "int8"),
    )


@lru_cache(maxsize=len(VOCES))
def _cargar_voz(ruta: str) -> PiperVoice:
    archivo = RAIZ / ruta
    if not archivo.exists():
        raise FileNotFoundError(
            f"no existe la voz {archivo}; descárgala con: "
            f"python -m piper.download_voices {archivo.stem} --download-dir {archivo.parent}"
        )
    return PiperVoice.load(archivo)


def _piper(idioma: str) -> PiperVoice:
    try:
        return _cargar_voz(VOCES[idioma])
    except FileNotFoundError as e:
        if idioma == "es":
            raise
        log.warning(f"{e}; uso la voz en español")
        return _cargar_voz(VOCES["es"])


def _detectar(muestras) -> str:
    _, _, probabilidades = _whisper().detect_language(audio=muestras)
    p = dict(probabilidades)
    return max(IDIOMAS, key=lambda idioma: p.get(idioma, 0.0))


def _transcribir(audio: bytes) -> tuple[str, str]:
    muestras = decode_audio(io.BytesIO(audio), sampling_rate=16000)
    idioma = _detectar(muestras)
    segmentos, _ = _whisper().transcribe(
        muestras,
        language=idioma,
        beam_size=int(os.getenv("WHISPER_BEAM", "1")),
        vad_filter=True,
        without_timestamps=True,
        initial_prompt=VOCABULARIO[idioma],
    )
    return " ".join(s.text.strip() for s in segmentos).strip(), idioma


def _sintetizar(texto: str, idioma: str) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        _piper(idioma).synthesize_wav(texto, wav)
    return buffer.getvalue()


def precargar() -> None:
    _whisper()
    for idioma in IDIOMAS:
        _piper(idioma)


async def transcribir(audio: bytes) -> tuple[str, str]:
    return await asyncio.to_thread(_transcribir, audio)


async def sintetizar(texto: str, idioma: str = "es") -> str:
    return base64.b64encode(await asyncio.to_thread(_sintetizar, texto, idioma)).decode()
