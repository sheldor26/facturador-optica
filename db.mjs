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
  return data;
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

export function contarFacturas() {
  return data.facturas.length;
}
