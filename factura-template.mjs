// Plantilla HTML/CSS de la factura, estilo oficial AFIP/ARCA con identidad de marca.
// Soporta Factura A (RI, IVA discriminado) y Factura B (Consumidor Final, IVA contenido).
// Devuelve un string HTML autocontenido (CSS + QR + logo embebidos).

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmtFecha = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
const num = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tiene = (s) => s && !String(s).startsWith("(completar");

// Códigos de comprobante AFIP (3 dígitos)
export const CODIGOS = { FACTURA: { A: "001", B: "006" }, ND: { A: "002", B: "007" }, NC: { A: "003", B: "008" } };
export const codigoComprobante = (clase, tipo) => (CODIGOS[clase] || CODIGOS.FACTURA)[tipo || "B"];

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
