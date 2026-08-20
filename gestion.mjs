// Puente con el sistema de la óptica (las órdenes de trabajo del mostrador).
//
// POR QUÉ EL FACTURADOR VA A BUSCAR EL TRABAJO, Y NO AL REVÉS
//
// El sistema de la óptica ya es un servidor andando en la PC principal. El Facturador es
// una ventana de escritorio, no un servidor. Que la gestión "empuje" el trabajo obligaría a
// abrirle un puerto al Facturador en las tres computadoras, inventarle autenticación y
// duplicar el candado que evita la doble facturación.
//
// Yendo a buscarlo, en cambio, no hace falta nada de eso: las órdenes listas para facturar
// entran por la misma pantalla, con el mismo flujo y el mismo candado que los pedidos de la
// tienda web. Es una pieza nueva menos y una pantalla nueva menos.
//
// LA DIRECCIÓN Y LA CLAVE VAN POR COMPUTADORA
//
// Mismo criterio que la tienda online: se guardan en la carpeta de datos del usuario, no
// viajan en el instalador. En la PC principal la dirección apunta a ella misma; en las otras
// dos, al nombre de la principal. La clave la escribe Juan una vez en cada máquina.

import fs from "node:fs";

let CRED_PATH = null;
export function setCredPath(p) { CRED_PATH = p; }

function cred() {
  try {
    const c = JSON.parse(fs.readFileSync(CRED_PATH, "utf-8"));
    if (c && c.apiUrl && c.apiSecret) return c;
  } catch { /* no está configurado en esta PC */ }
  return null;
}

export function estadoCred() {
  const c = cred();
  return { configurada: !!c, apiUrl: c?.apiUrl || "" };
}

export function guardarCred({ apiUrl, apiSecret }) {
  if (!CRED_PATH) throw new Error("Ruta de credenciales no definida");
  const url = String(apiUrl || "").trim().replace(/\/$/, "");
  fs.writeFileSync(CRED_PATH, JSON.stringify({ apiUrl: url, apiSecret: String(apiSecret || "") }, null, 2));
}

/*
 * Una sola puerta para hablar con el sistema.
 *
 * El timeout no es un lujo: el sistema de la óptica corre en la PC principal, y si esa
 * máquina está apagada un `fetch` sin límite deja la pantalla colgada sin decir nada. Diez
 * segundos alcanzan de sobra en una red local y avisan rápido cuando no hay nadie del otro
 * lado. (Es el mismo problema que ya está anotado para las ventanas de impresión y para la
 * consulta al padrón.)
 */
async function pedir(ruta, opts = {}) {
  const c = cred();
  if (!c) throw new Error("El sistema de la óptica no está configurado en esta computadora (Opciones).");

  const cortar = new AbortController();
  const reloj = setTimeout(() => cortar.abort(), 10_000);
  let r;
  try {
    r = await fetch(`${c.apiUrl}/api/facturador${ruta}`, {
      ...opts,
      signal: cortar.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiSecret}`, ...(opts.headers || {}) },
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error(`No contesta el sistema de la óptica (${c.apiUrl}).\n\nFijate que la computadora principal esté prendida y que el sistema esté andando en ella.`);
    }
    throw e;
  } finally {
    clearTimeout(reloj);
  }

  if (r.status === 401 || r.status === 403) {
    throw new Error("El sistema de la óptica rechazó la clave. Volvé a cargarla en Opciones.");
  }
  const datos = await r.json().catch(() => null);
  if (!r.ok) throw new Error(datos?.error || `El sistema de la óptica respondió ${r.status}`);
  return datos;
}

/**
 * Órdenes de trabajo entregadas y cobradas que todavía no tienen factura.
 *
 * Cada orden ya viene con sus renglones armados del lado de la gestión —un renglón por
 * concepto, y sin graduación— porque es allá donde se sabe qué se vendió. Acá no se
 * interpreta nada: se factura lo que llega, y si los importes no cierran contra `total`
 * el motor no emite (ver `totalEsperado` en `emitir`).
 */
export async function ordenesPendientes() {
  const d = await pedir("/pendientes");
  return Array.isArray(d?.ordenes) ? d.ordenes : [];
}

/*
 * El candado, igual que el de los pedidos web pero del lado de la gestión: la orden se toma
 * antes de emitir y se suelta al terminar. Quien decide el empate es la base de la óptica,
 * con la misma escritura condicional — dos computadoras que la piden a la vez, y sólo una
 * se la queda.
 */
export async function tomarOrden(id, pc, { forzar = false } = {}) {
  return pedir(`/ordenes/${encodeURIComponent(id)}/tomar`, {
    method: "POST",
    body: JSON.stringify({ pc: pc || "PC", forzar: !!forzar }),
  });
}

/**
 * Suelta la orden. Si se pasa `error`, además queda anotado del otro lado: es lo que
 * se mira desde la pantalla de Facturación cuando algo no salió, en vez de tener que
 * adivinar por qué una orden sigue esperando.
 */
export async function soltarOrden(id, pc, error) {
  return pedir(`/ordenes/${encodeURIComponent(id)}/soltar`, {
    method: "POST",
    body: JSON.stringify({ pc: pc || "PC", ...(error ? { error: String(error) } : {}) }),
  });
}

/**
 * "Al final no la quiere." Saca la orden de la lista sin emitir nada.
 *
 * No toca la plata: el cobro sigue cobrado y la ficha saldada. Sólo deja de esperar
 * comprobante. Después de emitida ya no sirve — ahí la salida es una Nota de Crédito.
 */
export async function noLaQuiere(id, motivo) {
  return pedir(`/ordenes/${encodeURIComponent(id)}/no-la-quiere`, {
    method: "POST",
    body: JSON.stringify({ motivo: motivo || "" }),
  });
}

/** Le avisa a la gestión que la orden quedó facturada, con su comprobante y su CAE. */
export async function marcarFacturada(id, { tipo, comprobante, cae, documento, pc }) {
  return pedir(`/ordenes/${encodeURIComponent(id)}/factura`, {
    method: "POST",
    // El documento con el que finalmente salió la factura vuelve al sistema para que
    // quede en la ficha del cliente. La próxima vez ya viene puesto y no hay que
    // volver a pedírselo. El toque final lo da quien emite, acá: lo que se manda es
    // lo que efectivamente se usó, no lo que se había propuesto.
    body: JSON.stringify({ tipo, comprobante, cae, documento: documento || "", pc: pc || "PC" }),
  });
}
