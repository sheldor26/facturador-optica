// Emite UNA Factura B REAL en PRODUCCIÓN (tiene validez fiscal).
// Factura B a Consumidor Final: $100 neto + IVA 21% = $121.
//
// Correr con:  node emitir-produccion.mjs

import "./arca-tls-fix.mjs"; // primero: arregla el TLS de ARCA
import fs from "node:fs";
import { Arca, CbteTipo, IvaTipo, DocTipo, CondicionIva } from "@ramiidv/arca-facturacion";
import { attachTokenPersistence } from "./ta-store.mjs";

const CUIT = 20168521821;
const CERT_PATH = "./facturador-pc_680c940809ace3ce.crt";
const KEY_PATH = "./clave-privada.key";
const PTO_VTA = 7;

const arca = new Arca({
  cuit: CUIT,
  cert: fs.readFileSync(CERT_PATH, "utf-8"),
  key: fs.readFileSync(KEY_PATH, "utf-8"),
  production: true, // PRODUCCIÓN — factura real
  onEvent: (e) => {
    if (e.type === "auth:cache-hit") console.log(`  [auth] token cacheado OK`);
    if (e.type === "auth:login") console.log(`  [auth] login nuevo (${e.durationMs}ms)`);
    if (e.type === "request:retry") console.warn(`  [retry] intento #${e.attempt}: ${e.error}`);
  },
});
attachTokenPersistence(arca, "prod");

const linea = () => console.log("─".repeat(60));
const pesos = (n) => "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 2 });

async function main() {
  linea();
  console.log("EMISIÓN REAL — PRODUCCIÓN (factura con validez fiscal)");
  console.log(`CUIT: ${CUIT}  |  Punto de venta: ${PTO_VTA}  |  Factura B a Consumidor Final`);
  linea();

  console.log("\nEmitiendo Factura B ($100 neto + IVA 21%)...");
  const factura = await arca.facturar({
    ptoVta: PTO_VTA,
    cbteTipo: CbteTipo.FACTURA_B,
    docTipo: DocTipo.CONSUMIDOR_FINAL,
    docNro: 0,
    condicionIva: CondicionIva.CONSUMIDOR_FINAL,
    items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
  });

  linea();
  if (factura.aprobada) {
    console.log("FACTURA APROBADA ✓");
    console.log(`   Comprobante: B ${String(PTO_VTA).padStart(4, "0")}-${String(factura.cbteNro).padStart(8, "0")}`);
    console.log(`   CAE:         ${factura.cae}`);
    console.log(`   Vto. CAE:    ${factura.caeVencimiento}`);
    console.log(`   Neto:        ${pesos(factura.importes.neto)}`);
    console.log(`   IVA (21%):   ${pesos(factura.importes.iva)}`);
    console.log(`   TOTAL:       ${pesos(factura.importes.total)}`);

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
    console.log(`   QR:          ${qr}`);

    // Guardamos un registro local de la factura (primer ladrillo de la base de la app)
    fs.mkdirSync("facturas", { recursive: true });
    const registro = {
      tipo: "B",
      ptoVta: PTO_VTA,
      numero: factura.cbteNro,
      fecha: Arca.formatDate(new Date()),
      cae: factura.cae,
      caeVencimiento: factura.caeVencimiento,
      receptor: { docTipo: "Consumidor Final", docNro: 0 },
      importes: factura.importes,
      qr,
      raw: factura.raw,
    };
    const archivo = `facturas/B-${String(PTO_VTA).padStart(4, "0")}-${String(factura.cbteNro).padStart(8, "0")}.json`;
    fs.writeFileSync(archivo, JSON.stringify(registro, null, 2));
    console.log(`\n   Registro guardado: ${archivo}`);
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
