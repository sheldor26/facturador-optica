import React, { useEffect, useState } from "react";

// Catálogo rápido de lentes: checklist para agregar ítems ya armados (con precio) a la
// lista de ítems de Emitir factura / Presupuestos, sin tipear todo a mano cada vez.
// Compartido entre las dos pantallas: requiere que `items` tenga la forma
// {_id, desc, cantidad, precioUnit, unidad, descPct, nota} (la misma en ambas).
// El catálogo (precios, productos, armazones) vive en config.json y se edita acá mismo
// con "Editar catálogo" — no hace falta tocar código para actualizarlo.

const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const nuevoId = () => Math.random().toString(36).slice(2);
const esPlaceholder = (it) => !it.nota && !it.desc.trim() && !it.precioUnit && !it._catId && !it._slot;
const CATALOGO_VACIO = { pares: [], porLente: [], extras: [] };
const OJOS = [{ key: "OD", label: "Ojo derecho" }, { key: "OI", label: "Ojo izquierdo" }];

// Opciones para el selector de "cada ojo distinto": las mitades de los pares (calculadas)
// más los precios "por lente" (Rango Extendido y similares, que ya vienen por lente).
function opcionesPorOjo(catalogo) {
  return [
    ...catalogo.pares.map((c) => ({ id: c.id, label: c.label, precio: round2(c.precio / 2) })),
    ...catalogo.porLente.map((c) => ({ id: c.id, label: c.label, precio: c.precio })),
  ];
}

export default function CatalogoLentes({ items, setItems }) {
  const [modoOjos, setModoOjos] = useState("igual"); // "igual" | "distinto"
  const [catalogo, setCatalogo] = useState(CATALOGO_VACIO);
  const [editando, setEditando] = useState(false);

  useEffect(() => {
    window.api.getConfig().then((c) => setCatalogo(c?.catalogoLentes || CATALOGO_VACIO)).catch(() => {});
  }, []);

  function agregarConReemplazo(prev, nuevo) {
    // Si la única fila es el placeholder vacío inicial, la reemplaza en vez de apilarse arriba.
    return prev.length === 1 && esPlaceholder(prev[0]) ? [nuevo] : [...prev, nuevo];
  }
  function toggleParIgual(cat) {
    setItems((prev) => {
      if (prev.some((it) => it._catId === cat.id && !it._slot)) return prev.filter((it) => it._catId !== cat.id || it._slot);
      const nuevo = { _id: nuevoId(), _catId: cat.id, desc: cat.label, cantidad: 1, precioUnit: cat.precio, unidad: "Par", descPct: "", nota: false };
      return agregarConReemplazo(prev, nuevo);
    });
  }
  function toggleExtra(item) {
    setItems((prev) => {
      if (prev.some((it) => it._catId === item.id)) return prev.filter((it) => it._catId !== item.id);
      const nuevo = { _id: nuevoId(), _catId: item.id, desc: item.label, cantidad: 1, precioUnit: item.precio, unidad: "Unidades", descPct: "", nota: false };
      return agregarConReemplazo(prev, nuevo);
    });
  }
  function elegirOjo(ojoKey, opcionId) {
    setItems((prev) => {
      const sinEste = prev.filter((it) => it._slot !== ojoKey);
      if (!opcionId) return sinEste; // "— Sin seleccionar —": solo saca la fila de ese ojo
      const eyeLabel = OJOS.find((o) => o.key === ojoKey)?.label || ojoKey;
      const nuevo = opcionId === "manual"
        ? { _id: nuevoId(), _slot: ojoKey, _catId: "manual", desc: `(completar) — ${eyeLabel}`, cantidad: 1, precioUnit: "", unidad: "Unidades", descPct: "", nota: false }
        : (() => {
            const opt = opcionesPorOjo(catalogo).find((o) => o.id === opcionId);
            return { _id: nuevoId(), _slot: ojoKey, _catId: opcionId, desc: `${opt.label} — ${eyeLabel}`, cantidad: 1, precioUnit: opt.precio, unidad: "Unidades", descPct: "", nota: false };
          })();
      return agregarConReemplazo(sinEste, nuevo);
    });
  }

  return (
    <section className="panel">
      <div className="cat-head">
        <h3>Catálogo rápido de lentes</h3>
        <button type="button" className="ghost mini" onClick={() => setEditando(true)}>✎ Editar catálogo</button>
      </div>
      <div className="cat-modo">
        <label><input type="radio" name="modoOjos" checked={modoOjos === "igual"} onChange={() => setModoOjos("igual")} /> Mismo cristal en los dos ojos</label>
        <label><input type="radio" name="modoOjos" checked={modoOjos === "distinto"} onChange={() => setModoOjos("distinto")} /> Cada ojo distinto (ej. uno estándar y otro Rango Extendido)</label>
      </div>

      {catalogo.pares.length === 0 && catalogo.porLente.length === 0 && catalogo.extras.length === 0 ? (
        <p className="dash-empty">Todavía no cargaste el catálogo. Tocá "Editar catálogo" para agregar productos y precios.</p>
      ) : modoOjos === "igual" ? (
        <div className="cat-grid">
          {catalogo.pares.map((c) => (
            <label key={c.id} className="cat-check">
              <input type="checkbox" checked={items.some((it) => it._catId === c.id && !it._slot)} onChange={() => toggleParIgual(c)} />
              <span>{c.label}</span>
              <b>{money(c.precio)}</b>
            </label>
          ))}
        </div>
      ) : (
        <div className="cat-ojos">
          {OJOS.map((ojo) => {
            const actual = items.find((it) => it._slot === ojo.key);
            return (
              <label key={ojo.key} className="fld">
                <span>{ojo.label}</span>
                <select value={actual?._catId || ""} onChange={(e) => elegirOjo(ojo.key, e.target.value)}>
                  <option value="">— Sin seleccionar —</option>
                  <optgroup label="Precio por lente (mitad del par)">
                    {catalogo.pares.map((c) => <option key={c.id} value={c.id}>{c.label} — {money(round2(c.precio / 2))}</option>)}
                  </optgroup>
                  <optgroup label="Rango Extendido / especial">
                    {catalogo.porLente.map((c) => <option key={c.id} value={c.id}>{c.label} — {money(c.precio)}</option>)}
                  </optgroup>
                  <option value="manual">Personalizado / de laboratorio (cargar a mano)</option>
                </select>
              </label>
            );
          })}
        </div>
      )}

      {catalogo.extras.map((item) => (
        <label key={item.id} className="cat-check" style={{ marginTop: 4 }}>
          <input type="checkbox" checked={items.some((it) => it._catId === item.id)} onChange={() => toggleExtra(item)} />
          <span>{item.label}</span>
          <b>{money(item.precio)}</b>
        </label>
      ))}
      <small className="good" style={{ display: "block", marginTop: 8 }}>
        Se agregan como filas en "Ítems": podés editar descripción, precio o cantidad a mano después de marcarlas.
      </small>

      {editando && (
        <EditorCatalogo
          catalogo={catalogo}
          onCerrar={() => setEditando(false)}
          onGuardado={(nuevo) => { setCatalogo(nuevo); setEditando(false); }}
        />
      )}
    </section>
  );
}

// ===========================================================================
//  Editor del catálogo de precios (pares, por lente, extras/armazones)
// ===========================================================================
function EditorCatalogo({ catalogo, onCerrar, onGuardado }) {
  const [pares, setPares] = useState(catalogo.pares.map((c) => ({ ...c })));
  const [porLente, setPorLente] = useState(catalogo.porLente.map((c) => ({ ...c })));
  const [extras, setExtras] = useState(catalogo.extras.map((c) => ({ ...c })));
  const [guardando, setGuardando] = useState(false);

  function fila(lista, setLista, id, patch) { setLista(lista.map((it) => (it.id === id ? { ...it, ...patch } : it))); }
  function agregarFila(setLista) { setLista((prev) => [...prev, { id: nuevoId(), label: "", precio: "" }]); }
  function quitarFila(setLista, id) { setLista((prev) => prev.filter((it) => it.id !== id)); }

  function limpiar(lista) {
    // Descarta filas vacías (sin descripción) y redondea precios.
    return lista.filter((it) => it.label.trim()).map((it) => ({ id: it.id, label: it.label.trim(), precio: round2(Number(it.precio) || 0) }));
  }

  async function guardar() {
    setGuardando(true);
    try {
      const nuevo = { pares: limpiar(pares), porLente: limpiar(porLente), extras: limpiar(extras) };
      await window.api.setConfig({ catalogoLentes: nuevo });
      onGuardado(nuevo);
    } finally { setGuardando(false); }
  }

  function Seccion({ titulo, ayuda, lista, setLista, unidadPrecio }) {
    return (
      <div className="cat-editor-sec">
        <h4>{titulo}</h4>
        {ayuda && <small className="good" style={{ display: "block", marginBottom: 8 }}>{ayuda}</small>}
        {lista.map((it) => (
          <div className="cat-editor-fila" key={it.id}>
            <input value={it.label} onChange={(e) => fila(lista, setLista, it.id, { label: e.target.value })} placeholder="Ej: Armazón modelo X" />
            <div className="cat-editor-precio">
              <span>$</span>
              <input className="num" type="number" min="0" step="0.01" value={it.precio}
                onChange={(e) => fila(lista, setLista, it.id, { precio: e.target.value })} placeholder="0" />
              {unidadPrecio && <small>{unidadPrecio}</small>}
            </div>
            <button className="del" onClick={() => quitarFila(setLista, it.id)} title="Quitar">×</button>
          </div>
        ))}
        <button className="ghost mini" type="button" onClick={() => agregarFila(setLista)}>+ Agregar</button>
      </div>
    );
  }

  return (
    <div className="modal-bg"><div className="modal modal-lg">
      <h2>Editar catálogo</h2>
      <p className="hint-share">Cambiá acá los precios cuando aumenten, renombrá un producto o agregá uno nuevo (armazones, otro tratamiento, etc.). Se guarda en esta computadora.</p>

      <Seccion titulo="Mismo cristal en los dos ojos (precio del par)" lista={pares} setLista={setPares} unidadPrecio="el par" />
      <Seccion titulo="Precio por lente (Rango Extendido / especial)" ayuda="Ya es el precio de 1 lente — no se divide a la mitad." lista={porLente} setLista={setPorLente} unidadPrecio="por lente" />
      <Seccion titulo="Adicionales (Antirreflex, armazones, etc.)" lista={extras} setLista={setExtras} />

      <div className="modal-btns" style={{ marginTop: 4 }}>
        <button className="ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
        <button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar catálogo"}</button>
      </div>
    </div></div>
  );
}
