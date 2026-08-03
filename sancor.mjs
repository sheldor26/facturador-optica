// Módulo Sancor: procesa las preliquidaciones de Sancor Salud.
// - Lee el TOTAL de la última hoja del PDF de preliquidación.
// - Detecta la columna COND. IVA (GRAV / NO GRAV).
// - Si TODAS las filas son GRAV, estampa debajo del total dos líneas:
//     IVA 10.5% = $ ...      y      TOTAL = $ ...
//   (la NO GRAV se deja intacta: a esas prestaciones no se les suma IVA).
// - Archiva la preliquidación (y luego la factura) en:
//     <base>/<año>/<mes>/<GRAV|NO GRAV>/
//
// Lee con pdfjs-dist (posiciones de texto) y estampa con pdf-lib.
// No toca la lógica fiscal: la emisión sigue usando engine.emitir().

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const require = createRequire(import.meta.url);

// pdfjs (build legacy para Node). Carga diferida para no pesar si no se usa.
let _pdfjs;
async function pdfjs() {
  if (!_pdfjs) _pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return _pdfjs;
}
// Carpeta de fuentes estándar de pdfjs (evita warnings y mejora la lectura).
function standardFontsUrl() {
  try {
    const p = path.dirname(require.resolve("pdfjs-dist/package.json"));
    return pathToFileURL(path.join(p, "standard_fonts") + path.sep).href;
  } catch { return undefined; }
}

const IVA_RATE = 0.105; // 10.5%
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const money = (n) =>
  "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Abre el PDF y devuelve el documento pdfjs. */
async function abrir(filePath) {
  const { getDocument } = await pdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  return getDocument({ data, standardFontDataUrl: standardFontsUrl(), isEvalSupported: false }).promise;
}

/** Ítems de texto {str,x,y,w} de una página (coordenadas nativas del PDF, sin rotar). */
async function itemsDe(page) {
  const tc = await page.getTextContent();
  return tc.items
    .map((it) => ({ str: (it.str || "").trim(), x: it.transform[4], y: it.transform[5], w: it.width || 0 }))
    .filter((o) => o.str);
}

/**
 * Analiza una preliquidación.
 * @returns {{
 *   archivo:string, numPages:number,
 *   tipo:'GRAV'|'NO GRAV'|'MIXTO'|'DESCONOCIDO',
 *   filas:string[], total:number, iva:number, totalConIva:number,
 *   _stamp?:{page:number,rowX:number,rightY:number}
 * }}
 */
export async function analizar(filePath) {
  const doc = await abrir(filePath);
  const numPages = doc.numPages;

  // 1) Condición de IVA por fila (recorre todas las páginas).
  //    En el PDF "GRAV" aparece como token suelto; "NO GRAV" como un único token.
  const filas = [];
  let hayGrav = false, hayNoGrav = false;
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    for (const it of await itemsDe(page)) {
      const s = it.str.toUpperCase();
      if (s === "NO GRAV") { filas.push("NO GRAV"); hayNoGrav = true; }
      else if (s === "GRAV") { filas.push("GRAV"); hayGrav = true; }
    }
  }
  let tipo = "DESCONOCIDO";
  if (hayGrav && hayNoGrav) tipo = "MIXTO";
  else if (hayNoGrav) tipo = "NO GRAV";
  else if (hayGrav) tipo = "GRAV";

  // 2) TOTAL de la última hoja: etiqueta "TOTAL" y el número más a la derecha en su fila.
  const last = await doc.getPage(numPages);
  const items = await itemsDe(last);
  const totLabel = items.find((it) => it.str.toUpperCase() === "TOTAL");
  let total = 0, rowX = null, rightY = null;
  if (totLabel) {
    const enFila = items
      .filter((it) => Math.abs(it.x - totLabel.x) < 3 && /^[\d.,]+$/.test(it.str) && it.str.replace(/[.,]/g, "").length >= 3)
      .sort((a, b) => b.y - a.y); // el más a la derecha = mayor y (por la rotación)
    if (enFila[0]) {
      total = parseFloat(enFila[0].str.replace(/\./g, "").replace(",", ".").replace(/[^0-9.]/g, "")) || parseFloat(enFila[0].str) || 0;
      // OJO: los importes vienen como "144706.0" (punto decimal, sin separador de miles).
      total = parseFloat(enFila[0].str.replace(/,/g, "")) || total;
      rowX = totLabel.x;
      rightY = enFila[0].y + enFila[0].w;
    }
  }

  const iva = tipo === "GRAV" ? round2(total * IVA_RATE) : 0;
  const totalConIva = round2(total + iva);

  return {
    archivo: path.basename(filePath),
    numPages, tipo, filas, total, iva, totalConIva,
    _stamp: totLabel ? { page: numPages, rowX, rightY } : null,
  };
}

/**
 * Estampa el IVA 10.5% + TOTAL debajo del total (solo si es GRAV) y escribe outPath.
 * Si no es GRAV, copia el PDF tal cual. Devuelve el análisis + {estampada:boolean}.
 */
export async function estampar(srcPath, outPath) {
  const info = await analizar(srcPath);
  const debeEstampar = info.tipo === "GRAV" && info._stamp && info.total > 0;

  if (!debeEstampar) {
    fs.copyFileSync(srcPath, outPath);
    return { ...info, estampada: false };
  }

  const pdf = await PDFDocument.load(fs.readFileSync(srcPath));
  const page = pdf.getPages()[info._stamp.page - 1];
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = 11;
  const { rowX, rightY } = info._stamp;

  const lineas = [`IVA 10.5% = ${money(info.iva)}`, `TOTAL = ${money(info.totalConIva)}`];
  lineas.forEach((txt, k) => {
    const w = font.widthOfTextAtSize(txt, size);
    // Filas hacia abajo (en la vista) = +x nativo. Alineado a la derecha con el valor del total.
    const x = rowX + 16 * (k + 1) + 4;
    const y = rightY - w;
    page.drawText(txt, { x, y, size, font, rotate: degrees(90), color: rgb(0, 0, 0) });
  });

  fs.writeFileSync(outPath, await pdf.save());
  return { ...info, estampada: true };
}

/** Carpeta destino: <base>/<año>/<MES en texto>/<GRAV|NO GRAV>. La crea si no existe. */
export function carpetaDestino(base, anio, mes, tipo) {
  const mesTxt = typeof mes === "number" ? `${String(mes).padStart(2, "0")} - ${MESES[mes - 1] || ""}`.trim() : String(mes);
  const sub = tipo === "GRAV" ? "GRAV" : "NO GRAV";
  const dir = path.join(base, String(anio), mesTxt, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Procesa una preliquidación de punta a punta:
 *  analiza → estampa (si GRAV) → guarda en la carpeta del mes.
 * @returns análisis + { tipo, aFacturar, rutaPreliq, carpeta }
 * `aFacturar` es el monto a facturar: total+IVA si GRAV, total si NO GRAV.
 */
export async function procesar({ srcPath, base, anio, mes }) {
  const info = await analizar(srcPath);
  if (info.tipo === "MIXTO")
    throw new Error("La preliquidación tiene filas GRAV y NO GRAV mezcladas. Revisala antes de continuar.");
  if (info.tipo === "DESCONOCIDO")
    throw new Error("No pude leer la columna COND. IVA de la preliquidación.");
  if (!info.total)
    throw new Error("No pude leer el TOTAL de la preliquidación.");

  const carpeta = carpetaDestino(base, anio, mes, info.tipo);
  const rutaPreliq = path.join(carpeta, path.basename(srcPath));
  await estampar(srcPath, rutaPreliq);

  return {
    ...info,
    aFacturar: info.tipo === "GRAV" ? info.totalConIva : info.total,
    rutaPreliq, carpeta,
  };
}
