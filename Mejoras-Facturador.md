# Ideas y mejoras — Facturador Óptica

_Backlog vivo de UI/UX, diseño, performance, facilidad de carga de datos y features nuevas. NO es la auditoría de bugs/seguridad (esa es [Auditoria-Facturador.md](Auditoria-Facturador.md)). Se actualiza en loop: cada corrida usa Claude Code + Codex CLI + Antigravity CLI (Agy) en paralelo, cruza lo que encuentran, y agrega acá solo lo nuevo o lo que cambió de estado._

**[C]** = lo vio Codex · **[A]** = lo vio Agy · **[Claude]** = verificado/agregado por mí · sin marca = coincidieron dos o más.

---

## Registro de corridas

| Fecha | Qué se agregó |
|---|---|
| 2026-08-03 (#1) | Primera pasada completa: UI/UX, diseño, performance, carga de datos, features. |
| 2026-08-03 (#2) | Catálogo en Emitir + fix de layout ya resueltos e implementados (ver #1). Segunda pasada con Codex+Agy enfocada en hallazgos NUEVOS: borrado de clientes sin confirmar, pedidos web "a ciegas", inconsistencias de impresión/feedback, punto de venta que escribe en cada tecla, presupuestos vencidos sin distinguir. |
| 2026-08-03 (#3) | Nada implementado desde la corrida #2 (código sin cambios). Tercera pasada con foco ampliado al lado nativo (`electron/main.cjs`, `preload.cjs`, `Setup.jsx`) y accesibilidad de teclado transversal — las pantallas de renderer ya estaban bastante exprimidas. Salió una sección nueva: "Nativo / Electron". |
| 2026-08-04 | Pedido de Juan (no salió del loop): al facturar un pedido web, poder pegar el link del PDF en el campo "Factura" de la tienda online sin subirlo a mano a Drive. **Implementado.** |
| 2026-08-05 | Pedido de Juan: auditoría completa de **todo el programa** (no solo el diff), con Codex leyendo el repo entero y Agy enfocado en backend/Electron. Todo lo que salió esta vez fue bugs/seguridad — sin hallazgos nuevos de UI/UX puros — así que se agregó todo en [Auditoria-Facturador.md](Auditoria-Facturador.md) (Crítico #3 nuevo: pedido web facturable dos veces; más 4 de Importante y 4 menores). |

---

## 🔗 Link público de comprobantes (2026-08-04)

**Compartir → "Link público"** (Facturas emitidas): sube el PDF del comprobante a un bucket nuevo y público de Supabase Storage (`comprobantes`, separado del bucket privado `sancor`) y copia el link directo al portapapeles — listo para pegar en el campo "Factura" de la tienda online o mandarlo por donde sea.

- `cloud.mjs`: `subirComprobantePublico()`, mismo patrón de auth que ya usa Sancor.
- `electron/main.cjs`: IPC `factura:subirPublico` (genera el PDF en memoria con `htmlToPdfBuffer`, sin escribirlo a disco primero, y lo sube).
- Supabase: bucket `comprobantes` (`public: true`) + políticas (`comprobantes_auth_all` para subir, lectura pública explícita) — mismo patrón que el bucket `products` ya usado por la tienda.
- Verificado: el endpoint público responde sin pedir autenticación (400 "no encontrado" en vez de 401/403), y el resto del código sigue exactamente el patrón ya probado en producción de Sancor. La subida real con una factura real todavía no se probó de punta a punta (necesita la app empaquetada con credenciales reales) — probarla la primera vez que se use.

**Extensión (2026-08-04): automático para Pedidos web.** Al facturar un pedido desde "Pedidos web", el Facturador ahora sube el PDF y escribe solo el link en `orders.invoice_url` (columna que ya usa la tienda online para "Ver factura") — no hace falta ir a Facturas emitidas ni copiar/pegar nada a mano. Es best-effort: si falla la subida, la factura igual queda emitida (lo importante) y el toast avisa que hay que subir el link a mano. Probado en el navegador con datos simulados, los dos mensajes de toast (con link / sin link) salen correctos.

**Lo que NO se pudo automatizar:** tildar "Avisar al cliente por mail" y que se dispare el envío. Revisé Supabase (Edge Functions, triggers de `orders`) y no hay nada ahí — esa lógica vive en el código de la tienda online (Next.js, otro repo, sin acceso desde esta sesión). Para cerrar el círculo completo haría falta ver ese código (agregar un trigger/función que mande el mail cuando `invoice_url` cambia, o que la tienda exponga un endpoint que el Facturador pueda llamar).

## 🔥 Alto impacto / bajo-medio esfuerzo (arrancar por acá)

1. ~~El catálogo rápido de lentes no existe en "Emitir factura"~~ — **Resuelto (2026-08-03).** Se extrajo a un componente compartido (`CatalogoLentes.jsx`) usado por Emitir y Presupuestos, para no duplicar el código. De paso se encontró y arregló un bug real de layout: con 3 paneles en la grilla de 2 columnas (`.emitir`), el 3er panel caía en la columna angosta (350px) en pantallas ≥1180px por cómo ubica CSS Grid los ítems por default — se veía roto/apretado en cualquier monitor de escritorio normal. Se agregó `.emitir-col2` para apilar los paneles de la columna ancha correctamente. El mismo bug ya estaba presente (sin que se hubiera notado) en **Presupuestos** y en **Sancor** (el panel "Fotos" quedaba apretado bajo "Período y carpeta") — se corrigieron los tres. Se probó modo claro y oscuro en las tres pantallas después del fix, sin problemas nuevos.
2. **Clientes no guarda teléfono/WhatsApp ni email.** Todas las pantallas de "Compartir" (Facturas, Presupuestos) piden tipear el destino a mano cada vez, aunque el cliente ya esté guardado — y encima el campo se resetea vacío cada vez que se abre el modal. Agregar `telefono`/`email` a Clientes y precargarlo en Compartir.
3. **No se puede editar un cliente guardado**, solo agregar o borrar (`Clientes.jsx`). Para corregir un domicilio hay que volver a tipear todo con el mismo CUIT. Un click en la fila que cargue el formulario de edición resuelve esto.
4. **Inconsistencia al buscar CUIT/DNI en ARCA**: en Emitir y Presupuestos, si hay varias personas con el mismo DNI aparece un modal para elegir. En Clientes, agarra la primera silenciosamente. Confunde a quien atiende. Unificar con el mismo modal en los tres lados.
5. **Búsqueda en Facturas/Presupuestos/Clientes solo dispara con Enter o botón**, no mientras se tipea. Buscar con debounce a medida que escriben (y un botón "limpiar") baja la fricción de uso diario.
6. **El menú lateral tiene 10 ítems al mismo nivel** sin agrupar. Separar visualmente "Vender" (Rápida/Emitir/Presupuestos/Sancor), "Consultar" (Facturas/Clientes/Reportes) y "Administrar" (Pedidos/Opciones) ayuda a alguien no técnico a no tener que leer las 10 opciones cada vez.
7. **"Condición frente al IVA" es jerga fiscal expuesta directo** en Emitir/Presupuestos. Para no técnicos sería mejor que se complete sola al buscar el CUIT, dejando el select como algo secundario ("editar datos fiscales") en vez de protagonista del formulario.
8. **El texto de Factura rápida es contradictorio**: dice *"para cuando el cliente no necesita la factura"*, pero la pantalla misma muestra "Factura B · Consumidor Final" y sí emite un comprobante real. Cambiar el texto a algo como "Venta rápida a Consumidor Final, sin cargar datos del cliente".
9. **Doble sincronización al abrir la app**: `electron/main.cjs` sincroniza al arrancar y después `Inicio.jsx` sincroniza otra vez al montar. Sacar una de las dos (dejar la de Inicio, mostrar la pantalla ya y sincronizar en segundo plano sin bloquear).
10. **Inicio hace ~6 llamadas IPC en cadena** (sincronizar → config → resumen → serverStatus → próximo N° A → próximo N° B) antes de terminar de pintar, con saltos de layout en el medio. Paralelizar con `Promise.allSettled` lo que no dependa entre sí, y pintar apenas llegue `resumen`.
11. ~~Borrar un cliente no pide confirmación~~ — **Resuelto (2026-08-03).** Mismo patrón de modal que ya usa Presupuestos (nombre + CUIT del cliente, "Esta acción no se puede deshacer", Cancelar/Eliminar con estado de carga). Probado en el navegador: Cancelar no borra, Eliminar sí borra y solo ese cliente.
12. ~~Pedidos web se facturan "a ciegas"~~ — **Resuelto (2026-08-03).** Nuevo `detallePedido(orderId)` en `engine.mjs` (IPC `pedido:detalle`) devuelve los ítems reales de la factura + el comprador resuelto por padrón antes de confirmar. El modal de "Facturar pedido" ahora muestra la lista de ítems, y si el DNI matchea a varias personas aparece el mismo picker que ya usan Emitir/Presupuestos ("Hay más de una persona con ese DNI") — se elige y recién ahí se factura con ese receptor exacto (`facturarPedido` ahora acepta un receptor ya resuelto en vez de volver a consultar el padrón). Probado en el navegador: pedido con comprador único (ítems + confirmar) y pedido con DNI ambiguo (elegir persona → ítems → confirmar), con el receptor correcto llegando al backend en ambos casos.
13. **El Punto de Venta en Opciones se guarda en el disco en cada tecla tipeada**: si alguien cambia "7" por "12", mientras tipea el "1" ya se escribió `ptoVta=1` en `config.json`. Pasar a estado local + guardar con `onBlur` o un botón explícito.
14. **Presupuestos vencidos se ven igual que los vigentes**: la lista muestra "vence DD/MM" como texto chico, pero la pill de estado siempre dice "Vigente" aunque ya haya pasado la fecha. Comparar contra la fecha actual y mostrar una pill distinta ("Vencido"/"Por vencer").
15. **Notas de Crédito/Débito muy cerca de acciones inocuas**: en Facturas emitidas, "Reimprimir", "Compartir", "N. Crédito" y "N. Débito" son botones mini idénticos en la misma fila — un click de más puede disparar una nota fiscal real por error. Separar las acciones fiscales (NC/ND) de las de solo consulta.

---

## 🖥️ Nativo / Electron (arranque, ventana, actualizaciones)

**Alto impacto:**
- ~~El menú nativo de Electron sigue activo, con sus atajos por defecto~~ — **Resuelto y confirmado (2026-08-03).** `Menu.setApplicationMenu(null)` + un guard en `before-input-event` que bloquea Ctrl/Cmd+R, F5, Ctrl/Cmd+W, Ctrl/Cmd+Shift+I y F12 — solo en la app instalada (`!isDev`), para no molestar mientras se desarrolla. De paso se agregó `minWidth`/`minHeight` a la ventana (el otro punto de esta misma sección). Probado en la build empaquetada real (Mac, sin firmar) por Juan: Cmd+R, Cmd+W y DevTools no hacen nada. **[A]**
- **Si falla la inicialización nativa, la app puede no abrir ninguna pantalla** (ni siquiera Setup): `initEngine()` corre antes de crear la ventana sin `try/catch` ni `dialog.showErrorBox`; si `config.json` o algún JSON de facturas queda corrupto, no hay mensaje de error ni forma de recuperarse desde la UI. **[C]**
- **Auto-actualización sin ninguna UX dentro de la app**: `autoUpdater.checkForUpdatesAndNotify()` corre solo, sin escuchar sus propios eventos (`update-downloaded`, `error`) ni exponer nada a la interfaz. No hay versión visible en Opciones, no hay botón "Buscar actualización", y si la descarga falla se traga en silencio. Si se bajó una versión nueva, nadie se entera ni sabe que hay que reiniciar para aplicarla. **[A][C][Claude: confirmado que no hay número de versión ni acción de update expuestos en Opciones.jsx ni en preload.cjs]**
- ~~La ventana principal no tiene `minWidth`/`minHeight`~~ — **Resuelto (2026-08-03)**, junto con el punto de arriba: `minWidth: 1024, minHeight: 650`. **[A]**

**Medio impacto:**
- `impresoras:listar` crea y destruye una `BrowserWindow` oculta completa cada vez que se consultan las impresoras (al entrar a Opciones o tocar "Actualizar"), en vez de usar `event.sender.getPrintersAsync()` directamente. **[A][Claude: confirmado en electron/main.cjs]**
- Los diálogos del sistema (elegir certificado/clave en Setup, guardar PDF, elegir carpeta) se abren sin pasarles la ventana dueña (`BrowserWindow.fromWebContents(e.sender)`), por lo que en Windows/macOS pueden aparecer no-modales o detrás de la app — pega justo en el momento más delicado, el primer arranque. **[C]**
- **Escape solo cierra el modal en Emitir, Rápida y Sancor** — los de Facturas (NC/ND, Compartir), Presupuestos (Facturar, Borrar, Compartir), Pedidos (Facturar) y el editor de catálogo lo ignoran. Tampoco hay focus trap en ningún modal: con Tab el foco se escapa al fondo semitransparente. Conviene un componente `Modal` común que centralice Escape + foco inicial + `role="dialog"`. **[A][C]**
- Setup inicial no acepta certificados en formato PKCS#12 (`.pfx`/`.p12`) — solo `.crt`/`.key` por separado. Si el contador entrega el certificado en ese formato (algo común), hoy no hay forma de cargarlo sin convertirlo a mano por fuera de la app. Tampoco hay zona de arrastrar y soltar para los archivos. **[A]**
- Sin captura global de errores no manejados en el proceso main (`uncaughtException`/`unhandledRejection`) — un fallo async de fondo (sync cada 12 min, generación de PDF, impresión) puede colgar o cerrar el proceso sin dejar rastro ni avisar. **[A]**

## 🎨 Diseño / Estética

- Contraste bajo entre `--card`, `--surface-2` e `--input-bg` en modo oscuro (valores muy parecidos): formularios y tablas pierden profundidad. **[A]**
- Anchos de columna fijos en píxeles en la tabla de ítems: en notebooks de 1366×768 el header "Precio (con IVA)" se rompe en varias líneas. Usar `min-width`/porcentajes. **[A]**
- El importe grande de Factura Rápida no tiene tratamiento visual de "caja monetaria" (falta el `$` como parte del diseño, no solo texto). **[A]**
- Demasiado radio de borde (14-16px) y sombra para una herramienta operativa de mostrador; se siente más "landing page" que app de trabajo. Bajar a 6-8px, menos sombra. **[C]**
- Cards con hover de elevación aunque no sean clickeables — sensación de "botón" donde no lo hay. **[C]**
- Sidebar con gradiente azul fijo; toda la app queda muy monocromática en azul/slate incluso en modo oscuro. **[C]**
- Estilos inline sueltos en Sancor.jsx, Reportes.jsx, Opciones.jsx en vez de clases — hace que la estética se desalinee con el tiempo. **[C]**
- El modal "Editar catálogo" (recién agregado) scrollea toda la ventana junta; con varias secciones el botón "Guardar catálogo" queda abajo de todo. Conviene header/footer fijos y solo el cuerpo con scroll. **[A]**
- Sin feedback visual al sincronizar manualmente (click en "Nube al día" del sidebar): no hay spinner ni texto de "Sincronizando…" mientras corre, puede parecer que no pasó nada y generar clicks repetidos. **[A]**
- Las tarjetas de Inicio ("Facturado hoy", "Presupuestos vigentes", etc.) no son clickeables — tocar "Presupuestos vigentes" no lleva a Presupuestos. Son datos + navegación en un solo lugar natural. **[A]**
- La barra de facturación mensual en Inicio dibuja un mínimo de 2% de alto incluso cuando el total del mes fue $0, dando la sensación visual de que hubo ventas. Si el total es 0, la barra debería ser 0%. **[A][Claude: confirmado en Inicio.jsx `Math.max(2, ...)`]**
- Sancor sigue mostrando "Pto. Vta. 7" hardcodeado en el texto del modal de confirmación de emisión, aunque la emisión real ya usa el punto de venta configurado en Opciones — si lo cambian, el texto miente. **[C]**

## ⚡ Performance

- Ver ítems #9 y #10 de arriba (doble sync al abrir + cadena de IPCs en Inicio) — son los dos de mayor impacto real hoy.
- ARCA se chequea cada 60s sin importar en qué pantalla esté el usuario; alcanzaría con chequear al abrir, al entrar a una pantalla de emisión, y antes de emitir. **[C]**
- Clientes y Presupuestos no tienen límite/paginado (Facturas sí, `limit=200` en `db.mjs`); con miles de registros a futuro puede sentirse pesado abrir esas pantallas. Hoy no es urgente (recién arrancando), pero conviene tenerlo anotado. **[A][C][Claude: confirmado en db.mjs — listarClientes sin limit, listarFacturas con limit=200 por defecto]**
- Tampoco se avisa en la UI que las listas están topeadas a 200 — puede parecer que "faltan facturas" cuando en realidad hay más de las que se muestran. **[C]**
- En Sancor, `FileReader.readAsDataURL` de fotos del celular (6-10MB) corre en el hilo de React: arrastrar varias fotos puede congelar la interfaz 1-2 segundos. **[A]**
- Reportes trae y renderiza todo el período en una sola tabla sin loading intermedio; para rangos largos puede sentirse trabado. **[C]**
- Sancor analiza las preliquidaciones (PDF) una por una con `await` secuencial en un `for`; con varios archivos juntos tarda más de lo necesario. Se podría paralelizar con `Promise.allSettled` y mostrar el estado por fila. **[C]**

## 📋 Facilidad de carga de datos

- Autocompletar cliente por CUIT en el datalist usa el número como value visible — para quien atiende es más fácil recordar el nombre ("Gómez") que el CUIT. Cambiar a un combobox buscable por nombre. **[C]**
- Detectar automáticamente cuando se completan 11 dígitos de CUIT y disparar la búsqueda en ARCA sola (con un debounce chico), en vez de exigir Enter o click en "Buscar". **[A]**
- Sin atajo visual para el truco de Tab→nueva fila en las tablas de ítems (existe en el código pero nadie lo descubre sin que se lo digan). Un tooltip/hint chiquito alcanza. **[A]**
- Sin botón "Cargar en Emitir" para tomar un presupuesto viejo y reabrirlo editable antes de facturar (hoy "Facturar" emite tal cual quedó guardado, sin poder ajustar un ítem de último momento). **[A][C: lo formula como "revisar antes de facturar"]**
- Default de "Condición de venta" siempre en "Otra": poco claro. Mejor default configurable (ej. "Contado") y recordar la última usada. **[C]**
- Al elegir "Personalizado / de laboratorio" en el catálogo rápido (por ojo), la fila queda con la descripción `(completar) — Ojo derecho` sin foco automático — si se olvidan de editarla, el comprobante puede salir con esa leyenda literal. Hacer foco automático en el campo y avisar si queda sin completar antes de emitir. **[A]**
- Enter no confirma el modal de "Sí, emitir" en Factura Rápida ni en Emitir (solo Escape cancela); hay que soltar el teclado y usar el mouse. Agregar `autoFocus` al botón principal o escuchar Enter en el modal. **[A]**
- Reportes siempre arranca en el rango "este mes"; para ver "ayer" o "mes anterior" hay que tocar el datepicker dos veces a mano. Botones de preset rápido (Hoy/Ayer/Mes anterior/Año actual). **[A]**
- Pedidos web: si falla la conexión con la tienda online, se ve exactamente igual que "no hay pedidos pendientes" — no se distingue un error real de que efectivamente no hay pedidos. **[C]**
- Rápida no refleja el resultado real de la impresión: el mensaje final siempre dice "el PDF se generó y abrió automáticamente" aunque en los hechos se mandó a la impresora (o falló) — Emitir sí muestra el estado real. Igualar el feedback. **[C]**
- Presupuestos imprime siempre al crear uno nuevo, sin opción de desactivarlo (Emitir sí tiene el checkbox "Imprimir original"). Sumar el mismo control acá. **[C]**
- Sin vista previa ni forma de sacar una foto individual antes de procesar el lote en Sancor (drag-and-drop de recetas/órdenes): si se arrastra la foto equivocada, no se puede corregir sin reprocesar todo. Miniatura + botón de quitar por archivo. **[A]**

## 🚀 Features nuevas (impacto vs esfuerzo)

> **Nota (2026-08-03):** seña/saldo pendiente, ficha de graduación/receta y plantillas de venta **NO van acá** — la óptica ya las maneja con un programa interno aparte. No proponer estas tres en futuras corridas del loop.

| Feature | Por qué | Impacto | Esfuerzo |
|---|---|---|---|
| Campo teléfono/WhatsApp en Clientes | Evita re-tipear el destino al compartir (ver #2 de arriba) | Alto | Bajo |
| Revisar/editar antes de convertir un presupuesto en factura | Hoy emite tal cual quedó guardado semanas atrás | Alto | Medio |
| Duplicar un comprobante/presupuesto anterior a Emitir | Clientes frecuentes piden lo mismo (reposición de lentes de contacto, etc.) | Medio | Medio |
| Vencimientos de presupuestos visibles en Inicio ("3 por vencer, llamar hoy") | Ya existe el campo `vencimiento`, solo falta mostrarlo | Medio | Bajo |
| Ficha de cliente con historial (últimas facturas, presupuestos vigentes, total comprado) | Vista de consulta, no requiere infraestructura nueva | Medio | Medio |
| Botón "copiar CAE / N° de factura" | Se manda seguido por WhatsApp a mano | Medio | Bajo |
| "Cierre del día" imprimible (total facturado, cantidad A/B, presupuestos creados) | Reportes ya tiene la base | Medio | Medio |
| Atajos de teclado de mostrador (F2 Rápida, F3 Emitir, F4 Presupuestos) | Menos mouse en la caja | Medio | Bajo |
| Filtros rápidos por estado en Presupuestos/Pedidos (chips: Todos/Vigentes/Facturados/Vencidos) | Hoy solo hay buscador de texto libre | Medio | Bajo |
| Botón "Probar impresora" en Opciones | Manda una página de prueba para confirmar la conexión antes de vender | Medio | Bajo |
| Botón "Copiar texto del comprobante" en los modales de Compartir | Evita depender de que WhatsApp Web/Desktop abra bien; útil si falla el enlace `whatsapp://` | Bajo-Medio | Bajo |

---

## Notas de proceso

- Antigravity CLI (agy) no tiene acceso de lectura de archivos en modo headless en este entorno — para que audite hay que pegarle el código completo en el prompt (no solo pedirle que lea el repo). Ya armado en el script de la corrida.
- Cuando dos herramientas coinciden en un hallazgo, se prioriza — es señal de que es un problema real y no una preferencia de estilo de una sola herramienta.
