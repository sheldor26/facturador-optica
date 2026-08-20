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

  // Tienda online (URL + secreto, por PC): avisar por mail al facturar un pedido web
  const [tiendaEstado, setTiendaEstado] = useState(null); // { configurada, apiUrl }
  const [tiendaUrl, setTiendaUrl] = useState("");
  const [tiendaSecreto, setTiendaSecreto] = useState("");
  const [tiendaMsg, setTiendaMsg] = useState(null); // { ok, texto }
  const [tiendaGuardando, setTiendaGuardando] = useState(false);

  useEffect(() => { window.api.getConfig().then(setCfg); }, []);
  useEffect(() => { window.api.listarImpresoras?.().then(setImpresoras).catch(() => {}); }, []);
  useEffect(() => {
    window.api.cloudEstadoCred?.().then((e) => { setCredEstado(e); if (e?.email) setCredEmail(e.email); }).catch(() => {});
  }, []);
  useEffect(() => {
    window.api.tiendaEstadoCred?.().then((e) => { setTiendaEstado(e); if (e?.apiUrl) setTiendaUrl(e.apiUrl); }).catch(() => {});
  }, []);

  async function guardarTienda() {
    if (!tiendaUrl.trim() || !tiendaSecreto) { setTiendaMsg({ ok: false, texto: "Completá la URL y el secreto." }); return; }
    setTiendaGuardando(true); setTiendaMsg(null);
    try {
      await window.api.tiendaGuardarCred({ apiUrl: tiendaUrl, apiSecret: tiendaSecreto });
      setTiendaSecreto("");
      setTiendaEstado({ configurada: true, apiUrl: tiendaUrl.trim() });
      setTiendaMsg({ ok: true, texto: "Guardado ✓ — se prueba solo la próxima vez que factures un pedido web." });
    } catch (e) { setTiendaMsg({ ok: false, texto: e?.message || String(e) }); }
    finally { setTiendaGuardando(false); }
  }

  // Sistema de la óptica (órdenes de trabajo del mostrador), por PC
  const [gesEstado, setGesEstado] = useState(null);
  const [gesUrl, setGesUrl] = useState("");
  const [gesSecreto, setGesSecreto] = useState("");
  const [gesMsg, setGesMsg] = useState(null);
  const [gesGuardando, setGesGuardando] = useState(false);

  useEffect(() => {
    window.api.gestionEstadoCred?.().then((e) => { setGesEstado(e); if (e?.apiUrl) setGesUrl(e.apiUrl); }).catch(() => {});
  }, []);

  async function guardarGestion() {
    if (!gesUrl.trim() || !gesSecreto) { setGesMsg({ ok: false, texto: "Completá la dirección y la clave." }); return; }
    setGesGuardando(true); setGesMsg(null);
    try {
      await window.api.gestionGuardarCred({ apiUrl: gesUrl, apiSecret: gesSecreto });
      setGesSecreto("");
      setGesEstado({ configurada: true, apiUrl: gesUrl.trim() });
      setGesMsg({ ok: true, texto: "Guardado ✓ — las órdenes listas para facturar aparecen en Pedidos." });
    } catch (e) { setGesMsg({ ok: false, texto: e?.message || String(e) }); }
    finally { setGesGuardando(false); }
  }

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

  // Revisar numeración: comparar hasta dónde llegó ARCA contra lo que hay en esta base.
  const [numRes, setNumRes] = useState(null);
  const [numTrabajando, setNumTrabajando] = useState("");

  async function revisarNumeracion(recuperar) {
    setNumTrabajando(recuperar ? "recuperando" : "revisando");
    setNumRes(null);
    try { setNumRes(await window.api.revisarNumeracion(recuperar)); }
    catch (e) { setNumRes({ error: e?.message || String(e) }); }
    finally { setNumTrabajando(""); }
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
            <div className="opt-title">Tienda online (avisar factura por mail)</div>
            <div className="opt-desc">
              Al facturar un pedido web, además de subir el link, se le avisa a la tienda para que le mande el mail al cliente sola — sin entrar a tildar el casillero a mano.
              {tiendaEstado && (
                <> {tiendaEstado.configurada
                  ? <b style={{ color: "var(--ok)" }}> · Configurada ({tiendaEstado.apiUrl}).</b>
                  : <b style={{ color: "var(--err)" }}> · Sin configurar en esta PC (el link se sube igual, pero sin mail automático).</b>}</>
              )}
            </div>
          </div>
        </div>

        <label className="fld" style={{ maxWidth: 420 }}>
          <span>URL de la tienda</span>
          <input value={tiendaUrl} autoComplete="off"
            onChange={(e) => setTiendaUrl(e.target.value)} placeholder="https://www.opticacarballo.com.ar" />
        </label>
        <label className="fld" style={{ maxWidth: 420 }}>
          <span>Secreto (FACTURADOR_API_SECRET de la tienda)</span>
          <input type="password" value={tiendaSecreto} autoComplete="new-password"
            onChange={(e) => setTiendaSecreto(e.target.value)} placeholder="••••••••" />
        </label>
        <div className="opt-folder">
          <button onClick={guardarTienda} disabled={tiendaGuardando}>{tiendaGuardando ? "Guardando…" : "Guardar"}</button>
          {tiendaMsg && <small className={tiendaMsg.ok ? "good" : "bad"} style={{ alignSelf: "center" }}>{tiendaMsg.texto}</small>}
        </div>
      </section>

      <section className="opt">
        <div className="opt-row">
          <div>
            <div className="opt-title">Sistema de la óptica (órdenes de trabajo)</div>
            <div className="opt-desc">
              Las órdenes ya entregadas y cobradas aparecen en <b>Pedidos</b> para facturarlas,
              con el detalle y los precios que se cargaron en el mostrador. La graduación no viaja:
              no va en la factura.
              {gesEstado && (
                <> {gesEstado.configurada
                  ? <b style={{ color: "var(--ok)" }}> · Conectado a {gesEstado.apiUrl}.</b>
                  : <b style={{ color: "var(--err)" }}> · Sin configurar en esta PC (las órdenes no se van a ver).</b>}</>
              )}
            </div>
          </div>
        </div>
        <label className="fld" style={{ maxWidth: 420 }}>
          <span>Dirección del sistema</span>
          <input value={gesUrl} autoComplete="off"
            onChange={(e) => setGesUrl(e.target.value)} placeholder="http://localhost:3000" />
        </label>
        <label className="fld" style={{ maxWidth: 420 }}>
          <span>Clave</span>
          <input type="password" value={gesSecreto} autoComplete="new-password"
            onChange={(e) => setGesSecreto(e.target.value)} placeholder="••••••••" />
        </label>
        <div className="opt-folder">
          <button onClick={guardarGestion} disabled={gesGuardando}>{gesGuardando ? "Guardando…" : "Guardar"}</button>
          {gesMsg && <small className={gesMsg.ok ? "good" : "bad"} style={{ alignSelf: "center" }}>{gesMsg.texto}</small>}
        </div>
      </section>

      <section className="opt">
        <div className="opt-row">
          <div>
            <div className="opt-title">Revisar numeración</div>
            <div className="opt-desc">
              Compara hasta qué número llegó ARCA con lo que hay guardado acá. Si un día se corta
              la luz o internet justo mientras se emitía, puede pasar que ARCA autorice el
              comprobante y esta base no llegue a guardarlo: acá aparece, y se puede traer.
              Correlo después de un corte, o si el contador pregunta por un salto en la numeración.
            </div>
          </div>
        </div>
        <div className="opt-folder">
          <button onClick={() => revisarNumeracion(false)} disabled={!!numTrabajando}>
            {numTrabajando === "revisando" ? "Revisando…" : "Revisar ahora"}
          </button>
          {numRes?.faltantes?.length > 0 && !numRes.recuperados?.length && (
            <button onClick={() => revisarNumeracion(true)} disabled={!!numTrabajando}>
              {numTrabajando === "recuperando" ? "Trayéndolos…" : "Traerlos de ARCA"}
            </button>
          )}
        </div>
        {numRes && (
          <div className="opt-desc" style={{ whiteSpace: "pre-line" }}>
            {numRes.error && <b className="bad">{numRes.error}</b>}
            {!numRes.error && !numRes.faltantes.length && (
              <b className="good">No falta ninguno ✓ — todo lo que ARCA tiene registrado está guardado acá.</b>
            )}
            {!numRes.error && numRes.faltantes.length > 0 && (
              <>
                <b className="bad">
                  {numRes.faltantes.length === 1 ? "Falta 1 comprobante" : `Faltan ${numRes.faltantes.length} comprobantes`} que ARCA
                  tiene registrados y esta base no:
                </b>
                <div>{numRes.faltantes.map((f) => `${f.clase === "FACTURA" ? "Factura" : f.clase} ${f.tipo} ${String(f.ptoVta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`).join(" · ")}</div>
                {numRes.dejadosAfuera > 0 && <div>(y {numRes.dejadosAfuera} más: volvé a correrlo cuando termine con éstos)</div>}
              </>
            )}
            {numRes.recuperados?.length > 0 && (
              <b className="good">
                Se trajeron {numRes.recuperados.length}. Quedan guardados con su número, su fecha y su CAE.
                El detalle de lo vendido no lo guarda ARCA, así que esos comprobantes figuran sin renglones.
              </b>
            )}
            {numRes.noSePudo?.length > 0 && (
              <b className="bad">No se pudo consultar {numRes.noSePudo.length}: probá de nuevo cuando haya internet.</b>
            )}
          </div>
        )}
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
