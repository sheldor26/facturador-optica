// Verificación de SOLO LECTURA contra ARCA en PRODUCCIÓN.
// NO emite ninguna factura. Solo confirma que:
//   1) Los servidores responden.
//   2) El certificado está autorizado para el servicio wsfe (si autentica, está OK).
//   3) El punto de venta 7 existe y responde.
//
// Correr con:  node verificar-produccion.mjs

import "./arca-tls-fix.mjs"; // debe ir primero: arregla el TLS de ARCA
import fs from "node:fs";
import { Arca, CbteTipo } from "@ramiidv/arca-facturacion";
import { attachTokenPersistence } from "./ta-store.mjs";

const CUIT = 20168521821;
const CERT_PATH = "./facturador-pc_680c940809ace3ce.crt";
const KEY_PATH = "./clave-privada.key";
const PTO_VTA = 7;

const arca = new Arca({
  cuit: CUIT,
  cert: fs.readFileSync(CERT_PATH, "utf-8"),
  key: fs.readFileSync(KEY_PATH, "utf-8"),
  production: true, // PRODUCCIÓN
  onEvent: (e) => {
    if (e.type === "auth:cache-hit") console.log(`  [auth] usando token cacheado (${e.service})`);
    if (e.type === "auth:login") console.log(`  [auth] login a ${e.service} OK (${e.durationMs}ms)`);
    if (e.type === "request:retry") console.warn(`  [retry] intento #${e.attempt}: ${e.error}`);
  },
});

// Reusa el token guardado en disco (evita el HTTP 500 "ya posee un TA valido")
attachTokenPersistence(arca, "prod");

const linea = () => console.log("─".repeat(60));

async function main() {
  linea();
  console.log("VERIFICACIÓN ARCA — PRODUCCIÓN (solo lectura, no emite nada)");
  console.log(`CUIT: ${CUIT}  |  Punto de venta: ${PTO_VTA}`);
  linea();

  console.log("\n1) Estado de los servidores...");
  const status = await arca.serverStatus();
  console.log(`   AppServer=${status.AppServer}  DbServer=${status.DbServer}  AuthServer=${status.AuthServer}`);

  console.log("\n2) Autenticando y consultando puntos de venta habilitados...");
  const pvs = await arca.getPuntosVenta();
  console.log(`   Puntos de venta habilitados: ${JSON.stringify(pvs)}`);

  console.log(`\n3) Último comprobante autorizado (Factura B, PV ${PTO_VTA})...`);
  const ultB = await arca.ultimoComprobante(PTO_VTA, CbteTipo.FACTURA_B);
  console.log(`   Factura B: último = ${ultB}  →  próximo = ${ultB + 1}`);

  const ultA = await arca.ultimoComprobante(PTO_VTA, CbteTipo.FACTURA_A);
  console.log(`   Factura A: último = ${ultA}  →  próximo = ${ultA + 1}`);

  linea();
  console.log("TODO OK ✓  El certificado autentica, el servicio wsfe responde y el PV existe.");
  console.log("Listo para el Paso 2 (emitir una factura real) cuando lo confirmes.");
  linea();
}

main().catch((err) => {
  console.error("\nERROR:", err.message);
  if (err.cause) console.error("Causa:", err.cause);
  process.exit(1);
});
