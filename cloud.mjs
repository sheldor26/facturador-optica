// Sincronización con la nube (Supabase, proyecto Optica Carballo).
// Comparte clientes y facturas entre las computadoras de la óptica.
// La seguridad la da el login (RLS): la clave pública sola no accede a estos datos.

// Las credenciales NO van en el código: se leen de cloud-config.json (no se commitea;
// en el build lo crea GitHub Actions desde un "secreto"). Sin config, la nube queda desactivada.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let CONFIG = null;
try { CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, "cloud-config.json"), "utf-8")); } catch { CONFIG = null; }

let token = null;

async function signIn() {
  if (!CONFIG) throw new Error("Nube no configurada");
  const r = await fetch(`${CONFIG.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: CONFIG.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: CONFIG.email, password: CONFIG.password }),
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
  const r = await req("facturador_clientes?select=cuit,nombre,condicion,domicilio");
  return r.ok ? r.json() : [];
}
export async function fetchFacturas() {
  const r = await req("facturador_facturas?select=*&order=id.asc");
  return r.ok ? r.json() : [];
}
export async function pushCliente(c) {
  const cuit = String(c.cuit || "").replace(/\D/g, "");
  if (!cuit) return;
  await req("facturador_clientes", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ cuit, nombre: c.nombre || "", condicion: c.condicion || "", domicilio: c.domicilio || "", actualizado_en: new Date().toISOString() }),
  });
}
export async function deleteCliente(cuit) {
  const c = String(cuit || "").replace(/\D/g, "");
  if (c) await req(`facturador_clientes?cuit=eq.${c}`, { method: "DELETE" });
}
// ---- Pedidos de la tienda web ----
export async function fetchPedidos() {
  const sel = "id,order_number,status,payment_status,paid_at,customer_name,customer_dni,total_cents,created_at,invoice_cae";
  const r = await req(`orders?select=${sel}&invoice_cae=is.null&payment_status=eq.approved&order=created_at.desc&limit=100`);
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

export async function pushFactura(rec, pc) {
  await req("facturador_facturas", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({
      clase: rec.clase || "FACTURA", tipo: rec.tipo, pto_vta: rec.ptoVta, numero: rec.numero, fecha: rec.fecha,
      cae: rec.cae || null, receptor_nombre: rec.receptor?.nombre || "Consumidor Final",
      total: rec.importes?.total ?? 0, neto: rec.importes?.neto ?? null, iva: rec.importes?.iva ?? null,
      qr: rec.qr || null, data: rec, pc: pc || null,
    }),
  });
}
