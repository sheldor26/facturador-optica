import React, { useEffect, useState } from "react";
import Setup from "./Setup.jsx";
import Inicio from "./Inicio.jsx";
import Rapida from "./Rapida.jsx";
import Emitir from "./Emitir.jsx";
import Facturas from "./Facturas.jsx";
import Pedidos from "./Pedidos.jsx";
import Reportes from "./Reportes.jsx";
import Clientes from "./Clientes.jsx";
import Opciones from "./Opciones.jsx";

const NAV = [
  { key: "inicio", label: "Inicio" },
  { key: "rapida", label: "Factura rápida" },
  { key: "emitir", label: "Emitir factura" },
  { key: "pedidos", label: "Pedidos web" },
  { key: "facturas", label: "Facturas emitidas" },
  { key: "clientes", label: "Clientes" },
  { key: "reportes", label: "Reportes" },
  { key: "opciones", label: "Opciones" },
];

const PATHS = {
  inicio: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>,
  rapida: <path d="M13 2L3 14h9l-1 8 10-12h-9z" />,
  emitir: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 11v6M9 14h6" /></>,
  facturas: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h8" /></>,
  pedidos: <><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
  clientes: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></>,
  reportes: <path d="M6 20v-5M12 20V8M18 20v-9" />,
  opciones: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" /></>,
};
function Ico({ k }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{PATHS[k]}</svg>;
}

export default function App() {
  const [configurado, setConfigurado] = useState(null);
  const [view, setView] = useState("inicio");
  const [emisor, setEmisor] = useState(null);
  const [nube, setNube] = useState("...");
  const [toasts, setToasts] = useState([]);
  let _tid = 0;
  function toast(msg, tipo = "ok") {
    const id = Date.now() + (_tid++);
    setToasts((t) => [...t, { id, msg, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  useEffect(() => { window.api.setupEstado().then(setConfigurado); }, []);
  useEffect(() => {
    if (!configurado) return;
    window.api.emisor().then(setEmisor).catch(() => {});
    window.api.sincronizar().then((r) => setNube(r?.ok ? "ok" : "off")).catch(() => setNube("off"));
  }, [configurado]);

  if (configurado === null) return <div className="loading">Cargando…</div>;
  if (!configurado) return <Setup onReady={() => setConfigurado(true)} />;

  return (
    <div className="app">
      <aside className="side">
        <div className="logo">FACTURADOR</div>
        <nav>
          {NAV.map((n) => (
            <a
              key={n.key}
              className={`nav ${view === n.key ? "active" : ""}`}
              data-soon={n.soon ? "" : undefined}
              onClick={() => !n.soon && setView(n.key)}
            >
              <span className="ico"><Ico k={n.key} /></span>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-nube"><span className={`ndot ${nube}`} />{nube === "ok" ? "Nube conectada" : nube === "off" ? "Sin conexión a la nube" : "Conectando…"}</div>
          <div className="side-name">{emisor?.nombreFantasia || ""}</div>
        </div>
      </aside>

      <main className="main">
        {view === "inicio" && <Inicio />}
        {view === "rapida" && <Rapida />}
        {view === "emitir" && <Emitir />}
        {view === "pedidos" && <Pedidos toast={toast} />}
        {view === "facturas" && <Facturas toast={toast} />}
        {view === "clientes" && <Clientes toast={toast} />}
        {view === "reportes" && <Reportes toast={toast} />}
        {view === "opciones" && <Opciones />}
      </main>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tipo}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
