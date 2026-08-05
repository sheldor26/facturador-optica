import React, { useEffect, useRef, useState } from "react";
import { mensajeHumano } from "./errores.js";

const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });

export default function Pedidos({ toast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [conf, setConf] = useState(null); // pedido a facturar
  const [detalle, setDetalle] = useState(null); // { items, receptor, opciones, total }
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [receptorElegido, setReceptorElegido] = useState(null); // cuando hay varias personas con el mismo DNI
  const [working, setWorking] = useState(false);
  const facturandoRef = useRef(false); // guard síncrono anti doble-emisión

  async function cargar() {
    setLoading(true);
    try { setItems(await window.api.listarPedidos()); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  // Al abrir "Facturar", trae el detalle real del pedido (ítems + comprador resuelto por padrón)
  // antes de dejar confirmar — así no se emite una factura fiscal a ciegas.
  useEffect(() => {
    if (!conf) { setDetalle(null); setReceptorElegido(null); return; }
    setCargandoDetalle(true);
    window.api.pedidoDetalle(conf.id)
      .then((d) => { setDetalle(d); setReceptorElegido(d.opciones ? null : d.receptor); })
      .catch((e) => { toast?.(mensajeHumano(e), "error"); setConf(null); })
      .finally(() => setCargandoDetalle(false));
  }, [conf]);

  function elegirPersona(p) {
    setReceptorElegido({ receptorCond: p.condicion, docNro: String(p.cuit), nombre: p.nombre, domicilio: p.domicilio });
  }

  async function facturar() {
    if (facturandoRef.current) return; // ya se está facturando: ignorar clics repetidos
    facturandoRef.current = true;
    setWorking(true);
    try {
      const res = await window.api.facturarPedido(conf.id, receptorElegido);
      if (res.ok) {
        if (res.yaExistia) {
          toast?.("Este pedido ya se había facturado acá (" + res.record.cae + ") — solo no se había avisado a la tienda. Se reintentó el aviso; no se reimprimió.");
        } else {
          toast?.(!res.linkTienda
            ? "Pedido facturado: " + res.record.cae + " (no se pudo subir el link a la tienda, se puede subir a mano desde Facturas emitidas)."
            : res.mailEnviado
              ? "Pedido facturado: " + res.record.cae + " — mail con la factura ya enviado al cliente."
              : "Pedido facturado: " + res.record.cae + " — link cargado en la tienda, pero el mail no salió solo (revisá Opciones o mandalo a mano).");
          window.api.imprimirFactura(res.id, ["ORIGINAL", "DUPLICADO"]);
        }
        setConf(null);
        await cargar();
      } else {
        toast?.("ARCA no aceptó: " + (res.observaciones || []).map((o) => o.msg).join(" · "), "error");
      }
    } catch (e) { toast?.(mensajeHumano(e), "error"); }
    finally { setWorking(false); facturandoRef.current = false; }
  }

  return (
    <>
      <header className="topbar">
        <h1>Pedidos web</h1>
        <button className="ghost" onClick={cargar}>Actualizar</button>
      </header>
      <p className="next" style={{ marginBottom: 16, padding: "12px 16px" }}>
        Pedidos de la tienda online que todavía <b>no tienen factura</b>. Al facturar, se genera la Factura B y se marca el CAE en el pedido (la web se lo muestra al cliente).
      </p>

      <table className="grid">
        <thead>
          <tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th className="r">Total</th><th></th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="6" className="empty"><span className="spin-row"><span className="spinner" /> Cargando pedidos…</span></td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan="6" className="empty">No hay pedidos pendientes de facturar.</td></tr>
          ) : (
            items.map((p) => (
              <tr key={p.id}>
                <td><b>#{p.numero}</b></td>
                <td>{p.fecha}</td>
                <td>{p.cliente}{p.dni ? ` · DNI ${p.dni}` : ""}</td>
                <td><span className={`pill ${p.pagado ? "online" : "cargando"}`} style={{ fontSize: 11 }}>{p.pagado ? "Pagado" : (p.pago || "—")}</span></td>
                <td className="r">{money(p.total)}</td>
                <td className="r"><button className="mini" onClick={() => setConf(p)}>Facturar</button></td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {conf && cargandoDetalle && (
        <div className="modal-bg"><div className="modal">
          <h2>Facturar pedido #{conf.numero}</h2>
          <p><span className="spin-row"><span className="spinner" /> Trayendo el detalle del pedido…</span></p>
        </div></div>
      )}

      {conf && !cargandoDetalle && detalle?.opciones && !receptorElegido && (
        <div className="modal-bg"><div className="modal">
          <h2>Hay más de una persona con ese DNI</h2>
          <p>Elegí el comprador correcto:</p>
          <div className="opciones">
            {detalle.opciones.map((p) => (
              <button key={p.cuit} className="opcion" onClick={() => elegirPersona(p)}>
                <b>{p.nombre}</b>
                <span>CUIT {p.cuit} · {p.condicion}</span>
              </button>
            ))}
          </div>
          <div className="modal-btns"><button className="ghost" onClick={() => setConf(null)}>Cancelar</button></div>
        </div></div>
      )}

      {conf && !cargandoDetalle && detalle && receptorElegido && (
        <div className="modal-bg"><div className="modal">
          <h2>Facturar pedido #{conf.numero}</h2>
          <table className="grid mini-grid" style={{ marginBottom: 12 }}>
            <tbody>
              {detalle.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.desc}{it.cantidad > 1 ? ` × ${it.cantidad}` : ""}</td>
                  <td className="r">{money(it.cantidad * it.precioUnit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Se va a emitir una <b>factura</b> a <b>{receptorElegido.nombre?.trim() ? receptorElegido.nombre : "Consumidor Final"}</b> por <b>{money(detalle.total)}</b>.</p>
          <p className="warn">Comprobante real y fiscal. Se marca el CAE en el pedido de la web.</p>
          <div className="modal-btns">
            <button className="ghost" onClick={() => setConf(null)} disabled={working}>Cancelar</button>
            <button onClick={facturar} disabled={working}>{working ? "Facturando…" : "Sí, facturar"}</button>
          </div>
        </div></div>
      )}
    </>
  );
}
