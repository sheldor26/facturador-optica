import React, { useEffect, useState } from "react";

const FACTURA_A = 1;
const FACTURA_B = 6;
const PTO_VTA = 7;

export default function Inicio() {
  const [emisor, setEmisor] = useState(null);
  const [estado, setEstado] = useState("cargando");
  const [proxA, setProxA] = useState(null);
  const [proxB, setProxB] = useState(null);
  const [error, setError] = useState(null);

  async function cargar() {
    setEstado("cargando");
    setError(null);
    try {
      setEmisor(await window.api.emisor());
      const st = await window.api.serverStatus();
      const ok = st.AppServer === "OK" && st.DbServer === "OK" && st.AuthServer === "OK";
      setEstado(ok ? "online" : "degradado");
      setProxB(await window.api.proximoNumero(PTO_VTA, FACTURA_B));
      setProxA(await window.api.proximoNumero(PTO_VTA, FACTURA_A));
    } catch (e) {
      setEstado("error");
      setError(e?.message || String(e));
    }
  }
  useEffect(() => { cargar(); }, []);

  return (
    <>
      <header className="topbar">
        <h1>Inicio</h1>
        <span className={`pill ${estado}`}>
          {estado === "online" ? "ARCA conectado" : estado === "cargando" ? "Conectando…" : estado === "degradado" ? "ARCA degradado" : "Sin conexión"}
        </span>
      </header>
      {error && <div className="alert">Error: {error} <button onClick={cargar}>Reintentar</button></div>}
      <section className="cards">
        <div className="card">
          <div className="card-label">Emisor</div>
          <div className="card-big">{emisor?.nombreFantasia || "—"}</div>
          <div className="card-sub">CUIT {emisor?.cuit || "—"} · {emisor?.condicionIva || ""}</div>
        </div>
        <div className="card">
          <div className="card-label">Próxima Factura B</div>
          <div className="card-big">N° {proxB != null ? String(proxB).padStart(8, "0") : "—"}</div>
          <div className="card-sub">Punto de venta {String(PTO_VTA).padStart(5, "0")}</div>
        </div>
        <div className="card">
          <div className="card-label">Próxima Factura A</div>
          <div className="card-big">N° {proxA != null ? String(proxA).padStart(8, "0") : "—"}</div>
          <div className="card-sub">Punto de venta {String(PTO_VTA).padStart(5, "0")}</div>
        </div>
      </section>
    </>
  );
}
