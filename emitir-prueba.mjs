// Prueba de conexión con ARCA en HOMOLOGACIÓN (entorno de testing, sin validez fiscal).
// Emite una Factura B de prueba y muestra el CAE que devuelve ARCA.
//
// Correr con:  node emitir-prueba.mjs

import fs from "node:fs";
import { Arca, CbteTipo, IvaTipo, DocTipo, CondicionIva } from "@ramiidv/arca-facturacion";

// --- Configuración -----------------------------------------------------------
const CUIT = 20168521821; // CUIT del certificado de homologación
const CERT_PATH = "./facturador-pc_680c940809ace3ce.crt";
const KEY_PATH = "./clave-privada.key";
const PTO_VTA = 1; // En homologación el punto de venta 1 siempre está disponible

const arca = new Arca({
  cuit: CUIT,
  cert: fs.readFileSync(CERT_PATH, "utf-8"),
  key: fs.readFileSync(KEY_PATH, "utf-8"),
  production: false, // false = HOMOLOGACIÓN (testing). NO toca nada real.
  // Log liviano de lo que pasa por debajo (autenticación y llamadas):
  onEvent: (e) => {
    if (e.type === "auth:login") console.log(`  [auth] login a ${e.service} (${e.durationMs}ms)`);
    if (e.type === "request:retry") console.warn(`  [retry] intento #${e.attempt}: ${e.error}`);
  },
});

// --- Helpers de impresión ----------------------------------------------------
const linea = () => console.log("─".repeat(60));
const pesos = (n) => "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 2 });

// --- Flujo de prueba ---------------------------------------------------------
async function main() {
  linea();
  console.log("PRUEBA ARCA — HOMOLOGACIÓN (sin validez fiscal)");
  console.log(`CUIT: ${CUIT}  |  Punto de venta: ${PTO_VTA}`);
  linea();

  // 1) ¿Responden los servidores de ARCA?
  console.log("\n1) Estado de los servidores de ARCA...");
  const status = await arca.serverStatus();
  console.log(`   AppServer=${status.AppServer}  DbServer=${status.DbServer}  AuthServer=${status.AuthServer}`);

  // 2) ¿Cuál fue el último comprobante autorizado? (para saber qué número sigue)
  console.log("\n2) Último comprobante autorizado (Factura B)...");
  const ultimo = await arca.ultimoComprobante(PTO_VTA, CbteTipo.FACTURA_B);
  console.log(`   Último número emitido: ${ultimo}  →  el próximo será ${ultimo + 1}`);

  // 3) Emitir una Factura B de prueba a Consumidor Final.
  //    Un ítem de $100 neto + IVA 21% = $121 total.
  console.log("\n3) Emitiendo Factura B de prueba (Consumidor Final)...");
  const factura = await arca.facturar({
    ptoVta: PTO_VTA,
    cbteTipo: CbteTipo.FACTURA_B,
    docTipo: DocTipo.CONSUMIDOR_FINAL,
    docNro: 0,
    condicionIva: CondicionIva.CONSUMIDOR_FINAL,
    items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
  });

  // 4) Resultado
  linea();
  if (factura.aprobada) {
    console.log("FACTURA APROBADA ✓");
    console.log(`   Número:     ${String(factura.cbteNro).padStart(8, "0")}`);
    console.log(`   CAE:        ${factura.cae}`);
    console.log(`   Vto. CAE:   ${factura.caeVencimiento}`);
    console.log(`   Neto:       ${pesos(factura.importes.neto)}`);
    console.log(`   IVA:        ${pesos(factura.importes.iva)}`);
    console.log(`   TOTAL:      ${pesos(factura.importes.total)}`);

    // URL del QR oficial que iría impreso en la factura
    const qr = Arca.generateQRUrl({
      fecha: Arca.formatDate(new Date()),
      cuit: CUIT,
      ptoVta: PTO_VTA,
      tipoCmp: CbteTipo.FACTURA_B,
      nroCmp: factura.cbteNro,
      importe: factura.importes.total,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: DocTipo.CONSUMIDOR_FINAL,
      nroDocRec: 0,
      codAut: Number(factura.cae),
    });
    console.log(`   QR:         ${qr}`);
  } else {
    console.log("FACTURA RECHAZADA ✗");
    console.log("   Observaciones:", JSON.stringify(factura.observaciones, null, 2));
  }
  linea();
}

main().catch((err) => {
  console.error("\nERROR:", err.message);
  if (err.cause) console.error("Causa:", err.cause);
  process.exit(1);
});
