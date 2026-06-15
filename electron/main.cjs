// Proceso main de Electron. Toda la lógica fiscal vive acá (Node).
// La UI (renderer) nunca toca el certificado: pide cosas por IPC.

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const isDev = !app.isPackaged;

// El motor es ESM (engine.mjs); lo cargamos con import() dinámico.
let enginePromise;
function engine() {
  if (!enginePromise) {
    enginePromise = import(pathToFileURL(path.join(__dirname, "..", "engine.mjs")).href);
  }
  return enginePromise;
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

// ---- Puente IPC (la UI llama, el main ejecuta) ----
ipcMain.handle("arca:serverStatus", async () => (await engine()).serverStatus());
ipcMain.handle("arca:proximoNumero", async (_e, ptoVta, cbteTipo) => (await engine()).proximoNumero(ptoVta, cbteTipo));
ipcMain.handle("app:emisor", async () => (await engine()).getEmisor());
ipcMain.handle("padron:consultar", async (_e, cuit) => (await engine()).consultarPadron(cuit));
ipcMain.handle("factura:emitir", async (_e, opts) => (await engine()).emitir(opts));
ipcMain.handle("factura:nota", async (_e, opts) => (await engine()).emitirNota(opts));
ipcMain.handle("facturas:listar", async (_e, q) => (await engine()).listarFacturas({ q }));
ipcMain.handle("factura:imprimir", async (_e, id) => {
  const eng = await engine();
  const row = eng.getFactura(id);
  if (!row) throw new Error("Comprobante no encontrado");
  const html = await eng.comprobanteHTMLPorId(id); // triplicado por defecto
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
  await htmlToPdf(html, outPath);
  await shell.openPath(outPath);
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
ipcMain.handle("setup:guardar", async (_e, data) => { (await engine()).guardarSetup(data); return true; });

// ---- Configuración / opciones ----
ipcMain.handle("config:get", async () => (await engine()).getConfig());
ipcMain.handle("config:set", async (_e, patch) => (await engine()).setConfig(patch));
ipcMain.handle("dialog:elegirCarpeta", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return res.canceled ? null : res.filePaths[0];
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1150,
    height: 780,
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
}

app.whenReady().then(async () => {
  const eng = await engine();
  // En dev usamos la carpeta del proyecto (cert.pem/key.pem/emisor.json ya están ahí);
  // en la app instalada, la carpeta de datos del usuario (cada PC la suya).
  const dataDir = isDev ? path.join(__dirname, "..") : app.getPath("userData");
  eng.initEngine({
    dataDir,
    carpetaDefault: path.join(app.getPath("documents"), "Facturas Óptica"),
  });
  createWindow();
});
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
