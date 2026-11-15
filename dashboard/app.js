import {
  $, ESTADOS, INTERVALO_MS, METRICAS, ORIGEN, RANGOS, actualizar, alRecibirComando, api, cambiarVista, chipEstado,
  ciclo, fechaCompleta, fijarComando, h, hace, iniciales, leer, lecturaDeMetrica, metrica, metricaDeIndicador,
  numero, peorEstado, rango, suscribir, textoRangoNormal, traducirIndicador, traducirTripulante,
} from "./datos.js";
import { dibujarCursor, dibujarGrafica, dibujarSparkline, limpiar, masCercano, tema } from "./graficas.js";

function segmentado(contenedor, opciones, actual, alElegir) {
  contenedor.replaceChildren(
    ...opciones.map(([id, texto]) =>
      h("button", { type: "button", clase: id === actual ? "activo" : null, onclick: () => alElegir(id) }, texto),
    ),
  );
}

export function montarEncabezado() {
  const tripulantes = $("#tripulantes");
  const rangos = $("#rangos");
  const conexion = $("#conexion");

  suscribir(["tripulante", "tripulantes"], e =>
    segmentado(tripulantes, e.tripulantes.map(t => [t.id, t.nombre]), e.tripulante, id => cambiarVista({ tripulante: id })),
  );
  suscribir(["rango"], e =>
    segmentado(rangos, RANGOS.map(r => [r.id, r.etiqueta]), e.rango, id => cambiarVista({ rango: id })),
  );
  suscribir(["conexion"], ({ conexion: c }) => {
    conexion.className = `conexion ${c.ok ? "ok" : c.ok === false ? "error" : ""}`;
    $("span", conexion).textContent = c.ok
      ? `Live · ${new Date(c.actualizado).toLocaleTimeString("en-US")}`
      : c.ok === false
        ? "Server unreachable"
        : "Connecting…";
  });
}

function aviso(lectura, indicador) {
  return h(
    "button",
    {
      type: "button",
      clase: `aviso ${lectura.estado}`,
      onclick: () => cambiarVista({ foco: metricaDeIndicador(indicador.id).id }),
    },
    chipEstado(lectura.estado, ESTADOS[lectura.estado].etiqueta),
    h("b", {}, indicador.nombre),
    `${numero(lectura.valor, indicador.decimales)} ${indicador.unidad}`,
  );
}

export function montarResumen() {
  const raiz = $("#resumen");

  suscribir(["lecturas", "tripulante", "tripulantes"], e => {
    const t = e.tripulantes.find(x => x.id === e.tripulante);
    if (!t) return;
    const lecturas = Object.values(e.lecturas);
    const personales = lecturas.filter(l => e.indicadores[l.indicador]?.categoria !== "ambiente");
    const general = peorEstado(personales.map(l => l.estado));
    const avisos = lecturas
      .filter(l => l.estado === "alerta" || l.estado === "precaucion")
      .sort((a, b) => ESTADOS[b.estado].nivel - ESTADOS[a.estado].nivel);
    const simulado = lecturas.some(l => l.simulado);

    raiz.replaceChildren(
      h(
        "div",
        { clase: "resumen-persona" },
        h("span", { clase: "avatar" }, iniciales(t.nombre)),
        h("div", {}, h("b", {}, t.nombre), h("span", {}, t.rol)),
      ),
      h(
        "div",
        { clase: "resumen-general" },
        h("span", { clase: "etiqueta" }, "Overall status"),
        chipEstado(general, ESTADOS[general].etiqueta),
      ),
      simulado ? h("span", { clase: "insignia" }, "Simulated data") : null,
      h(
        "div",
        { clase: "resumen-alertas" },
        avisos.length
          ? avisos.map(l => aviso(l, e.indicadores[l.indicador]))
          : h("span", { clase: "vacio" }, "No active alerts"),
      ),
    );
  });
}

const VITALES = METRICAS.filter(m => m.seccion === "vital");
const tiles = new Map();

function crearTile(m) {
  const refs = {
    raiz: h("button", { type: "button", clase: "tile", onclick: () => cambiarVista({ foco: m.id }) }),
    estado: h("span"),
    valor: h("b"),
    unidad: h("small"),
    lienzo: h("canvas"),
    tiempo: h("span"),
    normal: h("span"),
  };
  refs.raiz.append(
    h("div", { clase: "tile-cab" }, h("span", { clase: "tile-nombre" }, m.titulo), refs.estado),
    h("div", { clase: "tile-valor" }, refs.valor, refs.unidad),
    refs.lienzo,
    h("div", { clase: "tile-pie" }, refs.tiempo, refs.normal),
  );
  return refs;
}

function pintarValores(e) {
  for (const m of VITALES) {
    const refs = tiles.get(m.id);
    const l = lecturaDeMetrica(m, e);
    refs.raiz.className = `tile ${l.estado} ${e.foco === m.id ? "activo" : ""}`;
    refs.estado.replaceWith((refs.estado = chipEstado(l.estado, ESTADOS[l.estado].etiqueta)));
    refs.valor.textContent = l.valor;
    refs.unidad.textContent = l.unidad;
    refs.tiempo.textContent = hace(l.tiempo);
    refs.normal.textContent = textoRangoNormal(m, e);
  }
}

function pintarSparklinesVitales(e) {
  for (const m of VITALES) dibujarSparkline(tiles.get(m.id).lienzo, e.series[m.series[0]] || []);
}

export function montarVitales() {
  const raiz = $("#vitales");
  suscribir(["indicadores"], e => {
    tiles.clear();
    raiz.replaceChildren(...VITALES.map(m => {
      const refs = crearTile(m);
      tiles.set(m.id, refs);
      return refs.raiz;
    }));
  });
  suscribir(["lecturas", "foco", "indicadores"], e => tiles.size && pintarValores(e));
  suscribir(["series"], e => tiles.size && pintarSparklinesVitales(e));
  new ResizeObserver(() => tiles.size && pintarSparklinesVitales(leer())).observe(raiz);
}

const rf = {};
const vistaFoco = { geo: null, series: [], decimales: [], unidad: "", span: 0, punteroX: null };

export function resaltarFoco() {
  rf.raiz.classList.remove("resaltado");
  void rf.raiz.offsetWidth;
  rf.raiz.classList.add("resaltado");
  clearTimeout(rf.temporizador);
  rf.temporizador = setTimeout(() => rf.raiz.classList.remove("resaltado"), 2500);
}

function construir(raiz) {
  rf.raiz = raiz;
  rf.titulo = h("h2");
  rf.sub = h("p");
  rf.actual = h("div", { clase: "foco-actual" });
  rf.estadisticas = h("div", { clase: "estadisticas" });
  rf.base = h("canvas");
  rf.capa = h("canvas", { clase: "capa" });
  rf.tooltip = h("div", { clase: "tooltip", hidden: true });
  rf.vacio = h("div", { clase: "vacio", hidden: true });
  rf.lienzo = h("div", { clase: "lienzo" }, rf.base, rf.capa, rf.tooltip, rf.vacio);
  raiz.replaceChildren(
    h("header", { clase: "foco-cab" }, h("div", {}, rf.titulo, rf.sub), rf.actual),
    rf.estadisticas,
    rf.lienzo,
  );
  rf.capa.addEventListener("pointermove", ev => {
    vistaFoco.punteroX = ev.offsetX;
    cursor();
  });
  rf.capa.addEventListener("pointerleave", () => {
    vistaFoco.punteroX = null;
    cursor();
  });
}

function estadistica(valor, etiqueta) {
  return h("div", {}, h("b", {}, valor), h("span", {}, etiqueta));
}

function pintarEncabezado(e, m, r) {
  const t = e.tripulantes.find(x => x.id === e.tripulante);
  const quien = m.seccion === "cabina" ? "Cabin" : t?.nombre ?? "";
  rf.titulo.textContent = m.titulo;
  rf.sub.textContent = `${quien} · ${r.texto} · ${r.resolucion}`;
  const l = lecturaDeMetrica(m, e);
  rf.actual.replaceChildren(
    h("b", {}, l.valor),
    h("small", {}, l.unidad),
    chipEstado(l.estado, ESTADOS[l.estado].etiqueta),
  );
}

function pintarEstadisticas(e, m, series) {
  const ind = e.indicadores[m.series[0]];
  const valores = series[0].datos.map(p => p[1]);
  const t = tema();
  const leyenda = series.length > 1
    ? h("div", { clase: "leyenda" }, series.map((s, k) =>
        h("span", {}, h("i", { style: `background:${t.series[k]}` }), s.nombre)))
    : null;
  if (!valores.length) {
    rf.estadisticas.replaceChildren(...(leyenda ? [leyenda] : []));
    return;
  }
  const d = ind.decimales;
  const prom = valores.reduce((a, b) => a + b, 0) / valores.length;
  const dentro = valores.filter(v =>
    (ind.normal_min === null || v >= ind.normal_min) && (ind.normal_max === null || v <= ind.normal_max)).length;
  const sufijo = series.length > 1 ? ` (${series[0].nombre.toLowerCase()})` : "";
  rf.estadisticas.replaceChildren(
    estadistica(numero(Math.min(...valores), d), `Min${sufijo}`),
    estadistica(numero(prom, d + (d === 0 ? 0 : 1)), `Average${sufijo}`),
    estadistica(numero(Math.max(...valores), d), `Max${sufijo}`),
    estadistica(`${Math.round((100 * dentro) / valores.length)} %`, "In normal range"),
    ...(leyenda ? [leyenda] : []),
  );
}

function mensajeVacio(e, m, r) {
  const l = lecturaDeMetrica(m, e);
  if (m.barras && l.tiempo) {
    return `No records in the ${r.texto}. Latest: ${l.valor} ${l.unidad}, ${hace(l.tiempo)}. Try 7 d or 30 d.`;
  }
  return `No readings in the ${r.texto}.`;
}

function dibujar() {
  const e = leer();
  const m = metrica(e.foco);
  const r = rango(e.rango);
  if (!m || !r || !Object.keys(e.indicadores).length) return;

  const xmax = Date.now();
  const xmin = xmax - r.ms;
  const series = m.series.map((id, k) => ({
    id,
    nombre: m.nombres?.[k] ?? e.indicadores[id].nombre,
    datos: (e.series[id] || []).filter(p => p[0] >= xmin),
  }));
  const ind = e.indicadores[m.series[0]];
  const banda = m.series.length === 1 ? [ind.normal_min, ind.normal_max] : null;

  pintarEncabezado(e, m, r);
  pintarEstadisticas(e, m, series);
  rf.lienzo.classList.toggle("cargando", e.cargando);

  vistaFoco.geo = dibujarGrafica(rf.base, { series, xmin, xmax, banda, barras: m.barras });
  vistaFoco.series = series;
  vistaFoco.decimales = m.series.map(id => e.indicadores[id].decimales);
  vistaFoco.unidad = ind.unidad;
  vistaFoco.span = r.ms;
  rf.vacio.hidden = Boolean(vistaFoco.geo);
  rf.vacio.textContent = vistaFoco.geo ? "" : mensajeVacio(e, m, r);
  cursor();
}

function cursor() {
  const { geo, series, punteroX } = vistaFoco;
  const ancho = geo ? geo.w - geo.margen.izq - geo.margen.der : 0;
  if (!geo || punteroX === null || punteroX < geo.margen.izq || punteroX > geo.margen.izq + ancho) {
    limpiar(rf.capa);
    rf.tooltip.hidden = true;
    return;
  }
  const t = geo.xmin + ((punteroX - geo.margen.izq) / ancho) * (geo.xmax - geo.xmin);
  const referencia = series.find(s => s.datos.length);
  const p = referencia && masCercano(referencia.datos, t);
  if (!p) return;
  dibujarCursor(rf.capa, geo, series, p[0]);

  const colores = tema().series;
  rf.tooltip.replaceChildren(
    h("time", {}, fechaCompleta(p[0], vistaFoco.span)),
    ...series.map((s, k) => {
      const q = masCercano(s.datos, p[0]);
      return h(
        "div",
        {},
        h("i", { style: `background:${colores[k]}` }),
        h("b", {}, q ? `${numero(q[1], vistaFoco.decimales[k])} ${vistaFoco.unidad}` : "—"),
        series.length > 1 ? h("span", {}, s.nombre) : null,
      );
    }),
  );
  rf.tooltip.hidden = false;
  const x = geo.X(p[0]);
  const anchoTooltip = rf.tooltip.offsetWidth;
  rf.tooltip.style.left = `${x + 14 + anchoTooltip > geo.w ? x - 14 - anchoTooltip : x + 14}px`;
}

export function montarFoco() {
  construir($("#foco"));
  suscribir(["foco", "series", "rango", "tripulante", "indicadores", "cargando", "lecturas"], dibujar);
  new ResizeObserver(dibujar).observe(rf.lienzo);
}

const CABINA = METRICAS.filter(m => m.seccion === "cabina");
const filasCabina = new Map();
const rc = {};

function crearFila(m) {
  const f = {
    raiz: h("button", { type: "button", clase: "fila", onclick: () => cambiarVista({ foco: m.id }) }),
    estado: h("span"),
    lienzo: h("canvas"),
    valor: h("b"),
    unidad: h("small"),
  };
  f.raiz.append(
    h("div", { clase: "fila-nombre" }, h("span", {}, m.titulo), f.estado),
    f.lienzo,
    h("div", { clase: "fila-valor" }, f.valor, f.unidad),
  );
  return f;
}

function pintarCabina(e) {
  const estados = [];
  for (const m of CABINA) {
    const f = filasCabina.get(m.id);
    const l = lecturaDeMetrica(m, e);
    estados.push(l.estado);
    f.raiz.className = `fila ${e.foco === m.id ? "activo" : ""}`;
    f.estado.replaceWith((f.estado = chipEstado(l.estado, ESTADOS[l.estado].etiqueta)));
    f.valor.textContent = l.valor;
    f.unidad.textContent = l.unidad;
  }
  const general = peorEstado(estados);
  rc.general.replaceWith((rc.general = chipEstado(general, ESTADOS[general].etiqueta)));
}

function pintarSparklinesCabina(e) {
  for (const m of CABINA) dibujarSparkline(filasCabina.get(m.id).lienzo, e.series[m.series[0]] || []);
}

export function montarCabina() {
  const raiz = $("#cabina");
  suscribir(["indicadores"], () => {
    filasCabina.clear();
    rc.general = h("span");
    const lista = h("div", { clase: "filas" });
    for (const m of CABINA) {
      const f = crearFila(m);
      filasCabina.set(m.id, f);
      lista.append(f.raiz);
    }
    raiz.replaceChildren(h("div", { clase: "panel-cab" }, h("span", { clase: "etiqueta" }, "Cabin"), rc.general), lista);
  });
  suscribir(["lecturas", "foco", "indicadores"], e => filasCabina.size && pintarCabina(e));
  suscribir(["series"], e => filasCabina.size && pintarSparklinesCabina(e));
  new ResizeObserver(() => filasCabina.size && pintarSparklinesCabina(leer())).observe(raiz);
}

const DIARIO = METRICAS.filter(m => m.seccion === "diario");
const ESCALA_ANIMO = 5;

function detalle(m, e, l) {
  if (m.id !== "animo") return h("small", {}, l.unidad);
  const v = Number(e.lecturas.animo?.valor ?? 0);
  return h("div", { clase: "animo" },
    Array.from({ length: ESCALA_ANIMO }, (_, k) => h("i", { clase: k < v ? "lleno" : null })));
}

export function montarDiario() {
  const raiz = $("#diario");
  suscribir(["lecturas", "foco", "indicadores"], e => {
    if (!Object.keys(e.indicadores).length) return;
    const filas = DIARIO.map(m => {
      const l = lecturaDeMetrica(m, e);
      return h(
        "button",
        { type: "button", clase: `fila ${e.foco === m.id ? "activo" : ""}`, onclick: () => cambiarVista({ foco: m.id }) },
        h("div", { clase: "fila-nombre" }, h("span", {}, m.titulo), chipEstado(l.estado, `${ESTADOS[l.estado].etiqueta} · ${hace(l.tiempo)}`)),
        h("span"),
        h("div", { clase: "fila-valor" }, h("b", {}, m.id === "animo" ? `${l.valor}/${ESCALA_ANIMO}` : l.valor), detalle(m, e, l)),
      );
    });
    raiz.replaceChildren(
      h("div", { clase: "panel-cab" }, h("span", { clase: "etiqueta" }, "Daily log")),
      h("div", { clase: "filas" }, filas),
    );
  });
}

export function crearGrabadora({ alIniciar, alTerminar, alFallar }) {
  let grabadora = null;
  let partes = [];

  async function iniciar() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alFallar(e);
      return;
    }
    partes = [];
    grabadora = new MediaRecorder(stream);
    grabadora.ondataavailable = ev => partes.push(ev.data);
    grabadora.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const audio = new Blob(partes, { type: grabadora.mimeType });
      grabadora = null;
      alTerminar(audio);
    };
    grabadora.start();
    alIniciar();
  }

  return {
    grabando: () => grabadora !== null,
    alternar: () => (grabadora ? grabadora.stop() : iniciar()),
  };
}

const NS = "http://www.w3.org/2000/svg";

function s(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElementNS(NS, etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === "clase") el.setAttribute("class", valor);
    else if (clave.startsWith("on")) el.addEventListener(clave.slice(2), valor);
    else el.setAttribute(clave, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

const SILUETA = "M300 6 C304.7 6 310.2 6 314 8 C317.8 10 321 14 323 18 C325 22 325.7 27.3 326 32 C326.3 36.7 325.8 41.7 325 46 C324.2 50.3 322.7 54.7 321 58 C319.3 61.3 316.7 63.3 315 66 C313.3 68.7 311.7 71 311 74 C310.3 77 308.8 81 311 84 C313.2 87 318.8 90 324 92 C329.2 94 336.7 94.5 342 96 C347.3 97.5 352 98.3 356 101 C360 103.7 363.7 107.2 366 112 C368.3 116.8 369.2 123.3 370 130 C370.8 136.7 370.5 144.3 371 152 C371.5 159.7 372.2 168 373 176 C373.8 184 375 192.3 376 200 C377 207.7 378 215.3 379 222 C380 228.7 380.5 234.7 382 240 C383.5 245.3 386.8 248.7 388 254 C389.2 259.3 389.7 266.7 389 272 C388.3 277.3 386 283.3 384 286 C382 288.7 379.2 289.3 377 288 C374.8 286.7 372.3 282.7 371 278 C369.7 273.3 369.8 265.7 369 260 C368.2 254.3 367.3 250.3 366 244 C364.7 237.7 362.5 229.7 361 222 C359.5 214.3 358 205.7 357 198 C356 190.3 355.7 183.7 355 176 C354.3 168.3 353.8 159 353 152 C352.2 145 351 134 350 134 C349 134 348.2 145 347 152 C345.8 159 344.2 168.7 343 176 C341.8 183.3 340 188.7 340 196 C340 203.3 341.7 212 343 220 C344.3 228 346.8 236.3 348 244 C349.2 251.7 350 257.3 350 266 C350 274.7 349.2 285.3 348 296 C346.8 306.7 344.3 320.7 343 330 C341.7 339.3 340.3 345 340 352 C339.7 359 341.5 364 341 372 C340.5 380 338.7 391.3 337 400 C335.3 408.7 331.7 418 331 424 C330.3 430 332.2 432.3 333 436 C333.8 439.7 337.8 443.3 336 446 C334.2 448.7 326 451.3 322 452 C318 452.7 314 452.3 312 450 C310 447.7 310.2 443 310 438 C309.8 433 310.5 426.7 311 420 C311.5 413.3 312.7 406 313 398 C313.3 390 312.8 380 313 372 C313.2 364 314.2 357.7 314 350 C313.8 342.3 312.8 334.3 312 326 C311.2 317.7 310.3 307.3 309 300 C307.7 292.7 305.5 285.3 304 282 C302.5 278.7 301.3 280 300 280 C298.7 280 297.5 278.7 296 282 C294.5 285.3 292.3 292.7 291 300 C289.7 307.3 288.8 317.7 288 326 C287.2 334.3 286.2 342.3 286 350 C285.8 357.7 286.8 364 287 372 C287.2 380 286.7 390 287 398 C287.3 406 288.5 413.3 289 420 C289.5 426.7 290.2 433 290 438 C289.8 443 290 447.7 288 450 C286 452.3 282 452.7 278 452 C274 451.3 265.8 448.7 264 446 C262.2 443.3 266.2 439.7 267 436 C267.8 432.3 269.7 430 269 424 C268.3 418 264.7 408.7 263 400 C261.3 391.3 259.5 380 259 372 C258.5 364 260.3 359 260 352 C259.7 345 258.3 339.3 257 330 C255.7 320.7 253.2 306.7 252 296 C250.8 285.3 250 274.7 250 266 C250 257.3 250.8 251.7 252 244 C253.2 236.3 255.7 228 257 220 C258.3 212 260 203.3 260 196 C260 188.7 258.2 183.3 257 176 C255.8 168.7 254.2 159 253 152 C251.8 145 251 134 250 134 C249 134 247.8 145 247 152 C246.2 159 245.7 168.3 245 176 C244.3 183.7 244 190.3 243 198 C242 205.7 240.5 214.3 239 222 C237.5 229.7 235.3 237.7 234 244 C232.7 250.3 231.8 254.3 231 260 C230.2 265.7 230.3 273.3 229 278 C227.7 282.7 225.2 286.7 223 288 C220.8 289.3 218 288.7 216 286 C214 283.3 211.7 277.3 211 272 C210.3 266.7 210.8 259.3 212 254 C213.2 248.7 216.5 245.3 218 240 C219.5 234.7 220 228.7 221 222 C222 215.3 223 207.7 224 200 C225 192.3 226.2 184 227 176 C227.8 168 228.5 159.7 229 152 C229.5 144.3 229.2 136.7 230 130 C230.8 123.3 231.7 116.8 234 112 C236.3 107.2 240 103.7 244 101 C248 98.3 252.7 97.5 258 96 C263.3 94.5 270.8 94 276 92 C281.2 90 286.8 87 289 84 C291.2 81 289.7 77 289 74 C288.3 71 286.7 68.7 285 66 C283.3 63.3 280.7 61.3 279 58 C277.3 54.7 275.8 50.3 275 46 C274.2 41.7 273.7 36.7 274 32 C274.3 27.3 275 22 277 18 C279 14 282.2 10 286 8 C289.8 6 295.3 6 300 6Z";

const PUNTOS = [
  { metrica: "temp_corporal", x: 291, y: 36, lado: "izq", y2: 44 },
  { metrica: "animo", x: 309, y: 30, lado: "der", y2: 38 },
  { metrica: "spo2", x: 279, y: 140, lado: "izq", y2: 150 },
  { metrica: "presion", x: 236, y: 172, lado: "izq", y2: 262 },
  { metrica: "hr", x: 312, y: 139, lado: "der", y2: 146 },
  { metrica: "glucosa", x: 306, y: 206, lado: "der", y2: 254 },
];

const rc2 = { puntos: new Map() };

function crearPunto(p) {
  const izq = p.lado === "izq";
  const fin = izq ? 152 : 448;
  const codo = izq ? 200 : 400;
  const refs = { raiz: null, valor: s("tspan"), unidad: s("tspan", { clase: "unidad", dx: 4 }) };
  const elegir = () => cambiarVista({ foco: p.metrica });
  refs.raiz = s("g", {
    clase: "punto",
    tabindex: 0,
    role: "button",
    "aria-label": metrica(p.metrica).titulo,
    onclick: elegir,
    onkeydown: ev => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), elegir()),
  },
    s("path", { clase: "guia", d: `M${p.x} ${p.y} L${codo} ${p.y2} L${fin + (izq ? 6 : -6)} ${p.y2}` }),
    s("rect", { clase: "zona", x: izq ? 30 : 444, y: p.y2 - 28, width: 126, height: 52, rx: 8 }),
    s("circle", { clase: "zona", cx: p.x, cy: p.y, r: 16 }),
    p.metrica === "hr" ? null : s("circle", { clase: "anillo", cx: p.x, cy: p.y, r: 9 }),
    p.metrica === "hr" ? null : s("circle", { clase: "nucleo", cx: p.x, cy: p.y, r: 4 }),
    s("text", { clase: "nombre", x: fin, y: p.y2 - 9, "text-anchor": izq ? "end" : "start" }, metrica(p.metrica).titulo),
    s("text", { clase: "valor", x: fin, y: p.y2 + 15, "text-anchor": izq ? "end" : "start" }, refs.valor, refs.unidad),
  );
  return refs;
}

function pintarCuerpo(e) {
  for (const p of PUNTOS) {
    const refs = rc2.puntos.get(p.metrica);
    const l = lecturaDeMetrica(metrica(p.metrica), e);
    refs.raiz.setAttribute("class", `punto ${l.estado} ${e.foco === p.metrica ? "activo" : ""}`);
    refs.valor.textContent = p.metrica === "animo" && l.valor !== "—" ? `${l.valor}/${ESCALA_ANIMO}` : l.valor;
    refs.unidad.textContent = p.metrica === "animo" ? "" : l.unidad;
  }
  const hr = Number(e.lecturas.hr?.valor);
  rc2.svg.style.setProperty("--latido", hr > 20 ? `${(60 / hr).toFixed(2)}s` : "1s");
  rc2.corazon.parentNode.setAttribute("class", `latido ${e.lecturas.hr?.estado ?? ""}`);
}

export function montarCuerpo() {
  const raiz = $("#cuerpo");
  rc2.corazon = s("path", { clase: "corazon", d: "M0 2.5 C0 -2 -7 -2.5 -7 2.5 C-7 7 -1.5 9.5 0 12 C1.5 9.5 7 7 7 2.5 C7 -2.5 0 -2 0 2.5 Z" });
  rc2.svg = s("svg", { viewBox: "0 0 600 470", role: "img", "aria-label": "Body map" },
    s("ellipse", { clase: "plataforma", cx: 300, cy: 452, rx: 92, ry: 12 }),
    s("ellipse", { clase: "plataforma", cx: 300, cy: 452, rx: 62, ry: 8 }),
    s("defs", {},
      s("linearGradient", { id: "relleno-cuerpo", x1: 0, y1: 0, x2: 0, y2: 1 },
        s("stop", { offset: 0, clase: "relleno-alto" }),
        s("stop", { offset: 1, clase: "relleno-bajo" }))),
    s("path", { clase: "silueta", d: SILUETA }),
    s("path", { clase: "pulmon", d: "M293 106 Q268 110 266 146 Q267 170 291 166 Z" }),
    s("path", { clase: "pulmon", d: "M307 106 Q332 110 334 146 Q333 170 309 166 Z" }),
    s("g", { transform: "translate(312 133)" }, rc2.corazon),
  );
  for (const p of PUNTOS) {
    const refs = crearPunto(p);
    rc2.puntos.set(p.metrica, refs);
    rc2.svg.append(refs.raiz);
  }
  raiz.replaceChildren(rc2.svg);
  suscribir(["lecturas", "foco", "indicadores"], e => Object.keys(e.indicadores).length && pintarCuerpo(e));
}

const SESION = Math.random().toString(36).slice(2);

const ICONO = {
  microfono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  detener: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  bocina: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  silencio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
};

const ESTADO_ADAM = {
  listo: "Tap the mic to talk",
  grabando: "Listening… tap to send",
  pensando: "Thinking…",
  hablando: "Speaking…",
};

const SILENCIO = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const rj = {};
const sonido = { activo: false, hablando: false, reproductor: new Audio() };

function icono(nombre) {
  const span = h("span");
  span.innerHTML = ICONO[nombre];
  return span.firstChild;
}

function estadoAdam(clave, texto) {
  rj.raiz.classList.toggle("trabajando", clave === "pensando" || clave === "hablando");
  rj.estado.className = `adam-estado ${clave}`;
  rj.estado.textContent = texto ?? ESTADO_ADAM[clave];
}

function pintarSonido() {
  rj.sonido.classList.toggle("activo", sonido.activo);
  rj.sonido.title = sonido.activo ? "Mute this device" : "Enable audio on this device";
  rj.sonido.replaceChildren(
    icono(sonido.activo ? "bocina" : "silencio"),
    sonido.activo ? "Audio on" : "Tap to enable audio",
  );
}

function activarSonido() {
  if (sonido.activo) return;
  sonido.reproductor.src = SILENCIO;
  sonido.reproductor.play().catch(() => {});
  sonido.activo = true;
  pintarSonido();
}

function alternarSonido() {
  if (sonido.activo) {
    sonido.activo = false;
    sonido.reproductor.pause();
    if (sonido.hablando) estadoAdam("listo");
    sonido.hablando = false;
    pintarSonido();
  } else {
    activarSonido();
  }
}

function reproducir(src) {
  if (!sonido.activo || !src) return;
  sonido.hablando = true;
  sonido.reproductor.src = src;
  sonido.reproductor.play().catch(e => {
    sonido.hablando = false;
    estadoAdam("error", `Could not play the audio: ${e.message}`);
  });
}

function subtitulos(pregunta, respuesta) {
  rj.pregunta.textContent = pregunta ? `“${pregunta}”` : "";
  rj.respuesta.textContent = respuesta ?? "";
}

async function enviarVoz(audio) {
  estadoAdam("pensando");
  rj.microfono.disabled = true;
  try {
    const r = await api.voz(audio, leer().tripulante, SESION);
    subtitulos(r.transcripcion, r.respuesta);
    if (r.audio) reproducir(`data:audio/wav;base64,${r.audio}`);
    else estadoAdam("listo");
    ciclo();
  } catch (e) {
    estadoAdam("error", `Could not answer: ${e.message}`);
  } finally {
    rj.microfono.disabled = false;
  }
}

const grabadora = crearGrabadora({
  alIniciar: () => {
    rj.microfono.classList.add("grabando");
    rj.microfono.replaceChildren(icono("detener"));
    rj.microfono.title = "Stop and send";
    estadoAdam("grabando");
  },
  alTerminar: audio => {
    rj.microfono.classList.remove("grabando");
    rj.microfono.replaceChildren(icono("microfono"));
    rj.microfono.title = "Talk to Adam";
    enviarVoz(audio);
  },
  alFallar: e => estadoAdam("error", `Could not access the microphone: ${e.message}`),
});

export function montarAdam() {
  rj.raiz = $("#adam");
  rj.con = h("span");
  rj.estado = h("p", { clase: "adam-estado" });
  rj.pregunta = h("p", { clase: "adam-pregunta" });
  rj.respuesta = h("p", { clase: "adam-respuesta" });
  rj.microfono = h("button", { type: "button", clase: "microfono", title: "Talk to Adam", onclick: () => {
    activarSonido();
    grabadora.alternar();
  } }, icono("microfono"));
  rj.sonido = h("button", { type: "button", clase: "sonido", onclick: alternarSonido });

  rj.raiz.replaceChildren(
    h("span", { clase: "adam-orbe" }, h("i")),
    rj.microfono,
    h("div", { clase: "adam-textos" },
      h("b", { clase: "adam-titulo" }, "Adam ", rj.con),
      rj.estado, rj.pregunta, rj.respuesta),
    rj.sonido,
  );
  estadoAdam("listo");
  pintarSonido();

  sonido.reproductor.addEventListener("playing", () => sonido.hablando && estadoAdam("hablando"));
  sonido.reproductor.addEventListener("ended", () => {
    if (!sonido.hablando) return;
    sonido.hablando = false;
    estadoAdam("listo");
  });

  suscribir(["tripulante", "tripulantes"], e => {
    const t = e.tripulantes.find(x => x.id === e.tripulante);
    rj.con.textContent = t ? `· talking to ${t.nombre}` : "· health assistant";
  });
}

function vistaDeComando(c) {
  if (!c) return {};
  const p = c.params ?? {};
  const v = c.accion === "mostrar"
    ? { tripulante: p.tripulante_id, rango: p.rango, foco: (metricaDeIndicador(p.indicador) ?? metrica(p.indicador))?.id }
    : { tripulante: p.tripulante, rango: p.rango, foco: p.foco };
  const valida = {};
  if (leer().tripulantes.some(t => t.id === v.tripulante)) valida.tripulante = v.tripulante;
  if (rango(v.rango)) valida.rango = v.rango;
  if (metrica(v.foco)) valida.foco = v.foco;
  return valida;
}

function mostrar(params) {
  cambiarVista(vistaDeComando({ accion: "mostrar", params }), false);
  resaltarFoco();
}

function vistaRemota(params) {
  if (params.origen === ORIGEN) return;
  cambiarVista(vistaDeComando({ accion: "vista", params }), false);
}

function hablar(params) {
  if (params.origen === ORIGEN) return;
  subtitulos(params.pregunta, params.respuesta);
  if (params.audio) reproducir(`/api/audio/${params.audio}`);
}

async function iniciar() {
  montarEncabezado();
  montarResumen();
  montarVitales();
  montarFoco();
  montarCabina();
  montarDiario();
  montarCuerpo();
  montarAdam();

  const [indicadoresBd, tripulantesBd, sincronia] = await Promise.all([
    api.indicadores(),
    api.tripulantes(),
    api.sincronia(),
  ]);
  const indicadores = indicadoresBd.map(traducirIndicador);
  const tripulantes = tripulantesBd.map(traducirTripulante);
  actualizar({ indicadores: Object.fromEntries(indicadores.map(i => [i.id, i])), tripulantes });

  const guardada = vistaDeComando(sincronia.vista);
  actualizar({
    tripulante: guardada.tripulante ?? tripulantes[0]?.id,
    rango: guardada.rango ?? "tiempo_real",
    foco: guardada.foco ?? "hr",
    conexion: leer().conexion,
  });
  if (sincronia.hablar) subtitulos(sincronia.hablar.params.pregunta, sincronia.hablar.params.respuesta);
  fijarComando(sincronia.comando);

  alRecibirComando("mostrar", mostrar);
  alRecibirComando("vista", vistaRemota);
  alRecibirComando("hablar", hablar);
  window.monitor = { mostrar, estado: leer };

  await ciclo();
  setInterval(ciclo, INTERVALO_MS);
}

iniciar().catch(() => actualizar({ conexion: { ok: false, actualizado: null } }));
