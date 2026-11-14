import {
  $, ESTADOS, HERRAMIENTAS, INTERVALO_MS, METRICAS, RANGOS, SUGERENCIAS, actualizar, alRecibirComando, api,
  cambiarVista, chipEstado, ciclo, fechaCompleta, h, hace, iniciales, leer, lecturaDeMetrica, metrica,
  metricaDeIndicador, numero, peorEstado, rango, suscribir, textoRangoNormal, traducirIndicador, traducirTripulante,
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

const SESION = Math.random().toString(36).slice(2);
const SALUDO = "Hi, I'm Jarvis. Ask me about your vital signs or the cabin, or ask me to show you a chart.";

const ICONO = {
  microfono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  detener: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const rj = {};
const SILENCIO = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const reproductor = new Audio();

function desbloquearAudio() {
  reproductor.src = SILENCIO;
  reproductor.play().catch(() => {});
}

function icono(nombre) {
  const span = h("span");
  span.innerHTML = ICONO[nombre];
  return span.firstChild;
}

function agregar(clase, texto, herramientas) {
  const acciones = [...new Set(herramientas || [])].map(n => HERRAMIENTAS[n] ?? n);
  const el = h("div", { clase: `msg ${clase}` }, texto, acciones.length ? h("span", { clase: "acciones" }, acciones.join(" · ")) : null);
  rj.mensajes.append(el);
  rj.mensajes.scrollTop = rj.mensajes.scrollHeight;
  return el;
}

function ocupado(si) {
  rj.raiz.classList.toggle("trabajando", si);
  rj.enviar.disabled = si;
  rj.microfono.disabled = si && !grabadora.grabando();
}

async function conversar(texto, peticion) {
  rj.sugerencias.hidden = true;
  if (texto) agregar("usuario", texto);
  ocupado(true);
  const espera = agregar("pensando", texto ? "Thinking…" : "Listening and thinking…");
  try {
    const r = await peticion();
    espera.remove();
    if (r.transcripcion) agregar("usuario", r.transcripcion);
    agregar("asistente", r.respuesta, r.herramientas);
    if (r.audio) {
      reproductor.src = `data:audio/wav;base64,${r.audio}`;
      reproductor.play().catch(e => agregar("error", `Could not play the audio: ${e.message}`));
    }
    ciclo();
  } catch (e) {
    espera.remove();
    agregar("error", `Could not answer: ${e.message}`);
  } finally {
    ocupado(false);
  }
}

export function preguntar(texto) {
  texto = texto.trim();
  if (!texto) return;
  rj.entrada.value = "";
  return conversar(texto, () => api.chat(texto, leer().tripulante, SESION)).then(() => rj.entrada.focus());
}

const grabadora = crearGrabadora({
  alIniciar: () => {
    rj.microfono.classList.add("grabando");
    rj.microfono.replaceChildren(icono("detener"));
    rj.microfono.title = "Stop and send";
  },
  alTerminar: audio => {
    rj.microfono.classList.remove("grabando");
    rj.microfono.replaceChildren(icono("microfono"));
    rj.microfono.title = "Talk to Jarvis";
    conversar(null, () => api.voz(audio, leer().tripulante, SESION));
  },
  alFallar: e => agregar("error", `Could not access the microphone: ${e.message}`),
});

export function montarJarvis() {
  rj.raiz = $("#jarvis");
  rj.con = h("span");
  rj.mensajes = h("div", { clase: "mensajes" });
  rj.sugerencias = h("div", { clase: "sugerencias" },
    SUGERENCIAS.map(s => h("button", { type: "button", onclick: () => preguntar(s) }, s)));
  rj.microfono = h("button", { type: "button", clase: "boton-redondo", title: "Talk to Jarvis", onclick: () => {
    desbloquearAudio();
    grabadora.alternar();
  } }, icono("microfono"));
  rj.entrada = h("input", { autocomplete: "off", placeholder: "Ask Jarvis…" });
  rj.enviar = h("button", { clase: "boton-redondo primario", title: "Send" }, icono("enviar"));
  const formulario = h("form", { clase: "entrada" }, rj.microfono, rj.entrada, rj.enviar);
  formulario.addEventListener("submit", ev => {
    ev.preventDefault();
    preguntar(rj.entrada.value);
  });

  rj.raiz.replaceChildren(
    h("header", { clase: "jarvis-cab" },
      h("span", { clase: "jarvis-orbe" }, h("i")),
      h("div", {}, h("b", {}, "Jarvis"), rj.con)),
    rj.mensajes,
    rj.sugerencias,
    formulario,
  );
  agregar("asistente", SALUDO);

  suscribir(["tripulante", "tripulantes"], e => {
    const t = e.tripulantes.find(x => x.id === e.tripulante);
    rj.con.textContent = t ? `Health assistant · talking to ${t.nombre}` : "Health assistant";
  });
}

function mostrar({ indicador, rango: r, tripulante_id }) {
  const cambios = {};
  if (leer().tripulantes.some(t => t.id === tripulante_id)) cambios.tripulante = tripulante_id;
  if (rango(r)) cambios.rango = r;
  const m = metricaDeIndicador(indicador) ?? metrica(indicador);
  if (m) cambios.foco = m.id;
  cambiarVista(cambios);
  resaltarFoco();
}

async function iniciar() {
  montarEncabezado();
  montarResumen();
  montarVitales();
  montarFoco();
  montarCabina();
  montarDiario();
  montarJarvis();

  const [indicadoresBd, tripulantesBd] = await Promise.all([api.indicadores(), api.tripulantes()]);
  const indicadores = indicadoresBd.map(traducirIndicador);
  const tripulantes = tripulantesBd.map(traducirTripulante);
  const q = new URLSearchParams(location.search);
  const tripulante = tripulantes.some(t => t.id === q.get("tripulante")) ? q.get("tripulante") : tripulantes[0]?.id;

  actualizar({
    indicadores: Object.fromEntries(indicadores.map(i => [i.id, i])),
    tripulantes,
    tripulante,
    rango: rango(q.get("rango")) ? q.get("rango") : "tiempo_real",
    foco: metrica(q.get("foco")) ? q.get("foco") : "hr",
    conexion: leer().conexion,
  });

  alRecibirComando("mostrar", mostrar);
  window.monitor = { mostrar, preguntar, estado: leer };

  await ciclo();
  setInterval(ciclo, INTERVALO_MS);
}

iniciar().catch(() => actualizar({ conexion: { ok: false, actualizado: null } }));
