import React, { useEffect, useMemo, useState } from "react";

const CLASE = { FACTURA: "Factura", NC: "Nota de Crédito", ND: "Nota de Débito" };
const fmt = (s) => (s ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : "—");
const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
const DOC_LABEL = { 80: "CUIT", 86: "CUIL", 96: "DNI", 99: "-" };

export default function MercadoLibre() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);
  const [ptoVta, setPtoVta] = useState(6);
  const [ultimoResultado, setUltimoResultado] = useState(null);
  const [progreso, setProgreso] = useState(null);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [ordenFecha, setOrdenFecha] = useState("desc");

  useEffect(() => {
    window.api.getConfig?.().then((c) => setPtoVta(Number(c?.ptoVtaML) || 6)).catch(() => {});
  }, []);

  useEffect(() => {
    const off = window.api.mercadolibreOnProgreso?.((info) => setProgreso(info));
    return () => off?.();
  }, []);

  async function cargar(query = "") {
    setLoading(true);
    try { setItems(await window.api.mercadolibreListar(query)); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  async function guardarPtoVta(v) {
    const n = Number(v) || 0;
    setPtoVta(n);
    window.api.setConfig?.({ ptoVtaML: n }).catch(() => {});
  }

  async function sincronizar() {
    setSincronizando(true);
    setUltimoResultado(null);
    setProgreso(null);
    try {
      const r = await window.api.mercadolibreSincronizar(ptoVta);
      setUltimoResultado(r);
      await cargar(q);
    } catch (e) {
      setUltimoResultado({ ok: false, error: e?.message || String(e) });
    } finally {
      setSincronizando(false);
      setProgreso(null);
    }
  }

  async function toggleRevisado(f) {
    const nuevo = !f.revisado;
    setItems((prev) => prev.map((x) => (x.id === f.id ? { ...x, revisado: nuevo } : x)));
    try { await window.api.mercadolibreMarcarRevisado(f.id, nuevo); }
    catch { setItems((prev) => prev.map((x) => (x.id === f.id ? { ...x, revisado: !nuevo } : x))); } // no salió: revertir
  }

  const visibles = useMemo(() => {
    const base = soloPendientes ? items.filter((f) => !f.revisado) : items;
    const signo = ordenFecha === "asc" ? 1 : -1;
    return base.slice().sort((a, b) => signo * (a.fecha.localeCompare(b.fecha) || a.numero - b.numero));
  }, [items, soloPendientes, ordenFecha]);

  function toggleSeleccion(id) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleSeleccionTodos() {
    setSeleccion((prev) => (prev.size === visibles.length ? new Set() : new Set(visibles.map((f) => f.id))));
  }

  async function imprimirSeleccionadas() {
    if (!seleccion.size) return;
    setImprimiendo(true);
    try { await window.api.mercadolibreImprimirResumen([...seleccion]); }
    catch (e) { setUltimoResultado({ ok: false, error: e?.message || String(e) }); }
    finally { setImprimiendo(false); }
  }

  return (
    <>
      <header className="topbar"><h1>MercadoLibre</h1></header>
      <p className="rapida-hint" style={{ marginBottom: 16 }}>
        Comprobantes que MercadoLibre ya factura solo, con el mismo CUIT pero su propio Punto
        de Venta. Es solo para verlos juntos acá y controlarlos — no se pueden reimprimir con
        el detalle original, y no suman en "Facturado hoy/este mes" ni en Reportes: esas
        ventas ya las liquida MercadoLibre por su cuenta.
      </p>

      <div className="toolbar">
        <label className="fld" style={{ maxWidth: 160 }}>
          <span>Punto de Venta de ML</span>
          <input className="num" type="number" min="1" value={ptoVta} onChange={(e) => guardarPtoVta(e.target.value)} />
        </label>
        <button onClick={sincronizar} disabled={sincronizando || !ptoVta}>
          {sincronizando ? "Trayendo de ARCA…" : "Sincronizar con ARCA"}
        </button>
        {sincronizando && (
          <span className="rapida-hint" style={{ margin: 0 }}>
            {progreso
              ? `${CLASE[progreso.clase] || progreso.clase} ${progreso.tipo}: ${progreso.actual}/${progreso.hasta} (${progreso.nuevas} traídos). Si es la primera vez, puede tardar varios minutos — no cierres el programa.`
              : "Consultando a ARCA…"}
          </span>
        )}
        <input
          placeholder="Buscar por documento, número o CAE…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar(q)}
        />
        <button className="ghost" onClick={() => cargar(q)}>Buscar</button>
      </div>

      <div className="toolbar" style={{ marginTop: -6 }}>
        <label className="chk-print" style={{ margin: 0 }}>
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          <span>Mostrar solo los que faltan controlar</span>
        </label>
        <button disabled={!seleccion.size || imprimiendo} onClick={imprimirSeleccionadas}>
          {imprimiendo ? "Armando el PDF…" : `Imprimir seleccionadas (${seleccion.size})`}
        </button>
      </div>

      {ultimoResultado && (
        ultimoResultado.ok
          ? <div className={ultimoResultado.errores?.length ? "alert" : "alert-ok"}>
              {ultimoResultado.nuevas > 0 ? `Se trajeron ${ultimoResultado.nuevas} comprobante(s) nuevo(s).` : "No había comprobantes nuevos."}
              {ultimoResultado.errores?.length ? ` Algunos tipos no se pudieron consultar: ${ultimoResultado.errores.join(" · ")}` : ""}
            </div>
          : <div className="alert">No se pudo completar: {ultimoResultado.error}</div>
      )}

      <table className="grid">
        <thead>
          <tr>
            <th><input type="checkbox" checked={visibles.length > 0 && seleccion.size === visibles.length} onChange={toggleSeleccionTodos} /></th>
            <th>Comprobante</th>
            <th className="th-sort" onClick={() => setOrdenFecha((o) => (o === "asc" ? "desc" : "asc"))} title="Ordenar por fecha">
              Fecha {ordenFecha === "asc" ? "▲" : "▼"}
            </th>
            <th>Documento</th><th className="r">Total</th><th>CAE</th><th>Revisado</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="7" className="empty"><span className="spin-row"><span className="spinner" /> Cargando…</span></td></tr>
          ) : visibles.length === 0 ? (
            <tr><td colSpan="7" className="empty">
              {items.length === 0 ? "Todavía no se trajo ningún comprobante. Tocá \"Sincronizar con ARCA\"." : "No hay pendientes de controlar."}
            </td></tr>
          ) : (
            visibles.map((f) => (
              <tr key={f.id}>
                <td><input type="checkbox" checked={seleccion.has(f.id)} onChange={() => toggleSeleccion(f.id)} /></td>
                <td><b>{CLASE[f.clase] || f.clase} {f.tipo}</b> {String(f.ptoVta).padStart(5, "0")}-{String(f.numero).padStart(8, "0")}</td>
                <td>{fmt(f.fecha)}</td>
                <td>{f.docNro ? `${DOC_LABEL[f.docTipo] || ""} ${f.docNro}` : "Consumidor Final"}</td>
                <td className="r">{money(f.total)}</td>
                <td className="cae">{f.cae || "—"}</td>
                <td><input type="checkbox" checked={!!f.revisado} onChange={() => toggleRevisado(f)} title="Ya lo controlé contra la venta en MercadoLibre" /></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
