import React, { useEffect, useMemo, useRef, useState } from "react";
import { mensajeHumano } from "./errores.js";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Mes anterior al actual (en julio se presentan las de junio).
function periodoPorDefecto() {
  const h = new Date();
  let m = h.getMonth(); // 0-11 = mes actual - 1 (mes anterior) porque getMonth es 0-based del actual
  let y = h.getFullYear();
  if (m === 0) { m = 12; y -= 1; } // enero -> diciembre del año anterior
  return { mes: m === 0 ? 12 : m, anio: y }; // m aquí ya es (mesActual) en 1-based del mes anterior
}

export default function Sancor({ toast }) {
  const def = periodoPorDefecto();
  const [anio, setAnio] = useState(def.anio);
  const [mes, setMes] = useState(def.mes);
  const [carpetaBase, setCarpetaBase] = useState("");
  const [filas, setFilas] = useState([]); // { path, nombre, info, resultado, error }
  const [procesando, setProcesando] = useState(false);
  const [nube, setNube] = useState(null); // null=chequeando, true/false
  const [descargando, setDescargando] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);
  const [confirmEmision, setConfirmEmision] = useState(false);
  const [emisiones, setEmisiones] = useState({}); // { [path]: { ok, numero, ptoVta, cae, error } }

  useEffect(() => { window.api.sancorCarpetaBase().then(setCarpetaBase).catch(() => {}); }, []);
  useEffect(() => { window.api.sancorNubeEstado().then(setNube).catch(() => setNube(false)); }, []);
  // Al cambiar mes/año, limpiar las fotos listadas (son de otro período).
  useEffect(() => { setFotos({ GRAV: [], "NO GRAV": [] }); }, [anio, mes]);
  // Cerrar el modal de emisión con Escape.
  useEffect(() => {
    if (!confirmEmision) return;
    const h = (e) => { if (e.key === "Escape") setConfirmEmision(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [confirmEmision]);

  async function descargarMes() {
    setDescargando(true);
    try {
      const r = await window.api.sancorDescargarMes({ anio, mes });
      toast?.(r?.bajados ? `${r.bajados} archivo(s) descargados de la nube` : "No había archivos nuevos en la nube");
    } catch (e) { toast?.(e?.message || String(e), "err"); }
    finally { setDescargando(false); }
  }

  // ---- Fotos por arrastre (orden + receta) ----
  const [fotos, setFotos] = useState({ GRAV: [], "NO GRAV": [] }); // nombres agregados en esta sesión
  const [dragTipo, setDragTipo] = useState(null);
  const [subiendoFotos, setSubiendoFotos] = useState(null); // tipo en curso

  function leerBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function soltarFotos(fileList, tipo) {
    const files = [...fileList].filter((f) => /\.(jpe?g|png|webp|heic|pdf)$/i.test(f.name));
    if (!files.length) { toast?.("Arrastrá imágenes (jpg, png, heic) o PDF", "err"); return; }
    setSubiendoFotos(tipo);
    try {
      const archivos = await Promise.all(files.map(async (f) => ({ nombre: f.name, base64: await leerBase64(f) })));
      const r = await window.api.sancorGuardarFotos({ anio, mes, tipo, archivos });
      setFotos((prev) => ({ ...prev, [tipo]: [...prev[tipo], ...(r.nombres || [])] }));
      toast?.(`${r.copiadas} foto(s) en ${tipo}${r.subidas ? ` · ${r.subidas} a la nube` : ""}`);
    } catch (e) { toast?.(e?.message || String(e), "err"); }
    finally { setSubiendoFotos(null); }
  }

  function DropZone({ tipo }) {
    const activo = dragTipo === tipo;
    const abrirDialogo = async () => {
      const r = await window.api.sancorAgregarFotos({ anio, mes, tipo });
      if (r?.copiadas) { setFotos((prev) => ({ ...prev, [tipo]: [...prev[tipo], ...(r.nombres || [])] })); toast?.(`${r.copiadas} foto(s) en ${tipo}${r.subidas ? ` · ${r.subidas} a la nube` : ""}`); }
    };
    return (
      <div
        className={`dropzone ${activo ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragTipo(tipo); }}
        onDragLeave={() => setDragTipo(null)}
        onDrop={(e) => { e.preventDefault(); setDragTipo(null); soltarFotos(e.dataTransfer.files, tipo); }}
      >
        <div className="dz-titulo">{tipo}</div>
        <div className="dz-sub">
          {subiendoFotos === tipo ? "Subiendo…" : "Arrastrá acá las fotos (orden + receta)"}
        </div>
        <button className="ghost" type="button" onClick={abrirDialogo}>o elegir archivos…</button>
        {fotos[tipo].length > 0 && (
          <ul className="dz-lista">
            {fotos[tipo].map((n, i) => <li key={i}>✓ {n}</li>)}
          </ul>
        )}
      </div>
    );
  }

  async function cambiarCarpeta() {
    const c = await window.api.sancorElegirCarpetaBase();
    if (c) { setCarpetaBase(c); toast?.("Carpeta de Sancor actualizada"); }
  }

  async function agregarPreliqs() {
    const paths = await window.api.sancorElegirPreliqs();
    if (!paths?.length) return;
    const nuevas = paths
      .filter((p) => !filas.some((f) => f.path === p))
      .map((p) => ({ path: p, nombre: p.split(/[\\/]/).pop(), info: null, resultado: null, error: null }));
    setFilas((prev) => [...prev, ...nuevas]);
    // Previsualizar tipo/total de cada una.
    for (const nf of nuevas) {
      try {
        const info = await window.api.sancorAnalizar(nf.path);
        setFilas((prev) => prev.map((f) => (f.path === nf.path ? { ...f, info } : f)));
      } catch (e) {
        setFilas((prev) => prev.map((f) => (f.path === nf.path ? { ...f, error: e?.message || String(e) } : f)));
      }
    }
  }

  function quitar(p) { setFilas((prev) => prev.filter((f) => f.path !== p)); }

  async function procesar() {
    if (!filas.length) return;
    setProcesando(true);
    try {
      const res = await window.api.sancorProcesar({ archivos: filas.map((f) => f.path), anio, mes });
      setFilas((prev) => prev.map((f) => {
        const r = res.find((x) => x.archivo === f.nombre);
        return r ? { ...f, resultado: r, error: r.ok ? null : r.error } : f;
      }));
      const ok = res.filter((r) => r.ok).length;
      toast?.(`Procesadas ${ok}/${res.length} preliquidaciones`);
    } catch (e) {
      toast?.(e?.message || String(e), "err");
    } finally {
      setProcesando(false);
    }
  }

  const totales = useMemo(() => {
    let grav = 0, nograv = 0;
    for (const f of filas) {
      const src = f.resultado?.ok ? f.resultado : f.info;
      if (!src) continue;
      if (src.tipo === "GRAV") grav += src.totalConIva || 0;
      else if (src.tipo === "NO GRAV") nograv += src.total || 0;
    }
    return { grav, nograv };
  }, [filas]);

  const carpetaMes = filas.find((f) => f.resultado?.ok)?.resultado?.carpeta;
  const procesado = filas.some((f) => f.resultado?.ok);
  const pendientesEmision = filas.filter((f) => f.resultado?.ok && !emisiones[f.path]?.ok);
  const todasEmitidas = procesado && pendientesEmision.length === 0;

  const emitiendoRef = useRef(false); // guard síncrono anti doble-emisión

  async function emitirFacturas() {
    if (emitiendoRef.current) return; // ya se está emitiendo: ignorar clics repetidos
    emitiendoRef.current = true;
    setConfirmEmision(false);
    setEmitiendo(true);
    try {
      for (const f of pendientesEmision) {
        try {
          const r = await window.api.sancorEmitirFactura({ anio, mes, tipo: f.resultado.tipo, monto: f.resultado.aFacturar });
          setEmisiones((prev) => ({ ...prev, [f.path]: r }));
          if (r.ok) toast?.(`Factura B ${String(r.ptoVta).padStart(5, "0")}-${String(r.numero).padStart(8, "0")} emitida (${f.resultado.tipo})`);
          else toast?.(`No se pudo emitir ${f.resultado.tipo}: ${r.error}`, "err");
        } catch (e) {
          // Un fallo en una no debe cortar las demás.
          // Por mensajeHumano y no en crudo: acá también se emite por ARCA, y el aviso de
          // "no se sabe si salió" tiene que llegar entero (ver errores.js).
          setEmisiones((prev) => ({ ...prev, [f.path]: { ok: false, error: mensajeHumano(e) } }));
          toast?.(`No se pudo emitir ${f.resultado.tipo}`, "err");
        }
      }
    } finally { setEmitiendo(false); emitiendoRef.current = false; }
  }

  function Chip({ tipo }) {
    if (tipo === "GRAV") return <span className="pill degradado">GRAV</span>;
    if (tipo === "NO GRAV") return <span className="pill online">NO GRAV</span>;
    if (tipo === "MIXTO") return <span className="pill" style={{ background: "#e67e22", color: "#fff" }}>MIXTO</span>;
    return <span className="pill">?</span>;
  }

  return (
    <>
      <header className="topbar">
        <h1>Sancor</h1>
        <span className={`pill ${nube ? "online" : ""}`}>{nube == null ? "Nube…" : nube ? "☁ Nube conectada" : "Nube sin conexión"}</span>
      </header>

      <div className="emitir">
        <section className="panel">
          <h3>Período y carpeta</h3>
          <label className="fld">
            <span>Mes de las prestaciones</span>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="fld">
            <span>Año</span>
            <input className="num" type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} />
          </label>
          <label className="fld">
            <span>Carpeta base de Sancor</span>
            <div className="cuit-row">
              <input value={carpetaBase} readOnly placeholder="Elegí dónde se guardan las carpetas" />
              <button className="ghost" onClick={cambiarCarpeta}>Cambiar</button>
            </div>
            <small className="good">Se guardará en: <b>{carpetaBase || "…"}/{anio}/{String(mes).padStart(2, "0")} - {(MESES[mes - 1] || "").toLowerCase()}/GRAV · NO GRAV</b></small>
          </label>
          {nube && (
            <div className="add-row">
              <button className="ghost" onClick={descargarMes} disabled={descargando}>
                {descargando ? "Descargando…" : "↓ Descargar este mes de la nube"}
              </button>
              <small className="good" style={{ alignSelf: "center" }}>Traé a esta PC lo que subiste desde otra.</small>
            </div>
          )}
        </section>

        <div className="emitir-col2">
        <section className="panel">
          <h3>Preliquidaciones</h3>
          <div className="add-row">
            <button className="ghost" onClick={agregarPreliqs}>+ Agregar preliquidaciones (PDF)</button>
          </div>

          {filas.length > 0 && (
            <div className="tabla-scroll">
            <table className="items sancor-tabla">
              <thead><tr><th>Archivo</th><th>Tipo</th><th>Total</th><th>IVA 10.5%</th><th>A facturar</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {filas.map((f) => {
                  const src = f.resultado?.ok ? f.resultado : f.info;
                  return (
                    <tr key={f.path}>
                      <td>{f.nombre}</td>
                      <td>{src ? <Chip tipo={src.tipo} /> : "…"}</td>
                      <td className="num">{src ? money(src.total) : "…"}</td>
                      <td className="num">{src?.tipo === "GRAV" ? money(src.iva) : "—"}</td>
                      <td className="num"><b>{src ? money(src.tipo === "GRAV" ? src.totalConIva : src.total) : "…"}</b></td>
                      <td>
                        {f.error ? <span className="bad">✕ {f.error}</span>
                          : f.resultado?.ok ? <span className="good">✓ {f.resultado.estampada ? "Estampada" : "Archivada"}{f.resultado.nube?.ok ? " · ☁" : ""}</span>
                            : "Pendiente"}
                      </td>
                      <td><button className="del" onClick={() => quitar(f.path)} title="Quitar">×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}

          {filas.length > 0 && (
            <div className="tot-box">
              <div><span>A facturar GRAV</span>{money(totales.grav)}</div>
              <div><span>A facturar NO GRAV</span>{money(totales.nograv)}</div>
              <div className="tot-total"><span>Total</span>{money(totales.grav + totales.nograv)}</div>
            </div>
          )}

          <button className="emit-btn" disabled={!filas.length || procesando} onClick={procesar}>
            {procesando ? "Procesando…" : "Procesar y archivar"}
          </button>

          {procesado && (
            <>
              <div className="add-row" style={{ marginTop: 12 }}>
                <button className="ghost" onClick={() => window.api.sancorAbrirCarpeta(carpetaBase)}>Abrir carpeta de Sancor</button>
                {carpetaMes && <button className="ghost" onClick={() => window.api.sancorAbrirCarpeta(carpetaMes.replace(/(GRAV|NO GRAV)$/, ""))}>Abrir carpeta del mes</button>}
              </div>
              <button className="emit-btn" style={{ marginTop: 12 }} disabled={emitiendo || todasEmitidas} onClick={() => setConfirmEmision(true)}>
                {emitiendo ? "Emitiendo en ARCA…" : todasEmitidas ? "Facturas emitidas ✓" : "Emitir facturas a Sancor en ARCA"}
              </button>

              {filas.filter((f) => emisiones[f.path]).map((f) => {
                const e = emisiones[f.path];
                return (
                  <div key={f.path} className={`emision ${e.ok ? "ok" : "err"}`}>
                    {e.ok
                      ? <span className="good">✓ Factura B {String(e.ptoVta).padStart(5, "0")}-{String(e.numero).padStart(8, "0")} · {f.resultado.tipo} · {money(e.total)} · CAE {e.cae}{e.nube?.ok ? " · ☁" : ""}</span>
                      : <span className="bad">✕ {f.resultado.tipo}: {e.error}</span>}
                  </div>
                );
              })}
            </>
          )}
        </section>

        <section className="panel">
          <h3>Fotos (orden + receta)</h3>
          <small className="good" style={{ display: "block", marginBottom: 10 }}>
            Arrastrá las fotos del celular a cada recuadro. Se guardan en la carpeta del mes ({String(mes).padStart(2, "0")}/{anio}) y se suben a la nube comprimidas.
          </small>
          <div className="dz-grid">
            <DropZone tipo="NO GRAV" />
            <DropZone tipo="GRAV" />
          </div>
        </section>
        </div>
      </div>

      {confirmEmision && (
        <div className="modal-bg">
          <div className="modal">
            <h2>Emitir facturas a Sancor</h2>
            <p>Se van a emitir <b>{pendientesEmision.length}</b> factura(s) <b>B</b> a <b>Sancor</b> (Pto. Vta. 7):</p>
            <ul style={{ margin: "6px 0 10px", paddingLeft: 18 }}>
              {pendientesEmision.map((f) => (
                <li key={f.path}>{f.resultado.tipo} — <b>{money(f.resultado.aFacturar)}</b></li>
              ))}
            </ul>
            <p className="warn">Son comprobantes <b>reales y fiscales</b>: quedan registrados en ARCA.</p>
            <div className="modal-btns">
              <button className="ghost" onClick={() => setConfirmEmision(false)}>Cancelar</button>
              <button disabled={emitiendo} onClick={emitirFacturas}>Sí, emitir</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
