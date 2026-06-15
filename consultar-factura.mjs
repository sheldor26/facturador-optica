// Lee una factura YA EMITIDA directamente de los servidores de ARCA (solo lectura).
// Sirve para confirmar que el comprobante está registrado con su CAE.
//
// Correr con:  node consultar-factura.mjs

import "./arca-tls-fix.mjs";
import fs from "node:fs";
import { Arca, CbteTipo } from "@ramiidv/arca-facturacion";
import { attachTokenPersistence } from "./ta-store.mjs";

const CUIT = 20168521821;
const PTO_VTA = 7;
const NUMERO = 1;

const arca = new Arca({
  cuit: CUIT,
  cert: fs.readFileSync("./facturador-pc_680c940809ace3ce.crt", "utf-8"),
  key: fs.readFileSync("./clave-privada.key", "utf-8"),
  production: true,
  onEvent: (e) => {
    if (e.type === "auth:cache-hit") console.log("  [auth] token cacheado OK");
  },
});
attachTokenPersistence(arca, "prod");

async function main() {
  console.log("─".repeat(60));
  console.log(`Consultando a ARCA: Factura B ${String(PTO_VTA).padStart(4, "0")}-${String(NUMERO).padStart(8, "0")}`);
  console.log("─".repeat(60));

  const r = await arca.consultarComprobante(CbteTipo.FACTURA_B, PTO_VTA, NUMERO);
  console.log("\nDatos que ARCA tiene registrados de este comprobante:\n");
  console.log(JSON.stringify(r, null, 2));
}

main().catch((err) => {
  console.error("\nERROR:", err.message);
  if (err.cause) console.error("Causa:", err.cause);
  process.exit(1);
});
