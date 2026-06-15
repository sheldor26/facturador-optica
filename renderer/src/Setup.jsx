import React, { useState } from "react";

const COND_IVA = ["IVA Responsable Inscripto", "Responsable Monotributo", "IVA Sujeto Exento"];

export default function Setup({ onReady }) {
  const [cert, setCert] = useState(null); // { nombre, contenido }
  const [key, setKey] = useState(null);
  const [logo, setLogo] = useState(null); // { nombre, base64 }
  const [em, setEm] = useState({
    nombreFantasia: "", razonSocial: "", cuit: "", condicionIva: "IVA Responsable Inscripto",
    domicilio: "", iibb: "", inicioActividades: "", rubro: "Óptica", telefono: "", web: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const set = (k, v) => setEm((e) => ({ ...e, [k]: v }));

  async function elegir(tipo) {
    const r = await window.api.setupElegirArchivo(tipo);
    if (!r) return;
    if (tipo === "cert") setCert(r);
    else if (tipo === "key") setKey(r);
    else setLogo(r);
  }

  const cuitOk = /^\d{11}$/.test(String(em.cuit).replace(/\D/g, ""));
  const puede = cert && key && cuitOk && em.razonSocial.trim() && em.nombreFantasia.trim();

  async function guardar() {
    setGuardando(true); setError(null);
    try {
      await window.api.setupGuardar({
        certPem: cert.contenido,
        keyPem: key.contenido,
        emisor: { ...em, cuit: String(em.cuit).replace(/\D/g, "") },
        logoNombre: logo ? logo.nombre : null,
        logoBase64: logo ? logo.base64 : null,
      });
      onReady();
    } catch (e) { setError(e?.message || String(e)); setGuardando(false); }
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>Configuración inicial</h1>
        <p className="setup-sub">Cargá una sola vez el certificado y los datos del comercio en esta PC.</p>

        <h3>Certificado fiscal</h3>
        <div className="setup-files">
          <button className="ghost" onClick={() => elegir("cert")}>Elegir certificado (.crt)</button>
          <span>{cert ? "✓ " + cert.nombre : "sin elegir"}</span>
        </div>
        <div className="setup-files">
          <button className="ghost" onClick={() => elegir("key")}>Elegir clave privada (.key)</button>
          <span>{key ? "✓ " + key.nombre : "sin elegir"}</span>
        </div>

        <h3>Datos del comercio</h3>
        <div className="setup-grid">
          <label className="fld"><span>Nombre del comercio</span><input value={em.nombreFantasia} onChange={(e) => set("nombreFantasia", e.target.value)} placeholder="Laboratorio Óptico Carballo" /></label>
          <label className="fld"><span>Razón social</span><input value={em.razonSocial} onChange={(e) => set("razonSocial", e.target.value)} placeholder="MIRANDE JUAN LEOPOLDO" /></label>
          <label className="fld"><span>CUIT</span><input value={em.cuit} onChange={(e) => set("cuit", e.target.value)} placeholder="20168521821" />{em.cuit && !cuitOk && <small className="bad">11 dígitos</small>}</label>
          <label className="fld"><span>Condición frente al IVA</span><select value={em.condicionIva} onChange={(e) => set("condicionIva", e.target.value)}>{COND_IVA.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="fld"><span>Domicilio comercial</span><input value={em.domicilio} onChange={(e) => set("domicilio", e.target.value)} placeholder="Av. Lavalle 2686 - Virasoro" /></label>
          <label className="fld"><span>Ingresos Brutos</span><input value={em.iibb} onChange={(e) => set("iibb", e.target.value)} placeholder="20168521821" /></label>
          <label className="fld"><span>Inicio de actividades</span><input value={em.inicioActividades} onChange={(e) => set("inicioActividades", e.target.value)} placeholder="01/09/2000" /></label>
          <label className="fld"><span>Rubro (bajada del logo)</span><input value={em.rubro} onChange={(e) => set("rubro", e.target.value)} placeholder="Óptica" /></label>
        </div>
        <div className="setup-files">
          <button className="ghost" onClick={() => elegir("logo")}>Elegir logo (opcional)</button>
          <span>{logo ? "✓ " + logo.nombre : "sin logo"}</span>
        </div>

        {error && <div className="alert">{error}</div>}
        <button className="emit-btn" disabled={!puede || guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Guardar y empezar"}
        </button>
      </div>
    </div>
  );
}
