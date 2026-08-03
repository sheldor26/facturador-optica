// Proceso main de Electron. Toda la lógica fiscal vive acá (Node).
// La UI (renderer) nunca toca el certificado: pide cosas por IPC.

const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { autoUpdater } = require("electron-updater");

const isDev = !app.isPackaged;

// El motor es ESM (engine.mjs); lo cargamos con import() dinámico.
let enginePromise;
function engine() {
  if (!enginePromise) {
    enginePromise = import(pathToFileURL(path.join(__dirname, "..", "engine.mjs")).href);
  }
  return enginePromise;
}

// Módulo Sancor (ESM): procesa preliquidaciones (estampar IVA + archivar).
let sancorPromise;
function sancor() {
  if (!sancorPromise) {
    sancorPromise = import(pathToFileURL(path.join(__dirname, "..", "sancor.mjs")).href);
  }
  return sancorPromise;
}

// Módulo de nube (Supabase Storage) para compartir archivos entre PCs.
let cloudPromise;
function cloud() {
  if (!cloudPromise) {
    cloudPromise = import(pathToFileURL(path.join(__dirname, "..", "cloud.mjs")).href);
  }
  return cloudPromise;
}

// Carpeta base donde se guardan las preliquidaciones/facturas de Sancor.
// Si no está configurada, usa <documentos>/Sancor.
async function carpetaSancorBase() {
  const eng = await engine();
  const cfg = eng.getConfig();
  return cfg.carpetaSancor || path.join(app.getPath("documents"), "Sancor");
}

// Ruta del objeto en el bucket: "<año>/<mm>/<GRAV|NO GRAV>/<archivo>".
function objectPath(anio, mes, tipo, nombre) {
  return `${anio}/${String(mes).padStart(2, "0")}/${tipo === "GRAV" ? "GRAV" : "NO GRAV"}/${nombre}`;
}

// Comprime una imagen (desde un Buffer) a JPEG (lado máx. ~1600px) para que ocupe poco.
// Si no se puede leer (ej. HEIC no soportado), devuelve null para subir el original.
function comprimirImagenBuffer(buffer, maxLado = 1600, calidad = 70) {
  try {
    let img = nativeImage.createFromBuffer(buffer);
    if (img.isEmpty()) return null;
    const s = img.getSize();
    if (Math.max(s.width, s.height) > maxLado) {
      img = s.width >= s.height ? img.resize({ width: maxLado }) : img.resize({ height: maxLado });
    }
    return img.toJPEG(calidad);
  } catch { return null; }
}
function comprimirImagen(srcPath, maxLado = 1600, calidad = 70) {
  try { return comprimirImagenBuffer(fs.readFileSync(srcPath), maxLado, calidad); } catch { return null; }
}
// Nombre libre dentro de dir (agrega -1, -2… si ya existe).
function nombreLibre(dir, nombre) {
  const ext = path.extname(nombre), b = path.basename(nombre, ext);
  let final = nombre, i = 1;
  while (fs.existsSync(path.join(dir, final))) final = `${b}-${i++}${ext}`;
  return final;
}

// Genera un PDF A4 a partir de HTML, usando el Chromium interno de Electron.
async function htmlToPdf(html, outPath) {
  const tmpHtml = path.join(os.tmpdir(), `fact-${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, html);
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadFile(tmpHtml);
    const pdf = await win.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    fs.writeFileSync(outPath, pdf);
  } finally {
    win.destroy();
    fs.existsSync(tmpHtml) && fs.unlinkSync(tmpHtml);
  }
  return outPath;
}

// Imprime un HTML directamente en la impresora (sin pasar por un visor).
// silent=true manda a la impresora predeterminada (o `deviceName`) sin diálogo.
async function imprimirHtml(html, { deviceName, silent = true, copies = 1 } = {}) {
  const tmpHtml = path.join(os.tmpdir(), `print-${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, html);
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadFile(tmpHtml);
    await new Promise((resolve, reject) => {
      win.webContents.print(
        {
          silent,
          printBackground: true,
          copies: copies > 0 ? copies : 1,
          margins: { marginType: "none" },
          ...(deviceName ? { deviceName } : {}),
        },
        (ok, motivo) => (ok ? resolve() : reject(new Error(motivo || "La impresión no se completó"))),
      );
    });
  } finally {
    win.destroy();
    fs.existsSync(tmpHtml) && fs.unlinkSync(tmpHtml);
  }
}

// Según la config: imprime automáticamente y, si falla o está desactivado, abre el PDF.
async function imprimirOAbrir(eng, html, outPath) {
  const cfg = eng.getConfig();
  if (cfg.autoImprimir === false) { await shell.openPath(outPath); return { impreso: false }; }
  try {
    await imprimirHtml(html, { deviceName: cfg.impresora || undefined, silent: !cfg.dialogoImpresion });
    return { impreso: true };
  } catch (e) {
    await shell.openPath(outPath); // fallback: abrir para imprimir a mano
    return { impreso: false, error: e.message };
  }
}

// ---- Puente IPC (la UI llama, el main ejecuta) ----
ipcMain.handle("arca:serverStatus", async () => (await engine()).serverStatus());
ipcMain.handle("arca:proximoNumero", async (_e, ptoVta, cbteTipo) => (await engine()).proximoNumero(ptoVta, cbteTipo));
ipcMain.handle("app:emisor", async () => (await engine()).getEmisor());
ipcMain.handle("padron:consultar", async (_e, cuit) => (await engine()).consultarPadron(cuit));
ipcMain.handle("factura:emitir", async (_e, opts) => (await engine()).emitir(opts));
ipcMain.handle("factura:nota", async (_e, opts) => (await engine()).emitirNota(opts));
ipcMain.handle("facturas:listar", async (_e, q) => (await engine()).listarFacturas({ q }));
ipcMain.handle("nube:sincronizar", async () => (await engine()).sincronizarNube());
ipcMain.handle("pedidos:listar", async () => (await engine()).pedidosPendientes());
ipcMain.handle("pedido:detalle", async (_e, id) => (await engine()).detallePedido(id));
ipcMain.handle("pedido:facturar", async (_e, id, receptor) => (await engine()).facturarPedido(id, receptor));
ipcMain.handle("app:resumen", async () => (await engine()).resumenInicio());
ipcMain.handle("app:metricas", async () => (await engine()).metricasDashboard());
ipcMain.handle("clientes:listar", async (_e, q) => (await engine()).listarClientes(q));
ipcMain.handle("clientes:guardar", async (_e, c) => { (await engine()).guardarCliente(c); return true; });
ipcMain.handle("clientes:eliminar", async (_e, cuit) => { (await engine()).eliminarCliente(cuit); return true; });
ipcMain.handle("reporte:datos", async (_e, filtro) => (await engine()).reporte(filtro));
ipcMain.handle("reporte:exportar", async (_e, filtro) => {
  const eng = await engine();
  const csv = eng.reporteCSV(filtro);
  const res = await dialog.showSaveDialog({
    title: "Exportar reporte",
    defaultPath: path.join(eng.getConfig().carpetaFacturas, "reporte.csv"),
    filters: [{ name: "CSV (Excel)", extensions: ["csv"] }],
  });
  if (res.canceled) return null;
  fs.writeFileSync(res.filePath, "﻿" + csv, "utf-8"); // BOM para que Excel respete acentos
  await shell.openPath(res.filePath);
  return res.filePath;
});
ipcMain.handle("factura:compartir", async (_e, { id, medio, destino }) => {
  const eng = await engine();
  const row = eng.getFactura(id);
  if (!row) throw new Error("Comprobante no encontrado");
  const r = row.record;
  const html = await eng.comprobanteHTMLPorId(id, ["ORIGINAL"]); // al cliente le mandamos el original
  const cfg = eng.getConfig();
  fs.mkdirSync(cfg.carpetaFacturas, { recursive: true });
  const outPath = path.join(cfg.carpetaFacturas, eng.nombreArchivo(r));
  await htmlToPdf(html, outPath);
  const claseTxt = { FACTURA: "Factura", NC: "Nota de Crédito", ND: "Nota de Débito" }[r.clase] || r.clase;
  const comp = `${claseTxt} ${r.tipo} ${String(r.ptoVta).padStart(5, "0")}-${String(r.numero).padStart(8, "0")}`;
  const total = Number(r.importes?.total || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
  const msg = `Hola! Te paso tu comprobante ${comp} por $ ${total}. CAE ${r.cae}.`;
  if (medio === "whatsapp") {
    await shell.openExternal(`https://wa.me/${String(destino || "").replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`);
  } else {
    await shell.openExternal(`mailto:${encodeURIComponent(destino || "")}?subject=${encodeURIComponent(comp)}&body=${encodeURIComponent(msg)}`);
  }
  shell.showItemInFolder(outPath); // revela el PDF para adjuntarlo
  return outPath;
});
ipcMain.handle("factura:imprimir", async (_e, id, copias) => {
  const eng = await engine();
  const row = eng.getFactura(id);
  if (!row) throw new Error("Comprobante no encontrado");
  const html = await eng.comprobanteHTMLPorId(id, copias); // copias: ["ORIGINAL","DUPLICADO"] por defecto
  const nombre = eng.nombreArchivo(row.record);
  const cfg = eng.getConfig();
  let outPath;
  if (cfg.preguntarDonde) {
    const res = await dialog.showSaveDialog({
      title: "Guardar comprobante",
      defaultPath: path.join(cfg.carpetaFacturas, nombre),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (res.canceled) return null;
    outPath = res.filePath;
  } else {
    fs.mkdirSync(cfg.carpetaFacturas, { recursive: true });
    outPath = path.join(cfg.carpetaFacturas, nombre);
  }
  await htmlToPdf(html, outPath); // guarda el PDF en la carpeta (queda el registro)
  const r = await imprimirOAbrir(eng, html, outPath); // manda a la impresora (o abre si está desactivado/falla)
  return { outPath, impreso: r.impreso, error: r.error || null };
});

// Lista las impresoras del sistema (para elegir la predeterminada en Opciones).
ipcMain.handle("impresoras:listar", async () => {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL("about:blank");
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
  } catch { return []; }
  finally { win.destroy(); }
});

// ---- Presupuestos (documentos NO fiscales) ----
ipcMain.handle("presupuesto:crear", async (_e, opts) => (await engine()).crearPresupuesto(opts));
ipcMain.handle("presupuestos:listar", async (_e, q) => (await engine()).listarPresupuestos(q));
ipcMain.handle("presupuesto:facturar", async (_e, id) => (await engine()).facturarPresupuesto(id));
ipcMain.handle("presupuesto:eliminar", async (_e, id) => { (await engine()).eliminarPresupuesto(id); return true; });
ipcMain.handle("presupuesto:imprimir", async (_e, id) => {
  const eng = await engine();
  const row = eng.getPresupuesto(id);
  if (!row) throw new Error("Presupuesto no encontrado");
  const html = eng.presupuestoHTMLPorId(id, ["ORIGINAL"]);
  const nombre = eng.nombreArchivoPresupuesto(row.record);
  const cfg = eng.getConfig();
  let outPath;
  if (cfg.preguntarDonde) {
    const res = await dialog.showSaveDialog({
      title: "Guardar presupuesto",
      defaultPath: path.join(cfg.carpetaFacturas, nombre),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (res.canceled) return null;
    outPath = res.filePath;
  } else {
    fs.mkdirSync(cfg.carpetaFacturas, { recursive: true });
    outPath = path.join(cfg.carpetaFacturas, nombre);
  }
  await htmlToPdf(html, outPath);
  const r = await imprimirOAbrir(eng, html, outPath);
  return { outPath, impreso: r.impreso, error: r.error || null };
});
ipcMain.handle("presupuesto:compartir", async (_e, { id, medio, destino }) => {
  const eng = await engine();
  const row = eng.getPresupuesto(id);
  if (!row) throw new Error("Presupuesto no encontrado");
  const r = row.record;
  const html = eng.presupuestoHTMLPorId(id, ["ORIGINAL"]);
  const cfg = eng.getConfig();
  fs.mkdirSync(cfg.carpetaFacturas, { recursive: true });
  const outPath = path.join(cfg.carpetaFacturas, eng.nombreArchivoPresupuesto(r));
  await htmlToPdf(html, outPath);
  const total = Number(r.importes?.total || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
  const venc = r.vencimiento ? ` Válido hasta el ${r.vencimiento.slice(6, 8)}/${r.vencimiento.slice(4, 6)}/${r.vencimiento.slice(0, 4)}.` : "";
  const msg = `Hola! Te paso el presupuesto N° ${String(r.numero).padStart(8, "0")} por $ ${total}.${venc}`;
  if (medio === "whatsapp") {
    await shell.openExternal(`https://wa.me/${String(destino || "").replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`);
  } else {
    await shell.openExternal(`mailto:${encodeURIComponent(destino || "")}?subject=${encodeURIComponent("Presupuesto N° " + String(r.numero).padStart(8, "0"))}&body=${encodeURIComponent(msg)}`);
  }
  shell.showItemInFolder(outPath);
  return outPath;
});

// ---- Configuración inicial (importar certificado, etc.) ----
ipcMain.handle("setup:estado", async () => (await engine()).estaConfigurado());
ipcMain.handle("setup:elegirArchivo", async (_e, tipo) => {
  const filtros = tipo === "logo"
    ? [{ name: "Imagen", extensions: ["png", "jpg", "jpeg", "svg", "webp"] }]
    : tipo === "cert"
      ? [{ name: "Certificado", extensions: ["crt", "pem", "cer"] }]
      : [{ name: "Clave privada", extensions: ["key", "pem"] }];
  const res = await dialog.showOpenDialog({ properties: ["openFile"], filters: filtros });
  if (res.canceled) return null;
  const file = res.filePaths[0];
  if (tipo === "logo") return { nombre: path.basename(file), base64: fs.readFileSync(file).toString("base64") };
  return { nombre: path.basename(file), contenido: fs.readFileSync(file, "utf-8") };
});
ipcMain.handle("setup:guardar", async (_e, data) => {
  const eng = await engine();
  eng.guardarSetup(data);
  eng.iniciarRenovadorToken(); // recién configurada: arrancar el renovador del token
  eng.sincronizarNube().catch(() => {});
  return true;
});

// ---- Credenciales de la nube (por PC) ----
ipcMain.handle("cloud:estadoCred", async () => (await engine()).cloudEstadoCredenciales());
ipcMain.handle("cloud:probarCred", async (_e, c) => (await engine()).cloudProbarCredenciales(c));
ipcMain.handle("cloud:guardarCred", async (_e, c) => {
  const eng = await engine();
  eng.cloudGuardarCredenciales(c);
  eng.sincronizarNube().catch(() => {}); // reconectar con las nuevas credenciales
  return true;
});

// ---- Configuración / opciones ----
ipcMain.handle("config:get", async () => (await engine()).getConfig());
ipcMain.handle("config:set", async (_e, patch) => (await engine()).setConfig(patch));
ipcMain.handle("dialog:elegirCarpeta", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return res.canceled ? null : res.filePaths[0];
});

// ---- Resguardo de datos ----
ipcMain.handle("datos:exportar", async () => {
  const eng = await engine();
  const src = eng.rutaDatos();
  if (!fs.existsSync(src)) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  const res = await dialog.showSaveDialog({
    title: "Exportar respaldo de datos",
    defaultPath: path.join(app.getPath("documents"), `respaldo-facturador-${hoy}.json`),
    filters: [{ name: "Respaldo", extensions: ["json"] }],
  });
  if (res.canceled) return null;
  fs.copyFileSync(src, res.filePath);
  shell.showItemInFolder(res.filePath);
  return res.filePath;
});

// ---- Estado de sincronización (para el indicador) ----
ipcMain.handle("nube:estado", async () => (await engine()).estadoSync());

// ---- Módulo Sancor ----
ipcMain.handle("sancor:carpetaBase", async () => carpetaSancorBase());
ipcMain.handle("sancor:elegirCarpetaBase", async () => {
  const res = await dialog.showOpenDialog({ title: "Carpeta de Sancor", properties: ["openDirectory", "createDirectory"] });
  if (res.canceled) return null;
  const eng = await engine();
  eng.setConfig({ carpetaSancor: res.filePaths[0] });
  return res.filePaths[0];
});
ipcMain.handle("sancor:elegirPreliqs", async () => {
  const res = await dialog.showOpenDialog({
    title: "Elegí las preliquidaciones (PDF)",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return res.canceled ? [] : res.filePaths;
});
// Analiza una preliq sin escribir nada (para previsualizar tipo/total).
ipcMain.handle("sancor:analizar", async (_e, srcPath) => (await sancor()).analizar(srcPath));
// Procesa: estampa (si GRAV) + archiva local + sube a la nube (Storage).
ipcMain.handle("sancor:procesar", async (_e, { archivos, anio, mes }) => {
  const san = await sancor();
  const cld = await cloud();
  const base = await carpetaSancorBase();
  const out = [];
  for (const srcPath of archivos) {
    try {
      const r = await san.procesar({ srcPath, base, anio, mes });
      // Subir la preliquidación (ya estampada si era GRAV) a la nube.
      let nube = null;
      try {
        const buf = fs.readFileSync(r.rutaPreliq);
        const op = objectPath(anio, mes, r.tipo, path.basename(r.rutaPreliq));
        nube = await cld.subirArchivo(op, buf, "application/pdf");
        nube.objectPrefix = `${anio}/${String(mes).padStart(2, "0")}/${r.tipo === "GRAV" ? "GRAV" : "NO GRAV"}`;
      } catch (e) { nube = { ok: false, error: e?.message || String(e) }; }
      out.push({ ok: true, ...r, nube });
    } catch (e) {
      out.push({ ok: false, archivo: path.basename(srcPath), error: e?.message || String(e) });
    }
  }
  return out;
});
// Datos fijos del receptor Sancor (idénticos a las facturas ya emitidas por el usuario).
const SANCOR_RECEPTOR = {
  receptorCond: "IVA Sujeto Exento",
  docNro: "30590354798",
  nombre: "ASOCIACION MUTUAL SANCOR SALUD",
  domicilio: "25 DE MAYO 201 - SUNCHALES",
  condVenta: "Otra",
};
const SANCOR_PTO_VTA = 7;

// Emite UNA Factura B a Sancor por el monto dado (1 ítem "PRESTACIONES"), guarda el PDF
// en la carpeta del mes/tipo y lo sube a la nube. Mismo armado que las facturas manuales.
ipcMain.handle("sancor:emitirFactura", async (_e, { anio, mes, tipo, monto }) => {
  const eng = await engine();
  const san = await sancor();
  const cld = await cloud();
  const base = await carpetaSancorBase();
  try {
    const res = await eng.emitir({
      ...SANCOR_RECEPTOR,
      items: [{ desc: "PRESTACIONES", cantidad: 1, precioUnit: Number(monto), unidad: "Unidades", descPct: 0 }],
      ptoVta: eng.getPtoVta(),
    });
    if (!res.ok) return { ok: false, tipo, error: (res.observaciones || []).join(" · ") || "ARCA rechazó el comprobante" };
    const r = res.record;
    // Generar PDF de la factura y guardarlo junto a la preliquidación.
    const html = await eng.comprobanteHTMLPorId(res.id, ["ORIGINAL", "DUPLICADO"]);
    const dir = san.carpetaDestino(base, anio, mes, tipo);
    const nombre = eng.nombreArchivo(r);
    const outPath = path.join(dir, nombre);
    await htmlToPdf(html, outPath);
    let nube = null;
    try { nube = await cld.subirArchivo(objectPath(anio, mes, tipo, nombre), fs.readFileSync(outPath), "application/pdf"); } catch { nube = { ok: false }; }
    return { ok: true, tipo, ptoVta: r.ptoVta, numero: r.numero, cae: r.cae, total: r.importes.total, pdf: outPath, nube };
  } catch (e) {
    return { ok: false, tipo, error: e?.message || String(e) };
  }
});

ipcMain.handle("sancor:abrirCarpeta", async (_e, carpeta) => { await shell.openPath(carpeta); return true; });
ipcMain.handle("sancor:nubeEstado", async () => { try { return await (await cloud()).nubeDisponible(); } catch { return false; } });

// Elegí fotos por diálogo (orden + receta): comprime, guarda local y sube a la nube.
// La carpeta se calcula desde año/mes/tipo.
ipcMain.handle("sancor:agregarFotos", async (_e, { anio, mes, tipo }) => {
  const res = await dialog.showOpenDialog({
    title: "Elegí las fotos (orden + receta)",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Imágenes / PDF", extensions: ["jpg", "jpeg", "png", "heic", "webp", "pdf"] }],
  });
  if (res.canceled) return { copiadas: 0, subidas: 0, nombres: [] };
  const san = await sancor();
  const cld = await cloud();
  const base = await carpetaSancorBase();
  const dir = san.carpetaDestino(base, anio, mes, tipo);
  let copiadas = 0, subidas = 0;
  const nombres = [];
  for (const f of res.filePaths) {
    try {
      const ext = path.extname(f).toLowerCase();
      const esImagen = [".jpg", ".jpeg", ".png", ".webp", ".heic"].includes(ext);
      let buffer, nombre, contentType;
      const comprimida = esImagen ? comprimirImagen(f) : null;
      if (comprimida) { nombre = path.basename(f, ext) + ".jpg"; buffer = comprimida; contentType = "image/jpeg"; }
      else { nombre = path.basename(f); buffer = fs.readFileSync(f); contentType = ext === ".pdf" ? "application/pdf" : "application/octet-stream"; }
      const final = nombreLibre(dir, nombre);
      fs.writeFileSync(path.join(dir, final), buffer); copiadas++; nombres.push(final);
      const r = await cld.subirArchivo(objectPath(anio, mes, tipo, final), buffer, contentType);
      if (r.ok) subidas++;
    } catch { /* ignora este archivo */ }
  }
  return { copiadas, subidas, nombres };
});

// Guarda fotos ARRASTRADAS (llegan como bytes): comprime, guarda local y sube a la nube.
// archivos = [{ nombre, base64 }]. tipo = "GRAV" | "NO GRAV".
ipcMain.handle("sancor:guardarFotos", async (_e, { anio, mes, tipo, archivos }) => {
  const san = await sancor();
  const cld = await cloud();
  const base = await carpetaSancorBase();
  const dir = san.carpetaDestino(base, anio, mes, tipo);
  let copiadas = 0, subidas = 0;
  const nombres = [];
  for (const a of archivos || []) {
    try {
      const raw = Buffer.from(a.base64, "base64");
      const ext = path.extname(a.nombre || "foto").toLowerCase();
      const esImagen = [".jpg", ".jpeg", ".png", ".webp", ".heic"].includes(ext);
      const comp = esImagen ? comprimirImagenBuffer(raw) : null;
      let nombre, buffer, ct;
      if (comp) { nombre = path.basename(a.nombre, ext) + ".jpg"; buffer = comp; ct = "image/jpeg"; }
      else { nombre = a.nombre || "foto"; buffer = raw; ct = ext === ".pdf" ? "application/pdf" : "application/octet-stream"; }
      const final = nombreLibre(dir, nombre);
      fs.writeFileSync(path.join(dir, final), buffer); copiadas++; nombres.push(final);
      const r = await cld.subirArchivo(objectPath(anio, mes, tipo, final), buffer, ct);
      if (r.ok) subidas++;
    } catch { /* ignora este archivo */ }
  }
  return { copiadas, subidas, nombres };
});

// Descarga a la carpeta local todo lo que haya en la nube para un mes (para abrir en otra PC).
ipcMain.handle("sancor:descargarMes", async (_e, { anio, mes }) => {
  const cld = await cloud();
  const base = await carpetaSancorBase();
  const san = await sancor();
  const mm = String(mes).padStart(2, "0");
  let bajados = 0;
  for (const tipo of ["GRAV", "NO GRAV"]) {
    const prefix = `${anio}/${mm}/${tipo}/`;
    const archivos = await cld.listarArchivos(prefix);
    if (!archivos.length) continue;
    const dir = san.carpetaDestino(base, anio, mes, tipo);
    for (const a of archivos) {
      try {
        // Sanear el nombre que viene de la nube: nunca escribir fuera de la carpeta destino.
        const nombre = path.basename(a.name || "");
        if (!nombre || nombre === "." || nombre === "..") continue;
        const destino = path.join(dir, nombre);
        if (path.relative(dir, destino).startsWith("..")) continue; // fuera de la carpeta: descartar
        const buf = await cld.bajarArchivo(prefix + a.name);
        if (buf) { fs.writeFileSync(destino, buf); bajados++; }
      } catch { /* ignora */ }
    }
  }
  return { bajados };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1150,
    height: 780,
    minWidth: 1024,
    minHeight: 650,
    title: "Facturador Óptica",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (isDev) win.loadURL("http://127.0.0.1:5173");
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  // En la app instalada (no en desarrollo, para no estorbar mientras se prueba): sin menú nativo
  // y sin los atajos de teclado por defecto de Electron que pueden arruinar una venta en curso —
  // recargar (Ctrl/Cmd+R, F5) pierde el formulario que se está cargando, cerrar (Ctrl/Cmd+W) cierra
  // la app sin preguntar, y las DevTools (Ctrl/Cmd+Shift+I, F12) no tienen por qué estar a mano.
  if (!isDev) {
    Menu.setApplicationMenu(null);
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const mod = input.control || input.meta; // Ctrl (Win/Linux) o Cmd (mac)
      const k = input.key.toLowerCase();
      const esRecargar = (mod && k === "r") || input.key === "F5";
      const esCerrar = mod && k === "w";
      const esDevTools = (mod && input.shift && k === "i") || input.key === "F12";
      if (esRecargar || esCerrar || esDevTools) event.preventDefault();
    });
  }
}

app.whenReady().then(async () => {
  const eng = await engine();
  // En dev usamos la carpeta del proyecto (cert.pem/key.pem/emisor.json ya están ahí);
  // en la app instalada, la carpeta de datos del usuario (cada PC la suya).
  const dataDir = isDev ? path.join(__dirname, "..") : app.getPath("userData");
  eng.setPC(os.hostname()); // antes de initEngine: el renovador del token usa el nombre real
  eng.initEngine({
    dataDir,
    carpetaDefault: path.join(app.getPath("documents"), "Facturas Óptica"),
  });
  eng.sincronizarNube().catch(() => {}); // baja lo de las otras PCs y sube lo local
  setInterval(() => eng.sincronizarNube().catch(() => {}), 12 * 60 * 1000); // reintento periódico cada 12 min
  createWindow();
  // Auto-actualización: chequea GitHub Releases y baja la versión nueva si hay.
  if (!isDev) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
