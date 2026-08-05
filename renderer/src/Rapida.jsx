import React, { useEffect, useRef, useState } from "react";
import { mensajeHumano, mensajeRechazo } from "./errores.js";

const PTO_VTA = 7;
const DESCRIPCIONES = ["Lentes", "Armazón", "Lentes Bluecut", "Lentes de Contacto"];
const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Factura rápida: Consumidor Final (Factura B), solo el importe.
export default function Rapida() {
  const [importe, setImporte] = useState("");
  const [desc, setDesc] = useState("Lentes");
  const [step, setStep] = useState("form"); // form | confirm | emitiendo | ok | error
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState(null);
  const [imprimirOriginal, setImprimirOriginal] = useState(false);
  const [ptoVta, setPtoVta] = useState(PTO_VTA);
  const emitiendoRef = useRef(false); // guard síncrono anti doble-emisión

  useEffect(() => { window.api.getConfig?.().then((c) => setPtoVta(c?.ptoVta || PTO_VTA)).catch(() => {}); }, []);
  useEffect(() => {
    if (step !== "confirm") return;
    const h = (e) => { if (e.key === "Escape") setStep("form"); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [step]);

  const total = Number(importe) || 0;
  const puede = total > 0 && desc.trim();

  function reset() { setImporte(""); setDesc("Lentes"); setResult(null); setErrMsg(null); setStep("form"); emitiendoRef.current = false; }

  async function emitir() {
    if (emitiendoRef.current) return; // ya se está emitiendo: ignorar clics repetidos
    emitiendoRef.current = true;
    setStep("emitiendo");
    try {
      const res = await window.api.emitir({
        receptorCond: "Consumidor Final",
        condVenta: "Otra",
        ptoVta,
        items: [{ desc: desc.trim(), cantidad: 1, precioUnit: total, unidad: "Unidades" }],
      });
      if (res.ok) { setResult(res); setStep("ok"); window.api.imprimirFactura(res.id, imprimirOriginal ? ["ORIGINAL", "DUPLICADO"] : ["DUPLICADO"]).catch(() => {}); }
      else { setErrMsg(mensajeRechazo(res.observaciones)); setStep("error"); }
    } catch (e) { setErrMsg(mensajeHumano(e)); setStep("error"); }
    finally { emitiendoRef.current = false; }
  }

  if (step === "ok") {
    const r = result.record;
    return (
      <>
        <header className="topbar"><h1>Factura rápida</h1></header>
        <div className="ok-box">
          <div className="ok-check">✓</div>
          <h2>Factura B {String(r.ptoVta).padStart(5, "0")}-{String(r.numero).padStart(8, "0")} emitida</h2>
          <div className="ok-grid">
            <div><span>CAE</span><b>{r.cae}</b></div>
            <div><span>Total</span><b>{money(r.importes.total)}</b></div>
          </div>
          <p className="ok-note">El PDF se generó y abrió automáticamente.</p>
          <div className="ok-btns">
            <button className="ghost" onClick={() => window.api.verFactura(result.id).catch(() => {})}>Ver factura</button>
            <button onClick={reset}>Nueva factura rápida</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <h1>Factura rápida</h1>
        <span className="pill online">Factura B · Consumidor Final</span>
      </header>

      <div className="rapida">
        <p className="rapida-hint">Para cuando el cliente no necesita la factura pero querés dejar la venta registrada.</p>
        <label className="fld">
          <span>Importe total (con IVA)</span>
          <input
            className="big-amount"
            type="number" min="0" step="0.01" autoFocus
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && puede && setStep("confirm")}
            placeholder="0,00"
          />
        </label>
        <label className="fld">
          <span>Descripción</span>
          <input list="desc-presets" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Lentes" />
          <datalist id="desc-presets">
            {DESCRIPCIONES.map((d) => <option key={d} value={d} />)}
          </datalist>
        </label>
        <label className="chk-print">
          <input type="checkbox" checked={imprimirOriginal} onChange={(e) => setImprimirOriginal(e.target.checked)} />
          <span>Imprimir <b>original</b> para el cliente (el duplicado se imprime igual)</span>
        </label>
        <button className="emit-btn" disabled={!puede} onClick={() => setStep("confirm")}>
          Emitir Factura B — {money(total)}
        </button>
      </div>

      {step === "confirm" && (
        <div className="modal-bg"><div className="modal">
          <h2>Confirmar factura rápida</h2>
          <p>Factura B a <b>Consumidor Final</b> por <b>{money(total)}</b>.</p>
          <p className="warn">Es un comprobante <b>real y fiscal</b>.</p>
          <div className="modal-btns">
            <button className="ghost" onClick={() => setStep("form")}>Cancelar</button>
            <button disabled={step === "emitiendo"} onClick={emitir}>Sí, emitir</button>
          </div>
        </div></div>
      )}
      {step === "emitiendo" && <div className="modal-bg"><div className="modal"><h2>Emitiendo…</h2><p>Obteniendo el CAE de ARCA.</p></div></div>}
      {step === "error" && (
        <div className="modal-bg"><div className="modal">
          <h2>No se pudo emitir</h2>
          <p className="warn" style={{ whiteSpace: "pre-line" }}>{errMsg}</p>
          <div className="modal-btns"><button onClick={() => setStep("form")}>Volver</button></div>
        </div></div>
      )}
    </>
  );
}
