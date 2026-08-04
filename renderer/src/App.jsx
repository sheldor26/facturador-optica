import React, { useEffect, useState } from "react";
import Setup from "./Setup.jsx";
import Inicio from "./Inicio.jsx";
import Rapida from "./Rapida.jsx";
import Emitir from "./Emitir.jsx";
import Presupuestos from "./Presupuestos.jsx";
import Facturas from "./Facturas.jsx";
import Pedidos from "./Pedidos.jsx";
import Reportes from "./Reportes.jsx";
import Clientes from "./Clientes.jsx";
import Sancor from "./Sancor.jsx";
import Opciones from "./Opciones.jsx";

const NAV = [
  { key: "inicio", label: "Inicio" },
  { key: "rapida", label: "Factura rápida" },
  { key: "emitir", label: "Emitir factura" },
  { key: "presupuestos", label: "Presupuestos" },
  { key: "pedidos", label: "Pedidos web" },
  { key: "facturas", label: "Facturas emitidas" },
  { key: "clientes", label: "Clientes" },
  { key: "sancor", label: "Sancor" },
  { key: "reportes", label: "Reportes" },
  { key: "opciones", label: "Opciones" },
];

const PATHS = {
  inicio: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>,
  rapida: <path d="M13 2L3 14h9l-1 8 10-12h-9z" />,
  emitir: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 11v6M9 14h6" /></>,
  presupuestos: <><path d="M9 2h6a1 1 0 0 1 1 1v18l-4-2-4 2V3a1 1 0 0 1 1-1z" /><path d="M9 7h6M9 11h6" /></>,
  facturas: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h8" /></>,
  pedidos: <><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
  clientes: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></>,
  sancor: <><path d="M19 21V8l-7-5-7 5v13" /><path d="M9 21v-6h6v6" /><path d="M9 9h.01M15 9h.01" /></>,
  reportes: <path d="M6 20v-5M12 20V8M18 20v-9" />,
  opciones: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" /></>,
};
function Ico({ k }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{PATHS[k]}</svg>;
}

const Sol = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
const Luna = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;

export default function App() {
  const [configurado, setConfigurado] = useState(null);
  const [view, setView] = useState("inicio");
  const [emisor, setEmisor] = useState(null);
  const [nube, setNube] = useState("...");
  const [sync, setSync] = useState(null);
  const [arca, setArca] = useState("...");
  const [tema, setTema] = useState(() => localStorage.getItem("tema") || "claro");

  useEffect(() => {
    document.documentElement.dataset.theme = tema === "oscuro" ? "dark" : "";
    localStorage.setItem("tema", tema);
  }, [tema]);
  const [toasts, setToasts] = useState([]);
  let _tid = 0;
  function toast(msg, tipo = "ok") {
    const id = Date.now() + (_tid++);
    setToasts((t) => [...t, { id, msg, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  useEffect(() => { window.api.setupEstado().then(setConfigurado); }, []);
  async function sincronizar() {
    try {
      const r = await window.api.sincronizar();
      setNube(r?.ok ? "ok" : "off");
      setSync(await window.api.nubeEstadoSync().catch(() => null));
    } catch { setNube("off"); }
  }
  useEffect(() => {
    if (!configurado) return;
    window.api.emisor().then(setEmisor).catch(() => {});
    sincronizar();
    // Refresca el indicador cada 30 s (el main sincroniza de fondo cada 12 min).
    const t = setInterval(() => window.api.nubeEstadoSync().then((s) => { if (s) { setSync(s); setNube(s.ok ? "ok" : "off"); } }).catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [configurado]);

  function haceCuanto(at) {
    if (!at) return "";
    const m = Math.round((Date.now() - at) / 60000);
    if (m < 1) return "recién"; if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60); return `hace ${h} h`;
  }

  // Estado de los servidores de ARCA (no requiere login). Se chequea al abrir y cada 60 s.
  useEffect(() => {
    if (!configurado) return;
    let vivo = true;
    const chequear = () => window.api.serverStatus()
      .then((s) => { if (vivo) setArca(s && s.AppServer === "OK" && s.DbServer === "OK" && s.AuthServer === "OK" ? "ok" : "off"); })
      .catch(() => { if (vivo) setArca("off"); });
    chequear();
    const t = setInterval(chequear, 60000);
    return () => { vivo = false; clearInterval(t); };
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
              role="button"
              tabIndex={0}
              aria-current={view === n.key ? "page" : undefined}
              onClick={() => setView(n.key)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView(n.key); } }}
            >
              <span className="ico"><Ico k={n.key} /></span>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-nube"><span className={`ndot ${arca}`} />{arca === "ok" ? "ARCA en línea" : arca === "off" ? "ARCA sin conexión" : "ARCA…"}</div>
          <div className="side-nube" onClick={sincronizar} style={{ cursor: "pointer" }} title={sync?.fallidas ? `${sync.fallidas} sin poder subir — se reintenta solo` : "Sincronizar ahora"}>
            <span className={`ndot ${nube === "ok" && sync?.fallidas ? "warn" : nube}`} />
            {nube === "ok"
              ? <>{sync?.fallidas ? `${sync.fallidas} sin subir` : "Nube al día"}{sync?.subidas ? ` · subió ${sync.subidas}` : ""}{sync?.at ? <small style={{ opacity: .6 }}> · {haceCuanto(sync.at)}</small> : ""}</>
              : nube === "off" ? "Sin conexión — reintenta solo" : "Conectando…"}
          </div>
          <div className="side-name">{emisor?.nombreFantasia || ""}</div>
          <button className="tema-btn" onClick={() => setTema(tema === "oscuro" ? "claro" : "oscuro")}>
            {tema === "oscuro" ? <Sol /> : <Luna />}{tema === "oscuro" ? "Modo claro" : "Modo oscuro"}
          </button>
        </div>
      </aside>

      <main className="main">
        {view === "inicio" && <Inicio />}
        {view === "rapida" && <Rapida />}
        {view === "emitir" && <Emitir />}
        {view === "presupuestos" && <Presupuestos toast={toast} />}
        {view === "pedidos" && <Pedidos toast={toast} />}
        {view === "facturas" && <Facturas toast={toast} />}
        {view === "clientes" && <Clientes toast={toast} />}
        {view === "sancor" && <Sancor toast={toast} />}
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
