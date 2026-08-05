import React, { useEffect, useRef, useState } from "react";

const CLASE = { FACTURA: "Factura", NC: "Nota de Crédito", ND: "Nota de Débito" };
const fmt = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
const money = (n) => "$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 });
const comp = (f) => `${CLASE[f.clase] || f.clase} ${f.tipo} ${String(f.pto_vta).padStart(5, "0")}-${String(f.numero).padStart(8, "0")}`;

export default function Facturas({ toast }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [nota, setNota] = useState(null); // { clase, f }
  const [working, setWorking] = useState(false);
  const [compartir, setCompartir] = useState(null); // { f }
  const [cmedio, setCmedio] = useState("whatsapp");
  const [cdest, setCdest] = useState("");
  const [link, setLink] = useState(null); // link público ya generado (medio "link")
  const [generandoLink, setGenerandoLink] = useState(false);
  const emitiendoRef = useRef(false); // guard síncrono anti doble-emisión (NC/ND)

  async function cargar(query = "") {
    setLoading(true);
    try { setItems(await window.api.listarFacturas(query)); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  async function imprimir(id) {
    try {
      const r = await window.api.imprimirFactura(id);
      if (!r) return; // canceló el guardado
      if (r.impreso) toast?.("Enviado a la impresora.");
      else toast?.("No se pudo imprimir automáticamente. Se abrió el PDF para imprimir a mano.", "error");
    } catch (e) { toast?.(e?.message || String(e), "error"); }
  }

  async function ver(id) {
    try { await window.api.verFactura(id); }
    catch (e) { toast?.(e?.message || String(e), "error"); }
  }

  async function confirmarNota() {
    if (emitiendoRef.current) return; // ya se está emitiendo: ignorar clics repetidos
    emitiendoRef.current = true;
    setWorking(true);
    try {
      const res = await window.api.emitirNota({ clase: nota.clase, facturaId: nota.f.id });
      if (res.ok) {
        setNota(null);
        toast?.(`${CLASE[nota.clase]} emitida.`);
        await cargar(q);
        window.api.imprimirFactura(res.id);
      } else {
        toast?.("Rechazada: " + (res.observaciones || []).map((o) => o.msg).join(" · "), "error");
      }
    } catch (e) { toast?.(e?.message || String(e), "error"); }
    finally { setWorking(false); emitiendoRef.current = false; }
  }

  async function confirmarCompartir() {
    setWorking(true);
    try {
      await window.api.compartirFactura({ id: compartir.f.id, medio: cmedio, destino: cdest });
      setCompartir(null); setCdest("");
      toast?.("Se abrió " + (cmedio === "whatsapp" ? "WhatsApp" : "el correo") + " y se mostró el PDF para adjuntar.");
    } catch (e) { toast?.(e?.message || String(e), "error"); }
    finally { setWorking(false); }
  }

  async function generarLink() {
    setGenerandoLink(true);
    try {
      const url = await window.api.subirFacturaPublica(compartir.f.id);
      setLink(url);
      try { await navigator.clipboard.writeText(url); toast?.("Link copiado ✓ — pegalo en la tienda."); }
      catch { toast?.("Se generó el link (no se pudo copiar solo, copialo de la caja)."); }
    } catch (e) { toast?.(e?.message || String(e), "error"); }
    finally { setGenerandoLink(false); }
  }

  return (
    <>
      <header className="topbar"><h1>Facturas emitidas</h1></header>
      <div className="toolbar">
        <input
          placeholder="Buscar por cliente, número o CAE…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cargar(q)}
        />
        <button onClick={() => cargar(q)}>Buscar</button>
      </div>

      <table className="grid">
        <thead>
          <tr><th>Comprobante</th><th>Fecha</th><th>Cliente</th><th className="r">Total</th><th>CAE</th><th></th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="6" className="empty"><span className="spin-row"><span className="spinner" /> Cargando…</span></td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan="6" className="empty">Sin comprobantes todavía.</td></tr>
          ) : (
            items.map((f) => (
              <tr key={f.id}>
                <td><b>{CLASE[f.clase] || f.clase} {f.tipo}</b> {String(f.pto_vta).padStart(5, "0")}-{String(f.numero).padStart(8, "0")}</td>
                <td>{fmt(f.fecha)}</td>
                <td>{f.receptor_nombre}</td>
                <td className="r">{money(f.total)}</td>
                <td className="cae">{f.cae || "—"}</td>
                <td className="acciones">
                  <button className="ghost mini" onClick={() => ver(f.id)}>Ver</button>
                  <button className="ghost mini" onClick={() => imprimir(f.id)}>Reimprimir</button>
                  <button className="ghost mini" onClick={() => { setCompartir({ f }); setCmedio("whatsapp"); setCdest(""); setLink(null); }}>Compartir</button>
                  {f.clase === "FACTURA" && (
                    <>
                      <button className="ghost mini" onClick={() => setNota({ clase: "NC", f })}>N. Crédito</button>
                      <button className="ghost mini" onClick={() => setNota({ clase: "ND", f })}>N. Débito</button>
                    </>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {nota && (
        <div className="modal-bg"><div className="modal">
          <h2>Emitir {CLASE[nota.clase]} {nota.f.tipo}</h2>
          <p>Asociada a la <b>{comp(nota.f)}</b> por <b>{money(nota.f.total)}</b>.</p>
          <p className="warn">Es un comprobante <b>real y fiscal</b>. {nota.clase === "NC" ? "La Nota de Crédito anula/devuelve ese importe." : "La Nota de Débito suma ese importe."}</p>
          <div className="modal-btns">
            <button className="ghost" onClick={() => setNota(null)} disabled={working}>Cancelar</button>
            <button onClick={confirmarNota} disabled={working}>{working ? "Emitiendo…" : "Sí, emitir"}</button>
          </div>
        </div></div>
      )}

      {compartir && (
        <div className="modal-bg"><div className="modal">
          <h2>Compartir comprobante</h2>
          <p><b>{comp(compartir.f)}</b> · {money(compartir.f.total)}</p>
          <div className="medio-tabs">
            <button className={cmedio === "whatsapp" ? "" : "ghost"} onClick={() => setCmedio("whatsapp")}>WhatsApp</button>
            <button className={cmedio === "email" ? "" : "ghost"} onClick={() => setCmedio("email")}>Email</button>
            <button className={cmedio === "link" ? "" : "ghost"} onClick={() => setCmedio("link")}>Link público</button>
          </div>

          {cmedio === "link" ? (
            <>
              <p className="hint-share" style={{ marginTop: 14 }}>
                Sube el PDF a un link público (para pegar en "Ver factura" de la tienda online, o mandarlo por donde quieras).
              </p>
              {link ? (
                <label className="fld">
                  <span>Link del comprobante</span>
                  <div className="cuit-row">
                    <input value={link} readOnly onFocus={(e) => e.target.select()} />
                    <button className="ghost" onClick={() => navigator.clipboard.writeText(link).then(() => toast?.("Copiado ✓"))}>Copiar</button>
                  </div>
                </label>
              ) : (
                <button className="emit-btn" style={{ marginTop: 10 }} disabled={generandoLink} onClick={generarLink}>
                  {generandoLink ? "Subiendo…" : "Generar y copiar link"}
                </button>
              )}
              <div className="modal-btns">
                <button className="ghost" onClick={() => setCompartir(null)}>Cerrar</button>
              </div>
            </>
          ) : (
            <>
              <label className="fld" style={{ marginTop: 14 }}>
                <span>{cmedio === "whatsapp" ? "Teléfono (con cód. de país, ej. 5493756...)" : "Email del cliente"}</span>
                <input value={cdest} onChange={(e) => setCdest(e.target.value)} placeholder={cmedio === "whatsapp" ? "5493756123456" : "cliente@correo.com"} />
              </label>
              <p className="hint-share">Se abre {cmedio === "whatsapp" ? "WhatsApp" : "el correo"} con el mensaje y se muestra el PDF para que lo adjuntes con un arrastre.</p>
              <div className="modal-btns">
                <button className="ghost" onClick={() => setCompartir(null)} disabled={working}>Cancelar</button>
                <button onClick={confirmarCompartir} disabled={working}>{working ? "Abriendo…" : "Compartir"}</button>
              </div>
            </>
          )}
        </div></div>
      )}
    </>
  );
}
