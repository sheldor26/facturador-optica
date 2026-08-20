# Auditoría del Facturador Óptica

_Fecha: agosto 2026. Revisión de los cambios sin commitear (Presupuestos, módulo Sancor completo, credenciales de nube por PC, dashboard, impresión automática, backups, modo oscuro) sobre la auditoría de julio 2026. Hecha en trío: Claude Code (lectura completa del diff) + Codex CLI + Antigravity CLI (Agy) como segunda y tercera opinión independientes, con verificación cruzada de cada hallazgo contra el código real antes de listarlo acá._

---

## 🆕 Ronda 2026-08-05: auditoría completa de todo el programa

Juan pidió una auditoría de **todo el programa** (no solo lo nuevo) con las tres IAs. Codex CLI leyó el repo completo (backend + los diez componentes de `renderer/src`); Agy (Antigravity CLI) auditó en profundidad el backend/Electron (`engine.mjs`, `cloud.mjs`, `db.mjs`, `factura-template.mjs`, `sancor.mjs`, `ta-store.mjs`, `arca-tls-fix.mjs`, `main.cjs`, `preload.cjs` — la superficie de dinero/fiscal/credenciales/IPC), pegado directo en el prompt para que no dependiera de permisos de lectura de archivos en modo headless. Cada hallazgo de los dos se verificó contra el código real antes de agregarlo acá; lo que ya estaba anotado abajo no se duplicó, solo se marca como "reconfirmado" si volvió a salir.

**Hallazgo nuevo más importante — pasa a Crítico #3:** un pedido web se puede facturar dos veces si internet parpadea justo después de emitir en ARCA (ver abajo). Lo encontraron Codex y Agy de forma independiente, y lo verifiqué en el código: hoy no hay ningún resguardo local, solo el aviso a Supabase.

Los demás hallazgos nuevos son de menor severidad y quedaron incorporados en sus secciones correspondientes (marcados con **[C]**=Codex, **[A]**=Agy, **[Claude]**=verificado/matizado por mí). Lo que ya figuraba en la auditoría anterior y volvió a salir se marca "(reconfirmado)" sin repetir el texto.

---

## 🆕 Ronda 2026-08-14: ¿aguanta que el trabajo se lo mande otro programa?

Juan quiere que el sistema de gestión nuevo le pase al Facturador el detalle de la ficha y los precios (sin la graduación) para que la factura salga de acá. Antes de conectar nada se auditó de nuevo con Codex y Antigravity, con una pregunta concreta: **¿qué se rompe cuando el disparador deja de ser una persona?**

**Los dos dieron NO-GO para la emisión automática.** El resumen de Codex describe bien el fondo del asunto: *`emitir()` hoy no es una API fiscal dura: confía en que una persona y la UI ya revisaron condición IVA, documento, importes, líneas válidas, total esperado y unicidad del trabajo.*

De los cuatro hallazgos que coincidieron, se arreglaron los dos que pueden costar un problema con el fisco.

### 1. Una factura podía emitirse en ARCA y perderse acá — Resuelto (2026-08-14)

Si se cortaba internet **después** de que ARCA autorizaba y **antes** de que llegara la respuesta, el comprobante existía —legal, declarado, consultable por el QR— pero en la base local no quedaba nada. La factura siguiente tomaba el número de más allá y el salto en la numeración aparecía meses después. No había ninguna forma de recuperarlo: `FECompConsultar` estaba sólo en un script suelto (`consultar-factura.mjs`), nunca en el motor.

**Arreglo, en dos partes.**

Ya no se usa `crearFacturaAuto`, que elige el número adentro y no lo cuenta: ahora se pide el número primero y se manda explícito (las mismas dos llamadas a ARCA que hacía antes, no una más). Sabiendo qué número se pidió, cuando algo falla se le puede preguntar a ARCA por ese número exacto, y hay **tres** respuestas posibles en vez de dos: no existe (no se emitió, se reintenta), existe y es el nuestro (se guarda con el CAE que ARCA ya había dado), o no se puede preguntar. Ese tercer caso es el importante: antes se mostraba *"no se pudo conectar, probá de nuevo"*, que es exactamente el consejo que duplica la factura. Ahora dice que no se sabe y que no se vuelva a emitir hasta averiguarlo. Los mismos tres caminos se aplican a las Notas de Crédito y Débito.

Eso cubre el corte con el programa abierto. Para el otro caso —se cortó la luz, se cerró el programa— está **Opciones → "Revisar numeración"**: compara hasta dónde llegó ARCA contra lo que hay en la base y trae lo que falte. Ojo con una limitación real: ARCA guarda el comprobante fiscal (número, fecha, CAE, importes, documento del receptor) pero **no guarda los renglones**, así que un comprobante recuperado queda completo para el contador y para ARCA, y marcado y sin detalle de lo vendido.

Detalle que casi arruina el arreglo: el aviso de "no se sabe" lleva adentro el motivo técnico original, muchas veces `fetch failed`. Sin una marca que lo saltee, `mensajeHumano()` (`errores.js`) lo habría traducido a *"revisá tu conexión y probá de nuevo en un momento"* — el mensaje correcto convertido en el peligroso. Por eso `SinConfirmar` lleva el prefijo `[SIN-CONFIRMAR]`, que es lo único que sobrevive al cruce a la pantalla.

**Probado** con los cinco caminos simulados (todo bien · no existe · salió y se rescata · no se puede preguntar · el número lo tomó otro comprobante), el barrido de faltantes con siete casos (base al día, hueco al final, hueco en el medio, historia previa al programa, notas de crédito, instalación nueva, tope de 40 por corrida) y el paso del mensaje por `mensajeHumano()`. **No se tocó ARCA de producción**: una consulta desde acá podía renovar el token compartido y dejar a la óptica sin poder facturar por 12 horas.

### 2. Dos emisiones simultáneas del mismo trabajo — Resuelto (2026-08-14)

Facturar un pedido es mirar si ya está facturado y, si no, emitir. Entre esas dos cosas pasan los segundos que tarda ARCA, y en esos segundos el pedido sigue figurando sin facturar. Hoy lo tapa el botón de la pantalla; **automatizado, esa ventana se abre**.

**Lo que se arregló:** dentro de una computadora, el segundo intento sobre el mismo pedido ya no emite nada — se engancha al que está en curso y recibe su resultado. Cubre el doble clic y la misma pantalla abierta dos veces. Aparte, las emisiones de esta PC ahora salen de a una: los números de ARCA son correlativos y dos emisiones a la vez pedían el mismo "último + 1", y la segunda se rechazaba con un error que no explicaba nada.

**Entre computadoras distintas: el candado en la nube.** Juan eligió la columna nueva (migración `orders_candado_de_facturacion`, aplicada el 14/08/2026). La tabla `orders` de la tienda tiene ahora `invoice_claim` (qué computadora está emitiendo) e `invoice_claimed_at` (desde cuándo). Las dos son opcionales, arrancaron vacías en los seis pedidos que había, y la tienda no las lee.

Lo importante es que **no es un chequeo previo** —eso es justamente lo que no alcanzaba— sino una escritura condicional: el `UPDATE` lleva adentro la condición de que nadie lo haya tomado, y el empate lo resuelve la base, que es el único lugar donde se puede resolver de verdad. Si dos PCs lo intentan en el mismo instante, la segunda espera a que la primera termine, vuelve a mirar la fila ya cambiada y no actualiza ninguna: se entera antes de hablar con ARCA.

El candado se toma **lo más tarde posible**, cuando ya pasó todo lo que puede fallar sin llegar a ARCA, y se suelta en un `finally` unos segundos después. La lista de Pedidos web muestra "Lo está facturando \<PC\>" en vez del botón, así nadie lo intenta al pedo.

**Si una computadora se apaga a mitad**, el candado queda puesto. Pasados 15 minutos el programa lo da por abandonado, pero **no lo toma solo**: muestra quién lo tenía, desde cuándo, y avisa que si esa máquina llegó a emitir van a salir dos facturas. Decide una persona. Ese "casi siempre se apagó" no alcanza para automatizarlo, porque el caso que falta es exactamente el que se está tratando de evitar.

**Probado contra la base real**, en transacciones que se deshacen solas y sobre pedidos de mentira (verificado después: seis pedidos, cero candados, cero restos). Tres casos: dos PCs peleando por el mismo pedido → la segunda actualiza 0 filas y el pedido queda de la primera; forzar sobre un candado viejo → funciona; forzar sobre un pedido **ya facturado** → 0 filas, que es el que nunca tiene que poder. Esa última condición no se saca ni forzando.

**Para el repositorio de la tienda:** la columna se agregó directo a la base. Si la tienda lleva sus propias migraciones versionadas, conviene dejar ahí un archivo equivalente para que un despliegue desde cero no quede sin estas dos columnas.

### 3. Las puertas de atrás del motor — Resueltas (2026-08-14)

Cuatro agujeros que hoy tapa la pantalla y que un programa mandando datos habría atravesado derecho. Todos son guardas de una o dos líneas; ninguna cambia nada de lo que ya funcionaba (verificado: los cuatro textos de condición de IVA que usan las pantallas y los dos valores de clase de nota que manda `Facturas.jsx` coinciden exacto con lo que ahora se exige).

- **La condición de IVA ya no cae en silencio a Consumidor Final [C][A].** `COND_MAP[receptorCond] || COND_MAP["Consumidor Final"]` hacía que un `"IVA Responsable Inscripto "` con un espacio de más saliera como Factura B en vez de A. Ahora se recorta el texto y, si no es una de las cuatro, falla diciendo cuáles son. Vacío sigue significando Consumidor Final: es la venta anónima de mostrador. (No confundir con el reintento a Consumidor Final de `facturarPedido`, que es intencional, pedido por Juan el 11/08/2026 y con aviso a la vista.)
- **Una nota que no diga exactamente `"NC"` ya no sale como Nota de Débito [C].** Era `clase === "NC" ? notaCredito : notaDebito`, sin lista blanca: un `"NC "` con un espacio y, en vez de anular la factura, la aumentaba. Ahora sólo se aceptan `"NC"` y `"ND"`.
- **Ya no se puede facturar una lista de precios [C].** Un presupuesto `sinTotal` —los que llevan alternativas para que el cliente elija, y cuyo PDF aclara que no se suman— no se podía facturar desde la pantalla, pero sí por IPC: `facturarPresupuesto()` nunca miraba esa marca. Con alternativas de $40.000 y $50.000 emitía una factura de $90.000 de algo que nadie compró.
- **`saveToken()` ahora chequea `r.ok` [C]** (`cloud.mjs`): si la nube rechazaba el upsert, la PC creía haber publicado el token igual y las otras dos se quedaban con el viejo. Quien llama sigue tratándolo como best-effort; lo que cambia es que ahora falla a la vista.

De paso se tapó un agujero que abrió el arreglo del punto 1: **no se puede emitir una nota sobre un comprobante recuperado de ARCA**, porque ése no trae los renglones y la nota saldría por cero. Esos casos se resuelven en el portal de ARCA.

### 4. El motor no revisaba ningún importe — Resuelto (2026-08-14)

Confiaba en que la pantalla ya había limpiado lo que le llegaba. Y la pantalla limpia bien: descarta renglones con cantidad o precio en cero o negativos. El problema es que no es la única puerta — el IPC llega derecho al motor. Verificado con `construirDetalle` aislado: un precio que no es número daba un total `NaN` y seguía viaje, y una cantidad negativa producía una factura de −$50.000.

Ahora hay **un solo lugar** que decide qué es un importe válido (`revisarItems`, en `engine.mjs`), y pasan por ahí tanto la emisión como el presupuesto. Se rechaza, diciendo qué renglón y por qué: cantidad o precio que no sean números, cantidad o precio menores o iguales a cero, descuentos fuera de 0-100, un comprobante sin renglones, y uno donde todos los renglones sean líneas de texto sin importe. Aparte, `emitir()` se niega a facturar por cero.

**Sobre los decimales:** un precio con tres decimales se rechaza en vez de redondearlo. Redondear es cambiarle el precio a alguien sin avisarle, y además no cierra — diez renglones de $100,005 dan $1.000,05 si se suma primero y $1.000,10 si se redondea renglón por renglón, que es lo que hace este motor. Antes que declarar un número distinto del que calculó quien lo mandó, se dice que el precio está mal escrito.

**`totalEsperado`, el chequeo que hace confiable al puente.** `emitir()` acepta ahora un total opcional: quien manda el trabajo dice cuánto espera cobrar, el motor lo recalcula desde los renglones, y si no coinciden **no emite nada**. Es la diferencia entre un motor que obedece y uno que confirma. Ya está conectado en los pedidos web, que tienen el total del lado de la tienda, así que el chequeo corre desde hoy y no sólo cuando se conecte la gestión.

**Regresión encontrada y arreglada de paso:** `lineasDePedido()` sacaba el precio unitario dividiendo el total del renglón por la cantidad, y esa división no siempre da justo — tres unidades de un renglón de $100 dan $33,3333. Hasta ahora pasaba igual y el redondeo del motor lo tapaba de casualidad; con los importes revisados habría empezado a rechazar pedidos web. Ahora, cuando no divide justo, el renglón va con cantidad 1 por el total y la cantidad queda dicha en la descripción: el importe es exacto y no se pierde el dato. **Probado** con cinco formas de pedido (divide justo, no divide justo, centavos, con envío, con descuento): los cinco cierran exacto contra el total del pedido.

**Probado también** con seis casos que tienen que seguir andando (venta normal, varias unidades, con descuento, con centavos, con línea de texto suelta, descuento vacío como lo manda la pantalla) y once que antes pasaban y ahora no. Verificado que las pantallas de Emitir y Presupuestos ya filtran con el mismo criterio (`precioUnit > 0 && cantidad > 0`), así que nada de lo que hoy se puede cargar a mano queda rechazado.

### 5. El documento del receptor tampoco se revisaba — Resuelto (2026-08-14)

Para un Responsable Inscripto se hacía `Number(digits)` y listo: con el campo vacío salía CUIT `0`, y con cinco dígitos salía ese número. ARCA lo rechazaba, así que no llegaba a emitirse nada mal — pero el error venía de ARCA y en su idioma, cuando el problema estaba acá y se podía decir claro.

Hay **dos situaciones distintas y ahora se tratan distinto**, que es lo que hace que esto no moleste en el mostrador:

- **Factura A** (Responsable Inscripto, Sujeto Exento): el CUIT es obligatorio y tiene que ser un CUIT de verdad. Se exige, y se le revisa el **dígito verificador**, que agarra el número mal tipeado antes de mandarlo y sin preguntarle a nadie. El algoritmo ya estaba en el archivo (lo usa la búsqueda por DNI en el padrón); se verificó contra cuatro CUITs reales conocidos —incluido el de Sancor, que es el que factura el propio programa— y contra dos falsos.
- **Consumidor Final**: identificarse sigue siendo **opcional**, porque la venta anónima de mostrador es la más común que hay. Campo vacío, factura anónima, todo bien. Pero si viene algo escrito, ese algo tiene que ser un DNI (7-8) o un CUIT (11) válido: alguien quiso identificar al cliente, y dejarlo pasar en silencio significa emitir una factura que no dice quién compró. Eso antes pasaba — cinco dígitos y la factura salía anónima sin que nadie se enterara.

**Los pedidos web son la excepción, a propósito.** El documento lo escribió el cliente en la tienda, sin nadie que lo revise, y la venta ya está paga: frenarla porque puso mal el DNI sería peor que emitirla sin nombre. Esa decisión vive en `resolverReceptorPedido()`, no en el motor — el motor sigue siendo estricto, porque cuando alguien carga un documento desde el mostrador ese aviso sirve. **Probado**: de siete cosas que un cliente puede llegar a escribir (DNI bueno, CUIT bueno, cinco dígitos, CUIT mal tipeado, vacío, texto, un teléfono), ninguna frena la venta y las dos válidas conservan la identificación.

Los catorce casos del motor también quedaron probados, y se confirmó que el CUIT de Sancor —el único que el programa factura solo— pasa.

### Lo que sigue abierto de esta ronda

Con los cinco puntos cerrados, **el NO-GO de esta ronda queda levantado**: el motor valida importes, confirma contra el total que manda el origen, exige documentos válidos, no pierde una factura si se corta la luz y no deja que dos computadoras facturen la misma venta. Lo que sigue es construir el puente con el sistema de gestión, que ya tiene de este lado un contrato al que agarrarse.

- **Las notas de crédito dejan centavos sin cancelar [A].** Por redondeo línea por línea contra el consolidado, una factura de $30 se cancela con una nota de $29,98. Real, pero no bloquea nada.

---

## 🐞 Reportado por Juan en producción (no salió en las auditorías)

### ARCA rechazaba facturar a un cliente identificado como Responsable Monotributo — Resuelto (2026-08-11)

Juan no podía facturar un pedido web de hoy. ARCA devolvía: *"El campo Condicion IVA receptor no es valido para la clase de comprobante informado. Consultar metodo FEParamGetCondicionIvaReceptor"*. El padrón de ARCA había identificado al comprador (por su DNI) como **Responsable Monotributo**, y `COND_MAP` (`engine.mjs`) lo manda por **Factura B** con `CondicionIVAReceptorId = 6` (Monotributista) — pero **consulté la tabla oficial de ARCA en vivo** (`FEParamGetCondicionIvaReceptor`, de forma read-only, sin emitir nada) y confirmé que el código 6 hoy **solo es válido en Factura A/C** (`Cmp_Clase: "A/ALEY/C/32"`, sin "B"). El comentario viejo del código ("monotributo recibe Factura B") ya no es correcto — es un cambio de regla de ARCA (parte del rollout de `CondicionIVAReceptorId` obligatorio de la RG 5616), no algo que estuviera mal desde siempre: las facturas a Consumidor Final y a Responsable Inscripto (los casos que sí se usaban hasta ahora) nunca pisaron este problema.

Mientras se diagnosticaba, Juan mismo encontró al tanteo la vuelta correcta (dejar el CUIT cargado pero cambiar "Condición frente al IVA" a Consumidor Final a mano) y pudo facturar. Esa factura (N° 162) quedó bien emitida y con CAE real, pero por un desajuste aparte no había bajado del todo a la base local de esa PC — se trajo manualmente cruzando contra la nube, sin tocar nada fiscal (la factura ya estaba emitida y era válida desde el momento en que ARCA le dio el CAE).

**Arreglo:** en `emitir()`, un receptor con condición "Responsable Monotributo" ahora se trata igual que un Consumidor Final identificado — mismo `CondicionIVAReceptorId=5`, misma identificación opcional por DNI/CUIT. La Factura sigue saliendo tipo B (eso no cambió, ni cambió cómo se interpretan los precios cargados). `emitirNota()` (Notas de Crédito/Débito) recibió el mismo ajuste, para que una nota sobre una de estas facturas no vuelva a pisar el mismo problema. Verificado con un test aislado que reproduce los 5 casos reales (Consumidor Final anónimo, Consumidor Final + DNI, Responsable Monotributo + CUIT — el caso que rompía —, Responsable Inscripto, IVA Sujeto Exento) contra la tabla de `Cmp_Clase` real de ARCA: los 5 dan una combinación válida, y ninguno de los que ya andaban bien cambió de comportamiento.

**Extensión (2026-08-11): reintento automático en Pedidos web.** Juan pidió que si esto (u otro caso parecido) vuelve a pasar, el pedido no se quede sin poder facturarse. `facturarPedido()` ahora, si ARCA rechaza puntualmente por la condición de IVA del receptor identificado (`esRechazoPorCondicionIva()`, matchea el mensaje de error de ARCA), reintenta automáticamente **una sola vez** como Consumidor Final antes de darse por vencido — no reintenta ante cualquier rechazo (un ítem inválido, un problema de conexión, etc. siguen fallando normal, no hay reintento ciego). Si el reintento funciona, la pantalla de Pedidos web muestra un aviso aparte avisando que se facturó como Consumidor Final para que Juan lo revise si hace falta — no queda en silencio. Probado con un test aislado: el caso real (Monotributo rechazado → reintenta → sale bien, 2 llamadas) y dos casos de control (Consumidor Final sin error → 1 sola llamada, no reintenta; rechazo por un motivo que no es de condición de IVA → no reintenta a ciegas). Probado también visualmente en el navegador: los dos toasts (aviso + éxito) se ven apilados y claros.

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
| #7 Path traversal en descarga de Sancor | **Resuelto** (`path.basename` + chequeo de que la ruta quede dentro de la carpeta). La *subida* de fotos tenía el mismo riesgo — también resuelto (2026-08-05, ver Importante #7). |
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

**7. ~~Fotos arrastradas a Sancor: mismo riesgo de path traversal que ya se arregló en la descarga, sin aplicar en la subida~~ — Resuelto (2026-08-05).** En `sancor:guardarFotos`, cuando el archivo no era una imagen comprimible (PDF u otro), el nombre se usaba casi tal cual llega (`nombre = a.nombre || "foto"`), y el bug real estaba un paso más adentro: `nombreLibre()` (`electron/main.cjs`) solo sacaba el `path.basename` **cuando había una colisión de nombre** — en el caso normal (sin colisión), devolvía el nombre crudo tal cual había llegado por IPC, con cualquier `../` intacto. **Arreglo:** `nombreLibre()` ahora siempre parte del `path.basename`, haya o no colisión — cierra el hueco de una sola vez para los dos handlers que la usan (`agregarFotos` y `guardarFotos`), en vez de parchear cada llamador por separado. De paso, Agy también había marcado que `carpetaDestino(base, anio, mes, tipo)` (`sancor.mjs`) recibía `anio`/`mes` sin validar desde `sancor:procesar`/`sancor:agregarFotos`/`sancor:guardarFotos`/`sancor:emitirFactura` — con un `anio`/`mes` no numérico (`"../../../etc"`) se podía apuntar la carpeta destino ENTERA fuera de la carpeta de Sancor, no solo el nombre del archivo. Ahora `carpetaDestino` exige año (2000-2100) y mes (1-12) numéricos, o rechaza con un error claro. Probado con un test aislado: nombre con `../../../evil.pdf` sin colisión queda en `evil.pdf` (antes se colaba tal cual); `anio`/`mes` no numéricos se rechazan; el uso normal (año/mes numéricos de la UI) sigue dando exactamente la misma carpeta que antes.

**8. ~~Eliminar un presupuesto (o un cliente) no dejaba "tumba" (tombstone)~~ — Resuelto (2026-08-05).** `eliminarPresupuesto`/`eliminarCliente` borraban local + mandaban `DELETE` a la nube; si otra PC todavía lo tenía guardado localmente sin sincronizar, en su próximo `sincronizarNube()` lo volvía a **subir** (porque "no estaba" en la nube) y resucitaba en todos lados. **Arreglo:** `facturador_clientes`/`facturador_presupuestos` ganaron una columna `eliminado_en`; `deleteCliente`/`deletePresupuesto` ahora marcan esa fecha con un `PATCH` en vez de un `DELETE` real. `mergeClientes`/`mergePresupuestos` (`db.mjs`), al bajar de la nube un registro con `eliminado_en`, lo sacan de la base local en vez de traerlo/dejarlo — así la PC con la copia vieja se entera y lo borra ella también, sin volver a subirlo. Probado con un test que usa las funciones reales de `db.mjs` (no una copia): un cliente/presupuesto guardado localmente y luego "borrado en otra PC" (simulado con `eliminado_en` en el merge) desaparece de la base local en vez de quedarse; uno nuevo sin `eliminado_en` se sigue agregando normal.

**9. Consumidor Final anónimo sin tope de identificación.** Sigue sin exigirse DNI/CUIT cuando el importe supera el mínimo que ARCA exige identificar (ya estaba en la auditoría de julio, sigue sin resolverse, y ahora también aplica a Presupuestos).

**10. ~~El link público de comprobantes tiene nombre de archivo predecible~~ — Resuelto (2026-08-05) [C].** `nombreArchivo(rec)` armaba el nombre del PDF como `{cuit}_{código}_{ptoVta}_{numero}.pdf` — CUIT y punto de venta fijos y públicos, `numero` correlativo. Cualquiera con **un solo** link podía armar a mano las URLs de todas las demás facturas y descargarlas sin login. **Arreglo:** nueva `nombreArchivoPublico(id)` en `engine.mjs` genera un `crypto.randomUUID()` la primera vez que se comparte cada comprobante y lo guarda en el propio registro (`record.publicToken`, vía `setFacturaPublicToken` en `db.mjs`) — mismo link si se vuelve a compartir, pero nada adivinable. Se usa en los dos lugares que suben al bucket público (`factura:subirPublico` y el auto-upload de `pedido:facturar`); `nombreArchivo()` sigue igual para los archivos locales (ahí no hay problema, los ve solo quien ya tiene la PC). Además, **se encontró y sacó una segunda falla mientras se revisaba esto**: el bucket tenía una política RLS `to public` que permitía **listar** todos los objetos con la clave anónima (la misma que suele estar expuesta en el sitio público) — con esa política activa, nombres random no alcanzaban, porque no hacía falta adivinar nada, alcanzaba con pedirle la lista a Supabase. Se sacó esa política (no la usa ningún código: el link directo funciona solo por ser el bucket público, sin necesitar ningún permiso de SELECT). Verificado con un test aislado (token estable entre llamadas, formato UUID) y probando en vivo que el link directo de un comprobante ya subido sigue respondiendo 200 después de sacar la política.

**11. ~~Path traversal en el logo del setup inicial~~ — Resuelto (2026-08-05) [C].** `guardarSetup({ logoNombre, ... })` hacía `fs.writeFileSync(dp(logoNombre), ...)` sin sanear `logoNombre` en absoluto — un `logoNombre` con `../../` habría escrito fuera de la carpeta de datos. **Arreglo:** `path.basename(logoNombre)` antes de usarlo, y se ignora si queda vacío o en `.`/`..`. Mismo patrón que ya estaba resuelto en la descarga de Sancor. Probado con un test aislado: `../../evil.png` queda en `evil.png`, y `..`/vacío quedan bloqueados.

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
8. ~~`path.basename` en `guardarSetup` del logo (Importante #11), en la subida de fotos de Sancor (Importante #7), y tombstone para presupuestos y clientes borrados (Importante #8)~~ ✅ todo hecho (2026-08-05).

**Cuando haya tiempo:** el resto de Medio y Menor.

---

_Lo que sigue bien: Electron endurecido, numeración fiscal delegada a ARCA, backup diario, indicador de sync ya confiable, y la traducción de errores técnicos a lenguaje claro (`errores.js`) ahora cubre más pantallas que antes._
