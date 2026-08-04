// Sincronización con la nube (Supabase, proyecto Optica Carballo).
// Comparte clientes y facturas entre las computadoras de la óptica.
// La seguridad la da el login (RLS): la clave pública sola no accede a estos datos.

// Las credenciales NO van en el código: se leen de cloud-config.json (no se commitea;
// en el build lo crea GitHub Actions desde un "secreto"). Sin config, la nube queda desactivada.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// cloud-config.json trae SOLO datos públicos: url + anon key. La contraseña NO va acá.
let CONFIG = null;
try { CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, "cloud-config.json"), "utf-8")); } catch { CONFIG = null; }

// Credenciales (email/contraseña) POR COMPUTADORA: se guardan en la carpeta de datos del
// usuario (cloud-cred.json), NO viajan en el instalador. El engine define la ruta.
let CRED_PATH = null;
export function setCredPath(p) { CRED_PATH = p; }
function loadCred() {
  try { const c = JSON.parse(fs.readFileSync(CRED_PATH, "utf-8")); if (c && c.email && c.password) return c; } catch { /* no hay archivo */ }
  // Compatibilidad: si un cloud-config.json viejo todavía trae email/password, se usa (para no romper PCs no migradas).
  if (CONFIG && CONFIG.email && CONFIG.password) return { email: CONFIG.email, password: CONFIG.password };
  return null;
}
export function estadoCredenciales() {
  const c = loadCred();
  return { configurada: !!c, email: c?.email || "" };
}
export function guardarCredenciales({ email, password }) {
  if (!CRED_PATH) throw new Error("Ruta de credenciales no definida");
  fs.writeFileSync(CRED_PATH, JSON.stringify({ email: String(email || "").trim(), password: String(password || "") }, null, 2));
  token = null; // forzar re-login con las nuevas credenciales
}
export async function probarCredenciales({ email, password }) {
  if (!CONFIG) return { ok: false, error: "Falta la configuración de la nube (url/anon)" };
  try {
    const r = await fetch(`${CONFIG.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: CONFIG.anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(email || "").trim(), password }),
    });
    if (!r.ok) return { ok: false, error: r.status === 400 ? "Usuario o contraseña incorrectos" : "Error de conexión (" + r.status + ")" };
    return { ok: true };
  } catch (e) { return { ok: false, error: e?.message || String(e) }; }
}

let token = null;

async function signIn() {
  if (!CONFIG) throw new Error("Nube no configurada");
  const cred = loadCred();
  if (!cred) throw new Error("Nube sin credenciales en esta PC");
  const r = await fetch(`${CONFIG.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: CONFIG.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: cred.email, password: cred.password }),
  });
  if (!r.ok) throw new Error("Login a la nube falló: " + r.status);
  token = (await r.json()).access_token;
  return token;
}

async function req(path, opts = {}, reintentar = true) {
  if (!token) await signIn();
  const r = await fetch(`${CONFIG.url}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: CONFIG.anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (r.status === 401 && reintentar) { token = null; await signIn(); return req(path, opts, false); }
  return r;
}

export async function nubeDisponible() {
  try { await signIn(); return true; } catch { return false; }
}

export async function fetchClientes() {
  const r = await req("facturador_clientes?select=cuit,nombre,condicion,domicilio,actualizado_en");
  return r.ok ? r.json() : [];
}
export async function fetchFacturas() {
  const r = await req("facturador_facturas?select=*&order=id.asc");
  return r.ok ? r.json() : [];
}
export async function pushCliente(c) {
  const cuit = String(c.cuit || "").replace(/\D/g, "");
  if (!cuit) return;
  const r = await req("facturador_clientes", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ cuit, nombre: c.nombre || "", condicion: c.condicion || "", domicilio: c.domicilio || "", actualizado_en: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`pushCliente: la nube respondió ${r.status}`);
}
export async function deleteCliente(cuit) {
  const c = String(cuit || "").replace(/\D/g, "");
  if (c) await req(`facturador_clientes?cuit=eq.${c}`, { method: "DELETE" });
}
// ---- Pedidos de la tienda web ----
export async function fetchPedidos() {
  const sel = "id,order_number,status,payment_status,paid_at,customer_name,customer_dni,total_cents,created_at,invoice_cae";
  const r = await req(`orders?select=${sel}&invoice_cae=is.null&payment_status=eq.approved&status=neq.cancelled&order=created_at.desc&limit=100`);
  return r.ok ? r.json() : [];
}
export async function getPedidoConItems(id) {
  const r = await req(`orders?id=eq.${id}&select=*,order_items(*)`);
  const rows = r.ok ? await r.json() : [];
  const order = rows[0] || null;
  const items = order?.order_items || [];
  return { order, items };
}
export async function marcarPedidoFacturado(id, fields) {
  await req(`orders?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(fields) });
}

// ---- Token de ARCA compartido entre PCs ----
// El TA (token+sign) dura ~12h y ARCA da uno solo por certificado. Lo guardamos en
// la nube para que todas las PCs reusen el mismo y ninguna quede sin poder conectarse.
export async function fetchToken(service) {
  const r = await req(`facturador_token?service=eq.${encodeURIComponent(service)}&select=token,sign,expiration`);
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}
export async function saveToken(service, ticket, pc) {
  await req("facturador_token", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      service,
      token: ticket.token,
      sign: ticket.sign,
      expiration: new Date(ticket.expirationTime).toISOString(),
      updated_by: pc || null,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function pushFactura(rec, pc) {
  const r = await req("facturador_facturas", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({
      clase: rec.clase || "FACTURA", tipo: rec.tipo, pto_vta: rec.ptoVta, numero: rec.numero, fecha: rec.fecha,
      cae: rec.cae || null, receptor_nombre: rec.receptor?.nombre || "Consumidor Final",
      total: rec.importes?.total ?? 0, neto: rec.importes?.neto ?? null, iva: rec.importes?.iva ?? null,
      qr: rec.qr || null, data: rec, pc: pc || null,
    }),
  });
  if (!r.ok) throw new Error(`pushFactura: la nube respondió ${r.status}`);
}

// ---- Presupuestos (documentos no fiscales) ----
export async function fetchPresupuestos() {
  const r = await req("facturador_presupuestos?select=*&order=id.asc");
  return r.ok ? r.json() : [];
}
/** Sube/actualiza un presupuesto (upsert por uid: refleja también cambios de estado). */
export async function pushPresupuesto(rec, pc) {
  const r = await req("facturador_presupuestos", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      uid: rec.uid, numero: rec.numero, fecha: rec.fecha,
      receptor_nombre: rec.receptor?.nombre || "Consumidor Final",
      total: rec.importes?.total ?? 0, neto: rec.importes?.neto ?? null, iva: rec.importes?.iva ?? null,
      estado: rec.estado || "vigente", factura_id: rec.facturaId || null,
      data: rec, pc: pc || null, actualizado_en: new Date().toISOString(),
    }),
  });
  if (!r.ok) throw new Error(`pushPresupuesto: la nube respondió ${r.status}`);
}
export async function deletePresupuesto(uid) {
  if (uid) await req(`facturador_presupuestos?uid=eq.${encodeURIComponent(uid)}`, { method: "DELETE" });
}

// ---- Storage (archivos): bucket "sancor" ----
// Guarda preliquidaciones, facturas y fotos, compartidas entre PCs.
// Mismo login que el resto (usuario authenticated); credenciales en cloud-config.json.
const BUCKET = "sancor";
function encPath(objectPath) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}
async function storageFetch(pathAndQuery, opts = {}, reintentar = true) {
  if (!CONFIG) throw new Error("Nube no configurada");
  if (!token) await signIn();
  const r = await fetch(`${CONFIG.url}/storage/v1/${pathAndQuery}`, {
    ...opts,
    headers: { apikey: CONFIG.anon, Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (r.status === 401 && reintentar) { token = null; await signIn(); return storageFetch(pathAndQuery, opts, false); }
  return r;
}

/** Sube (o reemplaza) un archivo. objectPath ej: "2026/06/GRAV/archivo.pdf". */
export async function subirArchivo(objectPath, buffer, contentType) {
  if (!CONFIG) return { ok: false, error: "Nube no configurada" };
  try {
    const r = await storageFetch(`object/${BUCKET}/${encPath(objectPath)}`, {
      method: "POST",
      headers: { "Content-Type": contentType || "application/octet-stream", "x-upsert": "true" },
      body: buffer,
    });
    if (!r.ok) return { ok: false, error: `${r.status} ${await r.text().catch(() => "")}`.trim() };
    return { ok: true, path: objectPath };
  } catch (e) { return { ok: false, error: e?.message || String(e) }; }
}

/** Lista los archivos bajo un prefijo (un nivel). Devuelve [{name,...}]. */
export async function listarArchivos(prefix = "") {
  if (!CONFIG) return [];
  try {
    const r = await storageFetch(`object/list/${BUCKET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) return [];
    return (await r.json()).filter((o) => o && o.name && o.id !== null); // solo archivos (no subcarpetas)
  } catch { return []; }
}

/** Descarga un archivo como Buffer (o null si no está). */
export async function bajarArchivo(objectPath) {
  try {
    const r = await storageFetch(`object/${BUCKET}/${encPath(objectPath)}`, { method: "GET" });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}
