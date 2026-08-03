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

export default function Reportes({ toast }) {
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [data, setData] = useState(null);

  async function generar() {
    if (desde > hasta) { toast?.("La fecha 'Desde' no puede ser posterior a 'Hasta'.", "error"); return; }
    setData(await window.api.reporteDatos({ desde: ymd(desde), hasta: ymd(hasta) }));
  }
  useEffect(() => { generar(); }, []);

  async function exportar() {
    if (desde > hasta) { toast?.("La fecha 'Desde' no puede ser posterior a 'Hasta'.", "error"); return; }
    try {
      const r = await window.api.reporteExportar({ desde: ymd(desde), hasta: ymd(hasta) });
      if (r) toast?.("Exportado y abierto en Excel.");
    } catch (e) { toast?.(e?.message || String(e), "error"); }
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
            <tr><td colSpan="6" className="empty"><span className="spin-row"><span className="spinner" /> Cargando…</span></td></tr>
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

      {data?.presupuestos?.length > 0 && (
        <section style={{ marginTop: 26 }}>
          <h2 style={{ margin: "0 0 10px" }}>Presupuestos (no fiscales) · {data.presupTotales.count} · {money(data.presupTotales.total)}</h2>
          <table className="grid">
            <thead>
              <tr><th>Fecha</th><th>Número</th><th>Cliente</th><th className="r">Total</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {data.presupuestos.map((p, i) => (
                <tr key={i}>
                  <td>{fmt(p.fecha)}</td>
                  <td><b>N° {String(p.numero).padStart(8, "0")}</b></td>
                  <td>{p.receptor}</td>
                  <td className="r">{money(p.total)}</td>
                  <td>{p.estado === "facturado" ? <span className="pill online" title={p.facturaId || ""}>Facturado</span> : <span className="pill">Vigente</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
