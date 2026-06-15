import React, { useEffect, useState } from "react";

const CLASE = { FACTURA: "Factura", NC: "Nota de Crédito", ND: "Nota de Débito" };
const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
const fmt = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
const ymd = (iso) => iso.replaceAll("-", ""); // YYYY-MM-DD -> YYYYMMDD

function primerDiaMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Reportes() {
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);

  async function generar() {
    setMsg(null);
    setData(await window.api.reporteDatos({ desde: ymd(desde), hasta: ymd(hasta) }));
  }
  useEffect(() => { generar(); }, []);

  async function exportar() {
    setMsg("Exportando…");
    try {
      const r = await window.api.reporteExportar({ desde: ymd(desde), hasta: ymd(hasta) });
      setMsg(r ? "Exportado y abierto en Excel." : null);
    } catch (e) { setMsg("Error: " + (e?.message || e)); }
  }

  const t = data?.totales;
  return (
    <>
      <header className="topbar"><h1>Reportes</h1></header>

      <div className="toolbar">
        <label className="rng"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="rng"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <button onClick={generar}>Ver</button>
        <button className="ghost" onClick={exportar}>Exportar a Excel</button>
        {msg && <span className="msg">{msg}</span>}
      </div>

      {t && (
        <section className="cards" style={{ marginBottom: 18 }}>
          <div className="card"><div className="card-label">Neto gravado</div><div className="card-big">{money(t.neto)}</div></div>
          <div className="card"><div className="card-label">IVA</div><div className="card-big">{money(t.iva)}</div></div>
          <div className="card"><div className="card-label">Total</div><div className="card-big">{money(t.total)}</div></div>
          <div className="card"><div className="card-label">Comprobantes</div><div className="card-big">{t.count}</div></div>
        </section>
      )}

      <table className="grid">
        <thead>
          <tr><th>Fecha</th><th>Comprobante</th><th>Cliente</th><th className="r">Neto</th><th className="r">IVA</th><th className="r">Total</th></tr>
        </thead>
        <tbody>
          {!data ? (
            <tr><td colSpan="6" className="empty">Cargando…</td></tr>
          ) : data.filas.length === 0 ? (
            <tr><td colSpan="6" className="empty">Sin comprobantes en ese período.</td></tr>
          ) : (
            data.filas.map((f, i) => (
              <tr key={i}>
                <td>{fmt(f.fecha)}</td>
                <td><b>{CLASE[f.clase] || f.clase} {f.tipo}</b> {String(f.ptoVta).padStart(5, "0")}-{String(f.numero).padStart(8, "0")}</td>
                <td>{f.receptor}</td>
                <td className="r">{money(f.neto)}</td>
                <td className="r">{money(f.iva)}</td>
                <td className="r">{money(f.total)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
