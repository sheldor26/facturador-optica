// Parches de red para los servidores de ARCA. Se importa antes que nada (engine.mjs).
//
// 1) TLS (solo NODE PURO / OpenSSL): el handshake DHE con clave corta de ARCA es
//    rechazado (ERR_SSL_DH_KEY_TOO_SMALL). Reemplazamos el fetch global por uno de
//    undici con el nivel de seguridad bajado. En ELECTRON (BoringSSL) el fetch nativo
//    ya conecta bien y el truco de OpenSSL lo rompe, así que ahí NO tocamos el TLS.
//
// 2) SOAPAction en WSAA (AMBOS entornos): el login de WSAA exige el header
//    `SOAPAction` (aunque sea vacío). La librería no lo manda cuando va vacío y ARCA
//    responde HTTP 500 "no SOAPAction header!". Lo inyectamos nosotros.

const isElectron = !!process.versions?.electron;

if (!isElectron) {
  const { fetch: undiciFetch, Agent } = await import("undici");
  const arcaDispatcher = new Agent({
    connect: { ciphers: "DEFAULT@SECLEVEL=0", minDHSize: 512 },
  });
  globalThis.fetch = (input, init = {}) => undiciFetch(input, { ...init, dispatcher: arcaDispatcher });
}

// Envuelve el fetch actual (sea el nativo de Electron o el de undici) para agregar
// el header SOAPAction en las llamadas a WSAA cuando falta.
const baseFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (url.includes("wsaa") && init.headers && !(init.headers instanceof Headers)) {
    const tieneSA = Object.keys(init.headers).some((k) => k.toLowerCase() === "soapaction");
    if (!tieneSA) init = { ...init, headers: { ...init.headers, SOAPAction: "" } };
  }
  return baseFetch(input, init);
};
