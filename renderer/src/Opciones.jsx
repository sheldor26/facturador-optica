import React, { useEffect, useState } from "react";

export default function Opciones() {
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState(null);
  const [impresoras, setImpresoras] = useState([]);

  // Credenciales de la nube (por PC)
  const [credEstado, setCredEstado] = useState(null); // { configurada, email }
  const [credEmail, setCredEmail] = useState("");
  const [credPass, setCredPass] = useState("");
  const [credMsg, setCredMsg] = useState(null); // { ok, texto }
  const [credProbando, setCredProbando] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);

  useEffect(() => { window.api.getConfig().then(setCfg); }, []);
  useEffect(() => { window.api.listarImpresoras?.().then(setImpresoras).catch(() => {}); }, []);
  useEffect(() => {
    window.api.cloudEstadoCred?.().then((e) => { setCredEstado(e); if (e?.email) setCredEmail(e.email); }).catch(() => {});
  }, []);

  async function guardarCred() {
    if (!credEmail.trim() || !credPass) { setCredMsg({ ok: false, texto: "Completá email y contraseña." }); return; }
    setCredProbando(true); setCredMsg(null);
    try {
      const prueba = await window.api.cloudProbarCred({ email: credEmail, password: credPass });
      if (!prueba.ok) { setCredMsg({ ok: false, texto: prueba.error || "No se pudo verificar." }); return; }
      await window.api.cloudGuardarCred({ email: credEmail, password: credPass });
      setCredPass("");
      setCredEstado({ configurada: true, email: credEmail.trim() });
      setCredMsg({ ok: true, texto: "Nube conectada en esta PC ✓" });
    } catch (e) { setCredMsg({ ok: false, texto: e?.message || String(e) }); }
    finally { setCredProbando(false); }
  }

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

  async function exportarRespaldo() {
    try {
      const ruta = await window.api.exportarDatos();
      if (ruta) { setExportMsg("Respaldo guardado ✓"); setTimeout(() => setExportMsg(null), 3000); }
    } catch { setExportMsg("No se pudo exportar"); }
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

        <label className="fld" style={{ maxWidth: 220, marginTop: 8 }}>
          <span>Punto de venta</span>
          <input className="num" type="number" min="1" value={cfg.ptoVta ?? 7}
            onChange={(e) => guardar({ ptoVta: Number(e.target.value) || 1 })} />
          <small className="good">El punto de venta habilitado en ARCA con el que se emiten las facturas.</small>
        </label>
      </section>

      <section className="opt">
        <div className="opt-row">
          <div>
            <div className="opt-title">Impresión</div>
            <div className="opt-desc">Al emitir una factura (o crear un presupuesto) se manda directo a la impresora.</div>
          </div>
        </div>

        <label className="opt-check">
          <input
            type="checkbox"
            checked={cfg.autoImprimir !== false}
            onChange={(e) => guardar({ autoImprimir: e.target.checked })}
          />
          <span>
            <b>Imprimir automáticamente</b>
            <small>Si está desactivado, en lugar de imprimir se abre el PDF para que imprimas a mano.</small>
          </span>
        </label>

        <div className="opt-folder">
          <select
            value={cfg.impresora || ""}
            onChange={(e) => guardar({ impresora: e.target.value })}
            style={{ flex: 1, padding: "10px 12px", borderRadius: 10 }}
          >
            <option value="">Impresora predeterminada del sistema</option>
            {impresoras.map((p) => (
              <option key={p.name} value={p.name}>{p.displayName}{p.isDefault ? " (predeterminada)" : ""}</option>
            ))}
          </select>
          <button onClick={() => window.api.listarImpresoras?.().then(setImpresoras).catch(() => {})}>Actualizar</button>
        </div>

        <label className="opt-check">
          <input
            type="checkbox"
            checked={!!cfg.dialogoImpresion}
            onChange={(e) => guardar({ dialogoImpresion: e.target.checked })}
          />
          <span>
            <b>Mostrar el diálogo de impresión</b>
            <small>Activalo si preferís confirmar la impresora y las copias cada vez, en lugar de imprimir directo.</small>
          </span>
        </label>
      </section>

      <section className="opt">
        <div className="opt-row">
          <div>
            <div className="opt-title">Nube (sincronización entre computadoras)</div>
            <div className="opt-desc">
              La contraseña se guarda solo en esta computadora, no viaja con la app. Ingresala una vez por PC.
              {credEstado && (
                <> {credEstado.configurada
                  ? <b style={{ color: "var(--ok)" }}> · Conectada{credEstado.email ? ` como ${credEstado.email}` : ""}.</b>
                  : <b style={{ color: "var(--err)" }}> · Sin configurar en esta PC.</b>}</>
              )}
            </div>
          </div>
        </div>

        <label className="fld" style={{ maxWidth: 420 }}>
          <span>Email de la nube</span>
          <input type="email" value={credEmail} autoComplete="off"
            onChange={(e) => setCredEmail(e.target.value)} placeholder="facturador@opticacarballo.com" />
        </label>
        <label className="fld" style={{ maxWidth: 420 }}>
          <span>Contraseña de la nube</span>
          <input type="password" value={credPass} autoComplete="new-password"
            onChange={(e) => setCredPass(e.target.value)} placeholder="••••••••" />
        </label>
        <div className="opt-folder">
          <button onClick={guardarCred} disabled={credProbando}>{credProbando ? "Verificando…" : "Probar y guardar"}</button>
          {credMsg && <small className={credMsg.ok ? "good" : "bad"} style={{ alignSelf: "center" }}>{credMsg.texto}</small>}
        </div>
      </section>

      <section className="opt">
        <div className="opt-row">
          <div>
            <div className="opt-title">Resguardo de datos</div>
            <div className="opt-desc">Se hace una copia automática de la base cada día (se guardan las últimas 7). Además podés exportar un respaldo ahora a donde quieras.</div>
          </div>
        </div>
        <div className="opt-folder">
          <button onClick={exportarRespaldo}>Exportar respaldo ahora…</button>
          {exportMsg && <small className="good" style={{ alignSelf: "center" }}>{exportMsg}</small>}
        </div>
      </section>
    </>
  );
}
