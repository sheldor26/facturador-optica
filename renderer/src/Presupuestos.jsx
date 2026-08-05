import React, { useEffect, useMemo, useRef, useState } from "react";
import { mensajeHumano, mensajeRechazo } from "./errores.js";
import CatalogoLentes from "./CatalogoLentes.jsx";

const RATE = 0.21;
const CLIENTES = ["Consumidor Final", "IVA Responsable Inscripto", "Responsable Monotributo", "IVA Sujeto Exento"];
const U_MEDIDA = ["Unidades", "Par"];
const COND_VENTA = ["Otra", "Contado", "Cuenta Corriente", "Tarjeta", "Transferencia"];
const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (s) => (s ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : "—");
const nuevoId = () => Math.random().toString(36).slice(2); // key estable por fila
const itemVacio = () => ({ _id: nuevoId(), desc: "", cantidad: 1, precioUnit: "", unidad: "Unidades", descPct: "", nota: false });
const notaVacia = () => ({ _id: nuevoId(), desc: "", cantidad: "", precioUnit: "", unidad: "", nota: true });

export default function Presupuestos({ toast }) {
  const [vista, setVista] = useState("lista"); // lista | nuevo
  return vista === "nuevo"
    ? <Nuevo toast={toast} onListo={() => setVista("lista")} onCancelar={() => setVista("lista")} />
    : <Lista toast={toast} onNuevo={() => setVista("nuevo")} />;
}

// ===========================================================================
//  Lista de presupuestos guardados
// ===========================================================================
function Lista({ toast, onNuevo }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [facturar, setFacturar] = useState(null); // presupuesto a facturar
  const [borrar, setBorrar] = useState(null);
  const [working, setWorking] = useState(false);
  const [compartir, setCompartir] = useState(null);
  const [cmedio, setCmedio] = useState("whatsapp");
  const [cdest, setCdest] = useState("");
  const facturandoRef = useRef(false); // guard síncrono anti doble-emisión

  async function cargar(query = "") {
    setLoading(true);
    try { setItems(await window.api.listarPresupuestos(query)); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  async function imprimir(id) {
    try {
      const r = await window.api.imprimirPresupuesto(id);
      if (!r) return; // canceló el guardado
      if (r.impreso) toast?.("Enviado a la impresora.");
      else toast?.("No se pudo imprimir automáticamente. Se abrió el PDF para imprimir a mano.", "error");
    } catch (e) { toast?.(e?.message || String(e), "error"); }
  }

  async function confirmarFacturar() {
    if (facturandoRef.current) return; // ya se está facturando: ignorar clics repetidos
    facturandoRef.current = true;
    setWorking(true);
    try {
      const res = await window.api.facturarPresupuesto(facturar.id);
      if (res.ok) {
        const r = res.record;
        setFacturar(null);
        toast?.(`Factura ${r.tipo} ${String(r.ptoVta).padStart(5, "0")}-${String(r.numero).padStart(8, "0")} emitida.`);
        await cargar(q);
        window.api.imprimirFactura(res.id, ["ORIGINAL", "DUPLICADO"])
          .then((pr) => { if (pr && pr.impreso === false) toast?.("La factura se emitió pero no se imprimió. Se abrió el PDF.", "error"); })
          .catch(() => {});
      } else {
        toast?.(mensajeRechazo(res.observaciones), "error");
      }
    } catch (e) { toast?.(mensajeHumano(e), "error"); }
    finally { setWorking(false); facturandoRef.current = false; }
  }

  async function confirmarBorrar() {
    setWorking(true);
    try {
      await window.api.eliminarPresupuesto(borrar.id);
      setBorrar(null);
      toast?.("Presupuesto eliminado.");
      await cargar(q);
    } catch (e) { toast?.(e?.message || String(e), "error"); }
    finally { setWorking(false); }
  }

  async function confirmarCompartir() {
    setWorking(true);
    try {
      await window.api.compartirPresupuesto({ id: compartir.id, medio: cmedio, destino: cdest });
      setCompartir(null); setCdest("");
      toast?.("Se abrió " + (cmedio === "whatsapp" ? "WhatsApp" : "el correo") + " y se mostró el PDF para adjuntar.");
    } catch (e) { toast?.(e?.message || String(e), "error"); }
    finally { setWorking(false); }
  }

  return (
    <>
      <header className="topbar">
        <h1>Presupuestos</h1>
        <button onClick={onNuevo}>+ Nuevo presupuesto</button>
      </header>
      <div className="toolbar">
        <input
          placeholder="Buscar por cliente o número…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar(q)}
        />
        <button onClick={() => cargar(q)}>Buscar</button>
      </div>

      <table className="grid">
        <thead>
          <tr><th>Número</th><th>Fecha</th><th>Cliente</th><th className="r">Total</th><th>Estado</th><th></th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="6" className="empty"><span className="spin-row"><span className="spinner" /> Cargando…</span></td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan="6" className="empty">No hay presupuestos todavía.</td></tr>
          ) : (
            items.map((p) => (
              <tr key={p.id}>
                <td><b>N° {String(p.numero).padStart(8, "0")}</b></td>
                <td>{fmt(p.fecha)}{p.vencimiento ? <small style={{ display: "block", color: "var(--muted,#5a6473)" }}>vence {fmt(p.vencimiento)}</small> : null}</td>
                <td>{p.receptor_nombre}</td>
                <td className="r">{p.sinTotal ? <small style={{ color: "var(--muted,#5a6473)" }}>Lista de precios</small> : money(p.total)}</td>
                <td>
                  {p.estado === "facturado"
                    ? <span className="pill online" title={p.factura_id || ""}>Facturado</span>
                    : p.sinTotal
                    ? <span className="pill" title="Los productos son alternativas, no se factura directo">Lista</span>
                    : <span className="pill">Vigente</span>}
                </td>
                <td className="acciones">
                  <button className="ghost mini" onClick={() => imprimir(p.id)}>Imprimir</button>
                  <button className="ghost mini" onClick={() => { setCompartir(p); setCmedio("whatsapp"); setCdest(""); }}>Compartir</button>
                  {p.estado !== "facturado" && !p.sinTotal && (
                    <button className="ghost mini" onClick={() => setFacturar(p)}>Facturar</button>
                  )}
                  <button className="ghost mini" onClick={() => setBorrar(p)}>Eliminar</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {facturar && (
        <div className="modal-bg"><div className="modal">
          <h2>Facturar presupuesto</h2>
          <p>Vas a emitir la factura real del presupuesto <b>N° {String(facturar.numero).padStart(8, "0")}</b> a <b>{facturar.receptor_nombre}</b> por <b>{money(facturar.total)}</b>.</p>
          <p className="warn">Se generará un comprobante <b>real y fiscal</b> registrado en ARCA.</p>
          <div className="modal-btns">
            <button className="ghost" onClick={() => setFacturar(null)} disabled={working}>Cancelar</button>
            <button onClick={confirmarFacturar} disabled={working}>{working ? "Emitiendo…" : "Sí, facturar"}</button>
          </div>
        </div></div>
      )}

      {borrar && (
        <div className="modal-bg"><div className="modal">
          <h2>Eliminar presupuesto</h2>
          <p>¿Eliminar el presupuesto <b>N° {String(borrar.numero).padStart(8, "0")}</b> de <b>{borrar.receptor_nombre}</b>?</p>
          <p className="warn">Esta acción no se puede deshacer.</p>
          <div className="modal-btns">
            <button className="ghost" onClick={() => setBorrar(null)} disabled={working}>Cancelar</button>
            <button onClick={confirmarBorrar} disabled={working}>{working ? "Eliminando…" : "Eliminar"}</button>
          </div>
        </div></div>
      )}

      {compartir && (
        <div className="modal-bg"><div className="modal">
          <h2>Compartir presupuesto</h2>
          <p><b>N° {String(compartir.numero).padStart(8, "0")}</b> · {compartir.sinTotal ? "Lista de precios" : money(compartir.total)}</p>
          <div className="medio-tabs">
            <button className={cmedio === "whatsapp" ? "" : "ghost"} onClick={() => setCmedio("whatsapp")}>WhatsApp</button>
            <button className={cmedio === "email" ? "" : "ghost"} onClick={() => setCmedio("email")}>Email</button>
          </div>
          <label className="fld" style={{ marginTop: 14 }}>
            <span>{cmedio === "whatsapp" ? "Teléfono (con cód. de país, ej. 5493756...)" : "Email del cliente"}</span>
            <input value={cdest} onChange={(e) => setCdest(e.target.value)} placeholder={cmedio === "whatsapp" ? "5493756123456" : "cliente@correo.com"} />
          </label>
          <p className="hint-share">Se abre {cmedio === "whatsapp" ? "WhatsApp" : "el correo"} con el mensaje y se muestra el PDF para que lo adjuntes con un arrastre.</p>
          <div className="modal-btns">
            <button className="ghost" onClick={() => setCompartir(null)} disabled={working}>Cancelar</button>
            <button onClick={confirmarCompartir} disabled={working}>{working ? "Abriendo…" : "Compartir"}</button>
          </div>
        </div></div>
      )}
    </>
  );
}

// ===========================================================================
//  Nuevo presupuesto (formulario)
// ===========================================================================
function Nuevo({ toast, onListo, onCancelar }) {
  const [receptorCond, setReceptorCond] = useState("Consumidor Final");
  const [docNro, setDocNro] = useState("");
  const [nombre, setNombre] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [condVenta, setCondVenta] = useState("Otra");
  const [validezDias, setValidezDias] = useState(7);
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState([itemVacio()]);
  const [sinTotal, setSinTotal] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [padronMsg, setPadronMsg] = useState(null);
  const [padronErr, setPadronErr] = useState(false);
  const [opciones, setOpciones] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [guardando, setGuardando] = useState(false);

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
      else setOpciones(personas);
    } catch (e) { setPadronMsg(e?.message || String(e)); setPadronErr(true); }
    finally { setBuscando(false); }
  }

  const esCFsel = receptorCond === "Consumidor Final";
  const cuitDigits = String(docNro).replace(/\D/g, "");
  const sinDatos = !cuitDigits && !nombre.trim();
  const esCF = esCFsel || sinDatos;
  const condEfectiva = esCF ? "Consumidor Final" : receptorCond;
  const esA = condEfectiva === "IVA Responsable Inscripto";
  const tipo = esA ? "A" : "B";

  const totales = useMemo(() => {
    const suma = items.filter((it) => !it.nota).reduce((acc, it) => {
      const bruto = Number(it.cantidad || 0) * Number(it.precioUnit || 0);
      const d = Math.min(Math.max(Number(it.descPct) || 0, 0), 100);
      return acc + bruto * (1 - d / 100);
    }, 0);
    const neto = suma / (1 + RATE);
    return { neto, iva: suma - neto, total: suma };
  }, [items]);

  const tbodyRef = useRef(null);
  const focusLast = useRef(false);
  function setItem(i, patch) { setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it))); }
  function addItem() { setItems([...items, itemVacio()]); }
  function addNota() { setItems([...items, notaVacia()]); }
  function delItem(i) { setItems(items.length > 1 ? items.filter((_, j) => j !== i) : items); }

  function onTabUltima(e, i) {
    if (e.key === "Tab" && !e.shiftKey && i === items.length - 1) { e.preventDefault(); addItem(); focusLast.current = true; }
  }
  useEffect(() => {
    if (focusLast.current && tbodyRef.current) {
      const filas = tbodyRef.current.querySelectorAll("tr");
      filas[filas.length - 1]?.querySelector("input")?.focus();
      focusLast.current = false;
    }
  }, [items.length]);

  const reales = items.filter((it) => !it.nota && it.desc.trim() && Number(it.precioUnit) > 0 && Number(it.cantidad) > 0);
  const itemsAGuardar = items.filter((it) => (it.nota ? it.desc.trim() : it.desc.trim() && Number(it.precioUnit) > 0 && Number(it.cantidad) > 0));
  const cuitOk = /^\d{11}$/.test(cuitDigits);
  const datosIncompletos = !esCFsel && !sinDatos && !(cuitOk && nombre.trim());
  const puedeGuardar = reales.length > 0 && !datosIncompletos;

  async function crear() {
    setGuardando(true);
    try {
      const res = await window.api.crearPresupuesto({
        receptorCond: condEfectiva,
        docNro, nombre, domicilio, condVenta,
        validezDias: Number(validezDias) || 0,
        observaciones,
        items: itemsAGuardar.map((it) => (it.nota
          ? { desc: it.desc, nota: true }
          : { desc: it.desc, cantidad: Number(it.cantidad), precioUnit: Number(it.precioUnit), unidad: it.unidad, descPct: Number(it.descPct) || 0 })),
        sinTotal,
      });
      if (res.ok) {
        toast?.(`Presupuesto N° ${String(res.record.numero).padStart(8, "0")} creado.`);
        window.api.imprimirPresupuesto(res.id)
          .then((pr) => { if (pr && pr.impreso === false) toast?.("El presupuesto se creó pero no se imprimió. Se abrió el PDF.", "error"); })
          .catch(() => {});
        onListo?.();
      } else {
        toast?.("No se pudo crear el presupuesto.", "error");
      }
    } catch (e) { toast?.(mensajeHumano(e), "error"); }
    finally { setGuardando(false); }
  }

  return (
    <>
      <header className="topbar">
        <h1>Nuevo presupuesto</h1>
        <span className={`pill ${tipo === "A" ? "degradado" : "online"}`}>Precios estilo {tipo === "A" ? "Factura A (neto + IVA)" : "Factura B (con IVA)"}</span>
      </header>

      <div className="emitir">
        <section className="panel">
          <h3>Cliente</h3>
          <label className="fld">
            <span>CUIT / DNI — buscar en ARCA (opcional)</span>
            <div className="cuit-row">
              <input list="clientes-presup" value={docNro} placeholder="30-12345678-9 o elegí un cliente guardado"
                onChange={(e) => { const v = e.target.value; setDocNro(v); const c = clientes.find((x) => x.cuit === v.replace(/\D/g, "")); if (c) aplicarCliente(c); }}
                onKeyDown={(e) => e.key === "Enter" && buscarPadron()} />
              <button className="ghost" onClick={buscarPadron} disabled={buscando}>{buscando ? "Buscando…" : "Buscar"}</button>
              <datalist id="clientes-presup">
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
          <label className="fld"><span>Nombre del cliente{esCFsel ? " (opcional)" : ""}</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Para que figure en el presupuesto" /></label>
          <label className="fld"><span>Domicilio{esCFsel ? " (opcional)" : ""}</span>
            <input value={domicilio} onChange={(e) => setDomicilio(e.target.value)} placeholder="Calle 123 - Ciudad" /></label>
          {!esCFsel && !cuitOk && docNro && <small className="bad">El CUIT debe tener 11 dígitos.</small>}
          <label className="fld"><span>Condición de venta</span>
            <select value={condVenta} onChange={(e) => setCondVenta(e.target.value)}>
              {COND_VENTA.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="fld"><span>Validez (días)</span>
            <input className="num" type="number" min="0" value={validezDias} onChange={(e) => setValidezDias(e.target.value)} placeholder="7" />
          </label>
          <label className="fld"><span>Observaciones (opcional)</span>
            <textarea rows="3" value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Ej: Incluye armazón y cristales. Seña 50%. Entrega en 7 días hábiles." />
          </label>
        </section>

        <div className="emitir-col2">
        <CatalogoLentes items={items} setItems={setItems} />

        <section className="panel">
          <h3>Ítems</h3>
          <table className="items">
            <thead><tr><th>Descripción</th><th>Cant.</th><th>U. Medida</th><th>Precio (con IVA)</th><th>Desc. %</th><th></th></tr></thead>
            <tbody ref={tbodyRef}>
              {items.map((it, i) => (it.nota ? (
                <tr key={it._id} className="nota-row">
                  <td colSpan="5"><input value={it.desc} onChange={(e) => setItem(i, { desc: e.target.value })} onKeyDown={(e) => onTabUltima(e, i)} placeholder="Ej: N° de Afiliado 12345 — línea sin valor" /></td>
                  <td><button className="del" onClick={() => delItem(i)} title="Quitar">×</button></td>
                </tr>
              ) : (
                <tr key={it._id}>
                  <td><input value={it.desc} onChange={(e) => setItem(i, { desc: e.target.value })} placeholder="Ej: Anteojo con graduación" /></td>
                  <td><input className="num" type="number" min="0" value={it.cantidad} onChange={(e) => setItem(i, { cantidad: e.target.value })} /></td>
                  <td><select value={it.unidad} onChange={(e) => setItem(i, { unidad: e.target.value })}>{U_MEDIDA.map((u) => <option key={u}>{u}</option>)}</select></td>
                  <td><input className="num" type="number" min="0" step="0.01" value={it.precioUnit} onChange={(e) => setItem(i, { precioUnit: e.target.value })} placeholder="0,00" /></td>
                  <td><input className="num" type="number" min="0" max="100" step="0.01" value={it.descPct} onChange={(e) => setItem(i, { descPct: e.target.value })} onKeyDown={(e) => onTabUltima(e, i)} placeholder="0" /></td>
                  <td><button className="del" onClick={() => delItem(i)} title="Quitar">×</button></td>
                </tr>
              )))}
            </tbody>
          </table>
          <div className="add-row">
            <button className="ghost" onClick={addItem}>+ Agregar producto</button>
            <button className="ghost" onClick={addNota}>+ Agregar nota (sin valor)</button>
          </div>

          <label className="chk-print">
            <input type="checkbox" checked={sinTotal} onChange={(e) => setSinTotal(e.target.checked)} />
            <span>Es una <b>lista de precios</b>: mostrar cada producto con su valor, sin sumar un total (para cuando el cliente todavía no eligió qué combinación quiere).</span>
          </label>

          {sinTotal ? (
            <p className="hint-share">No se va a mostrar un total — el presupuesto va a listar cada producto con su precio, para que el cliente elija.</p>
          ) : (
            <div className="tot-box">
              <div><span>Neto</span>{money(totales.neto)}</div>
              <div><span>IVA 21%</span>{money(totales.iva)}</div>
              <div className="tot-total"><span>Total</span>{money(totales.total)}</div>
            </div>
          )}

          {datosIncompletos && (
            <small className="bad" style={{ display: "block", marginBottom: 8 }}>
              Completá CUIT (11 dígitos) y nombre, o dejalos vacíos para un presupuesto a Consumidor Final.
            </small>
          )}
          <div className="modal-btns" style={{ marginTop: 4 }}>
            <button className="ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
            <button className="emit-btn" disabled={!puedeGuardar || guardando} onClick={crear}>
              {guardando ? "Generando…" : sinTotal ? "Crear lista de precios" : `Crear presupuesto — ${money(totales.total)}`}
            </button>
          </div>
        </section>
        </div>
      </div>

      {opciones && (
        <div className="modal-bg"><div className="modal">
          <h2>Hay más de una persona con ese DNI</h2>
          <p>Elegí el cliente correcto:</p>
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
