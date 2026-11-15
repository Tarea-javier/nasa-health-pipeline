import { horaEje } from "./datos.js";

export function preparar(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return { c, w, h };
}

let cacheTema = null;

export function tema() {
  if (cacheTema) return cacheTema;
  const s = getComputedStyle(document.documentElement);
  const v = n => s.getPropertyValue(n).trim();
  const t = {
    texto: v("--texto"),
    tenue: v("--tenue"),
    rejilla: v("--rejilla"),
    banda: v("--banda"),
    panel: v("--panel"),
    series: [v("--serie-1"), v("--serie-2")],
    fuente: `11px ${v("--fuente")}`,
  };
  if (t.texto) cacheTema = t;
  return t;
}

export function tramos(datos) {
  if (datos.length < 3) return datos.length ? [datos] : [];
  const pasos = [];
  for (let k = 1; k < datos.length; k++) pasos.push(datos[k][0] - datos[k - 1][0]);
  const mediana = [...pasos].sort((a, b) => a - b)[Math.floor(pasos.length / 2)];
  const limite = Math.max(mediana * 4, 1);
  const salida = [[datos[0]]];
  for (let k = 1; k < datos.length; k++) {
    if (pasos[k - 1] > limite) salida.push([]);
    salida[salida.length - 1].push(datos[k]);
  }
  return salida;
}

export function marcas(min, max, cuantas = 4) {
  if (max - min < 1e-9) return { min: min - 1, max: max + 1, valores: [min - 1, min, min + 1] };
  const crudo = (max - min) / cuantas;
  const potencia = 10 ** Math.floor(Math.log10(crudo));
  const paso = [1, 2, 2.5, 5, 10].map(f => f * potencia).find(p => p >= crudo);
  const desde = Math.floor(min / paso) * paso;
  const hasta = Math.ceil(max / paso) * paso;
  const valores = [];
  for (let v = desde; v <= hasta + paso / 2; v += paso) valores.push(+v.toFixed(10));
  return { min: desde, max: hasta, valores, paso };
}

export function decimalesDePaso(paso) {
  if (!paso) return 0;
  const fraccion = String(+paso.toFixed(10)).split(".")[1];
  return fraccion ? Math.min(3, fraccion.length) : 0;
}

const MARGEN = { izq: 46, der: 16, arr: 12, aba: 26 };

function pasoTipico(datos, porDefecto) {
  if (datos.length < 2) return porDefecto;
  const pasos = [];
  for (let k = 1; k < datos.length; k++) pasos.push(datos[k][0] - datos[k - 1][0]);
  return pasos.sort((a, b) => a - b)[Math.floor(pasos.length / 2)];
}

function punto(c, x, y, r, relleno, anillo) {
  c.beginPath();
  c.arc(x, y, r, 0, 2 * Math.PI);
  c.fillStyle = relleno;
  c.fill();
  if (anillo) {
    c.lineWidth = 2;
    c.strokeStyle = anillo;
    c.stroke();
  }
}

export function masCercano(datos, t) {
  if (!datos.length) return null;
  let a = 0;
  let b = datos.length - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (datos[m][0] < t) a = m;
    else b = m;
  }
  return Math.abs(datos[a][0] - t) <= Math.abs(datos[b][0] - t) ? datos[a] : datos[b];
}

export function dibujarGrafica(canvas, { series, xmin, xmax, banda, barras }) {
  const { c, w, h } = preparar(canvas);
  const t = tema();
  const valores = series.flatMap(s => s.datos.map(p => p[1]));
  if (!valores.length) return null;

  let lo = Math.min(...valores);
  let hi = Math.max(...valores);
  if (banda?.[0] !== null && banda?.[0] !== undefined) lo = Math.min(lo, banda[0]);
  if (banda?.[1] !== null && banda?.[1] !== undefined) hi = Math.max(hi, banda[1]);
  const holgura = (hi - lo) * 0.08 || 1;
  const piso = barras || lo >= 0 ? Math.max(0, lo - holgura) : lo - holgura;
  const escala = marcas(barras ? 0 : piso, hi + holgura, 4);

  const ancho = w - MARGEN.izq - MARGEN.der;
  const alto = h - MARGEN.arr - MARGEN.aba;
  const X = v => MARGEN.izq + ((v - xmin) / (xmax - xmin)) * ancho;
  const Y = v => MARGEN.arr + (1 - (v - escala.min) / (escala.max - escala.min)) * alto;

  if (banda && banda[0] !== null && banda[1] !== null) {
    const y1 = Y(Math.min(banda[1], escala.max));
    const y0 = Y(Math.max(banda[0], escala.min));
    c.fillStyle = t.banda;
    c.fillRect(MARGEN.izq, y1, ancho, y0 - y1);
  }

  c.font = t.fuente;
  c.lineWidth = 1;
  c.textAlign = "right";
  c.textBaseline = "middle";
  const dec = decimalesDePaso(escala.paso);
  for (const v of escala.valores) {
    const y = Math.round(Y(v)) + 0.5;
    c.strokeStyle = t.rejilla;
    c.beginPath();
    c.moveTo(MARGEN.izq, y);
    c.lineTo(w - MARGEN.der, y);
    c.stroke();
    c.fillStyle = t.tenue;
    c.fillText(v.toFixed(dec), MARGEN.izq - 10, y);
  }

  c.textBaseline = "alphabetic";
  const span = xmax - xmin;
  const n = Math.max(2, Math.floor(ancho / 140));
  for (let k = 0; k <= n; k++) {
    const tx = xmin + (span * k) / n;
    c.textAlign = k === 0 ? "left" : k === n ? "right" : "center";
    c.fillText(horaEje(tx, span), X(tx), h - 6);
  }

  c.save();
  c.beginPath();
  c.rect(MARGEN.izq, MARGEN.arr - 6, ancho + 6, alto + 12);
  c.clip();

  series.forEach((s, i) => {
    const color = t.series[i % t.series.length];
    if (!s.datos.length) return;

    if (barras) {
      const paso = pasoTipico(s.datos, 86400e3);
      const anchoBarra = Math.min(26, Math.max(3, (X(xmin + paso) - X(xmin)) * 0.6));
      c.fillStyle = color;
      for (const [tt, v] of s.datos) {
        const y = Y(v);
        c.beginPath();
        c.roundRect(X(tt) - anchoBarra / 2, y, anchoBarra, Y(escala.min) - y, [4, 4, 0, 0]);
        c.fill();
      }
      return;
    }

    c.strokeStyle = color;
    c.lineWidth = 2;
    c.lineJoin = "round";
    c.lineCap = "round";
    for (const tramo of tramos(s.datos)) {
      if (tramo.length === 1) {
        punto(c, X(tramo[0][0]), Y(tramo[0][1]), 3, color);
        continue;
      }
      c.beginPath();
      tramo.forEach(([tt, v], k) => (k ? c.lineTo(X(tt), Y(v)) : c.moveTo(X(tt), Y(v))));
      c.stroke();
    }
    const [ut, uv] = s.datos[s.datos.length - 1];
    punto(c, X(ut), Y(uv), 4, color, t.panel);
  });

  c.restore();
  return { X, Y, xmin, xmax, margen: MARGEN, w, h };
}

export function dibujarCursor(capa, geo, series, tiempo) {
  const { c, h } = preparar(capa);
  if (!geo) return;
  const t = tema();
  const x = Math.round(geo.X(tiempo)) + 0.5;
  c.strokeStyle = t.tenue;
  c.lineWidth = 1;
  c.setLineDash([3, 3]);
  c.beginPath();
  c.moveTo(x, geo.margen.arr);
  c.lineTo(x, h - geo.margen.aba);
  c.stroke();
  c.setLineDash([]);
  series.forEach((s, i) => {
    const p = masCercano(s.datos, tiempo);
    if (p) punto(c, geo.X(p[0]), geo.Y(p[1]), 4, t.series[i % t.series.length], t.panel);
  });
}

export function limpiar(capa) {
  preparar(capa);
}

export function dibujarSparkline(canvas, datos, indiceColor = 0) {
  const { c, w, h } = preparar(canvas);
  if (datos.length < 2) return;
  const t = tema();
  const valores = datos.map(p => p[1]);
  let lo = Math.min(...valores);
  let hi = Math.max(...valores);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const x0 = datos[0][0];
  const x1 = datos[datos.length - 1][0];
  const X = v => 2 + ((v - x0) / (x1 - x0 || 1)) * (w - 8);
  const Y = v => 3 + (1 - (v - lo) / (hi - lo)) * (h - 6);
  const color = t.series[indiceColor % t.series.length];
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  c.lineJoin = "round";
  for (const tramo of tramos(datos)) {
    c.beginPath();
    tramo.forEach(([tt, v], k) => (k ? c.lineTo(X(tt), Y(v)) : c.moveTo(X(tt), Y(v))));
    c.stroke();
  }
  const [ut, uv] = datos[datos.length - 1];
  punto(c, X(ut), Y(uv), 2.5, color);
}
