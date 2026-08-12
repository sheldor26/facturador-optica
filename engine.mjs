// Motor reutilizable del facturador (proceso Node / main de Electron).
// Envuelve ARCA + token persistente + fix TLS + plantilla de PDF en funciones limpias.
// Lo usan tanto los scripts de CLI como la app.

import "./arca-tls-fix.mjs"; // primero: arregla el TLS viejo de ARCA
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { Arca, CbteTipo, IvaTipo, DocTipo, CondicionIva, Concepto, Moneda } from "@ramiidv/arca-facturacion";
import { attachTokenPersistence, setTokensDir, saveTicket } from "./ta-store.mjs";
import { renderFacturaHTML, renderPresupuestoHTML, codigoComprobante } from "./factura-template.mjs";
import { initDb, guardarFactura, listarFacturas, getFactura, contarFacturas, todasFacturas, guardarCliente as dbGuardarCliente, listarClientes, eliminarCliente as dbEliminarCliente, mergeClientes, mergeFacturas,
  guardarPresupuesto, listarPresupuestos as dbListarPresupuestos, getPresupuesto, marcarPresupuestoFacturado, eliminarPresupuesto as dbEliminarPresupuesto, todosPresupuestos, mergePresupuestos, proximoNumeroPresupuesto,
  setFacturaPublicToken } from "./db.mjs";
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
  cloud.setCredPath(dp("cloud-cred.json")); // credenciales de la nube por PC (no viajan en el instalador)
  cloud.setTiendaCredPath(dp("tienda-cred.json")); // URL + secreto de la tienda online, por PC
}

// ---- Credenciales de la nube (por PC) ----
export function cloudEstadoCredenciales() { return cloud.estadoCredenciales(); }
export function cloudGuardarCredenciales(c) { cloud.guardarCredenciales(c); }
export function cloudProbarCredenciales(c) { return cloud.probarCredenciales(c); }

// ---- Tienda online: avisar por mail al facturar un pedido web (por PC) ----
export function tiendaEstadoCred() { return cloud.estadoTiendaCred(); }
export function tiendaGuardarCred(c) { cloud.guardarTiendaCred(c); }
export function tiendaNotificarFactura(orderId, invoiceUrl) { return cloud.notificarFacturaTienda(orderId, invoiceUrl); }

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
    // path.basename por las dudas: el IPC expuesto acepta cualquier string, y sin esto un
    // logoNombre con "../" escribiría fuera de la carpeta de datos.
    const safeLogo = path.basename(String(logoNombre));
    if (safeLogo && safeLogo !== "." && safeLogo !== "..") {
      fs.writeFileSync(dp(safeLogo), Buffer.from(logoBase64, "base64"));
      em.logo = safeLogo;
    }
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

// ===========================================================================
//  Token de ARCA: renovación automática + compartido por la nube
// ---------------------------------------------------------------------------
//  El TA (token de acceso) dura ~12h y ARCA entrega UNO solo por certificado.
//  Con varias PCs usando el mismo certificado, si cada una pide el suyo se chocan
//  ("ya posee un TA valido"). Solución: el TA vive en la nube; una PC lo renueva
//  y todas lo reusan. Un "keeper" lo mantiene fresco para no quedar nunca sin
//  poder conectarse a ARCA.
const SVC_WSFE = "wsfe";
const USABLE_MS = 3 * 60_000;       // un TA sirve si le quedan más de 3 min
const RENOVAR_ANTES_MS = 30 * 60_000; // empezar a renovar cuando faltan <30 min
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expMs = (t) => (t ? new Date(t.expirationTime).getTime() : 0);
const usable = (t) => expMs(t) - Date.now() > USABLE_MS;

/** Adopta el TA de la nube si es mejor (más nuevo) que el local. Devuelve el TA o null. */
async function adoptarDeNube(service) {
  try {
    const ct = await cloud.fetchToken(service);
    if (!ct) return null;
    const exp = new Date(ct.expiration).getTime();
    const local = getArca().wsaa.ticketCache.get(service);
    if (exp - Date.now() > USABLE_MS && exp > expMs(local)) {
      const ticket = { token: ct.token, sign: ct.sign, expirationTime: new Date(ct.expiration) };
      getArca().wsaa.ticketCache.set(service, ticket);
      saveTicket("prod", ticket, service);
      return ticket;
    }
  } catch { /* nube no disponible: seguimos con lo local */ }
  return null;
}

/** Fuerza un login nuevo en WSAA preservando el TA previo si falla. */
async function renovarLogin(service) {
  const wsaa = getArca().wsaa;
  const previo = wsaa.ticketCache.get(service);
  wsaa.clearTicket(service);
  try {
    return await wsaa.getAccessTicket(service); // dispara el login
  } catch (e) {
    if (previo) wsaa.ticketCache.set(service, previo); // no quedarse sin token
    throw e;
  }
}

/**
 * Garantiza un TA usable para `service`, coordinado por la nube. NUNCA tira si todavía
 * hay un token usable: prioriza no dejar a la PC sin conexión. Best-effort.
 */
export async function ensureTicket(service = SVC_WSFE) {
  if (!estaConfigurado()) return null;
  let local = getArca().wsaa.ticketCache.get(service);

  // 1) El local sirve y no está por vencer → listo (no molestamos a ARCA).
  if (usable(local) && expMs(local) - Date.now() > RENOVAR_ANTES_MS) return local;

  // 2) ¿La nube tiene uno más nuevo? (otra PC pudo haberlo renovado)
  const deNube = await adoptarDeNube(service);
  if (deNube && expMs(deNube) - Date.now() > RENOVAR_ANTES_MS) return deNube;
  local = getArca().wsaa.ticketCache.get(service);

  // 3) Hay que renovar. Login con reintentos. Si ARCA responde "ya posee un TA valido"
  //    es porque el actual sigue sirviendo → no es error, seguimos con ese.
  for (let intento = 0; intento < 4; intento++) {
    try {
      const t = await renovarLogin(service);
      await cloud.saveToken(service, t, PC).catch(() => {});
      return t;
    } catch (e) {
      const adoptado = await adoptarDeNube(service); // ¿otra PC ya publicó uno fresco?
      if (usable(adoptado)) return adoptado;
      if (/ya posee/i.test(e?.message || "") && usable(local)) return local;
      if (intento < 3) await sleep(2000 * (intento + 1));
      else if (usable(local)) return local; // último recurso: el que tengamos
      else throw e;
    }
  }
  return getArca().wsaa.ticketCache.get(service);
}

let _keeper = null;
/** Arranca el renovador automático en segundo plano (cada 5 min + al iniciar). */
export function iniciarRenovadorToken() {
  if (_keeper || !estaConfigurado()) return;
  const tick = () => { ensureTicket(SVC_WSFE).catch(() => {}); };
  tick();
  _keeper = setInterval(tick, 5 * 60_000);
  if (_keeper.unref) _keeper.unref();
}

/** Estado de los servidores de ARCA (no requiere auth). */
export async function serverStatus() {
  return getArca().serverStatus();
}

/** Próximo número disponible para un tipo de comprobante en un punto de venta. */
export async function proximoNumero(ptoVta, cbteTipo) {
  await ensureTicket().catch(() => {});
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
  await ensureTicket("ws_sr_constancia_inscripcion").catch(() => {});
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
  "Responsable Monotributo": { cond: CondicionIva.MONOTRIBUTISTA, a: false }, // sigue siendo Factura B (ver nota en emitir())

  "IVA Sujeto Exento": { cond: CondicionIva.EXENTO, a: false },
};

/** ¿El rechazo de ARCA fue por la condición de IVA del receptor (no por otra cosa, como un
 * ítem inválido o un problema de conexión)? Sirve para decidir si vale la pena reintentar
 * como Consumidor Final en vez de simplemente fallar. */
function esRechazoPorCondicionIva(observaciones) {
  return (observaciones || []).some((o) => /condicion.*iva/i.test(o.msg || ""));
}

/** Parsea el resultado crudo de FECAESolicitar (CAE, vencimiento, número, observaciones). */
function parseCAE(raw) {
  const arr = Array.isArray(raw.FeDetResp.FECAEDetResponse) ? raw.FeDetResp.FECAEDetResponse : [raw.FeDetResp.FECAEDetResponse];
  const det = arr[0];
  const aprobada = det.Resultado === "A";
  const observaciones = [];
  if (det.Observaciones) {
    const obs = Array.isArray(det.Observaciones.Obs) ? det.Observaciones.Obs : [det.Observaciones.Obs];
    for (const o of obs) observaciones.push({ code: o.Code, msg: o.Msg });
  }
  return { aprobada, cae: aprobada ? det.CAE : undefined, caeVencimiento: aprobada ? det.CAEFchVto : undefined, cbteNro: Number(det.CbteDesde), observaciones, raw };
}

/**
 * Construye las líneas a mostrar y los importes (neto/IVA/total) a partir de los
 * ítems ingresados (precio FINAL con IVA). Lo usan tanto la emisión como el presupuesto.
 */
function construirDetalle(items, tipo) {
  const display = [];
  let impTotalFinal = 0; // total = exactamente lo que ingresó el cliente (precio FINAL con IVA)
  for (const it of items) {
    if (it.nota) { display.push({ codigo: "-", desc: (it.desc || "").toUpperCase(), nota: true }); continue; } // línea sin valor (ej. N° afiliado)
    const cant = Number(it.cantidad);
    const precio = Number(it.precioUnit); // siempre se ingresa el precio FINAL (con IVA)
    const descPct = Math.min(Math.max(Number(it.descPct) || 0, 0), 100); // bonificación 0-100%
    const brutoFinal = cant * precio;
    const bonifFinal = round2((brutoFinal * descPct) / 100); // descuento en $ (con IVA)
    const netoFinalLinea = round2(brutoFinal - bonifFinal); // final con IVA, ya con descuento
    impTotalFinal = round2(impTotalFinal + netoFinalLinea);
    const unitNeto = round2(precio / (1 + RATE));
    const lineNeto = round2(netoFinalLinea / (1 + RATE));
    display.push({
      codigo: it.codigo || "-", desc: (it.desc || "").toUpperCase(), cantidad: cant,
      unidad: it.unidad || "Unidades", bonifPct: descPct,
      bonifImp: tipo === "A" ? round2((cant * unitNeto * descPct) / 100) : bonifFinal,
      precioUnit: tipo === "A" ? unitNeto : precio, // A muestra neto (discrimina IVA); B muestra final
      subtotal: tipo === "A" ? lineNeto : netoFinalLinea,
    });
  }
  const impNeto = round2(impTotalFinal / (1 + RATE));
  const impIVA = round2(impTotalFinal - impNeto);
  return { display, impTotalFinal, impNeto, impIVA };
}

/**
 * Emite un comprobante REAL por ARCA y lo guarda en la base local.
 * Para B el precio ingresado es FINAL (con IVA); para A es NETO (sin IVA).
 * Devuelve { ok, id, record, nombreArchivo } o { ok:false, observaciones }.
 */
export async function emitir({ receptorCond, docNro, nombre, domicilio, condVenta, items, ptoVta, origenPedidoId }) {
  await ensureTicket().catch(() => {});
  const map = COND_MAP[receptorCond] || COND_MAP["Consumidor Final"];
  const tipo = map.a ? "A" : "B";
  const cbteTipo = tipo === "A" ? CbteTipo.FACTURA_A : CbteTipo.FACTURA_B;
  // Un Responsable Monotributo se factura igual que Consumidor Final identificado (mismo
  // CondicionIVAReceptorId=5, misma identificación opcional por DNI/CUIT): confirmado contra
  // la tabla en vivo de ARCA (FEParamGetCondicionIvaReceptor) que el código de Monotributista
  // (6) NO es válido en Factura B — solo en A/C — y esta app siempre factura B a quien no sea
  // IVA Responsable Inscripto. Sin este ajuste, un cliente que el padrón identifica como
  // Monotributo (aunque tenga DNI/CUIT cargado) hace que ARCA rechace la factura con
  // "Condicion IVA receptor no es valido para la clase de comprobante informado".
  const esCF = receptorCond === "Consumidor Final" || receptorCond === "Responsable Monotributo";

  // Documento del receptor. Para Consumidor Final (y Monotributo, ver arriba) identificarlo
  // es OPCIONAL: si cargan DNI (7-8) o CUIT (11) la factura sale con sus datos; si no, sale
  // anónima.
  const digits = String(docNro || "").replace(/\D/g, "");
  let docTipo, docNroNum;
  if (!esCF) { docTipo = DocTipo.CUIT; docNroNum = Number(digits); }
  else if (/^\d{11}$/.test(digits)) { docTipo = DocTipo.CUIT; docNroNum = Number(digits); }
  else if (/^\d{7,8}$/.test(digits)) { docTipo = DocTipo.DNI; docNroNum = Number(digits); }
  else { docTipo = DocTipo.CONSUMIDOR_FINAL; docNroNum = 0; }
  const identificado = docNroNum > 0;

  // El IVA se deriva del total final para que NUNCA aparezca el centavo de más:
  // ImpNeto + ImpIVA == ImpTotal exacto. El IVA queda a <1 centavo del 21% (ARCA lo tolera).
  const { display, impTotalFinal, impNeto, impIVA } = construirDetalle(items, tipo);
  const condReceptorId = esCF ? CondicionIva.CONSUMIDOR_FINAL : map.cond;
  const now = new Date();
  const fecha = Arca.formatDate(now); // YYYYMMDD

  // Detalle WSFE con importes EXACTOS (ImpNeto + ImpIVA == ImpTotal). Una sola alícuota (21%).
  const detail = {
    Concepto: Concepto.PRODUCTOS,
    DocTipo: docTipo,
    DocNro: docNroNum,
    CbteFch: fecha,
    ImpTotal: impTotalFinal,
    ImpTotConc: 0,
    ImpNeto: impNeto,
    ImpOpEx: 0,
    ImpTrib: 0,
    ImpIVA: impIVA,
    MonId: Moneda.PESOS,
    MonCotiz: 1,
    CondicionIVAReceptorId: condReceptorId,
    Iva: [{ Id: IvaTipo.IVA_21, BaseImp: impNeto, Importe: impIVA }],
  };
  const result = parseCAE(await getArca().crearFacturaAuto(ptoVta, cbteTipo, detail));
  if (!result.aprobada) return { ok: false, observaciones: result.observaciones || [] };

  const numero = result.cbteNro;
  const iso = `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`;
  const qr = Arca.generateQRUrl({
    fecha: iso, cuit: Number(getEmisor().cuit), ptoVta, tipoCmp: cbteTipo, nroCmp: numero,
    importe: impTotalFinal, moneda: "PES", ctz: 1,
    tipoDocRec: docTipo, nroDocRec: docNroNum, codAut: Number(result.cae),
  });

  const record = {
    clase: "FACTURA", tipo, ptoVta, numero, fecha,
    cae: result.cae, caeVencimiento: result.caeVencimiento,
    receptor: {
      docLabel: docTipo === DocTipo.DNI ? "DNI" : "CUIT",
      docNro: identificado ? String(docNro) : "-",
      nombre: nombre || "Consumidor Final",
      condicion: receptorCond,
      domicilio: domicilio || "-",
      condVenta: condVenta || "Contado",
    },
    items: display,
    importes: { neto: impNeto, iva: impIVA, otrosTributos: 0, total: impTotalFinal },
    qr,
    raw: result.raw,
    ...(origenPedidoId ? { origenPedidoId } : {}),
  };
  if (identificado && nombre) guardarCliente({ cuit: docNroNum, nombre, condicion: receptorCond, domicilio });
  const id = Number(guardarFactura(record, now.toISOString()));
  cloud.pushFactura(record, PC).catch(() => {});
  return { ok: true, id, record, nombreArchivo: nombreArchivo(record) };
}

/**
 * Emite una Nota de Crédito (clase "NC") o Débito ("ND") asociada a una factura
 * ya emitida (por su id en la base). Toma cliente, ítems e importe de la original.
 */
export async function emitirNota({ clase, facturaId }) {
  await ensureTicket().catch(() => {});
  const row = getFactura(facturaId);
  if (!row) throw new Error("Comprobante original no encontrado.");
  const orig = row.record;
  if ((orig.clase || "FACTURA") !== "FACTURA") throw new Error("Solo se puede notar una factura.");

  const tipo = orig.tipo; // A | B
  const origCbteTipo = tipo === "A" ? CbteTipo.FACTURA_A : CbteTipo.FACTURA_B;
  const map = COND_MAP[orig.receptor?.condicion] || COND_MAP["Consumidor Final"];
  // Responsable Monotributo se factura (y se nota) como Consumidor Final — ver el comentario
  // largo en emitir(): ARCA no acepta el código de Monotributista en clase B/C-nota-de-B.
  const esMonotributoComoCF = orig.receptor?.condicion === "Responsable Monotributo";

  // Documento del receptor: copiado de la factura original tal cual quedó identificada
  // (CUIT, DNI, o anónima), no asumido por su condición de IVA — así una Factura B
  // identificada con DNI/CUIT no pierde esa identificación en la nota.
  const digitsOrig = String(orig.receptor?.docNro || "").replace(/\D/g, "");
  let docTipo, docNroNum;
  if (orig.receptor?.docLabel === "CUIT" && /^\d{11}$/.test(digitsOrig)) { docTipo = DocTipo.CUIT; docNroNum = Number(digitsOrig); }
  else if (orig.receptor?.docLabel === "DNI" && /^\d{7,8}$/.test(digitsOrig)) { docTipo = DocTipo.DNI; docNroNum = Number(digitsOrig); }
  else { docTipo = DocTipo.CONSUMIDOR_FINAL; docNroNum = 0; }

  // Reconstruir los ítems desde el `subtotal` YA calculado de cada línea (con el descuento/
  // bonificación aplicado), no desde `cantidad * precioUnit` en crudo — si no, una nota sobre
  // una factura con descuento sale por más plata de la que realmente se cobró.
  const lineItems = [];
  for (const it of orig.items || []) {
    if (it.nota) continue;
    const subtotal = Number(it.subtotal); // A: neto sin IVA · B: final con IVA — ambos con descuento ya aplicado
    lineItems.push({ neto: tipo === "B" ? round2(subtotal / (1 + RATE)) : subtotal, iva: IvaTipo.IVA_21 });
  }

  const opts = {
    ptoVta: orig.ptoVta, docTipo, docNro: docNroNum,
    condicionIva: esMonotributoComoCF ? CondicionIva.CONSUMIDOR_FINAL : map.cond,
    items: lineItems,
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

// ===========================================================================
//  Presupuestos (documentos NO fiscales: no se conectan a ARCA)
// ===========================================================================

/** Devuelve el data-URL del logo (el del usuario o el incluido en el programa), o null. */
function logoDataUrl() {
  const emisor = getEmisor();
  let logoPath = emisor.logo && fs.existsSync(dp(emisor.logo)) ? dp(emisor.logo) : null;
  if (!logoPath && fs.existsSync(path.join(ROOT, "assets", "logo.png"))) logoPath = path.join(ROOT, "assets", "logo.png");
  if (!logoPath) return null;
  const ext = path.extname(logoPath).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return `data:${mime};base64,${fs.readFileSync(logoPath).toString("base64")}`;
}

/**
 * Crea un presupuesto (NO fiscal) y lo guarda en la base local + nube.
 * Recibe los ítems ya limpios (precio FINAL con IVA), igual que `emitir`.
 * `validezDias` (opcional) calcula la fecha de vencimiento que figura en el PDF.
 */
export function crearPresupuesto({ receptorCond, docNro, nombre, domicilio, condVenta, items, validezDias = 0, observaciones = "", sinTotal = false }) {
  const digits = String(docNro || "").replace(/\D/g, "");
  const sinDatos = !digits && !(nombre || "").trim();
  const condEfectiva = (receptorCond === "Consumidor Final" || sinDatos) ? "Consumidor Final" : receptorCond;
  const map = COND_MAP[condEfectiva] || COND_MAP["Consumidor Final"];
  const tipo = map.a ? "A" : "B";

  let docLabel = "CUIT/DNI", docNroShow = "-";
  if (/^\d{11}$/.test(digits)) { docLabel = "CUIT"; docNroShow = String(docNro); }
  else if (/^\d{7,8}$/.test(digits)) { docLabel = "DNI"; docNroShow = String(docNro); }

  const { display, impTotalFinal, impNeto, impIVA } = construirDetalle(items, tipo);

  const now = new Date();
  const fecha = Arca.formatDate(now); // YYYYMMDD
  let vencimiento = null;
  const dias = Number(validezDias) || 0;
  if (dias > 0) vencimiento = Arca.formatDate(new Date(now.getTime() + dias * 86_400_000));

  const numero = proximoNumeroPresupuesto();
  const uid = `P-${PC}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;

  const record = {
    clase: "PRESUPUESTO", uid, tipo, numero, fecha, validezDias: dias, vencimiento,
    observaciones: (observaciones || "").trim(),
    sinTotal: !!sinTotal,
    receptor: {
      docLabel, docNro: docNroShow, nombre: nombre || "Consumidor Final",
      condicion: condEfectiva, domicilio: domicilio || "-", condVenta: condVenta || "Contado",
    },
    items: display,
    importes: { neto: impNeto, iva: impIVA, otrosTributos: 0, total: impTotalFinal },
    // Datos crudos para poder facturar el presupuesto tal cual fue cargado.
    emitirOpts: { receptorCond: condEfectiva, docNro, nombre, domicilio, condVenta, items },
    estado: "vigente", facturaId: null,
  };
  if (/^\d{11}$/.test(digits) && nombre) guardarCliente({ cuit: digits, nombre, condicion: condEfectiva, domicilio });
  const id = Number(guardarPresupuesto(record, now.toISOString()));
  cloud.pushPresupuesto(record, PC).catch(() => {});
  return { ok: true, id, record };
}

export function listarPresupuestos(q) { return dbListarPresupuestos({ q }); }
export { getPresupuesto };

/** Genera el HTML de un presupuesto (con logo embebido, sin QR ni CAE). */
export function presupuestoHTML(record, copias = ["ORIGINAL"]) {
  return renderPresupuestoHTML({ emisor: getEmisor(), f: record, logoDataUrl: logoDataUrl(), copias });
}
export function presupuestoHTMLPorId(id, copias) {
  const row = getPresupuesto(id);
  if (!row) throw new Error("Presupuesto no encontrado: " + id);
  return presupuestoHTML(row.record, copias);
}

/** Nombre de archivo del PDF del presupuesto. */
export function nombreArchivoPresupuesto(rec) {
  const cuit = String(getEmisor().cuit).replace(/\D/g, "");
  return `${cuit}_PRESUPUESTO_${String(rec.numero).padStart(8, "0")}.pdf`;
}

/**
 * Convierte un presupuesto en factura REAL por ARCA (usa sus ítems/cliente tal cual)
 * y lo marca como facturado. Devuelve el mismo resultado que `emitir`.
 */
export async function facturarPresupuesto(id) {
  const row = getPresupuesto(id);
  if (!row) throw new Error("Presupuesto no encontrado.");
  if (row.estado === "facturado") throw new Error("Ese presupuesto ya fue facturado.");
  const opts = row.record?.emitirOpts;
  if (!opts) throw new Error("El presupuesto no tiene datos para facturar.");
  const res = await emitir({ ...opts, ptoVta: opts.ptoVta || getPtoVta() });
  if (res.ok) {
    const r = res.record;
    const comp = `Factura ${r.tipo} ${String(r.ptoVta).padStart(5, "0")}-${String(r.numero).padStart(8, "0")}`;
    marcarPresupuestoFacturado(id, comp);
    const upd = getPresupuesto(id);
    if (upd) cloud.pushPresupuesto(upd.record, PC).catch(() => {});
  }
  return res;
}

/** Elimina un presupuesto (local + nube). */
export function eliminarPresupuesto(id) {
  const uid = dbEliminarPresupuesto(id);
  if (uid) cloud.deletePresupuesto(uid).catch(() => {});
  return true;
}

/** Genera el HTML de un comprobante (con QR y logo embebidos). */
export async function comprobanteHTML(record, copias) {
  const emisor = getEmisor();
  let logoDataUrl = null;
  // 1) logo cargado por el usuario en esta PC; 2) si no hay, el logo incluido en el programa.
  let logoPath = emisor.logo && fs.existsSync(dp(emisor.logo)) ? dp(emisor.logo) : null;
  if (!logoPath && fs.existsSync(path.join(ROOT, "assets", "logo.png"))) logoPath = path.join(ROOT, "assets", "logo.png");
  if (logoPath) {
    const ext = path.extname(logoPath).slice(1).toLowerCase();
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    logoDataUrl = `data:${mime};base64,${fs.readFileSync(logoPath).toString("base64")}`;
  }
  const qrDataUrl = await QRCode.toDataURL(record.qr, { margin: 0, width: 240 });
  return renderFacturaHTML({ emisor, f: record, qrDataUrl, logoDataUrl, copias });
}

// ---- Configuración de la app (carpeta de guardado, etc.) ----

// Catálogo rápido de lentes (Presupuestos): precios editables desde la app (Presupuestos →
// "Editar catálogo"), sin tocar código. Guardado en config.json, por PC (no viaja por la nube).
//  - pares: mismo cristal en los dos ojos (precio del par).
//  - porLente: precio YA por lente (ej. Rango Extendido): no se divide a la mitad.
//  - extras: adicionales de una sola fila (Antirreflex, armazones, etc.).
const CATALOGO_LENTES_DEFAULT = {
  pares: [
    { id: "organico-blanco", label: "Orgánico Blanco stock", precio: 40000 },
    { id: "bluecut-ar", label: "Bluecut con AR stock", precio: 50000 },
    { id: "fotocromatico-ar", label: "Fotocromático con AR", precio: 80000 },
    { id: "fotocromatico-bluecut-ar", label: "Fotocromático Bluecut con AR", precio: 100000 },
    { id: "bifocal-blanco", label: "Bifocal Blanco", precio: 70000 },
    { id: "bifocal-bluecut", label: "Bifocal Bluecut", precio: 100000 },
    { id: "bifocal-fotocromatico", label: "Bifocal Fotocromático", precio: 130000 },
    { id: "bifocal-fotocromatico-bluecut", label: "Bifocal Fotocromático Bluecut", precio: 160000 },
  ],
  porLente: [
    { id: "rext-blanco", label: "R. Extendido Blanco", precio: 25000 },
    { id: "rext-bluecut-ar", label: "R. Extendido Bluecut con AR", precio: 35000 },
  ],
  extras: [
    { id: "antirreflex", label: "Antirreflex", precio: 30000 },
  ],
};

const CONFIG_DEFAULT = { carpetaFacturas: "", preguntarDonde: false, autoImprimir: true, impresora: "", dialogoImpresion: false, ptoVta: 7, catalogoLentes: CATALOGO_LENTES_DEFAULT };
/** Punto de venta configurado (por defecto 7). */
export function getPtoVta() { return Number(_config?.ptoVta) || 7; }
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

/**
 * Nombre de archivo a usar en el bucket PÚBLICO (link "Ver factura"/compartir). A diferencia
 * de `nombreArchivo()` (CUIT+número, perfecto para la carpeta local del usuario), acá no puede
 * ser adivinable: cualquiera con un solo link podría ir cambiando el número y bajarse todas las
 * demás facturas. Genera un token random la primera vez y lo reusa siempre para ese comprobante
 * (mismo link si se vuelve a compartir, no un archivo nuevo cada vez).
 */
export function nombreArchivoPublico(id) {
  const row = getFactura(id);
  if (!row) throw new Error("Comprobante no encontrado.");
  let token = row.record.publicToken;
  if (!token) { token = randomUUID(); setFacturaPublicToken(id, token); }
  return `${token}.pdf`;
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
  backupDatos(); // resguardo diario de la base local
  iniciarRenovadorToken(); // mantiene el token de ARCA fresco y compartido
}

/** Ruta del archivo de base local (datos.json). */
export function rutaDatos() { return dp("datos.json"); }

/**
 * Copia de seguridad diaria de datos.json a la carpeta backups/ (una por día,
 * conserva las últimas 7). Best-effort: nunca interrumpe el arranque.
 */
export function backupDatos() {
  try {
    const src = dp("datos.json");
    if (!fs.existsSync(src)) return;
    const dir = dp("backups");
    fs.mkdirSync(dir, { recursive: true });
    const hoy = new Date().toISOString().slice(0, 10);
    const dest = path.join(dir, `datos-${hoy}.json`);
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest); // una copia por día
    const files = fs.readdirSync(dir).filter((f) => /^datos-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (files.length > 7) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch { /* ignora */ } }
  } catch { /* backup best-effort */ }
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

let _ultimaSync = null; // { at, ok, offline, subidas, fallidas, bajadas, error }
/** Último resultado de sincronización (para el indicador de la interfaz). */
export function estadoSync() { return _ultimaSync; }

/** Sincroniza con la nube: baja todo lo de las otras PCs y sube lo local que falte. */
export async function sincronizarNube() {
  let res;
  try {
    if (!(await cloud.nubeDisponible())) { res = { ok: false, offline: true }; _ultimaSync = { at: Date.now(), ...res }; return res; }
    const [cloudFac, cloudCli, cloudPre] = await Promise.all([cloud.fetchFacturas(), cloud.fetchClientes(), cloud.fetchPresupuestos().catch(() => [])]);
    const bajFac = mergeFacturas(cloudFac) || 0;
    mergeClientes(cloudCli);
    const bajPre = mergePresupuestos(cloudPre) || 0;
    // Solo cuenta como "subida" la que realmente resolvió ok — antes se contaba igual
    // aunque la nube la rechazara o fallara la conexión, y el indicador mentía.
    let subidas = 0, fallidas = 0;
    async function push(fn) {
      try { await fn(); subidas++; } catch { fallidas++; }
    }
    const keys = new Set(cloudFac.map((r) => `${r.clase}-${r.tipo}-${r.pto_vta}-${r.numero}`));
    for (const f of todasFacturas()) {
      if (!keys.has(`${f.clase}-${f.tipo}-${f.ptoVta}-${f.numero}`)) await push(() => cloud.pushFactura(f.record, PC));
    }
    const cuits = new Set(cloudCli.map((c) => String(c.cuit)));
    for (const c of listarClientes()) {
      if (!cuits.has(c.cuit)) await push(() => cloud.pushCliente(c));
    }
    // Presupuestos: subir los locales que la nube no tenga (o que cambiaron de estado).
    const preCloud = new Map(cloudPre.map((r) => [r.uid, r]));
    for (const p of todosPresupuestos()) {
      const enNube = preCloud.get(p.uid);
      if (!enNube || (p.estado === "facturado" && enNube.estado !== "facturado")) {
        await push(() => cloud.pushPresupuesto(p.record, PC));
      }
    }
    res = { ok: true, subidas, fallidas, bajadas: bajFac + bajPre };
    _ultimaSync = { at: Date.now(), ...res };
    return res;
  } catch (e) { res = { ok: false, error: e.message }; _ultimaSync = { at: Date.now(), ...res }; return res; }
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

/** Arma las líneas de factura de un pedido: una por producto + envío, o una sola por el total si hay descuento. */
function lineasDePedido(order, items) {
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
    lineas = [{ desc: `Pedido web #${order.order_number} - ${nombres}`, cantidad: 1, precioUnit: (order.total_cents || 0) / 100, unidad: "Unidades" }];
  }
  return lineas;
}

/**
 * Resuelve el comprador de un pedido: por padrón si el DNI matchea a una sola persona, o
 * devuelve `opciones` para elegir si matchea a varias. Si no hay DNI cargado, no matchea a
 * nadie, o falla la consulta a ARCA (offline, etc.), NUNCA deja el comprador en blanco: cae
 * a los datos que la persona ya puso al comprar en la web (nombre + DNI), como Consumidor
 * Final identificado — antes en cualquiera de esos casos la factura salía sin nombre ni nada.
 */
async function resolverReceptorPedido(order) {
  const fallback = {
    receptorCond: "Consumidor Final",
    docNro: String(order.customer_dni || "").replace(/\D/g, ""),
    nombre: order.customer_name || "",
    domicilio: "",
  };
  if (!order.customer_dni) return { receptor: fallback, opciones: null };
  try {
    const { personas } = await consultarPadron(order.customer_dni);
    if (personas.length === 1) {
      const p = personas[0];
      return { receptor: { receptorCond: p.condicion, docNro: String(p.cuit), nombre: p.nombre, domicilio: p.domicilio }, opciones: null };
    }
    if (personas.length > 1) return { receptor: fallback, opciones: personas }; // que elija quien factura
    return { receptor: fallback, opciones: null }; // DNI válido pero sin match en el padrón
  } catch {
    return { receptor: fallback, opciones: null }; // ARCA caída o lo que sea: no se pierde el nombre
  }
}

/**
 * Detalle de un pedido antes de facturarlo: los ítems tal cual van a quedar en la factura,
 * y el comprador resuelto por padrón (o la lista de personas para elegir, si el DNI da varias).
 */
export async function detallePedido(orderId) {
  const { order, items } = await cloud.getPedidoConItems(orderId);
  if (!order) throw new Error("Pedido no encontrado.");
  const lineas = lineasDePedido(order, items);
  const { receptor, opciones } = await resolverReceptorPedido(order);
  return { items: lineas, receptor, opciones, total: (order.total_cents || 0) / 100 };
}

/** Busca si ya se emitió acá una factura para este pedido (por `orderId`), sin depender de que
 * la nube lo confirme. Es el resguardo local para no volver a facturar un pedido dos veces si
 * en su momento falló avisarle a la tienda (ver `facturarPedido`). */
export function facturaPorPedido(orderId) {
  return todasFacturas().find((f) => f.record?.origenPedidoId === orderId) || null;
}

/**
 * Factura un pedido de la web y marca el CAE en el pedido. `receptor`, si viene (ya sea el
 * sugerido por `detallePedido` o el elegido a mano cuando había varias personas con el mismo
 * DNI), se usa tal cual y no se vuelve a consultar el padrón.
 */
export async function facturarPedido(orderId, receptor) {
  const { order, items } = await cloud.getPedidoConItems(orderId);
  if (!order) throw new Error("Pedido no encontrado.");
  if (order.invoice_cae) throw new Error("Ese pedido ya está facturado.");

  // Resguardo local: si ya se emitió una factura acá para este pedido pero no se pudo avisar
  // a la tienda (ej. se cortó internet justo después), no facturar de nuevo — reintentar solo
  // el aviso con la factura que ya existe. Sin esto, el pedido seguiría figurando "pendiente"
  // en la tienda para siempre y se podría terminar emitiendo una segunda factura real por él.
  const yaFacturado = facturaPorPedido(orderId);
  if (yaFacturado) {
    const r = yaFacturado.record;
    const comp = `Factura ${r.tipo} ${String(r.ptoVta).padStart(5, "0")}-${String(r.numero).padStart(8, "0")}`;
    await cloud.marcarPedidoFacturado(orderId, { invoice_id: comp, invoice_cae: r.cae }).catch(() => {});
    return { ok: true, id: yaFacturado.id, record: r, nombreArchivo: nombreArchivo(r), yaExistia: true };
  }

  const total = (order.total_cents || 0) / 100;
  if (total <= 0) throw new Error("El pedido no tiene importe.");

  const lineas = lineasDePedido(order, items);
  const receptorFinal = receptor || (await resolverReceptorPedido(order)).receptor;

  let res = await emitir({ ...receptorFinal, condVenta: "Otra", ptoVta: getPtoVta(), items: lineas, origenPedidoId: orderId });
  // Si ARCA rechaza puntualmente la condición de IVA del receptor identificado (pasa cuando
  // el padrón devuelve una condición que ARCA dejó de aceptar para esta clase de comprobante,
  // como pasó con Responsable Monotributo — ver Auditoria-Facturador.md), no dejar el pedido
  // sin facturar: reintentar como Consumidor Final, conservando nombre/documento si los había.
  if (!res.ok && receptorFinal.receptorCond !== "Consumidor Final" && esRechazoPorCondicionIva(res.observaciones)) {
    res = await emitir({ ...receptorFinal, receptorCond: "Consumidor Final", condVenta: "Otra", ptoVta: getPtoVta(), items: lineas, origenPedidoId: orderId });
    if (res.ok) res.corregidoAConsumidorFinal = true;
  }
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
  // Presupuestos vigentes (no facturados): cantidad y monto, para tenerlos a la vista.
  const presup = todosPresupuestos();
  const vigentes = presup.filter((p) => p.estado !== "facturado");
  return {
    hoy: { total: neto(deHoy), count: cuenta(deHoy) },
    mes: { total: neto(deMes), count: cuenta(deMes) },
    presupuestos: {
      vigentesCount: vigentes.length,
      vigentesTotal: vigentes.reduce((s, p) => s + (p.total || 0), 0),
      mesCount: presup.filter((p) => (p.fecha || "").startsWith(mes)).length,
    },
    ultimas,
  };
}

// ---- Dashboard: métricas ampliadas ----
const MES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export function metricasDashboard() {
  const todas = todasFacturas();
  const ahora = new Date();
  // Serie de los últimos 6 meses (total neto de facturación e IVA).
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    const arr = todas.filter((f) => (f.fecha || "").startsWith(ym));
    meses.push({
      ym, etiqueta: MES_CORTO[d.getMonth()],
      total: arr.reduce((s, f) => s + signo(f) * (f.total || 0), 0),
      iva: arr.reduce((s, f) => s + signo(f) * (f.record?.importes?.iva || 0), 0),
      count: arr.filter((f) => f.clase === "FACTURA").length,
    });
  }
  // Top clientes de los últimos 12 meses (sin Consumidor Final).
  const d12 = new Date(ahora.getFullYear(), ahora.getMonth() - 11, 1);
  const ymDesde = `${d12.getFullYear()}${String(d12.getMonth() + 1).padStart(2, "0")}00`;
  const porCliente = {};
  for (const f of todas) {
    if ((f.fecha || "") < ymDesde) continue;
    const nom = f.receptorNombre || "Consumidor Final";
    if (nom === "Consumidor Final") continue;
    porCliente[nom] = (porCliente[nom] || 0) + signo(f) * (f.total || 0);
  }
  const topClientes = Object.entries(porCliente)
    .map(([nombre, total]) => ({ nombre, total })).filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total).slice(0, 5);
  // Composición A vs B del mes actual.
  const ymMes = meses[meses.length - 1].ym;
  const delMes = todas.filter((f) => (f.fecha || "").startsWith(ymMes) && f.clase === "FACTURA");
  return {
    meses,
    topClientes,
    mesActual: meses[meses.length - 1],
    mesAnterior: meses[meses.length - 2],
    composicion: { A: delMes.filter((f) => f.tipo === "A").length, B: delMes.filter((f) => f.tipo === "B").length },
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

  // Presupuestos del período (sección aparte: NO son comprobantes fiscales).
  const enP = todosPresupuestos().filter((p) => (!desde || p.fecha >= desde) && (!hasta || p.fecha <= hasta));
  let presupTotal = 0;
  const presupuestos = enP.map((p) => {
    presupTotal += p.total || 0;
    return { numero: p.numero, fecha: p.fecha, receptor: p.receptorNombre, total: p.total || 0, estado: p.estado || "vigente", facturaId: p.facturaId || null };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha));

  return {
    filas, totales: { neto, iva, total, count: en.length },
    presupuestos, presupTotales: { total: presupTotal, count: enP.length },
  };
}

const CLASE_TXT = { FACTURA: "Factura", NC: "Nota de Crédito", ND: "Nota de Débito" };
const numAr = (n) => Number(n || 0).toFixed(2).replace(".", ",");

/** Genera el CSV del reporte (separador ; y decimales con coma, para Excel ARG). */
export function reporteCSV(filtro) {
  const { filas, totales, presupuestos, presupTotales } = reporte(filtro);
  const fmtF = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  const head = ["Fecha", "Comprobante", "Pto Vta", "Número", "Cliente", "Neto", "IVA", "Total", "CAE"];
  const rows = filas.map((f) => [
    fmtF(f.fecha), `${CLASE_TXT[f.clase] || f.clase} ${f.tipo}`, String(f.ptoVta).padStart(5, "0"), String(f.numero).padStart(8, "0"),
    f.receptor, numAr(f.neto), numAr(f.iva), numAr(f.total), f.cae || "",
  ]);
  rows.push([]);
  rows.push(["", "", "", "", "TOTALES", numAr(totales.neto), numAr(totales.iva), numAr(totales.total), ""]);

  // Sección aparte: presupuestos (no fiscales).
  if (presupuestos && presupuestos.length) {
    rows.push([]);
    rows.push(["PRESUPUESTOS (no fiscales)"]);
    rows.push(["Fecha", "Número", "Cliente", "Total", "Estado", "Facturado como", "", "", ""]);
    for (const p of presupuestos) {
      rows.push([fmtF(p.fecha), String(p.numero).padStart(8, "0"), p.receptor, numAr(p.total), p.estado === "facturado" ? "Facturado" : "Vigente", p.facturaId || "", "", "", ""]);
    }
    rows.push(["", "", "TOTAL PRESUPUESTOS", numAr(presupTotales.total), `${presupTotales.count} presup.`, "", "", "", ""]);
  }
  return [head, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
}

/** Genera el HTML de un comprobante guardado, por id. */
export async function comprobanteHTMLPorId(id, copias) {
  const row = getFactura(id);
  if (!row) throw new Error("Comprobante no encontrado: " + id);
  return comprobanteHTML(row.record, copias);
}

export { CbteTipo };
