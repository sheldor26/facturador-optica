# Auditoría del Facturador Óptica

_Fecha: agosto 2026. Revisión de los cambios sin commitear (Presupuestos, módulo Sancor completo, credenciales de nube por PC, dashboard, impresión automática, backups, modo oscuro) sobre la auditoría de julio 2026. Hecha en trío: Claude Code (lectura completa del diff) + Codex CLI + Antigravity CLI (Agy) como segunda y tercera opinión independientes, con verificación cruzada de cada hallazgo contra el código real antes de listarlo acá._

---

## 🆕 Ronda 2026-08-05: auditoría completa de todo el programa

Juan pidió una auditoría de **todo el programa** (no solo lo nuevo) con las tres IAs. Codex CLI leyó el repo completo (backend + los diez componentes de `renderer/src`); Agy (Antigravity CLI) auditó en profundidad el backend/Electron (`engine.mjs`, `cloud.mjs`, `db.mjs`, `factura-template.mjs`, `sancor.mjs`, `ta-store.mjs`, `arca-tls-fix.mjs`, `main.cjs`, `preload.cjs` — la superficie de dinero/fiscal/credenciales/IPC), pegado directo en el prompt para que no dependiera de permisos de lectura de archivos en modo headless. Cada hallazgo de los dos se verificó contra el código real antes de agregarlo acá; lo que ya estaba anotado abajo no se duplicó, solo se marca como "reconfirmado" si volvió a salir.

**Hallazgo nuevo más importante — pasa a Crítico #3:** un pedido web se puede facturar dos veces si internet parpadea justo después de emitir en ARCA (ver abajo). Lo encontraron Codex y Agy de forma independiente, y lo verifiqué en el código: hoy no hay ningún resguardo local, solo el aviso a Supabase.

Los demás hallazgos nuevos son de menor severidad y quedaron incorporados en sus secciones correspondientes (marcados con **[C]**=Codex, **[A]**=Agy, **[Claude]**=verificado/matizado por mí). Lo que ya figuraba en la auditoría anterior y volvió a salir se marca "(reconfirmado)" sin repetir el texto.

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

**Agy planteó (ronda 2026-08-05) que `db.mjs` necesitaría un lock/mutex en memoria** porque las escrituras a `data` (el JSON completo en memoria) no están serializadas. Lo revisé línea por línea: no encontré ninguna ventana real hoy — lo único que se genera localmente (no viene de ARCA) es el número de presupuesto (`proximoNumeroPresupuesto()`), y se lee y se guarda de forma síncrona, sin ningún `await` en el medio que le dé chance al event loop de intercalar otra escritura. No es un bug activo hoy. Queda anotado como fortalecimiento a futuro **si** se agregan más pasos asíncronos entre leer y guardar algo generado localmente — no antes.

## 🔴 Crítico

### 1. ~~Notas de Crédito/Débito: dos bugs nuevos sobre el código viejo~~ — Resuelto (2026-08-05)

`engine.mjs` → `emitirNota()` tenía dos bugs, reconfirmados de forma independiente por Codex y Agy en la ronda de auditoría del 2026-08-05:
- **Ignoraba el descuento por línea.** Reconstruía el importe como `cantidad * precioUnit` sin restar `descPct`/bonificación. Si la factura original tenía un descuento, la nota salía por más plata que la factura y no cerraba con ella.
- **Perdía la identificación del receptor.** Para Factura B siempre mandaba `DocNro: 0` (anónimo), aunque la factura original haya sido una Factura B **identificada** con DNI/CUIT.

**Arreglo:** los ítems de la nota ahora se arman desde el `subtotal` ya calculado de cada línea de la factura original (que ya trae el descuento aplicado), no desde `cantidad * precioUnit` en crudo. El documento del receptor (`docTipo`/`docNro`) ahora se copia de `orig.receptor.docLabel`/`docNro` tal cual quedó identificado en la factura original, en vez de asumirlo por la condición de IVA. Probado con un test aislado que cubre: Factura B con 20% de descuento e identificada por DNI (la nota debe salir sobre el importe con descuento, no sobre el de lista, y conservar el DNI), Factura B anónima (sigue anónima, no se le inventa un documento), y Factura A con descuento (el neto ya sin IVA también respeta el descuento).

### 2. ~~El guard anti-doble-clic quedó incompleto~~ — Resuelto (2026-08-03)

Se agregó el mismo guard síncrono (`useRef` que corta clics repetidos antes del `await`, además del `disabled`) en `Presupuestos.jsx` (`confirmarFacturar`), `Pedidos.jsx` (`facturar`) y `Facturas.jsx` (`confirmarNota`) — ya estaba en Emitir/Rápida/Sancor. Las seis pantallas que emiten comprobantes fiscales reales quedan protegidas por igual.

**Pendiente, si se quiere ir un paso más allá:** un lock del lado de `engine.mjs`/main (por `presupuestoId`/`orderId`/`facturaId+clase`) para que ni una llamada IPC duplicada por otra vía (no solo el clic del botón) pueda pasar. No es urgente — el guard de UI ya cierra el escenario real de uso. **(reconfirmado por Agy en la ronda 2026-08-05, misma conclusión: no urgente.)**

### 3. ~~Un pedido web se puede facturar dos veces si falla avisar a Supabase justo después de emitir en ARCA~~ — Resuelto (2026-08-05) **[C][A]**

`facturarPedido()` (`engine.mjs:816-833`) hace, en este orden: **(1)** emite la factura real ante ARCA (`emitir()`), y recién **(2)**, si salió bien, intenta `cloud.marcarPedidoFacturado(orderId, {...}).catch(() => {})` para avisarle a Supabase (y de ahí a la tienda online) que ese pedido ya tiene factura.

El problema: el único lugar que sabe "este pedido ya está facturado" es el campo `orders.invoice_cae` en Supabase. Si el paso (2) falla (Supabase caído, corte de un segundo de internet, lo que sea), el `.catch(() => {})` lo traga en silencio — la factura real con CAE ya existe, pero el pedido en la tienda sigue figurando como pendiente. La próxima vez que se abra "Pedidos web", ese pedido va a aparecer de nuevo en la lista para facturar, y el único chequeo que existe (`if (order.invoice_cae) throw ...`, línea 819) lee ese mismo campo que no se pudo escribir — no hay ningún registro local que diga "a este `orderId` ya le emití una factura", así que nada impide facturarlo **una segunda vez, real y fiscal, ante ARCA**, por el mismo pedido.

Codex y Agy llegaron al mismo hallazgo de forma independiente (uno con lectura completa del repo, el otro solo con el backend pegado en el prompt), y lo confirmé leyendo `facturarPedido`/`guardarFactura`: ningún registro local de factura guarda a qué `orderId` pertenece, así que no hay forma de detectarlo desde el Facturador aunque Supabase se ponga al día después.

**Arreglo hecho:** `emitir()` ahora acepta un `origenPedidoId` opcional y lo guarda en el registro de la factura; nueva `facturaPorPedido(orderId)` busca localmente si ya existe. `facturarPedido()` la consulta primero — si ya existe, **no vuelve a emitir**, solo reintenta avisar a Supabase con la factura que ya está (autorrepara si esta vez la conexión anda bien) y devuelve `yaExistia: true` para que la UI no reimprima. Probado con un test aislado que reproduce el escenario exacto (falla el aviso → se reintenta facturar → detecta la factura existente → no emite una segunda → cuando Supabase vuelve, se marca solo) y probado en el navegador (toast distinto: "Este pedido ya se había facturado acá... Se reintentó el aviso; no se reimprimió."). *Alcance: el resguardo es local a cada PC — si dos PCs distintas intentaran facturar el mismo pedido en el mismo instante en que Supabase está caído para ambas, seguiría siendo posible una doble emisión entre PCs. Ese caso (mucho menos probable que el original) requeriría un lock del lado de Supabase, no se atacó acá.*

---

## 🟠 Importante

**3. Fallback de credenciales viejo sigue vivo.** `cloud.mjs` (`loadCred`) todavía lee `email`/`password` desde `cloud-config.json` si ese archivo los tuviera. Es compatibilidad hacia atrás intencional, pero si algún día se genera por error un build con ese JSON completo, se reintroduce la fuga de julio sin que nada avise. → Sacar el fallback, o al menos loguear/alertar fuerte si alguna vez se usa.

**4. `cloud-cred.json` guarda la contraseña en texto plano en disco.** Mucho mejor que viajar en el instalador público, pero sigue siendo un archivo legible por cualquier proceso con acceso al usuario del sistema. → `safeStorage` de Electron (cifra con el Keychain/DPAPI del SO).

**5. ~~El indicador de sync puede mentir~~ — Resuelto (2026-08-03).** `pushCliente`/`pushFactura`/`pushPresupuesto` (`cloud.mjs`) ahora revisan `r.ok` y tiran error si la nube rechaza el push (antes nunca fallaban por status HTTP, solo por caída de red). `sincronizarNube()` cuenta `subidas`/`fallidas` reales en vez de incrementar siempre. El indicador de la barra lateral muestra "N sin subir" con punto ámbar cuando algo no subió, en vez de decir "Nube al día" igual. Probado en el navegador: con fallas simuladas se ve el punto ámbar y el conteo correcto; sin fallas vuelve a verde "Nube al día".

**6. `backups/` no está en `.gitignore`.** El backup diario de `datos.json` (con CUITs, nombres, facturas reales) se guarda en `backups/`, que hoy aparece como carpeta sin trackear — un `git add -A` sin mirar la incluiría en el repo. → Agregar `backups/` al `.gitignore`, en la misma línea que ya protege `datos.json`.

**7. Fotos arrastradas a Sancor: mismo riesgo de path traversal que ya se arregló en la descarga, sin aplicar en la subida.** En `sancor:guardarFotos`/`sancor:agregarFotos`, cuando el archivo no es una imagen comprimible (PDF u otro), el nombre se usa casi tal cual llega (`nombre = a.nombre || "foto"`) y `nombreLibre()` devuelve ese nombre sin tocar si no hay colisión — sin pasar por `path.basename`. Requiere que el renderer esté comprometido para explotarlo (la UI normal solo dispara esto vía diálogo nativo o `File.name` del navegador, que no trae rutas), pero es la misma clase de bug que ya se cerró del otro lado. → Aplicar `path.basename` al nombre antes de `nombreLibre()`, igual que en `descargarMes`.

**8. Eliminar un presupuesto no deja "tumba" (tombstone).** `eliminarPresupuesto` borra local + manda `DELETE` a la nube, pero si otra PC todavía lo tiene guardado localmente sin sincronizar, el próximo `sincronizarNube()` lo vuelve a subir y resucita. → Guardar un `deleted_at`/lista de borrados para que el merge no lo resucite. **(reconfirmado por Codex 2026-08-05, y señala que `eliminarCliente` tiene exactamente el mismo patrón — `dbEliminarCliente` + `cloud.deleteCliente(cuit).catch(() => {})`, sin tombstone — así que un cliente borrado en una PC puede "resucitar" en el próximo merge igual que un presupuesto. Mismo arreglo aplica a los dos.)**

**9. Consumidor Final anónimo sin tope de identificación.** Sigue sin exigirse DNI/CUIT cuando el importe supera el mínimo que ARCA exige identificar (ya estaba en la auditoría de julio, sigue sin resolverse, y ahora también aplica a Presupuestos).

**10. ~~El link público de comprobantes tiene nombre de archivo predecible~~ — Resuelto (2026-08-05) [C].** `nombreArchivo(rec)` armaba el nombre del PDF como `{cuit}_{código}_{ptoVta}_{numero}.pdf` — CUIT y punto de venta fijos y públicos, `numero` correlativo. Cualquiera con **un solo** link podía armar a mano las URLs de todas las demás facturas y descargarlas sin login. **Arreglo:** nueva `nombreArchivoPublico(id)` en `engine.mjs` genera un `crypto.randomUUID()` la primera vez que se comparte cada comprobante y lo guarda en el propio registro (`record.publicToken`, vía `setFacturaPublicToken` en `db.mjs`) — mismo link si se vuelve a compartir, pero nada adivinable. Se usa en los dos lugares que suben al bucket público (`factura:subirPublico` y el auto-upload de `pedido:facturar`); `nombreArchivo()` sigue igual para los archivos locales (ahí no hay problema, los ve solo quien ya tiene la PC). Además, **se encontró y sacó una segunda falla mientras se revisaba esto**: el bucket tenía una política RLS `to public` que permitía **listar** todos los objetos con la clave anónima (la misma que suele estar expuesta en el sitio público) — con esa política activa, nombres random no alcanzaban, porque no hacía falta adivinar nada, alcanzaba con pedirle la lista a Supabase. Se sacó esa política (no la usa ningún código: el link directo funciona solo por ser el bucket público, sin necesitar ningún permiso de SELECT). Verificado con un test aislado (token estable entre llamadas, formato UUID) y probando en vivo que el link directo de un comprobante ya subido sigue respondiendo 200 después de sacar la política.

**11. Path traversal en el logo del setup inicial — Nuevo (2026-08-05) [C].** `guardarSetup({ logoNombre, ... })` (`engine.mjs`, función que escribe `cert.pem`/`key.pem`/`emisor.json`) hace `fs.writeFileSync(dp(logoNombre), ...)` sin sanear `logoNombre` en absoluto. La pantalla de Setup normal ya manda un nombre de archivo limpio, pero el handler IPC expuesto acepta cualquier string — un `logoNombre` con `../../` escribiría fuera de la carpeta de datos. Mismo patrón que ya se cerró en la descarga de Sancor (Resuelto, tabla de arriba) pero sin aplicar acá. → `const safeLogo = path.basename(logoNombre)` antes de usarlo, rechazando vacío/`..`.

---

## 🟡 Medio

- **Numeración de presupuestos puede colisionar visualmente** entre PCs offline (el `uid` evita duplicado técnico, pero dos clientes pueden ver el mismo N° hasta que sincronice).
- **`sancor:abrirCarpeta` abre cualquier ruta que le llegue por IPC** sin validar que sea un directorio esperado — superficie innecesaria si el renderer se compromete.
- **Ventanas ocultas de impresión sin timeout** (`imprimirHtml`, listar impresoras): si el driver del SO no responde, la ventana queda colgada indefinidamente.
- **Sancor no resetea todo el estado al cambiar de mes/año**: limpia las fotos pero no las preliquidaciones ya cargadas ni las emisiones hechas — se puede terminar operando sobre el período equivocado sin darte cuenta.
- **Parseo del total en preliquidaciones** (`sancor.mjs` → `analizar()`): hay dos cálculos secuenciales del mismo importe, el segundo pisa al primero. Por el comentario del propio código (`"los importes vienen como '144706.0'"`) parece un ajuste deliberado para el formato real de los PDF de Sancor, no un bug activo — pero el primer cálculo queda muerto y confuso, y si algún día llega una preliquidación en formato argentino real (con separador de miles), el parseo se rompe en silencio. Vale la pena probarlo con una preliquidación de cada tipo y sacar el cálculo que sobra.
- **Diferencia de centavos cosmética en el PDF de Factura A — Nuevo (2026-08-05) [A][Claude].** En `construirDetalle` (`engine.mjs`), cada línea de una Factura A redondea su propio neto (`round2(netoFinalLinea / 1.21)`), pero el "Importe Neto Gravado" del pie sale de redondear el **total final consolidado** (`round2(impTotalFinal / 1.21)`), no de sumar esos redondeos por línea. Con varios ítems, la suma manual de la columna "Subtotal" puede diferir 1-2 centavos del pie. **Verificado que esto NO afecta lo declarado a ARCA**: el propio comentario del código dice que es a propósito ("para que NUNCA aparezca el centavo de más... ImpNeto + ImpIVA == ImpTotal exacto"), y lo que se manda a ARCA (`detail.ImpNeto`/`ImpIVA`) es exactamente lo mismo que se imprime en el pie del PDF — el desajuste es solo visual, entre filas y pie, y solo en Factura A con más de un ítem. Bajo impacto, pero puede generar un reclamo de un cliente empresa que "recalcula" a mano.
- **Sin timeout en la consulta al padrón de ARCA — Nuevo (2026-08-05) [A].** La consulta al padrón (usada en Emitir/Presupuestos/Pedidos web para autocompletar datos del cliente por DNI/CUIT) no tiene un timeout explícito en el `fetch`. Si el webservice de ARCA se cuelga (pasa), la búsqueda se queda esperando sin límite y la pantalla parece trabada. Mismo patrón de riesgo que ya está anotado arriba para las ventanas de impresión. → Agregar un `AbortController` con 8-10s de límite.

---

## 🟢 Menor

- **Toast `"err"` no coincide con la clase CSS `.toast.error`** (varios lugares en `Sancor.jsx`): esos toasts de error salen con el borde celeste normal en vez de rojo.
- ~~`key={índice}` en las filas de ítems de `Presupuestos.jsx`~~ — Resuelto (2026-08-03) de paso al agregar el catálogo rápido de lentes, que necesitaba un `_id` estable por fila.
- **"IVA 21%" sigue hardcodeado** en varios textos de UI y en el PDF (Emitir, Presupuestos, `factura-template.mjs`).
- **`SANCOR_PTO_VTA = 7` en `electron/main.cjs` quedó como constante sin usar** desde que el punto de venta se hizo configurable (la emisión real usa `eng.getPtoVta()`).
- Comentario desactualizado en `cloud.mjs` sobre dónde viven las credenciales del bucket de Sancor (dice `cloud-config.json`, ya no es así).
- **El modal de confirmación de Sancor dice "Pto. Vta. 7" fijo en el texto — Nuevo (2026-08-05) [C].** (`Sancor.jsx:319`) aunque la emisión real usa `eng.getPtoVta()` (configurable en Opciones). Si alguna vez se cambia el punto de venta, el texto de confirmación queda mintiendo sobre cuál se va a usar. → Mostrar el valor real de config o sacar el número del texto.
- **Archivos temporales de impresión/PDF nombrados solo con `Date.now()` — Nuevo (2026-08-05) [C].** (`electron/main.cjs`, `htmlToPdfBuffer`/`imprimirHtml`) dos operaciones en el mismo milisegundo podrían pisarse el archivo temporal entre sí. Muy improbable en el uso real (una persona no dispara dos impresiones en el mismo milisegundo), pero `crypto.randomUUID()` en vez de `Date.now()` lo elimina del todo por el mismo costo.
- **`importeEnLetras` no contempla importes negativos — Nuevo (2026-08-05) [A].** (`factura-template.mjs`) si algún día se genera un presupuesto con un total negativo (no debería poder pasar hoy por la UI, pero tampoco está bloqueado explícitamente), la conversión a letras rompe. Bajo riesgo, arreglo barato: `Math.abs()` + anteponer "MENOS " si corresponde.
- ~~Los botones de "Ver/Reimprimir/Compartir/N. Crédito/N. Débito" quedaban corridos hacia la derecha en las filas con menos botones (ej. una Nota de Crédito, que no tiene N. Crédito/N. Débito)~~ — Reportado por Juan y resuelto (2026-08-05). `.grid td.acciones` usaba `justify-content: flex-end`; con `flex-start` todas las filas arrancan sus botones en la misma posición, tengan 3 o 5. Afecta por igual a Facturas emitidas y Presupuestos (comparten la misma clase CSS).

---

## Plan de acción recomendado

**Esta semana (fiscal + duplicados + privacidad de esta sesión):**
1. ~~Completar el guard anti-doble-clic en Presupuestos/Pedidos/Facturas~~ ✅ hecho (2026-08-03).
2. ~~Arreglar Nota de Crédito/Débito: descuento por línea + identificación del receptor (Crítico #1)~~ ✅ hecho (2026-08-05).
3. ~~Pedido web facturado dos veces si falla avisar a Supabase (Crítico #3)~~ ✅ hecho (2026-08-05).
4. ~~Nombre de archivo predecible en el link público de comprobantes (Importante #10)~~ ✅ hecho (2026-08-05) — de paso se sacó una política de Supabase que permitía listar el bucket entero con la clave anónima.
5. `backups/` al `.gitignore` (Importante #6) — un minuto, evita un problema serio si se comitea sin querer.

**Este mes:**
6. ~~Corregir el indicador de sync para que no cuente pushes fallidos~~ ✅ hecho (2026-08-03).
7. Sacar el fallback de credenciales viejas + evaluar `safeStorage` (Importante #3 y #4).
8. `path.basename` en la subida de fotos de Sancor (Importante #7), en `guardarSetup` del logo (Importante #11, nuevo), y tombstone para presupuestos **y clientes** borrados (Importante #8, ampliado).

**Cuando haya tiempo:** el resto de Medio y Menor.

---

_Lo que sigue bien: Electron endurecido, numeración fiscal delegada a ARCA, backup diario, indicador de sync ya confiable, y la traducción de errores técnicos a lenguaje claro (`errores.js`) ahora cubre más pantallas que antes._
