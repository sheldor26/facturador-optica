// Persistencia del Ticket de Acceso (TA) de ARCA en disco.
//
// PROBLEMA QUE RESUELVE: WSAA solo permite UN token activo por servicio cada
// ~12 horas. La librería cachea el token solo en memoria, así que cada proceso
// nuevo pide otro y choca con ese límite (HTTP 500 "ya posee un TA valido").
// Acá guardamos el token en disco y se lo inyectamos a la librería para reusarlo
// entre corridas. En la app final (un solo proceso) esto además evita re-logins.

import fs from "node:fs";
import path from "node:path";

let TOKENS_DIR = ".tokens";
export function setTokensDir(dir) { TOKENS_DIR = dir; }
const MARGIN_MS = 10 * 60_000; // renovar si quedan menos de 10 min

function fileFor(env, service) {
  return path.join(TOKENS_DIR, `${service}-${env}.json`);
}

/** Lee el TA de disco. Devuelve null si no existe o ya venció. */
export function loadTicket(env, service = "wsfe") {
  try {
    const raw = JSON.parse(fs.readFileSync(fileFor(env, service), "utf-8"));
    const expirationTime = new Date(raw.expirationTime);
    if (expirationTime.getTime() - Date.now() <= MARGIN_MS) return null; // vencido o por vencer
    return { token: raw.token, sign: raw.sign, expirationTime };
  } catch {
    return null;
  }
}

/** Guarda el TA en disco. */
export function saveTicket(env, ticket, service = "wsfe") {
  fs.mkdirSync(TOKENS_DIR, { recursive: true });
  fs.writeFileSync(
    fileFor(env, service),
    JSON.stringify(
      {
        service,
        token: ticket.token,
        sign: ticket.sign,
        expirationTime: new Date(ticket.expirationTime).toISOString(),
      },
      null,
      2,
    ),
  );
}

/**
 * Conecta una instancia de `Arca` con el almacén en disco:
 *  - Si hay un TA válido en disco, se lo inyecta a la librería (evita login).
 *  - Después de cada operación, si la librería obtuvo un TA nuevo, lo persiste.
 *
 * Accede al cliente WSAA interno de la librería (campo `wsaa` / `ticketCache`).
 */
export function attachTokenPersistence(arca, env) {
  const wsaa = arca.wsaa; // privado en TS, accesible en JS
  if (!wsaa?.ticketCache) {
    throw new Error("No pude acceder al cache interno de WSAA (cambió la librería?)");
  }

  // 1) Sembrar desde disco TODOS los tokens guardados de este entorno (wsfe, padrón, etc.)
  if (fs.existsSync(TOKENS_DIR)) {
    for (const f of fs.readdirSync(TOKENS_DIR)) {
      const m = f.match(new RegExp(`^(.+)-${env}\\.json$`));
      if (!m) continue;
      const t = loadTicket(env, m[1]);
      if (t) wsaa.ticketCache.set(m[1], t);
    }
  }

  // 2) Persistir cualquier servicio que la librería loguee (incluye padrón)
  arca.on("auth:login", (e) => {
    const fresh = wsaa.ticketCache.get(e.service);
    if (fresh) saveTicket(env, fresh, e.service);
  });
}
