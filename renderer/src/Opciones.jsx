import React, { useEffect, useState } from "react";

export default function Opciones() {
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => { window.api.getConfig().then(setCfg); }, []);

  async function guardar(patch) {
    const nuevo = await window.api.setConfig(patch);
    setCfg(nuevo);
    setMsg("Guardado.");
    setTimeout(() => setMsg(null), 1500);
  }

  async function elegir() {
    const ruta = await window.api.elegirCarpeta();
    if (ruta) guardar({ carpetaFacturas: ruta });
  }

  if (!cfg) return <div className="topbar"><h1>Opciones</h1></div>;

  return (
    <>
      <header className="topbar"><h1>Opciones</h1>{msg && <span className="pill online">{msg}</span>}</header>

      <section className="opt">
        <div className="opt-row">
          <div>
            <div className="opt-title">Carpeta donde se guardan las facturas</div>
            <div className="opt-desc">Los PDF se guardan acá con el nombre oficial de ARCA (CUIT_Tipo_PtoVenta_Número.pdf).</div>
          </div>
        </div>
        <div className="opt-folder">
          <code>{cfg.carpetaFacturas || "(sin definir)"}</code>
          <button onClick={elegir}>Cambiar carpeta…</button>
        </div>

        <label className="opt-check">
          <input
            type="checkbox"
            checked={!!cfg.preguntarDonde}
            onChange={(e) => guardar({ preguntarDonde: e.target.checked })}
          />
          <span>
            <b>Preguntar dónde guardar cada vez</b>
            <small>Si está activado, al reimprimir abre un diálogo para elegir la ubicación. Si no, guarda directo en la carpeta de arriba.</small>
          </span>
        </label>
      </section>
    </>
  );
}
