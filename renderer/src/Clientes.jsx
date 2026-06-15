import React, { useEffect, useState } from "react";

const COND = ["IVA Responsable Inscripto", "Responsable Monotributo", "IVA Sujeto Exento", "Consumidor Final"];
const vacio = () => ({ cuit: "", nombre: "", condicion: "IVA Responsable Inscripto", domicilio: "" });

export default function Clientes() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(vacio());
  const [buscando, setBuscando] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function cargar(query = "") { setItems(await window.api.listarClientes(query)); }
  useEffect(() => { cargar(); }, []);

  async function buscar() {
    const d = String(form.cuit).replace(/\D/g, "");
    if (!/^\d{7,8}$/.test(d) && !/^\d{11}$/.test(d)) { setMsg("Poné un CUIT (11) o DNI (7-8)."); return; }
    setBuscando(true); setMsg(null);
    try {
      const { personas } = await window.api.consultarPadron(d);
      const p = personas[0];
      setForm({ cuit: String(p.cuit), nombre: p.nombre || "", condicion: p.condicion, domicilio: p.domicilio || "" });
      if (personas.length > 1) setMsg("Había varias personas; tomé la primera. Editá si hace falta.");
    } catch (e) { setMsg(e?.message || String(e)); }
    finally { setBuscando(false); }
  }

  const cuitOk = /^\d{11}$/.test(String(form.cuit).replace(/\D/g, ""));
  const puede = cuitOk && form.nombre.trim();

  async function guardar() {
    await window.api.guardarCliente(form);
    setForm(vacio()); setMsg("Cliente guardado.");
    await cargar(q);
  }
  async function eliminar(cuit) {
    await window.api.eliminarCliente(cuit);
    await cargar(q);
  }

  return (
    <>
      <header className="topbar"><h1>Clientes</h1>{msg && <span className="pill online">{msg}</span>}</header>

      <section className="panel" style={{ marginBottom: 18 }}>
        <h3>Registrar cliente</h3>
        <div className="cli-form">
          <label className="fld"><span>CUIT / DNI</span>
            <div className="cuit-row">
              <input value={form.cuit} onChange={(e) => set("cuit", e.target.value)} placeholder="30-12345678-9" onKeyDown={(e) => e.key === "Enter" && buscar()} />
              <button className="ghost" onClick={buscar} disabled={buscando}>{buscando ? "Buscando…" : "Buscar en ARCA"}</button>
            </div>
            {form.cuit && !cuitOk && <small className="bad">CUIT de 11 dígitos</small>}
          </label>
          <label className="fld"><span>Nombre / Razón social</span><input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Empresa S.A." /></label>
          <label className="fld"><span>Condición frente al IVA</span><select value={form.condicion} onChange={(e) => set("condicion", e.target.value)}>{COND.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="fld"><span>Domicilio</span><input value={form.domicilio} onChange={(e) => set("domicilio", e.target.value)} placeholder="Calle 123 - Ciudad" /></label>
        </div>
        <button className="emit-btn" style={{ maxWidth: 220, marginTop: 6 }} disabled={!puede} onClick={guardar}>Guardar cliente</button>
      </section>

      <div className="toolbar">
        <input placeholder="Buscar por nombre o CUIT…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cargar(q)} />
        <button onClick={() => cargar(q)}>Buscar</button>
      </div>

      <table className="grid">
        <thead><tr><th>Nombre / Razón social</th><th>CUIT</th><th>Condición</th><th>Domicilio</th><th></th></tr></thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan="5" className="empty">Sin clientes guardados todavía.</td></tr>
          ) : (
            items.map((c) => (
              <tr key={c.cuit}>
                <td><b>{c.nombre}</b></td>
                <td className="cae">{c.cuit}</td>
                <td>{c.condicion}</td>
                <td>{c.domicilio || "—"}</td>
                <td className="r"><button className="del mini" onClick={() => eliminar(c.cuit)} title="Eliminar">×</button></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
