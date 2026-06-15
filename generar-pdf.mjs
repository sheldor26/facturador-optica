// Genera el PDF imprimible de una factura ya emitida, replicando el formato
// oficial de ARCA (Comprobantes en línea). Factura B a Consumidor Final.
//
// Correr con:  node generar-pdf.mjs facturas/B-0007-00000001.json

import fs from "node:fs";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const EMISOR = JSON.parse(fs.readFileSync("./emisor.json", "utf-8"));
const archivo = process.argv[2] || "facturas/B-0007-00000001.json";
const f = JSON.parse(fs.readFileSync(archivo, "utf-8"));

const fmtFecha = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
const num = (n) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const total = f.importes.total;
const ivaContenido = f.importes.iva;
const item = {
  descripcion: f.detalle || "Artículo de óptica (comprobante de prueba)",
  cantidad: 1,
  unidad: "unidades",
  precioUnit: total,
};

async function main() {
  const qrPng = await QRCode.toBuffer(f.qr, { margin: 0, width: 240 });
  const doc = new PDFDocument({ size: "A4", margin: 28 });
  const out = archivo.replace(/\.json$/, ".pdf");
  doc.pipe(fs.createWriteStream(out));

  const L = 28;
  const R = doc.page.width - 28;
  const Wt = R - L;
  const midX = doc.page.width / 2;
  const bold = (sz) => doc.font("Helvetica-Bold").fontSize(sz);
  const ital = (sz) => doc.font("Helvetica-Oblique").fontSize(sz);
  const reg = (sz) => doc.font("Helvetica").fontSize(sz);
  doc.lineWidth(0.8);

  // Imprime una línea con segmentos en negrita / normal (ej: "Razón Social: VALOR")
  const kv = (parts, x, yy, w, sz = 8.5) => {
    doc.fontSize(sz);
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      doc.font(p.b ? "Helvetica-Bold" : "Helvetica");
      if (i === 0) doc.text(p.t, x, yy, { width: w, continued: !last });
      else doc.text(p.t, { continued: !last });
    });
  };

  // ===== Encabezado con caja, B central y ORIGINAL recuadrado =====
  const hY = 48;
  const hH = 118;
  doc.rect(L, hY, Wt, hH).stroke();
  doc.moveTo(midX, hY).lineTo(midX, hY + hH).stroke();

  // ORIGINAL: recuadro centrado pisando el borde superior
  doc.rect(midX - 45, hY - 13, 90, 21).fillAndStroke("#ffffff", "#000000");
  bold(11).fillColor("#000").text("ORIGINAL", midX - 45, hY - 6, { width: 90, align: "center" });

  // Caja letra B (centro), justo debajo del recuadro ORIGINAL (sin solaparse)
  doc.rect(midX - 30, hY + 8, 60, 48).fillAndStroke("#ffffff", "#000000");
  bold(32).fillColor("#000").text("B", midX - 30, hY + 12, { width: 60, align: "center" });
  reg(7).text("COD. 006", midX - 30, hY + 45, { width: 60, align: "center" });

  // Izquierda: emisor (etiquetas en negrita, valores en normal)
  const lx = L + 14, lw = midX - 28 - lx - 4;
  bold(12).text(EMISOR.nombreFantasia, lx, hY + 15, { width: lw });
  kv([{ t: "Razón Social: ", b: true }, { t: EMISOR.razonSocial, b: false }], lx, hY + 46, lw);
  kv([{ t: "Domicilio Comercial: ", b: true }, { t: EMISOR.domicilio, b: false }], lx, doc.y + 2, lw);
  kv([{ t: "Condición frente al IVA: ", b: true }, { t: EMISOR.condicionIva, b: false }], lx, doc.y + 2, lw);

  // Derecha: comprobante (valores clave en negrita)
  const rx = midX + 40, rw = R - rx - 10;
  bold(18).text("FACTURA", rx, hY + 12, { width: rw });
  kv([{ t: "Punto de Venta: ", b: false }, { t: String(f.ptoVta).padStart(5, "0"), b: true },
      { t: "     Comp. Nro: ", b: false }, { t: String(f.numero).padStart(8, "0"), b: true }], rx, hY + 40, rw, 9);
  kv([{ t: "Fecha de Emisión: ", b: false }, { t: fmtFecha(f.fecha), b: true }], rx, doc.y + 2, rw, 9);
  kv([{ t: "CUIT: ", b: false }, { t: EMISOR.cuit, b: false }], rx, doc.y + 2, rw, 9);
  kv([{ t: "Ingresos Brutos: ", b: false }, { t: EMISOR.iibb, b: false }], rx, doc.y + 2, rw, 9);
  kv([{ t: "Fecha de Inicio de Actividades: ", b: false }, { t: EMISOR.inicioActividades, b: false }], rx, doc.y + 2, rw, 9);

  // ===== Período facturado =====
  let y = hY + hH;
  doc.rect(L, y, Wt, 18).stroke();
  kv([
    { t: "Período Facturado Desde: ", b: true }, { t: fmtFecha(f.fecha), b: false },
    { t: "   Hasta: ", b: true }, { t: fmtFecha(f.fecha), b: false },
    { t: "        Fecha de Vto. para el pago: ", b: true }, { t: fmtFecha(f.fecha), b: false },
  ], L + 8, y + 5, Wt - 16);

  // ===== Receptor (etiquetas en negrita) =====
  y += 18;
  const recH = 52;
  doc.rect(L, y, Wt, recH).stroke();
  kv([{ t: "CUIT/DNI: ", b: true }, { t: "-", b: false }], L + 8, y + 7, Wt / 2);
  kv([{ t: "Apellido y Nombre / Razón Social: ", b: true }, { t: "Consumidor Final", b: false }], midX, y + 7, Wt / 2 - 8);
  kv([{ t: "Condición frente al IVA: ", b: true }, { t: "Consumidor Final", b: false }], L + 8, y + 24, Wt / 2);
  kv([{ t: "Domicilio:", b: true }], midX, y + 24, Wt / 2 - 8);
  kv([{ t: "Condición de venta: ", b: true }, { t: "Contado", b: false }], L + 8, y + 40, Wt);

  // ===== Detalle: tabla con todas las columnas =====
  y += recH + 8;
  const tblTop = y;

  // Posiciones donde termina la tabla (para que las líneas lleguen al fondo)
  const footY = doc.page.height - 140;
  const regY = footY - 50;          // bloque Ley 27.743
  const detailBottom = regY - 10;   // fondo de la tabla de detalle

  // Encabezado gris
  doc.rect(L, tblTop, Wt, 16).fillAndStroke("#e9e9e9", "#000000");
  doc.fillColor("#000");
  bold(7);
  doc.text("Código", L + 4, tblTop + 5);
  doc.text("Producto / Servicio", L + 44, tblTop + 5);
  doc.text("Cantidad", L + 214, tblTop + 5, { width: 44, align: "right" });
  doc.text("U. Medida", L + 266, tblTop + 5);
  doc.text("Precio Unit.", L + 312, tblTop + 5, { width: 54, align: "right" });
  doc.text("% Bonif.", L + 372, tblTop + 5);
  doc.text("Imp. Bonif.", L + 404, tblTop + 5, { width: 56, align: "right" });
  doc.text("Subtotal", R - 66, tblTop + 5, { width: 62, align: "right" });

  // Fila
  const ry = tblTop + 22;
  reg(8.5);
  doc.text("-", L + 4, ry);
  doc.text(item.descripcion, L + 44, ry, { width: 162 });
  doc.text(num(item.cantidad), L + 214, ry, { width: 44, align: "right" });
  doc.text(item.unidad, L + 266, ry);
  doc.text(num(item.precioUnit), L + 312, ry, { width: 54, align: "right" });
  doc.text("0,00", L + 372, ry);
  doc.text("0,00", L + 404, ry, { width: 56, align: "right" });
  doc.text(num(total), R - 66, ry, { width: 62, align: "right" });

  // Caja exterior de la tabla + líneas verticales de columnas hasta el fondo
  doc.rect(L, tblTop, Wt, detailBottom - tblTop).stroke();
  const bounds = [L + 40, L + 208, L + 262, L + 308, L + 366, L + 402, L + 462];
  for (const bx of bounds) doc.moveTo(bx, tblTop).lineTo(bx, detailBottom).stroke();

  // ===== Caja de totales (relleno blanco: tapa las líneas y queda limpia) =====
  const totW = 250, totH = 62, totX = R - totW, totY = detailBottom - totH;
  doc.rect(totX, totY, totW, totH).fillAndStroke("#ffffff", "#000000");
  bold(9).fillColor("#000");
  const lblW = totW - 110;
  doc.text("Subtotal: $", totX + 6, totY + 9, { width: lblW, align: "right" });
  doc.text(num(total), totX + lblW, totY + 9, { width: 98, align: "right" });
  doc.text("Importe Otros Tributos: $", totX + 6, totY + 25, { width: lblW, align: "right" });
  doc.text("0,00", totX + lblW, totY + 25, { width: 98, align: "right" });
  bold(11);
  doc.text("Importe Total: $", totX + 6, totY + 42, { width: lblW - 6, align: "right" });
  doc.text(num(total), totX + lblW, totY + 42, { width: 98, align: "right" });

  // ===== Régimen de Transparencia Fiscal (Ley 27.743) =====
  doc.rect(L, regY, Wt, 32).stroke();
  doc.font("Helvetica-BoldOblique").fontSize(8.5).fillColor("#000").text("Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)", L + 6, regY + 6);
  bold(8.5).text(`IVA Contenido: $   ${num(ivaContenido)}`, L + 6, regY + 18);

  // ===== Pie: QR + ARCA + CAE =====
  doc.image(qrPng, L, footY, { width: 96 });
  bold(13).fillColor("#1c3f6e").text("ARCA", L + 108, footY + 24);
  reg(6).fillColor("#1c3f6e").text("AGENCIA DE RECAUDACIÓN\nY CONTROL ADUANERO", L + 108, footY + 40);
  doc.fillColor("#000");
  doc.font("Helvetica-BoldOblique").fontSize(8.5).text("Comprobante Autorizado", L + 108, footY + 60);
  ital(6.5).fillColor("#444").text("Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación", L + 108, footY + 74, { width: 230 });
  doc.fillColor("#000");
  bold(11).text(`CAE N°: ${f.cae}`, midX, footY + 26, { width: R - midX, align: "right" });
  reg(10).text(`Fecha de Vto. de CAE: ${fmtFecha(f.caeVencimiento)}`, midX, footY + 44, { width: R - midX, align: "right" });
  reg(8).text("Pág. 1/1", L, footY + 30, { width: Wt, align: "center" });

  doc.end();
  await new Promise((r) => doc.on("end", r));
  console.log("PDF generado:", out);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
