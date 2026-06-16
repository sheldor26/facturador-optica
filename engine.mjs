// Motor reutilizable del facturador (proceso Node / main de Electron).
// Envuelve ARCA + token persistente + fix TLS + plantilla de PDF en funciones limpias.
// Lo usan tanto los scripts de CLI como la app.

import "./arca-tls-fix.mjs"; // primero: arregla el TLS viejo de ARCA
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { Arca, CbteTipo, IvaTipo, DocTipo, CondicionIva } from "@ramiidv/arca-facturacion";
import { attachTokenPersistence, setTokensDir } from "./ta-store.mjs";
import { renderFacturaHTML, codigoComprobante } from "./factura-template.mjs";
import { initDb, guardarFactura, listarFacturas, getFactura, contarFacturas, todasFacturas, guardarCliente as dbGuardarCliente, listarClientes, eliminarCliente as dbEliminarCliente, mergeClientes, mergeFacturas } from "./db.mjs";
import * as cloud from "./cloud.mjs";

let PC = "PC";
export function setPC(n) { PC = n || "PC"; }

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let DATA_DIR = ROOT; // carpeta donde viven cert, clave, emisor, logo, base y tokens
const dp = (...x) => path.join(DATA_DIR, ...x);

/** Define la carpeta de datos (en la app es la carpeta de usuario; en dev, el proyecto). */
export function setDataDir(dir) {
  DATA_DIR = dir;
  fs.mkdirSync(dir, { recursive: true });
  setTokensDir(dp(".tokens"));
}

/** ¿Ya están cargados certificado, clave y datos del emisor? */
export function estaConfigurado() {
  return fs.existsSync(dp("cert.pem")) && fs.existsSync(dp("key.pem")) && fs.existsSync(dp("emisor.json"));
}

export function getEmisor() {
  return JSON.parse(fs.readFileSync(dp("emisor.json"), "utf-8"));
}

/** Guarda la configuración inicial (certificado, clave, datos del emisor, logo). */
export function guardarSetup({ certPem, keyPem, emisor, logoNombre, logoBase64 }) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(dp("cert.pem"), certPem);
  fs.writeFileSync(dp("key.pem"), keyPem);
  const em = { ...emisor };
  if (logoBase64 && logoNombre) {
    fs.writeFileSync(dp(logoNombre), Buffer.from(logoBase64, "base64"));
    em.logo = logoNombre;
  }
  fs.writeFileSync(dp("emisor.json"), JSON.stringify(em, null, 2));
  _arca = null; // recrear el cliente con el cert nuevo
}

let _arca;
function getArca() {
  if (_arca) return _arca;
  const emisor = getEmisor();
  _arca = new Arca({
    cuit: Number(emisor.cuit),
    cert: fs.readFileSync(dp("cert.pem"), "utf-8"),
    key: fs.readFileSync(dp("key.pem"), "utf-8"),
    production: true,
  });
  attachTokenPersistence(_arca, "prod");
  return _arca;
}

/** Estado de los servidores de ARCA (no requiere auth). */
export async function serverStatus() {
  return getArca().serverStatus();
}

/** Próximo número disponible para un tipo de comprobante en un punto de venta. */
export async function proximoNumero(ptoVta, cbteTipo) {
  const ultimo = await getArca().ultimoComprobante(ptoVta, cbteTipo);
  return ultimo + 1;
}

/** Puntos de venta habilitados. */
export async function puntosVenta() {
  return getArca().getPuntosVenta();
}

/**
 * Consulta el padrón de ARCA por CUIT y devuelve nombre, condición IVA y domicilio.
 * Requiere que el certificado tenga habilitado el servicio de padrón en ARCA.
 */
const PADRON_ENDPOINT = "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5";

// Dígito verificador de un CUIT a partir de los primeros 10 dígitos (prefijo + DNI).
function digitoVerificador(diez) {
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(diez[i]) * mult[i];
  const dv = 11 - (suma % 11);
  if (dv === 11) return 0;
  if (dv === 10) return null; // ese prefijo no aplica
  return dv;
}

// A partir de un DNI, arma los CUIT candidatos (probamos prefijos comunes).
function candidatosCuit(dni) {
  const d8 = String(dni).padStart(8, "0");
  const cands = [];
  for (const pref of ["20", "27", "23", "24"]) {
    const dv = digitoVerificador(pref + d8);
    if (dv !== null) cands.push(Number(pref + d8 + dv));
  }
  return cands;
}

/**
 * Consulta el padrón por CUIT (11 díg.) o DNI (7-8 díg.). Para DNI prueba los
 * CUIT candidatos hasta encontrar la persona. Devuelve nombre, condición IVA y domicilio.
 */
export async function consultarPadron(input) {
  const digits = String(input).replace(/\D/g, "");
  if (/^\d{11}$/.test(digits)) {
    return { personas: [await consultarPadronCuit(Number(digits))] };
  }
  if (/^\d{7,8}$/.test(digits)) {
    // Mismo DNI puede dar más de una persona (distinto prefijo de CUIT): traer TODAS.
    const cands = candidatosCuit(digits);
    const res = await Promise.allSettled(cands.map((c) => consultarPadronCuit(c)));
    const personas = res.filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (!personas.length) throw new Error("No se encontró el contribuyente en el padrón de ARCA.");
    return { personas };
  }
  throw new Error("Ingresá un CUIT (11 dígitos) o un DNI (7-8 dígitos).");
}

async function consultarPadronCuit(cuit) {
  const auth = await getArca().wsaa.getAccessTicket("ws_sr_constancia_inscripcion");
  const cuitRep = Number(getEmisor().cuit);
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
<soapenv:Body><a5:getPersona_v2><token>${auth.token}</token><sign>${auth.sign}</sign><cuitRepresentada>${cuitRep}</cuitRepresentada><idPersona>${cuit}</idPersona></a5:getPersona_v2></soapenv:Body></soapenv:Envelope>`;

  const resp = await fetch(PADRON_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    body: soap,
  });
  const xml = await resp.text();
  const fault = xml.match(/<faultstring>([^<]*)<\/faultstring>/)?.[1];
  if (fault) throw new Error("Padrón ARCA: " + fault);

  const get = (tag) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim() || "";
  const razon = get("razonSocial");
  const nombre = razon || [get("apellido"), get("nombre")].filter(Boolean).join(" ");
  if (!nombre) throw new Error("Sin datos en el padrón"); // candidato no válido → probar el siguiente
  const domicilio = [get("direccion"), get("localidad")].filter(Boolean).join(" - ");

  const ids = [...xml.matchAll(/<idImpuesto>(\d+)<\/idImpuesto>/g)].map((m) => Number(m[1]));
  const esMono = /Monotributo/i.test(xml) || /categoriaMonotributo/.test(xml);
  let condicion = "Consumidor Final";
  if (ids.includes(32)) condicion = "IVA Sujeto Exento";          // 32 = IVA exento
  else if (ids.includes(30)) condicion = "IVA Responsable Inscripto"; // 30 = IVA
  else if (esMono) condicion = "Responsable Monotributo";
  guardarCliente({ cuit: String(cuit), nombre, condicion, domicilio });
  return { cuit, nombre, condicion, domicilio, estado: get("estadoClave") };
}

const round2 = (n) => Math.round(n * 100) / 100;
const RATE = 0.21; // IVA 21% (única alícuota por ahora)

// Condición IVA del receptor -> código ARCA + si corresponde Factura A
const COND_MAP = {
  "Consumidor Final": { cond: CondicionIva.CONSUMIDOR_FINAL, a: false },
  "IVA Responsable Inscripto": { cond: CondicionIva.RESPONSABLE_INSCRIPTO, a: true },
  "Responsable Monotributo": { cond: CondicionIva.MONOTRIBUTISTA, a: false }, // monotributo recibe Factura B

  "IVA Sujeto Exento": { cond: CondicionIva.EXENTO, a: false },
};

/**
 * Emite un comprobante REAL por ARCA y lo guarda en la base local.
 * Para B el precio ingresado es FINAL (con IVA); para A es NETO (sin IVA).
 * Devuelve { ok, id, record, nombreArchivo } o { ok:false, observaciones }.
 */
export async function emitir({ receptorCond, docNro, nombre, domicilio, condVenta, items, ptoVta }) {
  const map = COND_MAP[receptorCond] || COND_MAP["Consumidor Final"];
  const tipo = map.a ? "A" : "B";
  const cbteTipo = tipo === "A" ? CbteTipo.FACTURA_A : CbteTipo.FACTURA_B;
  const esCF = receptorCond === "Consumidor Final"; // solo CF va sin datos del receptor
  const docTipo = esCF ? DocTipo.CONSUMIDOR_FINAL : DocTipo.CUIT;
  const docNroNum = esCF ? 0 : Number(String(docNro).replace(/\D/g, ""));

  const lineItems = [];
  const display = [];
  for (const it of items) {
    if (it.nota) { display.push({ codigo: "-", desc: (it.desc || "").toUpperCase(), nota: true }); continue; } // línea sin valor (ej. N° afiliado)
    const cant = Number(it.cantidad);
    const precio = Number(it.precioUnit); // siempre se ingresa el precio FINAL (con IVA)
    const lineNeto = round2((cant * precio) / (1 + RATE)); // la app calcula el neto sola
    const unitNeto = round2(precio / (1 + RATE));
    lineItems.push({ neto: lineNeto, iva: IvaTipo.IVA_21 });
    display.push({
      codigo: it.codigo || "-", desc: (it.desc || "").toUpperCase(), cantidad: cant,
      unidad: it.unidad || "Unidades", bonifPct: 0,
      precioUnit: tipo === "A" ? unitNeto : precio, // A muestra neto (discrimina IVA); B muestra final
      subtotal: tipo === "A" ? lineNeto : round2(cant * precio),
    });
  }

  const result = await getArca().facturar({
    ptoVta, cbteTipo, docTipo, docNro: docNroNum, condicionIva: map.cond, items: lineItems,
  });
  if (!result.aprobada) return { ok: false, observaciones: result.observaciones || [] };

  const numero = result.cbteNro;
  const now = new Date();
  const fecha = Arca.formatDate(now); // YYYYMMDD
  const iso = `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`;
  const qr = Arca.generateQRUrl({
    fecha: iso, cuit: Number(getEmisor().cuit), ptoVta, tipoCmp: cbteTipo, nroCmp: numero,
    importe: result.importes.total, moneda: "PES", ctz: 1,
    tipoDocRec: docTipo, nroDocRec: docNroNum, codAut: Number(result.cae),
  });

  const record = {
    clase: "FACTURA", tipo, ptoVta, numero, fecha,
    cae: result.cae, caeVencimiento: result.caeVencimiento,
    receptor: {
      docLabel: esCF ? "CUIT/DNI" : "CUIT",
      docNro: esCF ? "-" : String(docNro),
      nombre: nombre || "Consumidor Final",
      condicion: receptorCond,
      domicilio: domicilio || "-",
      condVenta: condVenta || "Contado",
    },
    items: display,
    importes: { neto: result.importes.neto, iva: result.importes.iva, otrosTributos: 0, total: result.importes.total },
    qr,
    raw: result.raw,
  };
  if (!esCF && nombre) guardarCliente({ cuit: docNroNum, nombre, condicion: receptorCond, domicilio });
  const id = Number(guardarFactura(record, now.toISOString()));
  cloud.pushFactura(record, PC).catch(() => {});
  return { ok: true, id, record, nombreArchivo: nombreArchivo(record) };
}

/**
 * Emite una Nota de Crédito (clase "NC") o Débito ("ND") asociada a una factura
 * ya emitida (por su id en la base). Toma cliente, ítems e importe de la original.
 */
export async function emitirNota({ clase, facturaId }) {
  const row = getFactura(facturaId);
  if (!row) throw new Error("Comprobante original no encontrado.");
  const orig = row.record;
  if ((orig.clase || "FACTURA") !== "FACTURA") throw new Error("Solo se puede notar una factura.");

  const tipo = orig.tipo; // A | B
  const origCbteTipo = tipo === "A" ? CbteTipo.FACTURA_A : CbteTipo.FACTURA_B;
  const map = COND_MAP[orig.receptor?.condicion] || COND_MAP["Consumidor Final"];
  const docTipo = map.a ? DocTipo.CUIT : DocTipo.CONSUMIDOR_FINAL;
  const docNroNum = map.a ? Number(String(orig.receptor?.docNro).replace(/\D/g, "")) : 0;

  // Reconstruir los ítems (mismo importe que la original)
  const lineItems = [];
  for (const it of orig.items || []) {
    if (it.nota) continue;
    const cant = Number(it.cantidad);
    const precio = Number(it.precioUnit);
    lineItems.push({ neto: tipo === "B" ? round2((cant * precio) / (1 + RATE)) : round2(cant * precio), iva: IvaTipo.IVA_21 });
  }

  const opts = {
    ptoVta: orig.ptoVta, docTipo, docNro: docNroNum, condicionIva: map.cond, items: lineItems,
    comprobanteOriginal: { tipo: origCbteTipo, ptoVta: orig.ptoVta, nro: orig.numero, fecha: orig.fecha },
  };
  const result = clase === "NC" ? await getArca().notaCredito(opts) : await getArca().notaDebito(opts);
  if (!result.aprobada) return { ok: false, observaciones: result.observaciones || [] };

  const numero = result.cbteNro;
  const now = new Date();
  const fecha = Arca.formatDate(now);
  const iso = `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`;
  const qr = Arca.generateQRUrl({
    fecha: iso, cuit: Number(getEmisor().cuit), ptoVta: orig.ptoVta, tipoCmp: result.cbteTipo, nroCmp: numero,
    importe: result.importes.total, moneda: "PES", ctz: 1, tipoDocRec: docTipo, nroDocRec: docNroNum, codAut: Number(result.cae),
  });

  const record = {
    clase, tipo, ptoVta: orig.ptoVta, numero, fecha,
    cae: result.cae, caeVencimiento: result.caeVencimiento,
    receptor: orig.receptor,
    asociados: [{ tipoTxt: `Factura ${tipo}`, ptoVta: orig.ptoVta, nro: orig.numero, fecha: orig.fecha }],
    items: orig.items,
    importes: { neto: result.importes.neto, iva: result.importes.iva, otrosTributos: 0, total: result.importes.total },
    qr, raw: result.raw,
  };
  const id = Number(guardarFactura(record, now.toISOString()));
  cloud.pushFactura(record, PC).catch(() => {});
  return { ok: true, id, record, nombreArchivo: nombreArchivo(record) };
}

/** Genera el HTML de un comprobante (con QR y logo embebidos). */
export async function comprobanteHTML(record, copias) {
  const emisor = getEmisor();
  let logoDataUrl = null;
  if (emisor.logo && fs.existsSync(dp(emisor.logo))) {
    const ext = path.extname(emisor.logo).slice(1).toLowerCase();
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    logoDataUrl = `data:${mime};base64,${fs.readFileSync(dp(emisor.logo)).toString("base64")}`;
  }
  const qrDataUrl = await QRCode.toDataURL(record.qr, { margin: 0, width: 240 });
  return renderFacturaHTML({ emisor, f: record, qrDataUrl, logoDataUrl, copias });
}

// ---- Configuración de la app (carpeta de guardado, etc.) ----

const CONFIG_DEFAULT = { carpetaFacturas: "", preguntarDonde: false };
let _configPath, _config;

function guardarConfig() {
  fs.writeFileSync(_configPath, JSON.stringify(_config, null, 2));
}
export function getConfig() {
  return _config;
}
export function setConfig(patch) {
  _config = { ..._config, ...patch };
  guardarConfig();
  return _config;
}

/** Nombre de archivo oficial AFIP: CUIT_CodTipo_PtoVta_Numero.pdf */
export function nombreArchivo(rec) {
  const cuit = String(getEmisor().cuit).replace(/\D/g, "");
  const cod = codigoComprobante(rec.clase || "FACTURA", rec.tipo || "B");
  const pv = String(rec.ptoVta).padStart(5, "0");
  const nro = String(rec.numero).padStart(8, "0");
  return `${cuit}_${cod}_${pv}_${nro}.pdf`;
}

// ---- Base de datos local ----

/** Inicializa carpeta de datos, base y configuración. */
export function initEngine({ dataDir, carpetaDefault }) {
  setDataDir(dataDir);
  initDb(dp("datos.json"));
  if (contarFacturas() === 0) importarFacturasIniciales();

  _configPath = dp("config.json");
  _config = fs.existsSync(_configPath)
    ? { ...CONFIG_DEFAULT, ...JSON.parse(fs.readFileSync(_configPath, "utf-8")) }
    : { ...CONFIG_DEFAULT };
  if (!_config.carpetaFacturas) _config.carpetaFacturas = carpetaDefault;
  guardarConfig();
}

/** Importa los comprobantes reales ya emitidos (archivos facturas/*.json). */
export function importarFacturasIniciales() {
  const dir = dp("facturas");
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file.startsWith("ejemplo-")) continue; // saltar ejemplos
    const rec = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    const mtime = fs.statSync(path.join(dir, file)).mtime.toISOString();
    guardarFactura(rec, mtime);
    n++;
  }
  return n;
}

export { listarFacturas, getFactura, contarFacturas, listarClientes };

// Guardar/eliminar cliente: local + nube (la nube best-effort, no bloquea).
export function guardarCliente(c) { dbGuardarCliente(c); cloud.pushCliente(c).catch(() => {}); }
export function eliminarCliente(cuit) { dbEliminarCliente(cuit); cloud.deleteCliente(cuit).catch(() => {}); }

/** Sincroniza con la nube: baja todo lo de las otras PCs y sube lo local que falte. */
export async function sincronizarNube() {
  try {
    if (!(await cloud.nubeDisponible())) return { ok: false, offline: true };
    const [cloudFac, cloudCli] = await Promise.all([cloud.fetchFacturas(), cloud.fetchClientes()]);
    mergeFacturas(cloudFac);
    mergeClientes(cloudCli);
    const keys = new Set(cloudFac.map((r) => `${r.clase}-${r.tipo}-${r.pto_vta}-${r.numero}`));
    for (const f of todasFacturas()) {
      if (!keys.has(`${f.clase}-${f.tipo}-${f.ptoVta}-${f.numero}`)) await cloud.pushFactura(f.record, PC).catch(() => {});
    }
    const cuits = new Set(cloudCli.map((c) => String(c.cuit)));
    for (const c of listarClientes()) {
      if (!cuits.has(c.cuit)) await cloud.pushCliente(c).catch(() => {});
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---- Pedidos de la tienda web ----

/** Lista los pedidos pagados que todavía no tienen factura. */
export async function pedidosPendientes() {
  try {
    const ped = await cloud.fetchPedidos();
    return ped.map((o) => ({
      id: o.id, numero: o.order_number, cliente: o.customer_name || "—",
      dni: o.customer_dni || "", total: (o.total_cents || 0) / 100,
      pago: o.payment_status || o.status || "", pagado: !!o.paid_at,
      fecha: (o.created_at || "").slice(0, 10),
    }));
  } catch { return []; }
}

/** Factura un pedido de la web (Factura B, consumidor final) y marca el CAE en el pedido. */
export async function facturarPedido(orderId) {
  const { order, items } = await cloud.getPedidoConItems(orderId);
  if (!order) throw new Error("Pedido no encontrado.");
  if (order.invoice_cae) throw new Error("Ese pedido ya está facturado.");
  const total = (order.total_cents || 0) / 100;
  if (total <= 0) throw new Error("El pedido no tiene importe.");

  // Detalle: si no hay descuento, una línea por producto + envío; si hay, una sola línea por el total.
  let lineas;
  if (!order.discount_cents && items.length) {
    lineas = items.map((it) => ({
      desc: it.product_name + (it.variant_sku ? ` (${it.variant_sku})` : ""),
      cantidad: it.quantity || 1,
      precioUnit: ((it.line_total_cents || 0) / 100) / (it.quantity || 1),
      unidad: "Unidades",
    }));
    if (order.shipping_cents > 0) lineas.push({ desc: "Envío", cantidad: 1, precioUnit: order.shipping_cents / 100, unidad: "Unidades" });
  } else {
    const nombres = items.map((it) => it.product_name).filter(Boolean).join(", ").slice(0, 120) || "Artículos de óptica";
    lineas = [{ desc: `Pedido web #${order.order_number} - ${nombres}`, cantidad: 1, precioUnit: total, unidad: "Unidades" }];
  }

  const res = await emitir({ receptorCond: "Consumidor Final", condVenta: "Otra", ptoVta: 7, items: lineas });
  if (res.ok) {
    const r = res.record;
    const comp = `Factura ${r.tipo} ${String(r.ptoVta).padStart(5, "0")}-${String(r.numero).padStart(8, "0")}`;
    await cloud.marcarPedidoFacturado(orderId, { invoice_id: comp, invoice_cae: r.cae }).catch(() => {});
  }
  return res;
}

// ---- Inicio: totales del día y del mes ----
function hoyYmd() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
const signo = (f) => (f.clase === "NC" ? -1 : 1); // las NC restan

export function resumenInicio() {
  const todas = todasFacturas();
  const hoy = hoyYmd();
  const mes = hoy.slice(0, 6);
  const neto = (arr) => arr.reduce((s, f) => s + signo(f) * (f.total || 0), 0);
  const cuenta = (arr) => arr.filter((f) => f.clase === "FACTURA").length;
  const deHoy = todas.filter((f) => f.fecha === hoy);
  const deMes = todas.filter((f) => (f.fecha || "").startsWith(mes));
  const ultimas = todas.slice(-6).reverse().map((f) => ({
    id: f.id, clase: f.clase, tipo: f.tipo, ptoVta: f.ptoVta, numero: f.numero, fecha: f.fecha, total: f.total, receptor: f.receptorNombre,
  }));
  return {
    hoy: { total: neto(deHoy), count: cuenta(deHoy) },
    mes: { total: neto(deMes), count: cuenta(deMes) },
    ultimas,
  };
}

// ---- Reportes ----
export function reporte({ desde, hasta } = {}) {
  const en = todasFacturas().filter((f) => (!desde || f.fecha >= desde) && (!hasta || f.fecha <= hasta));
  let neto = 0, iva = 0, total = 0;
  const filas = en.map((f) => {
    const imp = f.record?.importes || {};
    const sgn = signo(f);
    neto += sgn * (imp.neto || 0); iva += sgn * (imp.iva || 0); total += sgn * (f.total || 0);
    return { clase: f.clase, tipo: f.tipo, ptoVta: f.ptoVta, numero: f.numero, fecha: f.fecha, receptor: f.receptorNombre, neto: imp.neto || 0, iva: imp.iva || 0, total: f.total || 0, cae: f.cae };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { filas, totales: { neto, iva, total, count: en.length } };
}

const CLASE_TXT = { FACTURA: "Factura", NC: "Nota de Crédito", ND: "Nota de Débito" };
const numAr = (n) => Number(n || 0).toFixed(2).replace(".", ",");

/** Genera el CSV del reporte (separador ; y decimales con coma, para Excel ARG). */
export function reporteCSV(filtro) {
  const { filas, totales } = reporte(filtro);
  const fmtF = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  const head = ["Fecha", "Comprobante", "Pto Vta", "Número", "Cliente", "Neto", "IVA", "Total", "CAE"];
  const rows = filas.map((f) => [
    fmtF(f.fecha), `${CLASE_TXT[f.clase] || f.clase} ${f.tipo}`, String(f.ptoVta).padStart(5, "0"), String(f.numero).padStart(8, "0"),
    f.receptor, numAr(f.neto), numAr(f.iva), numAr(f.total), f.cae || "",
  ]);
  rows.push([]);
  rows.push(["", "", "", "", "TOTALES", numAr(totales.neto), numAr(totales.iva), numAr(totales.total), ""]);
  return [head, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
}

/** Genera el HTML de un comprobante guardado, por id. */
export async function comprobanteHTMLPorId(id, copias) {
  const row = getFactura(id);
  if (!row) throw new Error("Comprobante no encontrado: " + id);
  return comprobanteHTML(row.record, copias);
}

export { CbteTipo };
