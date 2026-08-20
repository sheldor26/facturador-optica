import React, { useEffect, useRef, useState } from "react";
import { mensajeHumano } from "./errores.js";

const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });

export default function Pedidos({ toast }) {
  const [items, setItems] = useState([]);
  const [ordenes, setOrdenes] = useState([]); // las del sistema de la óptica
  const [errorGestion, setErrorGestion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [conf, setConf] = useState(null); // pedido a facturar
  const [detalle, setDetalle] = useState(null); // { items, receptor, opciones, total }
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [receptorElegido, setReceptorElegido] = useState(null); // cuando hay varias personas con el mismo DNI
  const [working, setWorking] = useState(false);
  const [candado, setCandado] = useState(null); // pedido trabado por una PC que no terminó
  const [docNro, setDocNro] = useState(""); // el documento con el que va a salir la factura
  const [descartar, setDescartar] = useState(null); // orden que al final no lleva factura
  const facturandoRef = useRef(false); // guard síncrono anti doble-emisión

  /*
   * Dos fuentes de trabajo, una sola pantalla.
   *
   * Las órdenes salen del sistema de la óptica y los pedidos de la tienda web. Lo que
   * cambia es de dónde vienen; lo que se hace con ellos —mirar el detalle, confirmar,
   * emitir— es idéntico, así que comparten los mismos botones y el mismo candado.
   *
   * Si el sistema de la óptica no contesta, los pedidos de la tienda se muestran igual:
   * que una de las dos esté caída no puede dejar la pantalla vacía.
   */
  async function cargar() {
    setLoading(true);
    try {
      const [pedidos, deGestion] = await Promise.all([
        window.api.listarPedidos().catch(() => []),
        window.api.listarOrdenes?.().catch(() => ({ ordenes: [] })) ?? { ordenes: [] },
      ]);
      setItems((pedidos || []).map((p) => ({ ...p, origen: "tienda" })));
      setOrdenes(deGestion?.ordenes || []);
      setErrorGestion(deGestion?.error || null);
    } finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  // Al abrir "Facturar", trae el detalle real antes de dejar confirmar — así no se emite
  // una factura fiscal a ciegas. Las órdenes de la óptica ya lo traen puesto: el detalle
  // y el comprador se resuelven allá, que es donde se cargó el trabajo.
  useEffect(() => {
    if (!conf) { setDetalle(null); setReceptorElegido(null); return; }
    if (conf.origen === "optica") {
      setDetalle(conf.detalle);
      setReceptorElegido(conf.detalle.receptor);
      setDocNro(conf.detalle.receptor?.docNro || "");
      return;
    }
    setCargandoDetalle(true);
    window.api.pedidoDetalle(conf.id)
      .then((d) => { setDetalle(d); setReceptorElegido(d.opciones ? null : d.receptor); })
      .catch((e) => { toast?.(mensajeHumano(e), "error"); setConf(null); })
      .finally(() => setCargandoDetalle(false));
  }, [conf]);

  /*
   * "AL FINAL NO LA QUIERE."
   *
   * Pidió factura al cobrar y después se arrepintió. Saca la orden de la lista sin
   * emitir nada. No toca la plata: el cobro sigue cobrado y la ficha saldada — lo único
   * que cambia es que deja de esperar comprobante.
   *
   * Sólo sirve ANTES de emitir. Después, el comprobante existe en ARCA y sacarlo de una
   * lista no lo hace desaparecer: ahí la salida es una Nota de Crédito, en Facturas
   * emitidas. Si justo otra computadora la facturó en el medio, el sistema contesta eso
   * y se muestra tal cual.
   */
  async function confirmarDescarte() {
    setWorking(true);
    try {
      await window.api.descartarOrden(descartar.id, "");
      toast?.(`La orden ${descartar.numero ? "#" + descartar.numero : ""} ya no espera factura.`);
      setDescartar(null);
      await cargar();
    } catch (e) { toast?.(mensajeHumano(e), "error"); }
    finally { setWorking(false); }
  }

  function elegirPersona(p) {
    setReceptorElegido({ receptorCond: p.condicion, docNro: String(p.cuit), nombre: p.nombre, domicilio: p.domicilio });
  }

  // OJO: siempre invocarla como `facturar()` y no como `onClick={facturar}`, o el evento
  // del clic llega como primer argumento y `tomarIgual` sale verdadero sin que nadie lo pida.
  async function facturar(tomarIgual = false) {
    if (facturandoRef.current) return; // ya se está facturando: ignorar clics repetidos
    facturandoRef.current = true;
    setWorking(true);
    setCandado(null);
    try {
      const res = conf.origen === "optica"
        ? await window.api.facturarOrden(conf.id, { tomarIgual, docNro })
        : await window.api.facturarPedido(conf.id, receptorElegido, { tomarIgual });
      if (res.ok) {
        const deLaOptica = conf.origen === "optica";
        if (res.yaExistia) {
          toast?.(deLaOptica
            ? "Esta orden ya se había facturado acá (" + res.record.cae + ") — sólo no se había podido avisar al sistema. Se reintentó el aviso; no se reimprimió."
            : "Este pedido ya se había facturado acá (" + res.record.cae + ") — solo no se había avisado a la tienda. Se reintentó el aviso; no se reimprimió.");
        } else if (deLaOptica) {
          // Sin link ni mail: eso es de la tienda. Acá el aviso vuelve al sistema de la
          // óptica, que es donde el CAE queda pegado a la ficha.
          if (res.rescatada) {
            toast?.("Esta factura ya estaba emitida en ARCA y no había quedado guardada acá. Se recuperó con su CAE original; no se emitió una nueva.", "error");
          }
          toast?.("Orden facturada: " + res.record.cae);
          window.api.imprimirFactura(res.id, ["ORIGINAL", "DUPLICADO"]);
        } else {
          if (res.corregidoAConsumidorFinal) {
            toast?.("ARCA no aceptó la condición de IVA del comprador identificado, así que se facturó como Consumidor Final para no dejarlo sin facturar. Revisalo si hace falta.", "error");
          }
          toast?.(!res.linkTienda
            ? "Pedido facturado: " + res.record.cae + " (no se pudo subir el link a la tienda, se puede subir a mano desde Facturas emitidas)."
            : res.mailEnviado
              ? "Pedido facturado: " + res.record.cae + " — mail con la factura ya enviado al cliente."
              : "Pedido facturado: " + res.record.cae + " — link cargado en la tienda, pero el mail no salió solo (revisá Opciones o mandalo a mano).");
          window.api.imprimirFactura(res.id, ["ORIGINAL", "DUPLICADO"]);
        }
        setConf(null);
        await cargar();
      } else if (res.tomadoPorOtra) {
        const t = res.tomadoPorOtra;
        if (t.yaFacturado) {
          toast?.("Ese pedido ya lo facturó otra computadora (CAE " + t.cae + ").", "error");
          setConf(null); await cargar();
        } else if (!t.vencido) {
          toast?.(`Lo está facturando ${t.quien} en este momento. Esperá unos segundos y actualizá la lista.`, "error");
        } else {
          setCandado(t); // quedó trabado hace rato: que decida una persona
        }
      } else {
        toast?.("ARCA no aceptó: " + (res.observaciones || []).map((o) => o.msg).join(" · "), "error");
      }
    } catch (e) { toast?.(mensajeHumano(e), "error"); }
    finally { setWorking(false); facturandoRef.current = false; }
  }

  return (
    <>
      <header className="topbar">
        <h1>Para facturar</h1>
        <button className="ghost" onClick={cargar}>Actualizar</button>
      </header>

      <h2 style={{ margin: "0 0 8px", fontSize: "1.05rem" }}>Órdenes de la óptica</h2>
      <p className="next" style={{ marginBottom: 16, padding: "12px 16px" }}>
        Cobros del mostrador en los que la persona <b>pidió factura</b>. El detalle y los precios
        vienen del sistema; la graduación no va en la factura.
        {errorGestion && <><br /><b className="warn">No se pudo consultar el sistema de la óptica: {errorGestion}</b></>}
      </p>

      <table className="grid" style={{ marginBottom: 28 }}>
        <thead>
          <tr><th>Orden</th><th>Fecha</th><th>Cliente</th><th className="r">Importe</th><th></th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="5" className="empty"><span className="spin-row"><span className="spinner" /> Buscando…</span></td></tr>
          ) : ordenes.length === 0 ? (
            <tr><td colSpan="5" className="empty">No hay cobros esperando factura.</td></tr>
          ) : (
            ordenes.map((o) => (
              <tr key={o.id}>
                <td><b>{o.numero ? "#" + o.numero : "—"}</b></td>
                <td>{o.fecha}</td>
                <td>{o.cliente}{o.dni ? ` · ${o.dni}` : ""}</td>
                <td className="r">{money(o.total)}</td>
                <td className="r">
                  <button className="mini" onClick={() => setConf(o)}>Facturar</button>
                  {" "}
                  <button className="mini ghost" onClick={() => setDescartar(o)}>No la quiere</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h2 style={{ margin: "0 0 8px", fontSize: "1.05rem" }}>Pedidos de la tienda</h2>
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
                <td className="r">{p.loTiene
                  ? <small className="warn">Lo está facturando {p.loTiene}</small>
                  : <button className="mini" onClick={() => setConf(p)}>Facturar</button>}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {conf && cargandoDetalle && (
        <div className="modal-bg"><div className="modal">
          <h2>Facturar {conf.origen === "optica" ? "orden" : "pedido"} #{conf.numero}</h2>
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
          <h2>Facturar {conf.origen === "optica" ? "orden" : "pedido"} #{conf.numero}</h2>
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

          {/*
            El último toque al documento se da acá, con la persona enfrente.
            Viene puesto lo que sabe el sistema —lo que se anotó al cobrar, o lo que
            quedó guardado en la ficha de otra factura anterior— y se puede cambiar o
            borrar. Vacío significa Consumidor Final sin identificar, que es lo más
            común en el mostrador y es perfectamente válido.

            Lo que se use vuelve al sistema y queda en la ficha del cliente: la próxima
            vez ya viene escrito y no hay que volver a pedírselo.
          */}
          {conf.origen === "optica" && (
            <label className="fld" style={{ maxWidth: 280 }}>
              <span>DNI o CUIT (vacío = Consumidor Final)</span>
              <input
                value={docNro}
                inputMode="numeric"
                autoComplete="off"
                disabled={working}
                onChange={(e) => setDocNro(e.target.value)}
                placeholder="Sin documento"
              />
            </label>
          )}
          <p className="warn">Comprobante real y fiscal. {conf.origen === "optica"
            ? "El CAE queda guardado en la ficha de la orden."
            : "Se marca el CAE en el pedido de la web."}</p>
          <div className="modal-btns">
            <button className="ghost" onClick={() => setConf(null)} disabled={working}>Cancelar</button>
            <button onClick={() => facturar()} disabled={working}>{working ? "Facturando…" : "Sí, facturar"}</button>
          </div>
        </div></div>
      )}

      {/*
        El candado quedó puesto hace rato. Casi siempre significa que esa computadora se
        apagó a mitad; pero "casi siempre" no alcanza para decidirlo solo, porque el caso
        que falta es el que emite la factura dos veces. Decide una persona, con el dato de
        quién lo tenía y desde cuándo a la vista.
      */}
      {descartar && (
        <div className="modal-bg"><div className="modal">
          <h2>¿No quiere la factura?</h2>
          <p>
            La orden <b>{descartar.numero ? "#" + descartar.numero : "de mostrador"}</b> de{" "}
            <b>{descartar.cliente}</b> por <b>{money(descartar.total)}</b> deja de esperar factura
            y desaparece de esta lista.
          </p>
          <p className="warn">
            No se toca la plata: el cobro sigue cobrado y la ficha saldada. Sólo deja de
            esperar comprobante.
          </p>
          <div className="modal-btns">
            <button className="ghost" onClick={() => setDescartar(null)} disabled={working}>Volver</button>
            <button onClick={confirmarDescarte} disabled={working}>
              {working ? "Sacando…" : "Sí, no la quiere"}
            </button>
          </div>
        </div></div>
      )}

      {candado && (
        <div className="modal-bg"><div className="modal">
          <h2>Este pedido quedó trabado</h2>
          <p><b>{candado.quien}</b> lo tomó para facturar hace {candado.minutos} minutos y nunca terminó.
            Lo más probable es que esa computadora se haya apagado o cerrado el programa a mitad.</p>
          <p className="warn">
            Antes de tomarlo, asegurate de que esa computadora no esté facturándolo ahora mismo.
            Si llegó a emitir y vos lo emitís de nuevo, salen dos facturas por la misma venta.
          </p>
          <div className="modal-btns">
            <button className="ghost" onClick={() => setCandado(null)} disabled={working}>Mejor no</button>
            <button onClick={() => facturar(true)} disabled={working}>{working ? "Facturando…" : "Tomarlo y facturar"}</button>
          </div>
        </div></div>
      )}
    </>
  );
}
