// Traduce errores técnicos de ARCA / conexión a lenguaje claro para quien usa el programa.
// No cambia la lógica: solo el texto que se muestra cuando algo sale mal.
export function mensajeHumano(e) {
  const msg = (typeof e === "string" ? e : e?.message || "").toString();

  // ANTES QUE CUALQUIER OTRA COSA: el aviso de "no se sabe si la factura salió" se muestra
  // tal cual, sin resumir ni traducir. Adentro lleva el motivo técnico original (muchas
  // veces "fetch failed"), así que sin este atajo caería en la regla de conexión de acá
  // abajo y terminaría diciendo "probá de nuevo" — el único consejo que no hay que dar,
  // porque emite la factura por segunda vez. Ver `SinConfirmar` en engine.mjs.
  const marca = "[SIN-CONFIRMAR]";
  if (msg.includes(marca)) return msg.slice(msg.indexOf(marca) + marca.length).trim();

  const m = msg.toLowerCase();

  if (/fetch failed|enotfound|econnrefused|econnreset|network|timeout|etimedout|aborted|getaddrinfo|dns/.test(m))
    return "No se pudo conectar con ARCA. Revisá tu conexión a internet y probá de nuevo en un momento.";
  if (/dh_key|ssl|tls|certificate|\bcert\b/.test(m))
    return "Hubo un problema de seguridad al conectar con ARCA. Probá de nuevo; si sigue, reiniciá el programa.";
  if (/soapaction|wsaa|ta valido|ta válido|token|sesi[oó]n/.test(m))
    return "ARCA estaba renovando la sesión. Esperá unos segundos y volvé a intentar.";
  if (/\b500\b|internal server|service unavailable|\b503\b/.test(m))
    return "ARCA respondió con un error temporal. Probá de nuevo en un ratito.";
  if (/cuit|documento|doc(tipo|nro)/.test(m))
    return "Hay un problema con el CUIT/DNI del cliente. Revisalo y volvé a intentar.";

  return msg || "Ocurrió un error inesperado. Probá de nuevo.";
}

// Para rechazos de ARCA (no es una caída, sino que ARCA no aceptó el comprobante):
// muestra las observaciones de ARCA (ya vienen en castellano) con una intro clara.
export function mensajeRechazo(observaciones) {
  const obs = (observaciones || []).map((o) => o.msg).filter(Boolean);
  if (!obs.length) return "ARCA no aceptó el comprobante. Revisá los datos y probá de nuevo.";
  return "ARCA no aceptó el comprobante:\n• " + obs.join("\n• ");
}
