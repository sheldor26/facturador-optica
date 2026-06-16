// Puente seguro entre la UI y el proceso main.
// Expone SOLO funciones de negocio; nunca el certificado ni Node directo.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  emisor: () => ipcRenderer.invoke("app:emisor"),
  setupEstado: () => ipcRenderer.invoke("setup:estado"),
  setupElegirArchivo: (tipo) => ipcRenderer.invoke("setup:elegirArchivo", tipo),
  setupGuardar: (data) => ipcRenderer.invoke("setup:guardar", data),
  serverStatus: () => ipcRenderer.invoke("arca:serverStatus"),
  proximoNumero: (ptoVta, cbteTipo) => ipcRenderer.invoke("arca:proximoNumero", ptoVta, cbteTipo),
  consultarPadron: (cuit) => ipcRenderer.invoke("padron:consultar", cuit),
  emitir: (opts) => ipcRenderer.invoke("factura:emitir", opts),
  emitirNota: (opts) => ipcRenderer.invoke("factura:nota", opts),
  listarFacturas: (q) => ipcRenderer.invoke("facturas:listar", q),
  imprimirFactura: (id, copias) => ipcRenderer.invoke("factura:imprimir", id, copias),
  sincronizar: () => ipcRenderer.invoke("nube:sincronizar"),
  listarPedidos: () => ipcRenderer.invoke("pedidos:listar"),
  facturarPedido: (id) => ipcRenderer.invoke("pedido:facturar", id),
  resumen: () => ipcRenderer.invoke("app:resumen"),
  listarClientes: (q) => ipcRenderer.invoke("clientes:listar", q),
  guardarCliente: (c) => ipcRenderer.invoke("clientes:guardar", c),
  eliminarCliente: (cuit) => ipcRenderer.invoke("clientes:eliminar", cuit),
  reporteDatos: (filtro) => ipcRenderer.invoke("reporte:datos", filtro),
  reporteExportar: (filtro) => ipcRenderer.invoke("reporte:exportar", filtro),
  compartirFactura: (opts) => ipcRenderer.invoke("factura:compartir", opts),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch) => ipcRenderer.invoke("config:set", patch),
  elegirCarpeta: () => ipcRenderer.invoke("dialog:elegirCarpeta"),
});
