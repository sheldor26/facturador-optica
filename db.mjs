// Base de datos local del facturador en un archivo JSON (sin módulos nativos,
// así el programa se empaqueta para Windows/Mac sin problemas).
// Para el volumen de una óptica (miles de comprobantes) va sobrado.

import fs from "node:fs";

let FILE;
let data; // { seq: number, facturas: [...] }

export function initDb(file) {
  FILE = file;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!data.facturas) data = { seq: 0, facturas: [] };
  } catch {
    data = { seq: 0, facturas: [] };
  }
  if (!data.clientes) data.clientes = [];
  if (!data.presupuestos) data.presupuestos = [];
  if (typeof data.pseq !== "number") data.pseq = 0;
  return data;
}

/** Devuelve todas las facturas con su registro completo (para reportes/totales). */
export function todasFacturas() {
  return data.facturas;
}

/** Guarda/actualiza un cliente por CUIT. */
export function guardarCliente(c) {
  if (!c || !c.cuit) return;
  const cuit = String(c.cuit).replace(/\D/g, "");
  if (!cuit) return;
  const idx = data.clientes.findIndex((x) => x.cuit === cuit);
  const reg = { cuit, nombre: c.nombre || "", condicion: c.condicion || "", domicilio: c.domicilio || "", actualizado: new Date().toISOString() };
  if (idx >= 0) data.clientes[idx] = reg;
  else data.clientes.push(reg);
  guardar();
}

/** Elimina un cliente por CUIT. */
export function eliminarCliente(cuit) {
  const c = String(cuit).replace(/\D/g, "");
  const antes = data.clientes.length;
  data.clientes = data.clientes.filter((x) => x.cuit !== c);
  if (data.clientes.length !== antes) guardar();
}

/** Lista clientes guardados (con búsqueda opcional por nombre o CUIT). */
export function listarClientes(q = "") {
  let arr = data.clientes;
  if (q) {
    const s = String(q).toLowerCase();
    arr = arr.filter((c) => (c.nombre || "").toLowerCase().includes(s) || c.cuit.includes(s));
  }
  return arr.slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
}

function guardar() {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE); // escritura atómica
}

/** Guarda (o ignora si ya existe) un comprobante. Devuelve el id. */
export function guardarFactura(rec, creadoEn) {
  const clase = rec.clase || "FACTURA";
  const key = `${clase}-${rec.tipo}-${rec.ptoVta}-${rec.numero}`;
  if (data.facturas.some((f) => f.key === key)) return 0; // ya existe
  const id = ++data.seq;
  data.facturas.push({
    id, key, clase, tipo: rec.tipo || "B",
    ptoVta: rec.ptoVta, numero: rec.numero, fecha: rec.fecha,
    cae: rec.cae || null, receptorNombre: rec.receptor?.nombre || "Consumidor Final",
    total: rec.importes?.total ?? 0, creadoEn, record: rec,
  });
  guardar();
  return id;
}

/** Lista comprobantes (más nuevos primero), con búsqueda opcional. */
export function listarFacturas({ q = "", limit = 200 } = {}) {
  let arr = data.facturas;
  if (q) {
    const s = String(q).toLowerCase();
    arr = arr.filter((f) =>
      (f.receptorNombre || "").toLowerCase().includes(s) ||
      String(f.numero).includes(s) ||
      (f.cae || "").includes(s));
  }
  return arr.slice().reverse().slice(0, limit).map((f) => ({
    id: f.id, clase: f.clase, tipo: f.tipo, pto_vta: f.ptoVta, numero: f.numero,
    fecha: f.fecha, total: f.total, receptor_nombre: f.receptorNombre, cae: f.cae,
  }));
}

/** Trae el comprobante completo (con su JSON) por id. */
export function getFactura(id) {
  const f = data.facturas.find((x) => x.id === id);
  return f ? { ...f, record: f.record } : null;
}

/** Guarda el token público (link "Ver factura") de un comprobante ya emitido. */
export function setFacturaPublicToken(id, token) {
  const f = data.facturas.find((x) => x.id === id);
  if (!f) return null;
  f.record.publicToken = token;
  guardar();
  return token;
}

export function contarFacturas() {
  return data.facturas.length;
}

/** Mezcla clientes de la nube: gana el más reciente (last-write-wins por fecha). */
export function mergeClientes(arr) {
  let cambios = 0;
  for (const c of arr || []) {
    const cuit = String(c.cuit).replace(/\D/g, "");
    if (!cuit) continue;
    const i = data.clientes.findIndex((x) => x.cuit === cuit);
    // Borrado en otra PC (o en esta, antes de que sincronizara): sacarlo también acá.
    // Sin esto, una PC con una copia vieja lo volvía a subir en su próximo sync y "resucitaba".
    if (c.eliminado_en) {
      if (i >= 0) { data.clientes.splice(i, 1); cambios++; }
      continue;
    }
    const tsNube = c.actualizado_en || c.actualizado || "";
    const reg = { cuit, nombre: c.nombre || "", condicion: c.condicion || "", domicilio: c.domicilio || "", actualizado: tsNube || new Date().toISOString() };
    if (i < 0) { data.clientes.push(reg); cambios++; continue; }
    const tsLocal = data.clientes[i].actualizado || "";
    // Solo pisar si la versión de la nube es más nueva (o si local no tiene fecha).
    if (!tsLocal || (tsNube && tsNube > tsLocal)) { data.clientes[i] = reg; cambios++; }
  }
  if (cambios) guardar();
  return cambios;
}

// ===========================================================================
//  Presupuestos (documentos NO fiscales: no van a ARCA, sin CAE ni QR)
// ---------------------------------------------------------------------------
//  Cada presupuesto lleva un `uid` único (estable entre PCs) que sirve de clave
//  para no duplicarlo al sincronizar por la nube. El `numero` es solo una
//  etiqueta correlativa local para que el cliente lo identifique.

/** Próximo número de presupuesto, mayor que cualquiera ya conocido (local o de la nube). */
export function proximoNumeroPresupuesto() {
  const max = data.presupuestos.reduce((m, p) => Math.max(m, Number(p.numero) || 0), 0);
  return Math.max(max, data.pseq) + 1;
}

/** Guarda un presupuesto nuevo (o lo ignora si su uid ya existe). Devuelve el id local. */
export function guardarPresupuesto(rec, creadoEn) {
  if (data.presupuestos.some((p) => p.uid === rec.uid)) return 0; // ya existe
  const id = ++data.seq;
  if (Number(rec.numero) > data.pseq) data.pseq = Number(rec.numero);
  data.presupuestos.push({
    id, uid: rec.uid, numero: rec.numero, fecha: rec.fecha,
    receptorNombre: rec.receptor?.nombre || "Consumidor Final",
    total: rec.importes?.total ?? 0,
    estado: rec.estado || "vigente", facturaId: rec.facturaId || null,
    creadoEn, record: rec,
  });
  guardar();
  return id;
}

/** Lista presupuestos (más nuevos primero), con búsqueda opcional. */
export function listarPresupuestos({ q = "", limit = 200 } = {}) {
  let arr = data.presupuestos;
  if (q) {
    const s = String(q).toLowerCase();
    arr = arr.filter((p) =>
      (p.receptorNombre || "").toLowerCase().includes(s) ||
      String(p.numero).includes(s));
  }
  return arr.slice().reverse().slice(0, limit).map((p) => ({
    id: p.id, uid: p.uid, numero: p.numero, fecha: p.fecha, total: p.total,
    receptor_nombre: p.receptorNombre, estado: p.estado, factura_id: p.facturaId,
    vencimiento: p.record?.vencimiento || null,
    sinTotal: !!p.record?.sinTotal,
  }));
}

/** Trae el presupuesto completo (con su JSON) por id. */
export function getPresupuesto(id) {
  const p = data.presupuestos.find((x) => x.id === id);
  return p ? { ...p, record: p.record } : null;
}

/** Marca un presupuesto como facturado (guarda el comprobante asociado). */
export function marcarPresupuestoFacturado(id, facturaId) {
  const p = data.presupuestos.find((x) => x.id === id);
  if (!p) return null;
  p.estado = "facturado";
  p.facturaId = facturaId || null;
  if (p.record) { p.record.estado = "facturado"; p.record.facturaId = facturaId || null; }
  guardar();
  return p;
}

/** Elimina un presupuesto por id. Devuelve su uid (para borrarlo también en la nube). */
export function eliminarPresupuesto(id) {
  const p = data.presupuestos.find((x) => x.id === id);
  if (!p) return null;
  data.presupuestos = data.presupuestos.filter((x) => x.id !== id);
  guardar();
  return p.uid;
}

export function todosPresupuestos() {
  return data.presupuestos;
}

/** Mezcla presupuestos que vienen de la nube (los que no estén ya local, por uid). */
export function mergePresupuestos(arr) {
  let cambios = 0;
  for (const row of arr || []) {
    const rec = row.data;
    if (!rec || !rec.uid) continue;
    const existente = data.presupuestos.find((p) => p.uid === rec.uid);
    // Borrado en otra PC: sacarlo también acá en vez de dejarlo (o de volver a subirlo
    // en el próximo sync porque localmente "no está borrado en la nube").
    if (row.eliminado_en) {
      if (existente) { data.presupuestos = data.presupuestos.filter((p) => p.uid !== rec.uid); cambios++; }
      continue;
    }
    if (existente) {
      // Si en la nube ya está facturado y local no, actualizamos el estado.
      if (rec.estado === "facturado" && existente.estado !== "facturado") {
        existente.estado = "facturado";
        existente.facturaId = rec.facturaId || row.factura_id || null;
        if (existente.record) { existente.record.estado = "facturado"; existente.record.facturaId = existente.facturaId; }
        cambios++;
      }
      continue;
    }
    const id = ++data.seq;
    if (Number(rec.numero) > data.pseq) data.pseq = Number(rec.numero);
    data.presupuestos.push({
      id, uid: rec.uid, numero: rec.numero, fecha: rec.fecha,
      receptorNombre: rec.receptor?.nombre || "Consumidor Final",
      total: rec.importes?.total ?? 0,
      estado: rec.estado || "vigente", facturaId: rec.facturaId || row.factura_id || null,
      creadoEn: row.creado_en || new Date().toISOString(), record: rec,
    });
    cambios++;
  }
  if (cambios) guardar();
  return cambios;
}

/** Mezcla facturas que vienen de la nube (las que no estén ya local). */
export function mergeFacturas(arr) {
  let nuevas = 0;
  for (const row of arr || []) {
    const rec = row.data;
    if (!rec) continue;
    const key = `${rec.clase || "FACTURA"}-${rec.tipo}-${rec.ptoVta}-${rec.numero}`;
    if (data.facturas.some((f) => f.key === key)) continue;
    const id = ++data.seq;
    data.facturas.push({
      id, key, clase: rec.clase || "FACTURA", tipo: rec.tipo, ptoVta: rec.ptoVta, numero: rec.numero,
      fecha: rec.fecha, cae: rec.cae || null, receptorNombre: rec.receptor?.nombre || "Consumidor Final",
      total: rec.importes?.total ?? 0, creadoEn: row.creado_en || new Date().toISOString(), record: rec,
    });
    nuevas++;
  }
  if (nuevas) guardar();
  return nuevas;
}
