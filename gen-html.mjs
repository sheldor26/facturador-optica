// Genera el HTML de una factura (con QR y logo embebidos) y lo abre en el navegador.
//
// Correr con:  node gen-html.mjs facturas/B-0007-00000001.json

import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { renderFacturaHTML } from "./factura-template.mjs";

const emisor = JSON.parse(fs.readFileSync("./emisor.json", "utf-8"));
const archivo = process.argv[2] || "facturas/B-0007-00000001.json";
const f = JSON.parse(fs.readFileSync(archivo, "utf-8"));

// Logo como data URL (si está configurado en emisor.json -> "logo": "ruta")
let logoDataUrl = null;
if (emisor.logo && fs.existsSync(emisor.logo)) {
  const ext = path.extname(emisor.logo).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  logoDataUrl = `data:${mime};base64,${fs.readFileSync(emisor.logo).toString("base64")}`;
}

const qrDataUrl = await QRCode.toDataURL(f.qr, { margin: 0, width: 240 });
const html = renderFacturaHTML({ emisor, f, qrDataUrl, logoDataUrl });

const out = archivo.replace(/\.json$/, ".html");
fs.writeFileSync(out, html);
console.log("HTML generado:", out, logoDataUrl ? "(con logo)" : "(sin logo, texto)");
