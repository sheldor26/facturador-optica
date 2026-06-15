import React, { useEffect, useState } from "react";

const FACTURA_A = 1;
const FACTURA_B = 6;
const PTO_VTA = 7;
const CLASE = { FACTURA: "Factura", NC: "Nota de Crédito", ND: "Nota de Débito" };
const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
const fmt = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;

export default function Inicio() {
  const [estado, setEstado] = useState("cargando");
  const [proxA, setProxA] = useState(null);
  const [proxB, setProxB] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState(null);

  async function cargar() {
    setEstado("cargando");
    setError(null);
    try {
      setResumen(await window.api.resumen());
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
          <div className="card-label">Facturado hoy</div>
          <div className="card-big">{money(resumen?.hoy.total)}</div>
          <div className="card-sub">{resumen?.hoy.count ?? 0} comprobante(s)</div>
        </div>
        <div className="card">
          <div className="card-label">Facturado este mes</div>
          <div className="card-big">{money(resumen?.mes.total)}</div>
          <div className="card-sub">{resumen?.mes.count ?? 0} comprobante(s)</div>
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

      <section className="next">
        <h2>Últimas facturas</h2>
        {!resumen || resumen.ultimas.length === 0 ? (
          <p>Todavía no emitiste comprobantes.</p>
        ) : (
          <table className="grid mini-grid">
            <tbody>
              {resumen.ultimas.map((f) => (
                <tr key={f.id}>
                  <td><b>{CLASE[f.clase] || f.clase} {f.tipo}</b> {String(f.ptoVta).padStart(5, "0")}-{String(f.numero).padStart(8, "0")}</td>
                  <td>{fmt(f.fecha)}</td>
                  <td>{f.receptor}</td>
                  <td className="r">{money(f.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
