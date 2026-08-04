# Auditoría del Facturador Óptica

_Fecha: agosto 2026. Revisión de los cambios sin commitear (Presupuestos, módulo Sancor completo, credenciales de nube por PC, dashboard, impresión automática, backups, modo oscuro) sobre la auditoría de julio 2026. Hecha en trío: Claude Code (lectura completa del diff) + Codex CLI + Antigravity CLI (Agy) como segunda y tercera opinión independientes, con verificación cruzada de cada hallazgo contra el código real antes de listarlo acá._

---

## 🐞 Reportado por Juan en producción (no salió en las auditorías)

### Facturar un pedido web podía salir con el comprador completamente en blanco — Resuelto (2026-08-03)

Juan facturó un pedido desde "Pedidos web" y la factura salió a Consumidor Final **sin ningún dato del comprador, ni el nombre**. Causa real (`engine.mjs`, `detallePedido`/`facturarPedido`): si el pedido no tenía DNI cargado, el DNI no matcheaba a nadie en el padrón de ARCA, o la consulta al padrón fallaba (ARCA caída, timeout), el comprador quedaba con el objeto vacío por defecto (`nombre: ""`) **sin nunca caer al nombre que la persona ya había puesto al comprar en la web** (`order.customer_name`, el mismo dato que se muestra en la lista de "Pedidos web"). Bug preexistente al código anterior a esta sesión, no algo introducido por el fix de "pedidos a ciegas" del mismo día — solo quedó más visible.

**Arreglo:** nueva `resolverReceptorPedido()`, compartida por `detallePedido` y `facturarPedido`: solo usa el dato del padrón cuando matchea a **una sola** persona; en cualquier otro caso (sin DNI, sin match, error de consulta) cae al nombre + DNI que puso el comprador en la web, nunca a un objeto vacío. Verificado con un test aislado (sin depender de ARCA/Supabase reales) que cubre los 5 casos: sin DNI, sin match, ARCA caída, un match, y varios matches — en los tres primeros antes se perdía el nombre y ahora no.

---

## ✅ De la auditoría anterior: qué se resolvió y qué no

| Punto (julio 2026) | Estado ahora |
|---|---|
| #1 Contraseña de Supabase en el instalador | **Resuelto en lo grueso**: se movió a `cloud-cred.json` por PC, fuera del build. Queda un matiz de seguridad (ver Importante #4). |
| #2 Doble clic = factura duplicada | **Resuelto en las seis pantallas** (Emitir, Rápida, Sancor, y ahora Presupuestos→Facturar, Pedidos→Facturar, Facturas→Nota de Crédito/Débito — 2026-08-03). |
| #3 IVA fijo 21% (Sancor GRAV) | **Descartado como bug.** Confirmado con Juan: es intencional, así se factura siempre. Ver sección "Revisado y descartado". |
| #4 Notas de crédito/débito al 21% | **No resuelto, y aparecieron dos problemas nuevos** sobre el mismo código (ver Crítico #2). |
| #5 Sin backups de `datos.json` | **Resuelto** (backup diario, últimas 7 copias en `backups/`), con un efecto secundario nuevo (ver Importante #3). |
| #6 Fallos de sync invisibles | **Resuelto (2026-08-03)**: indicador + ya no miente (ver Importante #2, resuelto abajo). |
| #7 Path traversal en descarga de Sancor | **Resuelto** (`path.basename` + chequeo de que la ruta quede dentro de la carpeta). Pero el mismo patrón de riesgo quedó sin aplicar en la *subida* de fotos (ver Importante #5). |
| #8 Navegación por teclado rota | **Resuelto** en el menú lateral (roles, `tabIndex`, `onKeyDown`). Los modales de Emitir/Rápida/Sancor ya cierran con Escape; los de Presupuestos, no. |
| Merge de clientes pisa sin mirar fecha | **Resuelto** (last-write-wins por `actualizado`/`actualizado_en`). |
| Punto de venta 7 hardcodeado | **Resuelto** (configurable en Opciones), queda una constante muerta sin usar en Sancor. |

---

## ⚪ Revisado y descartado (no es un bug)

**Sancor factura con 21% de IVA aunque la preliquidación estampa 10,5%.** `sancor.mjs` calcula `IVA_RATE = 0.105` para el sello visual de la preliquidación, pero la Factura B que se emite a Sancor por ARCA sale con `IvaTipo.IVA_21` (21%). Claude, Codex y Agy lo marcamos los tres como crítico asumiendo que el sello del PDF tenía que coincidir con lo declarado a ARCA. **Confirmado con Juan (2026-08-03): es intencional, así se viene facturando desde siempre, no tocar.** El 10,5% de la preliquidación es un cálculo interno de Sancor para su propia liquidación, no la alícuota que la óptica debe declarar por sus prestaciones. Lección: una discrepancia entre dos números no es automáticamente un bug — antes de asumirlo, preguntar si hay un criterio de negocio/contable detrás.

## 🔴 Crítico

### 1. Notas de Crédito/Débito: dos bugs nuevos sobre el código viejo

`engine.mjs` → `emitirNota()`:
- **Ignora el descuento por línea.** Reconstruye el importe como `cantidad * precioUnit` sin restar `descPct`/bonificación. Si la factura original tenía un descuento, la nota sale por más plata que la factura y **no cierra** con ella.
- **Pierde la identificación del receptor.** Usa `map.a ? DocTipo.CUIT : DocTipo.CONSUMIDOR_FINAL` — para Factura B siempre manda `DocNro: 0` (anónimo), aunque la factura original haya sido una Factura B **identificada** con DNI/CUIT (la función nueva del commit "Factura B Consumidor Final + descuento", v1.0.9). Es una regresión funcional: antes no existía la Factura B identificada, ahora sí, y la nota no la contempla.

**Arreglo:** reconstruir la nota desde el `subtotal`/detalle fiscal ya calculado de la factura original (no recalcular desde cero) y copiar `docTipo`/`docNro`/`CondicionIVAReceptorId` de `orig.receptor`.

### 2. ~~El guard anti-doble-clic quedó incompleto~~ — Resuelto (2026-08-03)

Se agregó el mismo guard síncrono (`useRef` que corta clics repetidos antes del `await`, además del `disabled`) en `Presupuestos.jsx` (`confirmarFacturar`), `Pedidos.jsx` (`facturar`) y `Facturas.jsx` (`confirmarNota`) — ya estaba en Emitir/Rápida/Sancor. Las seis pantallas que emiten comprobantes fiscales reales quedan protegidas por igual.

**Pendiente, si se quiere ir un paso más allá:** un lock del lado de `engine.mjs`/main (por `presupuestoId`/`orderId`/`facturaId+clase`) para que ni una llamada IPC duplicada por otra vía (no solo el clic del botón) pueda pasar. No es urgente — el guard de UI ya cierra el escenario real de uso.

---

## 🟠 Importante

**3. Fallback de credenciales viejo sigue vivo.** `cloud.mjs` (`loadCred`) todavía lee `email`/`password` desde `cloud-config.json` si ese archivo los tuviera. Es compatibilidad hacia atrás intencional, pero si algún día se genera por error un build con ese JSON completo, se reintroduce la fuga de julio sin que nada avise. → Sacar el fallback, o al menos loguear/alertar fuerte si alguna vez se usa.

**4. `cloud-cred.json` guarda la contraseña en texto plano en disco.** Mucho mejor que viajar en el instalador público, pero sigue siendo un archivo legible por cualquier proceso con acceso al usuario del sistema. → `safeStorage` de Electron (cifra con el Keychain/DPAPI del SO).

**5. ~~El indicador de sync puede mentir~~ — Resuelto (2026-08-03).** `pushCliente`/`pushFactura`/`pushPresupuesto` (`cloud.mjs`) ahora revisan `r.ok` y tiran error si la nube rechaza el push (antes nunca fallaban por status HTTP, solo por caída de red). `sincronizarNube()` cuenta `subidas`/`fallidas` reales en vez de incrementar siempre. El indicador de la barra lateral muestra "N sin subir" con punto ámbar cuando algo no subió, en vez de decir "Nube al día" igual. Probado en el navegador: con fallas simuladas se ve el punto ámbar y el conteo correcto; sin fallas vuelve a verde "Nube al día".

**6. `backups/` no está en `.gitignore`.** El backup diario de `datos.json` (con CUITs, nombres, facturas reales) se guarda en `backups/`, que hoy aparece como carpeta sin trackear — un `git add -A` sin mirar la incluiría en el repo. → Agregar `backups/` al `.gitignore`, en la misma línea que ya protege `datos.json`.

**7. Fotos arrastradas a Sancor: mismo riesgo de path traversal que ya se arregló en la descarga, sin aplicar en la subida.** En `sancor:guardarFotos`/`sancor:agregarFotos`, cuando el archivo no es una imagen comprimible (PDF u otro), el nombre se usa casi tal cual llega (`nombre = a.nombre || "foto"`) y `nombreLibre()` devuelve ese nombre sin tocar si no hay colisión — sin pasar por `path.basename`. Requiere que el renderer esté comprometido para explotarlo (la UI normal solo dispara esto vía diálogo nativo o `File.name` del navegador, que no trae rutas), pero es la misma clase de bug que ya se cerró del otro lado. → Aplicar `path.basename` al nombre antes de `nombreLibre()`, igual que en `descargarMes`.

**8. Eliminar un presupuesto no deja "tumba" (tombstone).** `eliminarPresupuesto` borra local + manda `DELETE` a la nube, pero si otra PC todavía lo tiene guardado localmente sin sincronizar, el próximo `sincronizarNube()` lo vuelve a subir y resucita. → Guardar un `deleted_at`/lista de borrados para que el merge no lo resucite.

**9. Consumidor Final anónimo sin tope de identificación.** Sigue sin exigirse DNI/CUIT cuando el importe supera el mínimo que ARCA exige identificar (ya estaba en la auditoría de julio, sigue sin resolverse, y ahora también aplica a Presupuestos).

---

## 🟡 Medio

- **Numeración de presupuestos puede colisionar visualmente** entre PCs offline (el `uid` evita duplicado técnico, pero dos clientes pueden ver el mismo N° hasta que sincronice).
- **`sancor:abrirCarpeta` abre cualquier ruta que le llegue por IPC** sin validar que sea un directorio esperado — superficie innecesaria si el renderer se compromete.
- **Ventanas ocultas de impresión sin timeout** (`imprimirHtml`, listar impresoras): si el driver del SO no responde, la ventana queda colgada indefinidamente.
- **Sancor no resetea todo el estado al cambiar de mes/año**: limpia las fotos pero no las preliquidaciones ya cargadas ni las emisiones hechas — se puede terminar operando sobre el período equivocado sin darte cuenta.
- **Parseo del total en preliquidaciones** (`sancor.mjs` → `analizar()`): hay dos cálculos secuenciales del mismo importe, el segundo pisa al primero. Por el comentario del propio código (`"los importes vienen como '144706.0'"`) parece un ajuste deliberado para el formato real de los PDF de Sancor, no un bug activo — pero el primer cálculo queda muerto y confuso, y si algún día llega una preliquidación en formato argentino real (con separador de miles), el parseo se rompe en silencio. Vale la pena probarlo con una preliquidación de cada tipo y sacar el cálculo que sobra.

---

## 🟢 Menor

- **Toast `"err"` no coincide con la clase CSS `.toast.error`** (varios lugares en `Sancor.jsx`): esos toasts de error salen con el borde celeste normal en vez de rojo.
- ~~`key={índice}` en las filas de ítems de `Presupuestos.jsx`~~ — Resuelto (2026-08-03) de paso al agregar el catálogo rápido de lentes, que necesitaba un `_id` estable por fila.
- **"IVA 21%" sigue hardcodeado** en varios textos de UI y en el PDF (Emitir, Presupuestos, `factura-template.mjs`).
- **`SANCOR_PTO_VTA = 7` en `electron/main.cjs` quedó como constante sin usar** desde que el punto de venta se hizo configurable (la emisión real usa `eng.getPtoVta()`).
- Comentario desactualizado en `cloud.mjs` sobre dónde viven las credenciales del bucket de Sancor (dice `cloud-config.json`, ya no es así).

---

## Plan de acción recomendado

**Esta semana (fiscal + duplicados):**
1. ~~Completar el guard anti-doble-clic en Presupuestos/Pedidos/Facturas~~ ✅ hecho (2026-08-03).
2. Arreglar Nota de Crédito/Débito: descuento por línea + identificación del receptor (Crítico #1).
3. `backups/` al `.gitignore` (Importante #6) — un minuto, evita un problema serio si se comitea sin querer.

**Este mes:**
4. ~~Corregir el indicador de sync para que no cuente pushes fallidos~~ ✅ hecho (2026-08-03).
5. Sacar el fallback de credenciales viejas + evaluar `safeStorage` (Importante #3 y #4).
6. `path.basename` en la subida de fotos de Sancor (Importante #7) y tombstone para presupuestos borrados (Importante #8).

**Cuando haya tiempo:** el resto de Medio y Menor.

---

_Lo que sigue bien: Electron endurecido, numeración fiscal delegada a ARCA, backup diario, indicador de sync ya confiable, y la traducción de errores técnicos a lenguaje claro (`errores.js`) ahora cubre más pantallas que antes._
