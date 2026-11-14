import argparse
import asyncio
import json
import os
import time

from bleak import BleakClient, BleakScanner
from dotenv import load_dotenv
from websockets.asyncio.client import connect

load_dotenv()

WS_URL = os.getenv("WS_URL", "ws://localhost:8000/ws/sensor")
HR_MEDICION = "00002a37-0000-1000-8000-00805f9b34fb"
SIN_DATOS_S = 20


def hora() -> str:
    return time.strftime("%H:%M:%S")


def leer_bpm(datos: bytearray) -> int:
    return int.from_bytes(datos[1:3], "little") if datos[0] & 1 else datos[1]


async def leer_banda(cola: asyncio.Queue, nombre: str):
    while True:
        banda = await BleakScanner.find_device_by_filter(
            lambda d, adv: nombre in (d.name or adv.local_name or "").lower(), timeout=20
        )
        if not banda:
            print(f"{hora()} no encuentro la banda; revisa que esté desconectada del teléfono y en entrenamiento")
            continue
        desconectada = asyncio.Event()
        ultimo = time.time()

        def al_recibir(_, datos: bytearray):
            nonlocal ultimo
            bpm = leer_bpm(datos)
            if bpm <= 0:
                return
            ultimo = time.time()
            if not cola.full():
                cola.put_nowait((ultimo, bpm))
            print(f"{hora()} bpm={bpm}")

        try:
            async with BleakClient(banda, timeout=30, disconnected_callback=lambda _: desconectada.set()) as cliente:
                print(f"{hora()} banda conectada: {banda.name} ({banda.address})")
                await cliente.start_notify(HR_MEDICION, al_recibir)
                while not desconectada.is_set():
                    await asyncio.sleep(1)
                    if time.time() - ultimo > SIN_DATOS_S:
                        print(f"{hora()} {SIN_DATOS_S} s sin latidos; reconectando")
                        break
        except Exception as e:
            print(f"{hora()} error con la banda ({type(e).__name__}: {e}); reintentando en 3 s")
            await asyncio.sleep(3)


async def enviar(cola: asyncio.Queue, tripulante: str):
    while True:
        try:
            async with connect(WS_URL) as ws:
                print(f"{hora()} conectado a {WS_URL}")
                while True:
                    ts, bpm = await cola.get()
                    await ws.send(json.dumps(
                        {"tripulante_id": tripulante, "sensor_id": "galaxy-fit3", "tiempo": ts, "simulado": False, "hr": bpm}
                    ))
                    await ws.recv()
        except Exception as e:
            print(f"{hora()} sin conexión con el servidor ({type(e).__name__}); reintentando en 3 s")
            await asyncio.sleep(3)


async def correr(tripulante: str, nombre: str):
    cola = asyncio.Queue(maxsize=300)
    await asyncio.gather(leer_banda(cola, nombre), enviar(cola, tripulante))


def main():
    p = argparse.ArgumentParser(description="Puente Galaxy Fit3 (BLE) → servidor (WebSocket)")
    p.add_argument("--tripulante", default="T1", help="tripulante al que pertenecen los latidos")
    p.add_argument("--nombre", default="fit3", help="texto que debe contener el nombre Bluetooth de la banda")
    a = p.parse_args()
    asyncio.run(correr(a.tripulante, a.nombre.lower()))


if __name__ == "__main__":
    main()
