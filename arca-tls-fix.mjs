// Fix de TLS para los servidores viejos de ARCA.
//
// En NODE PURO (OpenSSL): el handshake DHE con clave corta de ARCA es rechazado
// (ERR_SSL_DH_KEY_TOO_SMALL). Reemplazamos el fetch global por uno de undici con
// el nivel de seguridad bajado, SOLO para estas conexiones.
//
// En ELECTRON (BoringSSL): el fetch NATIVO ya conecta con ARCA sin problema, y el
// truco de OpenSSL (SECLEVEL=0) rompe BoringSSL. Por eso NO tocamos nada ahí.

const isElectron = !!process.versions?.electron;

if (!isElectron) {
  const { fetch: undiciFetch, Agent } = await import("undici");
  const arcaDispatcher = new Agent({
    connect: { ciphers: "DEFAULT@SECLEVEL=0", minDHSize: 512 },
  });
  globalThis.fetch = (input, init = {}) => undiciFetch(input, { ...init, dispatcher: arcaDispatcher });
}
