import React, { useEffect, useState } from "react";

const CLASE = { FACTURA: "Factura", NC: "Nota de Crédito", ND: "Nota de Débito" };
const fmt = (s) => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
const money = (n) => "$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 });
const comp = (f) => `${CLASE[f.clase] || f.clase} ${f.tipo} ${String(f.pto_vta).padStart(5, "0")}-${String(f.numero).padStart(8, "0")}`;

export default function Facturas() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [nota, setNota] = useState(null); // { clase, f }
  const [working, setWorking] = useState(false);
  const [compartir, setCompartir] = useState(null); // { f }
  const [cmedio, setCmedio] = useState("whatsapp");
  const [cdest, setCdest] = useState("");

  async function cargar(query = "") {
    setLoading(true);
    try { setItems(await window.api.listarFacturas(query)); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  async function imprimir(id) {
    setMsg("Generando PDF…");
    try { await window.api.imprimirFactura(id); setMsg("PDF abierto en el visor."); }
    catch (e) { setMsg("Error: " + (e?.message || e)); }
  }

  async function confirmarNota() {
    setWorking(true);
    try {
      const res = await window.api.emitirNota({ clase: nota.clase, facturaId: nota.f.id });
      if (res.ok) {
        setNota(null);
        setMsg(`${CLASE[nota.clase]} emitida.`);
        await cargar(q);
        window.api.imprimirFactura(res.id);
      } else {
        setMsg("Rechazada: " + (res.observaciones || []).map((o) => o.msg).join(" · "));
      }
    } catch (e) { setMsg("Error: " + (e?.message || e)); }
    finally { setWorking(false); }
  }

  async function confirmarCompartir() {
    setWorking(true);
    try {
      await window.api.compartirFactura({ id: compartir.f.id, medio: cmedio, destino: cdest });
      setCompartir(null); setCdest("");
      setMsg("Se abrió " + (cmedio === "whatsapp" ? "WhatsApp" : "el correo") + " y se mostró el PDF para adjuntar.");
    } catch (e) { setMsg("Error: " + (e?.message || e)); }
    finally { setWorking(false); }
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
        {msg && <span className="msg">{msg}</span>}
      </div>

      <table className="grid">
        <thead>
          <tr><th>Comprobante</th><th>Fecha</th><th>Cliente</th><th className="r">Total</th><th>CAE</th><th></th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="6" className="empty">Cargando…</td></tr>
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
                  <button className="ghost mini" onClick={() => imprimir(f.id)}>Reimprimir</button>
                  <button className="ghost mini" onClick={() => { setCompartir({ f }); setCmedio("whatsapp"); setCdest(""); }}>Compartir</button>
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
