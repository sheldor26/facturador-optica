import React, { useState } from "react";

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

  const total = Number(importe) || 0;
  const puede = total > 0 && desc.trim();

  function reset() { setImporte(""); setDesc("Lentes"); setResult(null); setErrMsg(null); setStep("form"); }

  async function emitir() {
    setStep("emitiendo");
    try {
      const res = await window.api.emitir({
        receptorCond: "Consumidor Final",
        condVenta: "Otra",
        ptoVta: PTO_VTA,
        items: [{ desc: desc.trim(), cantidad: 1, precioUnit: total, unidad: "Unidades" }],
      });
      if (res.ok) { setResult(res); setStep("ok"); window.api.imprimirFactura(res.id, imprimirOriginal ? ["ORIGINAL", "DUPLICADO"] : ["DUPLICADO"]); }
      else { setErrMsg((res.observaciones || []).map((o) => `[${o.code}] ${o.msg}`).join(" · ") || "Rechazada por ARCA"); setStep("error"); }
    } catch (e) { setErrMsg(e?.message || String(e)); setStep("error"); }
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
          <button onClick={reset}>Nueva factura rápida</button>
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
            <button onClick={emitir}>Sí, emitir</button>
          </div>
        </div></div>
      )}
      {step === "emitiendo" && <div className="modal-bg"><div className="modal"><h2>Emitiendo…</h2><p>Obteniendo el CAE de ARCA.</p></div></div>}
      {step === "error" && (
        <div className="modal-bg"><div className="modal">
          <h2>No se pudo emitir</h2>
          <p className="warn">{errMsg}</p>
          <div className="modal-btns"><button onClick={() => setStep("form")}>Volver</button></div>
        </div></div>
      )}
    </>
  );
}
