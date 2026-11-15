export const INTERVALO_MS = 1000;
export const RECARGA_SERIES_MS = 30000;

export const RANGOS = [
  { id: "tiempo_real", etiqueta: "Live", texto: "last 5 minutes", resolucion: "raw readings", ms: 5 * 60e3 },
  { id: "1h", etiqueta: "1 h", texto: "last hour", resolucion: "10 s averages", ms: 3600e3 },
  { id: "24h", etiqueta: "24 h", texto: "last 24 hours", resolucion: "5 min averages", ms: 86400e3 },
  { id: "7d", etiqueta: "7 d", texto: "last 7 days", resolucion: "30 min averages", ms: 7 * 86400e3 },
  { id: "30d", etiqueta: "30 d", texto: "last 30 days", resolucion: "2 h averages", ms: 30 * 86400e3 },
  { id: "1y", etiqueta: "Pre-flight", texto: "last year · pre-flight vs in-flight", resolucion: "daily averages", ms: 365 * 86400e3 },
];

export const METRICAS = [
  { id: "hr", titulo: "Heart rate", series: ["hr"], seccion: "vital" },
  { id: "spo2", titulo: "Blood oxygen", series: ["spo2"], seccion: "vital" },
  { id: "temp_corporal", titulo: "Body temperature", series: ["temp_corporal"], seccion: "vital" },
  { id: "presion", titulo: "Blood pressure", series: ["presion_sis", "presion_dia"], nombres: ["Systolic", "Diastolic"], seccion: "vital" },
  { id: "glucosa", titulo: "Glucose", series: ["glucosa"], seccion: "vital" },
  { id: "co2", titulo: "CO₂", series: ["co2"], seccion: "cabina" },
  { id: "radiacion", titulo: "Radiation", series: ["radiacion"], seccion: "cabina" },
  { id: "temp_cabina", titulo: "Temperature", series: ["temp_cabina"], seccion: "cabina" },
  { id: "humedad", titulo: "Humidity", series: ["humedad"], seccion: "cabina" },
  { id: "sueno_horas", titulo: "Sleep", series: ["sueno_horas"], seccion: "diario", barras: true },
  { id: "animo", titulo: "Mood", series: ["animo"], seccion: "diario", barras: true },
];

export const INDICADORES = METRICAS.flatMap(m => m.series);

export const ESTADOS = {
  normal: { etiqueta: "Normal", nivel: 0 },
  precaucion: { etiqueta: "Caution", nivel: 1 },
  alerta: { etiqueta: "Alert", nivel: 2 },
  sin_datos: { etiqueta: "No data", nivel: -1 },
};

export const ORIGEN = Math.random().toString(36).slice(2);

const NOMBRES_INDICADOR = {
  hr: "Heart rate",
  spo2: "Blood oxygen",
  temp_corporal: "Body temperature",
  presion_sis: "Systolic pressure",
  presion_dia: "Diastolic pressure",
  glucosa: "Glucose",
  co2: "Cabin CO₂",
  temp_cabina: "Cabin temperature",
  humedad: "Cabin humidity",
  radiacion: "Radiation",
  sueno_horas: "Sleep",
  animo: "Mood",
};

const UNIDADES = { lpm: "bpm" };

const TRIPULANTES = {
  T1: { nombre: "Cmdr. Ríos", rol: "Commander" },
  T2: { nombre: "Dr. Vega", rol: "Mission Specialist" },
};

export const traducirIndicador = i => ({
  ...i,
  nombre: NOMBRES_INDICADOR[i.id] ?? i.nombre,
  unidad: UNIDADES[i.unidad] ?? i.unidad,
});

export const traducirTripulante = t => ({ ...t, ...TRIPULANTES[t.id] });

export const metrica = id => METRICAS.find(m => m.id === id);
export const metricaDeIndicador = ind => METRICAS.find(m => m.series.includes(ind));
export const rango = id => RANGOS.find(r => r.id === id);

const estado = {
  tripulante: "T1",
  rango: "tiempo_real",
  foco: "hr",
  indicadores: {},
  tripulantes: [],
  lecturas: {},
  series: {},
  cargando: true,
  conexion: { ok: null, actualizado: null },
};

const oyentes = new Set();

export const leer = () => estado;

export function actualizar(cambios) {
  Object.assign(estado, cambios);
  const claves = Object.keys(cambios);
  oyentes.forEach(fn => fn(estado, claves));
}

export function suscribir(claves, fn) {
  const oyente = (e, cambiadas) => {
    if (cambiadas.some(c => claves.includes(c))) fn(e);
  };
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

async function pedir(ruta, opciones) {
  const r = await fetch(ruta, opciones);
  if (!r.ok) {
    const detalle = (await r.json().catch(() => ({}))).detail;
    throw new Error(detalle || `HTTP ${r.status}`);
  }
  return r.json();
}

const consulta = params => new URLSearchParams(params).toString();

export const api = {
  indicadores: () => pedir("/api/indicadores"),
  tripulantes: () => pedir("/api/tripulantes"),
  version: () => pedir("/api/version"),
  comandos: desde => pedir(`/api/comandos?${consulta({ desde })}`),
  estado: tripulante_id => pedir(`/api/estado?${consulta({ tripulante_id })}`),
  series: (indicadores, tripulante_id, rango) =>
    pedir(`/api/serie?${consulta({ indicadores: indicadores.join(","), tripulante_id, rango })}`),
  sincronia: () => pedir("/api/sincronia"),
  vista: vista =>
    pedir("/api/vista", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...vista, origen: ORIGEN }),
    }),
  voz: (audio, tripulante_id, sesion) => {
    const datos = new FormData();
    datos.append("audio", audio, "pregunta.webm");
    datos.append("tripulante_id", tripulante_id);
    datos.append("sesion", sesion);
    datos.append("origen", ORIGEN);
    return pedir("/api/voz", { method: "POST", body: datos });
  },
};

const dos = n => String(n).padStart(2, "0");

export function numero(v, decimales = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toFixed(decimales);
}

export function hace(tiempo) {
  if (!tiempo) return "no readings";
  const s = Math.max(0, Math.round((Date.now() - new Date(tiempo)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function horaEje(ms, span) {
  const d = new Date(ms);
  if (span <= 15 * 60e3) return `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
  if (span <= 2 * 86400e3) return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export function fechaCompleta(ms, span) {
  const d = new Date(ms);
  const hora = span <= 15 * 60e3
    ? `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`
    : `${dos(d.getHours())}:${dos(d.getMinutes())}`;
  if (span <= 86400e3) return hora;
  return `${d.toLocaleDateString("en-US", { day: "numeric", month: "short" })} · ${hora}`;
}

export function peorEstado(estados) {
  return estados.reduce(
    (peor, e) => ((ESTADOS[e]?.nivel ?? -1) > (ESTADOS[peor]?.nivel ?? -1) ? e : peor),
    "sin_datos",
  );
}

export function iniciales(nombre) {
  return nombre
    .split(/[\s.]+/)
    .filter(Boolean)
    .map(p => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export const $ = (selector, raiz = document) => raiz.querySelector(selector);

export function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === "clase") el.className = valor;
    else if (clave === "datos") Object.assign(el.dataset, valor);
    else if (clave.startsWith("on")) el.addEventListener(clave.slice(2), valor);
    else el.setAttribute(clave, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

export function chipEstado(estado, etiqueta) {
  return h("span", { clase: `estado ${estado}` }, h("i"), etiqueta);
}

export function lecturaDeMetrica(m, e) {
  const lecturas = m.series.map(id => e.lecturas[id]).filter(Boolean);
  const inds = m.series.map(id => e.indicadores[id]);
  const valor = lecturas.length === m.series.length && lecturas.every(l => l.valor !== null)
    ? lecturas.map((l, k) => numero(l.valor, inds[k].decimales)).join("/")
    : "—";
  const tiempos = lecturas.map(l => l.tiempo).filter(Boolean).sort();
  return {
    valor,
    unidad: inds[0].unidad,
    estado: peorEstado(lecturas.map(l => l.estado)),
    tiempo: tiempos[tiempos.length - 1] ?? null,
  };
}

export function textoRangoNormal(m, e) {
  const inds = m.series.map(id => e.indicadores[id]);
  if (inds.length > 1) return `normal ≤${inds.map(i => i.normal_max).join("/")}`;
  const i = inds[0];
  return `normal ${numero(i.normal_min, i.decimales)}–${numero(i.normal_max, i.decimales)}`;
}

const control = { version: null, comando: null, ultimaSerie: 0, forzar: true, ocupado: false };
const manejadores = {};

export function alRecibirComando(accion, fn) {
  manejadores[accion] = fn;
}

export function fijarComando(id) {
  control.comando = id;
}

export function cambiarVista(cambios, difundir = true) {
  const actual = leer();
  const recarga =
    (cambios.tripulante && cambios.tripulante !== actual.tripulante) ||
    (cambios.rango && cambios.rango !== actual.rango);
  actualizar(recarga ? { ...cambios, cargando: true } : cambios);
  if (difundir) {
    const { tripulante, rango, foco } = leer();
    api.vista({ tripulante, rango, foco }).catch(() => {});
  }
  if (recarga) {
    control.forzar = true;
    ciclo();
  }
}

async function aplicarComandos(desde) {
  let ultimo = desde;
  for (const c of await api.comandos(desde)) {
    ultimo = c.id;
    try {
      manejadores[c.accion]?.(c.params);
    } catch (e) {
      console.warn("comando", c.accion, e);
    }
  }
  return ultimo;
}

async function cargarSeries() {
  const { tripulante, rango } = leer();
  const r = await api.series(INDICADORES, tripulante, rango);
  control.ultimaSerie = Date.now();
  if (leer().tripulante === tripulante && leer().rango === rango) {
    actualizar({ series: r.series, cargando: false });
  } else {
    control.forzar = true;
  }
}

export async function ciclo() {
  if (control.ocupado) return;
  control.ocupado = true;
  try {
    const v = await api.version();
    actualizar({ conexion: { ok: true, actualizado: v.actualizado } });

    if (control.comando === null) control.comando = v.comando;
    else if (v.comando > control.comando) control.comando = await aplicarComandos(control.comando);

    const cambio = v.version !== control.version;
    control.version = v.version;
    const forzar = control.forzar;
    control.forzar = false;

    if (cambio || forzar) {
      const filas = await api.estado(leer().tripulante);
      actualizar({ lecturas: Object.fromEntries(filas.map(f => [f.indicador, f])) });
    }

    const rapido = ["tiempo_real", "1h"].includes(leer().rango);
    if (forzar || (cambio && rapido) || Date.now() - control.ultimaSerie > RECARGA_SERIES_MS) {
      await cargarSeries();
    }
  } catch (e) {
    actualizar({ conexion: { ok: false, actualizado: null } });
  } finally {
    control.ocupado = false;
  }
}
