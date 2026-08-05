// Plantilla HTML/CSS de la factura, estilo oficial AFIP/ARCA con identidad de marca.
// Soporta Factura A (RI, IVA discriminado) y Factura B (Consumidor Final, IVA contenido).
// Devuelve un string HTML autocontenido (CSS + QR + logo embebidos).

// Algunos datos (ej. domicilios de ARCA) ya vienen con entidades HTML como "B&#176;" (B°).
// Primero las decodificamos a su carácter real, y recién ahí escapamos &<> — así no queda
// el doble-escapado "&amp;#176;" que se ve como "&#176;" en la factura.
const decodeEntidades = (s) => String(s ?? "")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp|deg|ordm|ordf);/g, (_, n) =>
    ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°", ordm: "º", ordf: "ª" }[n]));
const esc = (s) => decodeEntidades(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmtFecha = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
const num = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tiene = (s) => s && !String(s).startsWith("(completar");

// Códigos de comprobante AFIP (3 dígitos)
export const CODIGOS = { FACTURA: { A: "001", B: "006" }, ND: { A: "002", B: "007" }, NC: { A: "003", B: "008" } };
export const codigoComprobante = (clase, tipo) => (CODIGOS[clase] || CODIGOS.FACTURA)[tipo || "B"];

// --- Importe a letras (es-AR), para el "Son: pesos ..." del presupuesto ---
const _UNI = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte"];
const _DEC = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const _CEN = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
function _decenas(n) {
  if (n <= 20) return _UNI[n];
  if (n < 30) return "veinti" + _UNI[n - 20];
  const d = Math.floor(n / 10), u = n % 10;
  return _DEC[d] + (u ? " y " + _UNI[u] : "");
}
function _centenas(n) {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100), r = n % 100;
  return ((c ? _CEN[c] + (r ? " " : "") : "") + _decenas(r)).trim();
}
function _enteroALetras(n) {
  if (n === 0) return "cero";
  let t = "";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  if (millones) t += (millones === 1 ? "un millón" : _centenas(millones) + " millones") + " ";
  if (miles) t += (miles === 1 ? "mil" : _centenas(miles) + " mil") + " ";
  if (resto) t += _centenas(resto);
  // Apócope de "uno" antes de mil/millones y al final (pesos es masculino).
  return t.trim()
    .replace(/veintiuno( mil| millones|$)/g, "veintiún$1")
    .replace(/uno( mil| millones|$)/g, "un$1");
}
export function importeEnLetras(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const entero = Math.floor(v);
  const cent = String(Math.round((v - entero) * 100)).padStart(2, "0");
  return `Son: pesos ${_enteroALetras(entero)} con ${cent}/100`.toUpperCase();
}

// ===========================================================================
//  Presupuesto (documento NO fiscal): mismo estilo que la factura pero sin QR,
//  sin CAE y sin letra A/B de AFIP. Incluye validez y una leyenda aclaratoria.
// ===========================================================================
export function renderPresupuestoHTML({ emisor, f, logoDataUrl, copias = ["ORIGINAL"] }) {
  const tipo = f.tipo || "B";
  const esA = tipo === "A";
  const rec = f.receptor || {};
  const recDocLabel = rec.docLabel || "CUIT/DNI";
  const recDocNro = rec.docNro || "-";
  const recNombre = rec.nombre || "Consumidor Final";
  const recCond = rec.condicion || "Consumidor Final";
  const recDom = rec.domicilio || "-";
  const recVenta = rec.condVenta || "Contado";

  const items = f.items || [];
  const filasItems = items.map((it) => it.nota ? `
      <tr><td class="c">-</td><td class="prod">${esc(it.desc)}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>` : `
      <tr>
        <td class="c">${esc(it.codigo ?? "-")}</td><td class="prod">${esc(it.desc)}</td>
        <td class="r">${num(it.cantidad)}</td><td class="c">${esc(it.unidad ?? "Unidades")}</td>
        <td class="r">${num(it.precioUnit)}</td><td class="r">${num(it.bonifPct ?? 0)}</td>
        <td class="r">${num(it.bonifImp ?? 0)}</td><td class="r">${num(it.subtotal)}</td>
      </tr>`).join("");

  const neto = f.importes.neto ?? f.importes.total;
  const iva = f.importes.iva ?? 0;
  const totalF = f.importes.total;
  const esLista = !!f.sinTotal;
  const totalesRows = esA
    ? `
      <tr><td class="lbl">Importe Neto Gravado: $</td><td>${num(neto)}</td></tr>
      <tr><td class="lbl">IVA 21%: $</td><td>${num(iva)}</td></tr>
      <tr class="tot"><td class="lbl">Importe Total: $</td><td>${num(totalF)}</td></tr>`
    : `
      <tr><td class="lbl">Subtotal: $</td><td>${num(totalF)}</td></tr>
      <tr class="tot"><td class="lbl">Importe Total: $</td><td>${num(totalF)}</td></tr>`;
  const ivaContenido = esA ? "" : `<div class="iva-cont">IVA contenido: $ ${num(iva)}</div>`;

  const contacto = [tiene(emisor.telefono) ? `Tel: ${esc(emisor.telefono)}` : "", tiene(emisor.web) ? esc(emisor.web) : ""]
    .filter(Boolean).join("&nbsp;&nbsp;·&nbsp;&nbsp;");
  const numeroTxt = String(f.numero ?? 0).padStart(8, "0");
  const vencTxt = f.vencimiento ? fmtFecha(f.vencimiento) : null;

  const cuerpo = (copia) => `<div class="hoja"><div class="factura">

  <div class="header">
    <div class="original">${copia}</div>
    <div class="emisor">
      <div class="brand">
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="logo">` : ""}
        <div><div class="nm">${esc(emisor.nombreFantasia)}</div>${emisor.rubro ? `<div class="ru">${esc(emisor.rubro)}</div>` : ""}</div>
      </div>
      <div class="dato"><b>Razón Social:</b> ${esc(emisor.razonSocial)}</div>
      <div class="dato"><b>Domicilio Comercial:</b> ${esc(emisor.domicilio)}</div>
      <div class="dato"><b>Condición frente al IVA:</b> ${esc(emisor.condicionIva)}</div>
      <div class="dato"><b>CUIT:</b> ${esc(emisor.cuit)}</div>
      ${contacto ? `<div class="cont">${contacto}</div>` : ""}
    </div>
    <div class="centro">
      <div class="letra"><div class="big">P</div><div class="cod">PRESUP.</div></div>
    </div>
    <div class="comprobante">
      <div class="titulo" style="font-size:21px">PRESUPUESTO</div>
      <div class="dato">Número: <b>${numeroTxt}</b></div>
      <div class="dato">Fecha: <b>${fmtFecha(f.fecha)}</b></div>
      <div class="dato">CUIT: ${esc(emisor.cuit)}</div>
      <div class="dato">Ingresos Brutos: ${esc(emisor.iibb)}</div>
      ${vencTxt ? `<div class="venc-chip">Válido hasta el ${vencTxt}</div>` : ""}
    </div>
  </div>

  <div class="receptor">
    <div class="dato"><b>${esc(recDocLabel)}:</b> ${esc(recDocNro)}</div>
    <div class="dato"><b>Apellido y Nombre / Razón Social:</b> ${esc(recNombre)}</div>
    <div class="dato"><b>Condición frente al IVA:</b> ${esc(recCond)}</div>
    <div class="dato"><b>Domicilio:</b> ${esc(recDom)}</div>
    <div class="dato"><b>Condición de venta:</b> ${esc(recVenta)}</div>
  </div>

  <table class="detalle">
    <thead><tr>
      <th>Código</th><th>Producto / Servicio</th><th class="r">Cantidad</th><th>U. Medida</th>
      <th class="r">Precio Unit.</th><th class="r">% Bonif.</th><th class="r">Imp. Bonif.</th><th class="r">Subtotal</th>
    </tr></thead>
    <tbody>
      ${filasItems}
      <tr class="fill-row"><td class="fill"></td><td class="fill"></td><td class="fill"></td><td class="fill"></td>
          <td class="fill"></td><td class="fill"></td><td class="fill"></td><td class="fill"></td></tr>
    </tbody>
  </table>

  ${esLista ? `
  <div class="lista-precios-nota">Valores de referencia por producto — no se suman en un total. El cliente elige la combinación que le convenga.</div>
  ` : `
  <div class="totales">
    <table>${totalesRows}
    </table>
  </div>
  ${ivaContenido}
  <div class="enletras">${importeEnLetras(totalF)}</div>
  `}

  <div class="obs">
    <div class="obs-t">Observaciones</div>
    <div class="obs-b">${esc(f.observaciones || "").replace(/\n/g, "<br>")}</div>
  </div>

  <div class="presup-foot">
    <div class="leyenda">
      <b>DOCUMENTO NO VÁLIDO COMO FACTURA.</b> Presupuesto sin validez fiscal.
      ${esLista
        ? `Es una lista de precios orientativa, no un total a pagar${vencTxt ? `, válida hasta el ${vencTxt}` : ""}.`
        : `Los precios pueden estar sujetos a modificaciones${vencTxt ? ` y rigen hasta el ${vencTxt}` : ""}.`}
      ${contacto ? `<div class="foot-cont">${contacto}</div>` : ""}
    </div>
    <div class="firma"><span>Firma y aclaración</span></div>
  </div>
  <div class="pagina">Pág. 1/1</div>

</div></div>`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Presupuesto ${numeroTxt}</title>
<style>
  :root { --brand: #16243f; --line: #16243f; --muted: #5a6473; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #eef0f3; font-family: Arial, Helvetica, sans-serif; color: #111; }
  .hoja { width: 210mm; height: 297mm; margin: 12px auto; background: #fff; padding: 8mm 7mm; break-after: page; page-break-after: always; }
  .hoja:last-child { break-after: auto; page-break-after: auto; }
  .factura { border: 1.3px solid var(--brand); position: relative; display: flex; flex-direction: column; height: 172mm; }

  .header { display: grid; grid-template-columns: 1fr 96px 1fr; position: relative; }
  .header > div { padding: 9px 13px; }
  .emisor { border-right: 1px solid var(--line); }
  .comprobante { border-left: 1px solid var(--line); }

  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
  .brand img { height: 50px; width: auto; }
  .brand .nm { font-size: 16.5px; font-weight: bold; color: var(--brand); line-height: 1.05; letter-spacing: .2px; }
  .brand .ru { font-size: 8.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.4px; margin-top: 2px; }
  .emisor .dato { font-size: 10.5px; line-height: 1.6; }
  .emisor .dato b { font-weight: bold; }
  .emisor .cont { font-size: 9.5px; color: var(--muted); margin-top: 5px; padding-top: 5px; border-top: 1px dotted #b9c0cc; }

  .centro { position: relative; }
  .original { position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
    border: 1px solid var(--brand); background: #fff; font-weight: bold; font-size: 11px; letter-spacing: 1.5px;
    padding: 2px 14px; white-space: nowrap; z-index: 2; }
  .letra { position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
    border: 1px solid var(--brand); background: #fff; width: 56px; text-align: center; padding: 3px 0; z-index: 2; }
  .letra .big { font-size: 34px; font-weight: bold; line-height: 1; color: var(--brand); }
  .letra .cod { font-size: 7.5px; color: var(--muted); }

  .comprobante .titulo { font-size: 21px; font-weight: bold; color: var(--brand); letter-spacing: 2px; margin-bottom: 7px; }
  .comprobante .dato { font-size: 10.5px; line-height: 1.62; }
  .comprobante .dato b { font-weight: bold; }

  .receptor { border-top: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr; padding: 8px 13px; gap: 5px 24px; font-size: 10.5px; }
  .receptor .dato b { font-weight: bold; }

  table.detalle { width: 100%; border-collapse: collapse; border-top: 1px solid var(--line); font-size: 10.5px; flex: 1 1 auto; }
  table.detalle th, table.detalle td { border: 1px solid var(--line); padding: 4px 6px; vertical-align: top; }
  table.detalle thead th { background: var(--brand); color: #fff; font-weight: bold; font-size: 9.5px; text-align: center; letter-spacing: .3px; }
  table.detalle td.r, table.detalle th.r { text-align: right; }
  table.detalle td.c { text-align: center; }
  table.detalle td.prod { text-transform: uppercase; }
  table.detalle tr.fill-row, table.detalle td.fill { height: 100%; }

  .venc-chip { display: inline-block; margin-top: 7px; background: #fff4d6; border: 1px solid #d9a400;
    color: #7a5b00; font-weight: bold; font-size: 10.5px; padding: 3px 10px; border-radius: 4px; }

  .totales { display: flex; justify-content: flex-end; }
  .totales table { border-collapse: collapse; font-size: 11.5px; min-width: 290px; }
  .totales td { padding: 4px 10px; text-align: right; }
  .totales td.lbl { font-weight: bold; }
  .totales tr.tot td { font-size: 17px; font-weight: bold; color: #fff; background: var(--brand); border-top: 1.3px solid var(--brand); }

  .iva-cont { text-align: right; padding: 4px 13px 0; font-size: 10.5px; font-weight: bold; }
  .enletras { padding: 6px 13px 0; font-size: 10.5px; font-style: italic; font-weight: bold; color: var(--brand); text-transform: uppercase; }
  .lista-precios-nota { margin: 8px 13px 0; padding: 7px 10px; background: #fff4d6; border: 1px solid #d9a400;
    color: #7a5b00; font-size: 10.5px; font-weight: bold; text-align: center; }

  .obs { margin: 10px 13px 0; border: 1px solid var(--line); }
  .obs .obs-t { background: #f1f3f7; border-bottom: 1px solid var(--line); font-weight: bold; font-size: 9.5px;
    letter-spacing: .4px; padding: 3px 8px; text-transform: uppercase; color: var(--brand); }
  .obs .obs-b { min-height: 34px; padding: 6px 8px; font-size: 10px; line-height: 1.5; }

  .presup-foot { display: grid; grid-template-columns: 1fr 220px; align-items: end; gap: 18px;
    padding: 14px 13px 6px; border-top: 1px solid var(--line); margin-top: auto; }
  .presup-foot .leyenda { font-size: 9.5px; color: var(--muted); line-height: 1.5; }
  .presup-foot .leyenda b { color: #111; }
  .presup-foot .leyenda .foot-cont { margin-top: 5px; padding-top: 4px; border-top: 1px dotted #b9c0cc; color: var(--brand); font-weight: bold; }
  .presup-foot .firma { text-align: center; }
  .presup-foot .firma span { display: block; border-top: 1px solid #555; padding-top: 4px; font-size: 9.5px; color: var(--muted); }
  .pagina { text-align: center; font-size: 9px; color: var(--muted); padding-bottom: 6px; }

  @page { size: A4; margin: 0; }
  @media print { html, body { background: #fff; } .hoja { margin: 0; } }
</style></head>
<body>
${copias.map(cuerpo).join("\n")}
</body></html>`;
}

export function renderFacturaHTML({ emisor, f, qrDataUrl, logoDataUrl, copias = ["ORIGINAL", "DUPLICADO"] }) {
  const tipo = f.tipo || "B";
  const clase = f.clase || "FACTURA"; // FACTURA | NC | ND
  const titulo = clase === "NC" ? "NOTA DE CRÉDITO" : clase === "ND" ? "NOTA DE DÉBITO" : "FACTURA";
  const codigo = codigoComprobante(clase, tipo);
  const esA = tipo === "A";

  // Comprobantes asociados (para NC / ND)
  const asociados = (f.asociados && f.asociados.length)
    ? `<div class="asociados"><b>Comprobante${f.asociados.length > 1 ? "s" : ""} Asociado${f.asociados.length > 1 ? "s" : ""}:</b> ${f.asociados
        .map((a) => `${esc(a.tipoTxt)} ${String(a.ptoVta).padStart(5, "0")}-${String(a.nro).padStart(8, "0")} (${fmtFecha(a.fecha)})`)
        .join(" &nbsp;·&nbsp; ")}</div>`
    : "";

  // Receptor (default: Consumidor Final para B)
  const rec = f.receptor || {};
  const recDocLabel = rec.docLabel || "CUIT/DNI";
  const recDocNro = rec.docNro || "-";
  const recNombre = rec.nombre || "Consumidor Final";
  const recCond = rec.condicion || "Consumidor Final";
  const recDom = rec.domicilio || "-";
  const recVenta = rec.condVenta || "Contado";

  // Items (compat: si no hay array, arma uno solo desde importes)
  const items = f.items || [{
    codigo: "-", desc: f.detalle || "Artículo de óptica (comprobante de prueba)",
    cantidad: 1, unidad: "unidades", precioUnit: f.importes.total, bonifPct: 0, subtotal: f.importes.total,
  }];

  const filasItems = items.map((it) => it.nota ? `
      <tr><td class="c">-</td><td class="prod">${esc(it.desc)}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>` : `
      <tr>
        <td class="c">${esc(it.codigo ?? "-")}</td><td class="prod">${esc(it.desc)}</td>
        <td class="r">${num(it.cantidad)}</td><td class="c">${esc(it.unidad ?? "Unidades")}</td>
        <td class="r">${num(it.precioUnit)}</td><td class="r">${num(it.bonifPct ?? 0)}</td>
        <td class="r">${num(it.bonifImp ?? 0)}</td><td class="r">${num(it.subtotal)}</td>
      </tr>`).join("");

  // Totales: A discrimina IVA; B muestra Régimen Ley 27.743 con IVA contenido
  const neto = f.importes.neto ?? f.importes.total;
  const iva = f.importes.iva ?? 0;
  const otros = f.importes.otrosTributos ?? 0;
  const totalF = f.importes.total;

  const totalesRows = esA
    ? `
      <tr><td class="lbl">Importe Neto Gravado: $</td><td>${num(neto)}</td></tr>
      <tr><td class="lbl">IVA 21%: $</td><td>${num(iva)}</td></tr>
      <tr><td class="lbl">Importe Otros Tributos: $</td><td>${num(otros)}</td></tr>
      <tr class="tot"><td class="lbl">Importe Total: $</td><td>${num(totalF)}</td></tr>`
    : `
      <tr><td class="lbl">Subtotal: $</td><td>${num(totalF)}</td></tr>
      <tr><td class="lbl">Importe Otros Tributos: $</td><td>${num(otros)}</td></tr>
      <tr class="tot"><td class="lbl">Importe Total: $</td><td>${num(totalF)}</td></tr>`;

  const regimen = esA ? "" : `
  <div class="regimen">
    <div class="t">Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</div>
    <div class="iva">IVA Contenido: $ ${num(iva)}</div>
  </div>`;

  const contacto = [tiene(emisor.telefono) ? `Tel: ${esc(emisor.telefono)}` : "", tiene(emisor.web) ? esc(emisor.web) : ""]
    .filter(Boolean).join("&nbsp;&nbsp;·&nbsp;&nbsp;");

  const cuerpo = (copia) => `<div class="hoja"><div class="factura">

  <div class="header">
    <div class="original">${copia}</div>
    <div class="emisor">
      <div class="brand">
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="logo">` : ""}
        <div><div class="nm">${esc(emisor.nombreFantasia)}</div>${emisor.rubro ? `<div class="ru">${esc(emisor.rubro)}</div>` : ""}</div>
      </div>
      <div class="dato"><b>Razón Social:</b> ${esc(emisor.razonSocial)}</div>
      <div class="dato"><b>Domicilio Comercial:</b> ${esc(emisor.domicilio)}</div>
      <div class="dato"><b>Condición frente al IVA:</b> ${esc(emisor.condicionIva)}</div>
      <div class="dato"><b>CUIT:</b> ${esc(emisor.cuit)}</div>
      ${contacto ? `<div class="cont">${contacto}</div>` : ""}
    </div>
    <div class="centro">
      <div class="letra"><div class="big">${tipo}</div><div class="cod">COD. ${codigo}</div></div>
    </div>
    <div class="comprobante">
      <div class="titulo" style="font-size:${clase === "FACTURA" ? 24 : 19}px">${titulo}</div>
      <div class="dato">Punto de Venta: <b>${String(f.ptoVta).padStart(5, "0")}</b>&nbsp;&nbsp;&nbsp;Comp. Nro: <b>${String(f.numero).padStart(8, "0")}</b></div>
      <div class="dato">Fecha de Emisión: <b>${fmtFecha(f.fecha)}</b></div>
      <div class="dato">CUIT: ${esc(emisor.cuit)}</div>
      <div class="dato">Ingresos Brutos: ${esc(emisor.iibb)}</div>
      <div class="dato">Fecha de Inicio de Actividades: ${esc(emisor.inicioActividades)}</div>
    </div>
  </div>

  <div class="periodo">
    <b>Período Facturado Desde:</b> ${fmtFecha(f.fecha)} &nbsp;&nbsp; <b>Hasta:</b> ${fmtFecha(f.fecha)}
    &nbsp;&nbsp;&nbsp;&nbsp;<b>Fecha de Vto. para el pago:</b> ${fmtFecha(f.fecha)}
  </div>

  <div class="receptor">
    <div class="dato"><b>${esc(recDocLabel)}:</b> ${esc(recDocNro)}</div>
    <div class="dato"><b>Apellido y Nombre / Razón Social:</b> ${esc(recNombre)}</div>
    <div class="dato"><b>Condición frente al IVA:</b> ${esc(recCond)}</div>
    <div class="dato"><b>Domicilio:</b> ${esc(recDom)}</div>
    <div class="dato"><b>Condición de venta:</b> ${esc(recVenta)}</div>
  </div>
  ${asociados}

  <table class="detalle">
    <thead><tr>
      <th>Código</th><th>Producto / Servicio</th><th class="r">Cantidad</th><th>U. Medida</th>
      <th class="r">Precio Unit.</th><th class="r">% Bonif.</th><th class="r">Imp. Bonif.</th><th class="r">Subtotal</th>
    </tr></thead>
    <tbody>
      ${filasItems}
      <tr class="fill-row"><td class="fill"></td><td class="fill"></td><td class="fill"></td><td class="fill"></td>
          <td class="fill"></td><td class="fill"></td><td class="fill"></td><td class="fill"></td></tr>
    </tbody>
  </table>

  <div class="totales">
    <table>${totalesRows}
    </table>
  </div>
  ${regimen}

  <div class="footer">
    <div class="qr"><img src="${qrDataUrl}" alt="QR"></div>
    <div class="arca">
      <div class="marca">ARCA</div>
      <div class="sub">AGENCIA DE RECAUDACIÓN<br>Y CONTROL ADUANERO</div>
      <div class="aut">Comprobante Autorizado</div>
      <div class="disc">Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación</div>
    </div>
    <div class="cae">
      <div class="n">CAE N°: ${esc(f.cae)}</div>
      <div class="v">Fecha de Vto. de CAE: ${fmtFecha(f.caeVencimiento)}</div>
    </div>
  </div>
  <div class="pagina">Pág. 1/1</div>

</div></div>`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Factura ${tipo} ${String(f.ptoVta).padStart(5, "0")}-${String(f.numero).padStart(8, "0")}</title>
<style>
  :root { --brand: #16243f; --line: #16243f; --muted: #5a6473; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #eef0f3; font-family: Arial, Helvetica, sans-serif; color: #111; }
  .hoja { width: 210mm; height: 297mm; margin: 12px auto; background: #fff; padding: 8mm 7mm; break-after: page; page-break-after: always; }
  .hoja:last-child { break-after: auto; page-break-after: auto; }
  .factura { border: 1.3px solid var(--brand); position: relative; display: flex; flex-direction: column; height: 172mm; }

  .header { display: grid; grid-template-columns: 1fr 96px 1fr; position: relative; }
  .header > div { padding: 9px 13px; }
  .emisor { border-right: 1px solid var(--line); }
  .comprobante { border-left: 1px solid var(--line); }

  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
  .brand img { height: 50px; width: auto; }
  .brand .nm { font-size: 16.5px; font-weight: bold; color: var(--brand); line-height: 1.05; letter-spacing: .2px; }
  .brand .ru { font-size: 8.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.4px; margin-top: 2px; }
  .emisor .dato { font-size: 10.5px; line-height: 1.6; }
  .emisor .dato b { font-weight: bold; }
  .emisor .cont { font-size: 9.5px; color: var(--muted); margin-top: 5px; padding-top: 5px; border-top: 1px dotted #b9c0cc; }

  .centro { position: relative; }
  .original { position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
    border: 1px solid var(--brand); background: #fff; font-weight: bold; font-size: 11px; letter-spacing: 1.5px;
    padding: 2px 14px; white-space: nowrap; z-index: 2; }
  .letra { position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
    border: 1px solid var(--brand); background: #fff; width: 56px; text-align: center; padding: 3px 0; z-index: 2; }
  .letra .big { font-size: 34px; font-weight: bold; line-height: 1; color: var(--brand); }
  .letra .cod { font-size: 7.5px; color: var(--muted); }

  .comprobante .titulo { font-size: 24px; font-weight: bold; color: var(--brand); letter-spacing: 2px; margin-bottom: 7px; }
  .comprobante .dato { font-size: 10.5px; line-height: 1.62; }
  .comprobante .dato b { font-weight: bold; }

  .periodo { border-top: 1px solid var(--line); padding: 5px 13px; font-size: 10.5px; }
  .periodo b { font-weight: bold; }

  .receptor { border-top: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr; padding: 8px 13px; gap: 5px 24px; font-size: 10.5px; }
  .receptor .dato b { font-weight: bold; }

  .asociados { border-top: 1px solid var(--line); padding: 5px 13px; font-size: 9.5px; }
  .asociados b { font-weight: bold; }

  table.detalle { width: 100%; border-collapse: collapse; border-top: 1px solid var(--line); font-size: 10.5px; flex: 1 1 auto; }
  table.detalle th, table.detalle td { border: 1px solid var(--line); padding: 4px 6px; vertical-align: top; }
  table.detalle thead th { background: var(--brand); color: #fff; font-weight: bold; font-size: 9.5px; text-align: center; letter-spacing: .3px; }
  table.detalle td.r, table.detalle th.r { text-align: right; }
  table.detalle td.c { text-align: center; }
  table.detalle td.prod { text-transform: uppercase; }
  table.detalle tr.fill-row, table.detalle td.fill { height: 100%; }

  .totales { display: flex; justify-content: flex-end; }
  .totales table { border-collapse: collapse; font-size: 11.5px; min-width: 270px; }
  .totales td { padding: 4px 10px; text-align: right; }
  .totales td.lbl { font-weight: bold; }
  .totales tr.tot td { font-size: 14px; font-weight: bold; color: var(--brand); background: #eef1f6; border-top: 1.3px solid var(--brand); }

  .regimen { border-top: 1px solid var(--line); padding: 7px 13px; font-size: 10.5px; }
  .regimen .t { font-style: italic; font-weight: bold; }
  .regimen .iva { font-weight: bold; }

  .footer { display: grid; grid-template-columns: 112px 1fr 1fr; align-items: center; padding: 11px 13px 6px; gap: 12px;
    border-top: 1px solid var(--line); margin-top: auto; }
  .footer .qr img { width: 102px; height: 102px; }
  .arca .marca { color: var(--brand); font-weight: bold; font-size: 16px; line-height: 1; letter-spacing: .5px; }
  .arca .sub { color: var(--brand); font-size: 7.5px; }
  .arca .aut { font-weight: bold; font-style: italic; font-size: 10.5px; margin-top: 6px; }
  .arca .disc { font-size: 7.5px; color: var(--muted); margin-top: 2px; }
  .cae { text-align: right; }
  .cae .n { font-weight: bold; font-size: 14px; color: var(--brand); }
  .cae .v { font-size: 11.5px; margin-top: 4px; }
  .pagina { text-align: center; font-size: 9px; color: var(--muted); padding-bottom: 6px; }

  @page { size: A4; margin: 0; }
  @media print { html, body { background: #fff; } .hoja { margin: 0; } }
</style></head>
<body>
${copias.map(cuerpo).join("\n")}
</body></html>`;
}
