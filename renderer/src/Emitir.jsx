import React, { useEffect, useMemo, useRef, useState } from "react";

const PTO_VTA = 7;
const RATE = 0.21;
const CLIENTES = ["Consumidor Final", "IVA Responsable Inscripto", "Responsable Monotributo", "IVA Sujeto Exento"];
const U_MEDIDA = ["Unidades", "Par"];
const COND_VENTA = ["Otra", "Contado", "Cuenta Corriente", "Tarjeta", "Transferencia"];
const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const itemVacio = () => ({ desc: "", cantidad: 1, precioUnit: "", unidad: "Unidades", nota: false });
const notaVacia = () => ({ desc: "", cantidad: "", precioUnit: "", unidad: "", nota: true });

export default function Emitir() {
  const [receptorCond, setReceptorCond] = useState("Consumidor Final");
  const [docNro, setDocNro] = useState("");
  const [nombre, setNombre] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [condVenta, setCondVenta] = useState("Otra");
  const [items, setItems] = useState([itemVacio()]);
  const [step, setStep] = useState("form"); // form | confirm | emitiendo | ok | error
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState(null);
  const [imprimirOriginal, setImprimirOriginal] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [padronMsg, setPadronMsg] = useState(null);
  const [padronErr, setPadronErr] = useState(false);
  const [opciones, setOpciones] = useState(null); // varias personas con el mismo DNI
  const [clientes, setClientes] = useState([]);

  useEffect(() => { window.api.listarClientes().then(setClientes).catch(() => {}); }, []);

  function aplicarCliente(c) {
    if (!c) return;
    setReceptorCond(c.condicion || "IVA Responsable Inscripto");
    setNombre(c.nombre || "");
    setDomicilio(c.domicilio || "");
    setPadronMsg(`✓ ${c.nombre} (guardado)`); setPadronErr(false); setOpciones(null);
  }

  function aplicarPersona(p) {
    setReceptorCond(p.condicion);
    setNombre(p.nombre || "");
    setDomicilio(p.domicilio || "");
    setDocNro(String(p.cuit));
    setPadronMsg(`✓ ${p.nombre} · ${p.condicion}`); setPadronErr(false);
    setOpciones(null);
  }

  async function buscarPadron() {
    const d = String(docNro).replace(/\D/g, "");
    if (!/^\d{7,8}$/.test(d) && !/^\d{11}$/.test(d)) { setPadronMsg("Ingresá un CUIT (11) o un DNI (7-8 dígitos)."); setPadronErr(true); return; }
    setBuscando(true); setPadronMsg(null); setOpciones(null);
    try {
      const { personas } = await window.api.consultarPadron(d);
      if (personas.length === 1) aplicarPersona(personas[0]);
      else setOpciones(personas); // mismo DNI, varias personas → elegir
    } catch (e) { setPadronMsg(e?.message || String(e)); setPadronErr(true); }
    finally { setBuscando(false); }
  }

  const esA = receptorCond === "IVA Responsable Inscripto"; // solo RI recibe Factura A
  const esCF = receptorCond === "Consumidor Final"; // CF no lleva datos del receptor
  const tipo = esA ? "A" : "B";

  const totales = useMemo(() => {
    const suma = items.filter((it) => !it.nota).reduce((acc, it) => acc + Number(it.cantidad || 0) * Number(it.precioUnit || 0), 0);
    if (esA) { const neto = suma; const iva = neto * RATE; return { neto, iva, total: neto + iva }; }
    const neto = suma / (1 + RATE); return { neto, iva: suma - neto, total: suma };
  }, [items, esA]);

  const tbodyRef = useRef(null);
  const focusLast = useRef(false);

  function setItem(i, patch) { setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it))); }
  function addItem() { setItems([...items, itemVacio()]); }
  function addNota() { setItems([...items, notaVacia()]); }
  function delItem(i) { setItems(items.length > 1 ? items.filter((_, j) => j !== i) : items); }

  // Tab en el último campo de la última fila → crea una fila nueva y enfoca su descripción
  function onTabUltima(e, i) {
    if (e.key === "Tab" && !e.shiftKey && i === items.length - 1) {
      e.preventDefault();
      addItem();
      focusLast.current = true;
    }
  }
  useEffect(() => {
    if (focusLast.current && tbodyRef.current) {
      const filas = tbodyRef.current.querySelectorAll("tr");
      filas[filas.length - 1]?.querySelector("input")?.focus();
      focusLast.current = false;
    }
  }, [items.length]);

  // Productos cobrables (con precio) y todo lo que va al detalle (incluye notas sin valor)
  const reales = items.filter((it) => !it.nota && it.desc.trim() && Number(it.precioUnit) > 0 && Number(it.cantidad) > 0);
  const itemsAEmitir = items.filter((it) => (it.nota ? it.desc.trim() : it.desc.trim() && Number(it.precioUnit) > 0 && Number(it.cantidad) > 0));
  const cuitOk = esCF || /^\d{11}$/.test(String(docNro).replace(/\D/g, ""));
  const puedeEmitir = reales.length > 0 && cuitOk && (esCF || nombre.trim());

  async function guardarClienteActual() {
    await window.api.guardarCliente({ cuit: String(docNro).replace(/\D/g, ""), nombre, condicion: receptorCond, domicilio });
    setClientes(await window.api.listarClientes());
    setPadronMsg("Cliente guardado ✓"); setPadronErr(false);
  }

  function reset() {
    setReceptorCond("Consumidor Final"); setDocNro(""); setNombre(""); setDomicilio("");
    setItems([itemVacio()]); setResult(null); setErrMsg(null); setStep("form");
  }

  async function emitir() {
    setStep("emitiendo");
    try {
      const res = await window.api.emitir({
        receptorCond, docNro, nombre, domicilio, condVenta,
        items: itemsAEmitir.map((it) => (it.nota
          ? { desc: it.desc, nota: true }
          : { desc: it.desc, cantidad: Number(it.cantidad), precioUnit: Number(it.precioUnit), unidad: it.unidad })),
        ptoVta: PTO_VTA,
      });
      if (res.ok) { setResult(res); setStep("ok"); window.api.imprimirFactura(res.id, imprimirOriginal ? ["ORIGINAL", "DUPLICADO"] : ["DUPLICADO"]); }
      else { setErrMsg((res.observaciones || []).map((o) => `[${o.code}] ${o.msg}`).join(" · ") || "Rechazada por ARCA"); setStep("error"); }
    } catch (e) { setErrMsg(e?.message || String(e)); setStep("error"); }
  }

  if (step === "ok") {
    const r = result.record;
    return (
      <>
        <header className="topbar"><h1>Emitir factura</h1></header>
        <div className="ok-box">
          <div className="ok-check">✓</div>
          <h2>Factura {r.tipo} {String(r.ptoVta).padStart(5, "0")}-{String(r.numero).padStart(8, "0")} emitida</h2>
          <div className="ok-grid">
            <div><span>CAE</span><b>{r.cae}</b></div>
            <div><span>Total</span><b>{money(r.importes.total)}</b></div>
            <div><span>Cliente</span><b>{r.receptor.nombre}</b></div>
          </div>
          <p className="ok-note">El PDF se generó y abrió automáticamente ({result.nombreArchivo}).</p>
          <button onClick={reset}>Emitir otra</button>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <h1>Emitir factura</h1>
        <span className={`pill ${tipo === "A" ? "degradado" : "online"}`}>Será Factura {tipo}</span>
      </header>

      <div className="emitir">
        <section className="panel">
          <h3>Cliente</h3>
          <label className="fld">
            <span>CUIT / DNI — buscar en ARCA</span>
            <div className="cuit-row">
              <input list="clientes-guardados" value={docNro} placeholder="30-12345678-9 o elegí un cliente guardado"
                onChange={(e) => { const v = e.target.value; setDocNro(v); const c = clientes.find((x) => x.cuit === v.replace(/\D/g, "")); if (c) aplicarCliente(c); }}
                onKeyDown={(e) => e.key === "Enter" && buscarPadron()} />
              <button className="ghost" onClick={buscarPadron} disabled={buscando}>{buscando ? "Buscando…" : "Buscar"}</button>
              <datalist id="clientes-guardados">
                {clientes.map((c) => <option key={c.cuit} value={c.cuit}>{c.nombre}</option>)}
              </datalist>
            </div>
            {padronMsg && <small className={padronErr ? "bad" : "good"}>{padronMsg}</small>}
          </label>
          <label className="fld">
            <span>Condición frente al IVA</span>
            <select value={receptorCond} onChange={(e) => setReceptorCond(e.target.value)}>
              {CLIENTES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          {!esCF && (
            <>
              {!cuitOk && docNro && <small className="bad">El CUIT debe tener 11 dígitos.</small>}
              <label className="fld"><span>Razón social / Nombre</span>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Empresa S.A." /></label>
              <label className="fld"><span>Domicilio</span>
                <input value={domicilio} onChange={(e) => setDomicilio(e.target.value)} placeholder="Calle 123 - Ciudad" /></label>
              {cuitOk && nombre.trim() && <button className="ghost" style={{ alignSelf: "flex-start" }} onClick={guardarClienteActual}>Guardar este cliente</button>}
            </>
          )}
          <label className="fld"><span>Condición de venta</span>
            <select value={condVenta} onChange={(e) => setCondVenta(e.target.value)}>
              {COND_VENTA.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </section>

        <section className="panel">
          <h3>Ítems</h3>
          <table className="items">
            <thead><tr><th>Descripción</th><th>Cant.</th><th>U. Medida</th><th>{esA ? "Precio neto" : "Precio (con IVA)"}</th><th></th></tr></thead>
            <tbody ref={tbodyRef}>
              {items.map((it, i) => (it.nota ? (
                <tr key={i} className="nota-row">
                  <td colSpan="4"><input value={it.desc} onChange={(e) => setItem(i, { desc: e.target.value })} onKeyDown={(e) => onTabUltima(e, i)} placeholder="Ej: N° de Afiliado 12345 — línea sin valor" /></td>
                  <td><button className="del" onClick={() => delItem(i)} title="Quitar">×</button></td>
                </tr>
              ) : (
                <tr key={i}>
                  <td><input value={it.desc} onChange={(e) => setItem(i, { desc: e.target.value })} placeholder="Ej: Anteojo con graduación" /></td>
                  <td><input className="num" type="number" min="0" value={it.cantidad} onChange={(e) => setItem(i, { cantidad: e.target.value })} /></td>
                  <td><select value={it.unidad} onChange={(e) => setItem(i, { unidad: e.target.value })}>{U_MEDIDA.map((u) => <option key={u}>{u}</option>)}</select></td>
                  <td><input className="num" type="number" min="0" step="0.01" value={it.precioUnit} onChange={(e) => setItem(i, { precioUnit: e.target.value })} onKeyDown={(e) => onTabUltima(e, i)} placeholder="0,00" /></td>
                  <td><button className="del" onClick={() => delItem(i)} title="Quitar">×</button></td>
                </tr>
              )))}
            </tbody>
          </table>
          <div className="add-row">
            <button className="ghost" onClick={addItem}>+ Agregar producto</button>
            <button className="ghost" onClick={addNota}>+ Agregar nota (sin valor)</button>
          </div>

          <div className="tot-box">
            <div><span>Neto</span>{money(totales.neto)}</div>
            <div><span>IVA 21%</span>{money(totales.iva)}</div>
            <div className="tot-total"><span>Total</span>{money(totales.total)}</div>
          </div>

          <label className="chk-print">
            <input type="checkbox" checked={imprimirOriginal} onChange={(e) => setImprimirOriginal(e.target.checked)} />
            <span>Imprimir <b>original</b> (para el cliente). El <b>duplicado</b> se imprime siempre.</span>
          </label>
          <button className="emit-btn" disabled={!puedeEmitir} onClick={() => setStep("confirm")}>
            Emitir Factura {tipo} — {money(totales.total)}
          </button>
        </section>
      </div>

      {step === "confirm" && (
        <div className="modal-bg">
          <div className="modal">
            <h2>Confirmar emisión</h2>
            <p>Vas a emitir una <b>Factura {tipo}</b> a <b>{esA ? nombre : "Consumidor Final"}</b> por <b>{money(totales.total)}</b>.</p>
            <p className="warn">Este comprobante es <b>real y fiscal</b>: queda registrado en ARCA.</p>
            <div className="modal-btns">
              <button className="ghost" onClick={() => setStep("form")}>Cancelar</button>
              <button onClick={emitir}>Sí, emitir</button>
            </div>
          </div>
        </div>
      )}
      {step === "emitiendo" && <div className="modal-bg"><div className="modal"><h2>Emitiendo…</h2><p>Conectando con ARCA y obteniendo el CAE.</p></div></div>}
      {step === "error" && (
        <div className="modal-bg"><div className="modal">
          <h2>No se pudo emitir</h2>
          <p className="warn">{errMsg}</p>
          <div className="modal-btns"><button onClick={() => setStep("form")}>Volver</button></div>
        </div></div>
      )}
      {opciones && (
        <div className="modal-bg"><div className="modal">
          <h2>Hay más de una persona con ese DNI</h2>
          <p>Elegí el comprador correcto:</p>
          <div className="opciones">
            {opciones.map((p) => (
              <button key={p.cuit} className="opcion" onClick={() => aplicarPersona(p)}>
                <b>{p.nombre}</b>
                <span>CUIT {p.cuit} · {p.condicion}</span>
              </button>
            ))}
          </div>
          <div className="modal-btns"><button className="ghost" onClick={() => setOpciones(null)}>Cancelar</button></div>
        </div></div>
      )}
    </>
  );
}
