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
  const [metricas, setMetricas] = useState(null);
  const [ptoVta, setPtoVta] = useState(PTO_VTA);
  const [error, setError] = useState(null);

  async function cargar() {
    setEstado("cargando");
    setError(null);
    try {
      await window.api.sincronizar().catch(() => {}); // baja lo de las otras PCs
      const cfg = await window.api.getConfig().catch(() => null);
      const pv = cfg?.ptoVta || PTO_VTA;
      setPtoVta(pv);
      setResumen(await window.api.resumen());
      window.api.metricas?.().then(setMetricas).catch(() => {});
      const st = await window.api.serverStatus();
      const ok = st.AppServer === "OK" && st.DbServer === "OK" && st.AuthServer === "OK";
      setEstado(ok ? "online" : "degradado");
      setProxB(await window.api.proximoNumero(pv, FACTURA_B));
      setProxA(await window.api.proximoNumero(pv, FACTURA_A));
    } catch (e) {
      setEstado("error");
      setError(e?.message || String(e));
    }
  }
  useEffect(() => { cargar(); }, []);

  // Variación % del mes actual vs. el anterior.
  const variacion = (() => {
    if (!metricas?.mesActual || !metricas?.mesAnterior) return null;
    const a = metricas.mesActual.total, b = metricas.mesAnterior.total;
    if (!b) return null;
    return Math.round(((a - b) / Math.abs(b)) * 100);
  })();

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
          <div className="card-sub">Punto de venta {String(ptoVta).padStart(5, "0")}</div>
        </div>
        <div className="card">
          <div className="card-label">Próxima Factura A</div>
          <div className="card-big">N° {proxA != null ? String(proxA).padStart(8, "0") : "—"}</div>
          <div className="card-sub">Punto de venta {String(ptoVta).padStart(5, "0")}</div>
        </div>
        <div className="card">
          <div className="card-label">Presupuestos vigentes</div>
          <div className="card-big">{resumen?.presupuestos?.vigentesCount ?? 0}</div>
          <div className="card-sub">{money(resumen?.presupuestos?.vigentesTotal)} sin facturar</div>
        </div>
      </section>

      {metricas?.meses?.some((m) => m.total > 0) && (
        <section className="dash">
          <div className="dash-chart">
            <div className="dash-head">
              <h2>Facturación · últimos 6 meses</h2>
              {variacion != null && (
                <span className={`dash-var ${variacion >= 0 ? "up" : "down"}`}>
                  {variacion >= 0 ? "▲" : "▼"} {Math.abs(variacion)}% vs. mes anterior
                </span>
              )}
            </div>
            {(() => {
              const max = Math.max(...metricas.meses.map((m) => m.total), 1);
              return (
                <div className="bars">
                  {metricas.meses.map((m, i) => (
                    <div className="bar-col" key={m.ym} title={money(m.total)}>
                      <div className="bar-val">{m.total ? money(m.total).replace("$ ", "$") : ""}</div>
                      <div className="bar-track">
                        <div className={`bar-fill ${i === metricas.meses.length - 1 ? "now" : ""}`}
                          style={{ height: `${Math.max(2, (m.total / max) * 100)}%` }} />
                      </div>
                      <div className="bar-lbl">{m.etiqueta}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <div className="dash-side">
            <h2>Mejores clientes <small>(12 meses)</small></h2>
            {metricas.topClientes.length === 0 ? (
              <p className="dash-empty">Sin clientes con CUIT todavía.</p>
            ) : (
              <ol className="top-cli">
                {metricas.topClientes.map((c) => (
                  <li key={c.nombre}><span className="tc-nom">{c.nombre}</span><span className="tc-tot">{money(c.total)}</span></li>
                ))}
              </ol>
            )}
            <div className="dash-comp">
              <span>Este mes: <b>{money(metricas.mesActual?.total)}</b></span>
              <span>IVA del mes: <b>{money(metricas.mesActual?.iva)}</b></span>
              <span>Facturas A/B: <b>{metricas.composicion?.A ?? 0} / {metricas.composicion?.B ?? 0}</b></span>
            </div>
          </div>
        </section>
      )}

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
