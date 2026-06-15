import React, { useEffect, useState } from "react";
import Setup from "./Setup.jsx";
import Inicio from "./Inicio.jsx";
import Rapida from "./Rapida.jsx";
import Emitir from "./Emitir.jsx";
import Facturas from "./Facturas.jsx";
import Opciones from "./Opciones.jsx";

const NAV = [
  { key: "inicio", label: "Inicio" },
  { key: "rapida", label: "Factura rápida" },
  { key: "emitir", label: "Emitir factura" },
  { key: "facturas", label: "Facturas emitidas" },
  { key: "clientes", label: "Clientes", soon: true },
  { key: "opciones", label: "Opciones" },
];

export default function App() {
  const [configurado, setConfigurado] = useState(null);
  const [view, setView] = useState("inicio");
  const [emisor, setEmisor] = useState(null);

  useEffect(() => { window.api.setupEstado().then(setConfigurado); }, []);
  useEffect(() => { if (configurado) window.api.emisor().then(setEmisor).catch(() => {}); }, [configurado]);

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
              {n.label}
            </a>
          ))}
        </nav>
        <div className="side-foot">{emisor?.nombreFantasia || ""}</div>
      </aside>

      <main className="main">
        {view === "inicio" && <Inicio />}
        {view === "rapida" && <Rapida />}
        {view === "emitir" && <Emitir />}
        {view === "facturas" && <Facturas />}
        {view === "opciones" && <Opciones />}
      </main>
    </div>
  );
}
