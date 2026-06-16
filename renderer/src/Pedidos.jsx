import React, { useEffect, useState } from "react";

const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });

export default function Pedidos({ toast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [conf, setConf] = useState(null); // pedido a facturar
  const [working, setWorking] = useState(false);

  async function cargar() {
    setLoading(true);
    try { setItems(await window.api.listarPedidos()); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  async function facturar() {
    setWorking(true);
    try {
      const res = await window.api.facturarPedido(conf.id);
      if (res.ok) {
        toast?.("Pedido facturado: " + res.record.cae);
        window.api.imprimirFactura(res.id, ["ORIGINAL", "DUPLICADO"]);
        setConf(null);
        await cargar();
      } else {
        toast?.("Rechazada: " + (res.observaciones || []).map((o) => o.msg).join(" · "), "error");
      }
    } catch (e) { toast?.(e?.message || String(e), "error"); }
    finally { setWorking(false); }
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
            <tr><td colSpan="6" className="empty">Cargando pedidos…</td></tr>
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

      {conf && (
        <div className="modal-bg"><div className="modal">
          <h2>Facturar pedido #{conf.numero}</h2>
          <p>Se va a emitir una <b>Factura B</b> a Consumidor Final por <b>{money(conf.total)}</b>.</p>
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
