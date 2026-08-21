# Contrato de la tanda · el modo corrida

Lanzar una tanda de Vitral desde la ventana, en el proyecto activo, y ver en que va
cada vidrio.

Las dos mitades ya existen: el motor emite eventos JSON con `--json`, y la ventana
abre paneles con `cwd`. Esta tanda las une, y **nada mas**.

Este es plomo de tanda: se retira al cerrar, y lo que sobreviva se sube a
`panel-pty.md`, que es el contrato permanente. **Manda sobre lo que te parezca
razonable.** Si algo aqui te chirria, hazlo igual y dilo en tu handoff.

---

## Lo que no entra

- **No se reimplementa la orquestacion.** El motor decide; la ventana mira.
- **No se lanza el planificador**: eso es conversacion, y los agentes corren headless.
- **No se editan bocetos** desde la ventana.
- **No se puede intervenir una corrida en marcha.** Ni abortar, ni pausar, ni reanudar.
  El motor no ofrece nada de eso hoy y aqui no se inventa.
- **No se toca `src/`, `vitral.mjs` ni `pruebas/checks.mjs`.** El motor no cambia por una
  tanda de interfaz, y `--json` ya existe: no hace falta ninguna bandera nueva.

### Y una expectativa que hay que matar antes de que nazca

**El flujo no lleva ni un byte de lo que escribe un agente.** El catalogo entero da
`arranque`, `latido` cada 60 s y `cierre`. `proceso.mjs` acumula stdout y solo lo
parsea al terminar; el README lo dice: *"Sin streaming del trabajo"*.

De ahi sale la decision que ordena la tanda: **un vidrio no es un panel.** No tiene
teclado, no tiene PTY, no tiene salida en vivo y no hay nada que redimensionar. Un
vidrio es **una fila en la barra**. Abrirle un PTY seria un terminal vacio durante
minutos, y encima de los procesos que el motor ya tiene en vuelo.

---

## Como se lanza el motor

**Rust lanza el proceso con una tuberia normal. Sin PTY y sin shell.**

```rust
Command::new("node")
    .arg(<vitral.mjs>)          // ruta absoluta al motor
    .arg("--json")              // y "--seco" delante, si toca
    .current_dir(<proyecto>)    // la raiz sale del cwd: es la primitiva del motor
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
```

**Nada de PTY, y no es preferencia.** Un PTY es un emulador de terminal: renderiza los
bytes en un buffer de N columnas y **parte las lineas al ancho**. Medido contra el
boceto de la interfaz: la linea mas larga del flujo son **86.690 caracteres**. Por un
PTY llegaria troceada y con secuencias de escape dentro.

**`--seco` va siempre primero.** El boton de lanzar corre el ensayo antes que la
corrida real: no gasta un centimo y es donde saltan los guardarrailes. La persona ve el
resultado y decide.

**El boceto es siempre `.vitral/boceto.json` del proyecto activo.** No se elige, no se
busca y no se enumera nada del proyecto. Si no existe, el motor devuelve su propio
error y se pinta como cualquier otro.

### El lector de lineas: acumula hasta el salto

**Un trozo de la tuberia no es una linea.** Medido contra el boceto de la interfaz:
llegaron **7 trozos para 5 lineas, y 3 de esos trozos no contenian ni un salto de
linea**.

El lector acumula en un buffer, corta por `\n`, y **emite solo lineas completas**. Lo
que quede sin `\n` se guarda para el trozo siguiente. Al cerrarse la tuberia, si queda
un resto sin salto de linea, **se descarta**: es un flujo truncado, no un evento.

### Rust no interpreta

**Rust reenvia la linea tal cual y no parsea ni un campo.** Es el mismo reparto que ya
existe con el PTY: Rust emite bytes, xterm interpreta. Aqui Rust emite lineas,
`corrida.js` interpreta.

Con eso el catalogo IPC gana **dos eventos, no quince**, y el catalogo de eventos del
motor vive en **un solo archivo**.

---

## El catalogo IPC: lo que se anade

Se copia literal en los dos lados. Sin traducir, sin reordenar, sin renombrar.

### Comando

| Comando | Argumentos | Devuelve |
|---|---|---|
| `lanzar_corrida` | `proyecto: String`, `seco: bool` | `Result<(), String>` |

`#[tauri::command(async)]`, como los ocho que ya hay.

`proyecto` es la ruta **absoluta** del proyecto activo, igual que el `cwd` de un panel.
Una corrida se direcciona por su proyecto, como un panel por su `id`. **No hay ningun
"proyecto de la corrida" global**, ni en Rust ni en JavaScript: es la misma leccion que
dieron el `id` y el `cwd`.

```js
await invoke('lanzar_corrida', { proyecto: 'C:\\Programacion\\Vitral', seco: true });
```

### Eventos

| Evento | Carga | Cuando |
|---|---|---|
| `corrida:linea` | `{ proyecto: String, linea: String }` | por cada linea completa de stdout |
| `corrida:fin` | `{ proyecto: String, codigo: i32 }` | una vez, cuando el proceso del motor termina |
| `corridas:activas` | `{ proyectos: Vec<String> }` | una vez por segundo. **La lista completa** |

`linea` es **texto plano**, no base64: es JSON, que ya es texto. El base64 de
`panel:salida` existe porque un caracter UTF-8 puede partirse entre dos lecturas del
PTY; aqui el lector ya entrega lineas enteras.

`corrida:fin` se emite **exactamente una vez** por corrida, pase lo que pase, como
`panel:fin`.

`corridas:activas` manda el conjunto entero en cada latido, no las altas y bajas, y lo
emite **el hilo temporizador que ya existe** —el de `maquina:uso` y `paneles:ocupados`—,
no uno nuevo.

### Errores

Como los demas: `String` corto, en espanol, en minuscula, que nombra lo que falla.

```
ya hay una corrida en marcha en "C:\Programacion\Vitral"
no se pudo lanzar "node": <lo que diga el sistema>
```

`lanzar_corrida` sobre un proyecto que ya tiene una corrida devuelve `Err` y **no lanza
un segundo proceso**, igual que `abrir_panel` con un id repetido.

---

## Quien conoce el catalogo de eventos del motor

**`ui/web/corrida.js`, y nadie mas.** Es la regla que hace posible esta tanda sin
duplicar un catalogo.

El origen unico del catalogo es `.vitral/plomo/motor.md`, que las tandas de interfaz no
ven, porque el plomo se lee del directorio del boceto. **Copiarlo aqui serian dos
catalogos, y dos catalogos divergen.** La salida no es donde ponerlo: es estrechar el
acoplamiento hasta que quepa en un prompt. Es la misma disciplina que ya usa el motor
—`agentes.mjs` es el unico que conoce el formato de cada CLI, `registro.mjs` el unico
que conoce la disposicion de `.vitral/`— aplicada aqui.

Asi que:

- El catalogo va **en el prompt de la tarea `flujo`**, y solo ahi.
- El resto de la interfaz consume **la forma interna** de la seccion siguiente, y **no
  ve un `evt` en su vida**.
- Se comprueba con `grep`: los nombres de evento del motor tienen que aparecer en
  **un solo archivo** de `ui/`. Si aparecen en dos, el acoplamiento se escapo.

---

## La forma interna: lo que expone `corrida.js`

```js
arrancar(proyecto, { seco })        // invoca lanzar_corrida y empieza a escuchar
alCambiar(fn)                       // fn(corrida) en cada cambio
olvidar(proyecto)                   // borra una corrida terminada
```

**`alCambiar` recibe la corrida entera ya recalculada, no un parche.** El que pinta
repinta con lo que recibe y **no mantiene su propia copia**. Es la misma regla que ya
siguen los tres comandos que devuelven `Estado`.

Un escuchador de `corrida:linea` y uno de `corrida:fin`, montados **una sola vez** y
nunca desmontados, como los de panel. Una linea de un proyecto que no esta en el
registro **se ignora sin ruido**.

```js
{
  proyecto: 'C:\\Programacion\\Vitral',
  nombre:   'El motor habla en eventos',
  boceto:   '.vitral/boceto.json',
  rama:     'feat/eventos',
  seco:     true,
  estado:   'corriendo',
  veredictos: [ { nivel: 'avisa', mensaje: '...', sugerencia: null, detalles: [] } ],
  vidrios: [
    { id: 'emisor', agente: 'claude', rutas: ['src/salida.mjs'], estado: 'ok',
      ms: 134000, costo: 2.882063, turnos: 24, denegaciones: 0,
      motivo: 'success', error: null, marca: null, handoff: null },
  ],
  resumen: null,
  codigo:  null,
}
```

**Los campos siempre estan.** Un dato ausente es `null` o `[]`, nunca un campo que
falta. Es la misma regla que el flujo del motor.

**`vidrios` va en orden de ola**, aplanando `corrida.olas`, y ese orden **no cambia
nunca**. No es orden de llegada: el evento `corrida` trae los ids de todas las tareas de
todas las olas antes de que arranque ninguna.

`estado` de la corrida, cinco valores:

| Valor | Cuando |
|---|---|
| `lanzando` | se invoco `lanzar_corrida` y no ha llegado ninguna linea |
| `corriendo` | llego el evento `corrida` |
| `terminada` | llego `fin` con `ok: true` |
| `detenida` | llego `fallo`, o `fin` con `ok: false` |
| `rechazada` | llego un `veredicto` de nivel `aborta`, o un `error`, sin `corrida` |

---

## Los siete estados de un vidrio

**De que evento sale cada uno.** Esta tabla es el origen unico de los estados.

| Estado | De donde sale |
|---|---|
| `esperando` | esta en `corrida.olas` y aun no llego su `arranque` |
| `en curso` | llego `arranque`. `latido` le actualiza `ms` |
| `ok` | `cierre` con `ok: true` |
| `FALLO` | `cierre` con `ok: false`, con cualquier otro `motivo` |
| `cortada` | `cierre` con `motivo` `error_max_budget_usd` o `timeout`. Trae `marca` |
| `saltada` | evento `saltada`. `handoff` es su fecha ISO |
| `no llego a correr` | hubo un `fallo` de ola y esta tarea estaba en una posterior |

**El ultimo es el que se cae si nadie lo escribe.** Una tarea que nunca va a correr y
una que espera su turno se ven igual y son cosas muy distintas. El flujo las distingue
porque el evento `fallo` dice que la corrida se detuvo: **al recibirlo, todo lo que
siga en `esperando` pasa a `no llego a correr`.**

---

## Como se ve

Es contrato, no gusto personal: si no se escribe, cada agente elige otra cosa.

Todo nace dentro de la paleta **Pergamino** ya contratada en `panel-pty.md`. Los siete
estados son lo unico derivado, y se derivaron como se derivo `activo-ruta`: bajando el
color hasta que se lee sobre pergamino.

### La fila de un vidrio

Se eligio mirando una maqueta, entre tres pesos posibles. El elegido es el intermedio.

| Cosa | Valor |
|---|---|
| Alto | `28px` |
| Sangria izquierda | `30px` |
| Relleno derecho | `12px` |
| Tipografia del id | `11px`, color `texto` `#2e2b1c` |
| Tipografia de los datos | `10px`, color `texto-tenue` `#665f4a`, `font-variant-numeric: tabular-nums` |
| Hueco entre marca, id y datos | `8px` |
| Fondo | el de la barra, `#ece3c8`. **La fila de un vidrio no tiene fondo propio** |

Las filas de vidrio van **debajo de la fila del proyecto activo** y solo ahi. Un
proyecto que no esta activo no ensena sus vidrios, igual que no ensena sus paneles.

**Por que el intermedio y no los otros dos**, que es lo que impide que la tanda
siguiente lo "arregle": con la fila de `20px` las marcas quedan diminutas, y la marca es
lo que lleva el estado; con la de `44px` la barra deja de leerse como una lista de
proyectos, porque seis vidrios de dos lineas hunden los proyectos de abajo.

### Los siete estados: color y forma

**La forma lleva el estado. El color lo refuerza.** No al reves, y hay un numero
detras: ver la nota del par peor.

| Estado | Color | Sobre pergamino | Forma |
|---|---|---|---|
| `esperando` | `#8a8270` | 2.98 | circulo hueco, borde `1.5px`, `9x9` |
| `en curso` | `#5c7a12` / `#9a7b16` | 3.86 / 3.14 | los cuatro cuadros que ya giran en el indicador, `14x14` |
| `ok` | `#16300a` | 11.21 | marca de visto, trazo `2px` |
| `FALLO` | `#a01c1c` | 6.12 | aspa maciza, trazo `2px`, `10x10` |
| `cortada` | `#8a5a0c` | 4.62 | cuadro de `10x10` con borde `1.5px`, medio lleno por la izquierda |
| `saltada` | `#a39c84` | 2.14 | guion de `10x2` |
| `no llego a correr` | `#b0a894` | 1.85 | circulo hueco tachado en diagonal |

**Los tres ultimos van por debajo de 4.5 a proposito**, como `no-disponible`, que ya
esta contratado a 2.14: son estados sin resultado y tienen que verse apagados. Los tres
que traen resultado —`ok`, `FALLO`, `cortada`— pasan el minimo.

**`en curso` reusa el indicador que ya existe**, con sus mismos colores, su mismo ciclo
de `1.6s` y su mismo recorrido por el anillo. No se inventa otra animacion.

#### El par peor, medido

> **`ok` contra `FALLO` es `1.83 : 1`**, y es el par que peor se distingue de los
> veintiuno.

Son los dos estados que mas importan. Verde oscuro y rojo oscuro tienen casi la misma
luminancia: se separan por tono, no por claridad, que ademas es el fallo clasico de
daltonismo.

No es por dejadez: **es el techo.** Con el verde de partida `#3d6410` el par estaba en
`1.13`; llevandolo a `#16300a` sube a `1.83`. Pasar de `2` exigia aclarar el `FALLO` a
`#c62828`, que lo deja en `4.39` sobre pergamino, por debajo del minimo de legibilidad.

**Por eso el estado no puede ir por color.** La marca de `ok` y la de `FALLO` no se
parecen en nada aunque su luminancia si. El segundo par es `saltada` contra
`no llego a correr`, `1.16`, y se resuelve igual: guion contra circulo tachado.

### La animacion

**Valores contratados, no "una transicion suave".**

| Cosa | Valor |
|---|---|
| Duracion | **`220ms`** |
| Curva | `ease-out` |
| Entrada de una fila | `opacity` 0 → 1 **y** `transform: translateY(-4px)` → `none` |
| Escalonado entre filas | **`0ms`. No hay.** Las filas entran como un bloque |
| Cambio de estado | **solo la marca**, con un fundido cruzado de `220ms`. La fila **no se mueve** |

**El escalonado es cero y no es pereza: escalonar mentiria.** Las filas no aparecen
cuando arrancan los vidrios. Aparecen cuando llega el evento `corrida`, que trae los ids
de **todas** las tareas de **todas** las olas. La entrada ocurre una vez por corrida y
las seis filas son un solo hecho. Un escalonado insinuaria un orden de llegada que no
existe — y dentro de una ola tampoco lo hay, porque el motor lanza con `Promise.all`.

**El cambio de estado no mueve la fila.** Mover la fila haria saltar las de abajo, y en
una lista de proyectos eso es ruido caro. Ademas el cambio ya trae una senal fuerte
gratis: `en curso` es lo unico que se mueve continuamente, asi que pasar a `ok` es pasar
de moverse a estarse quieto.

Los `220ms` salen de mirar tres pasos —`120`, `220`, `400`— sobre la fila real. Por
debajo de `100ms` no se lee como movimiento sino como un salto; por encima de `400ms`
estorba. **Son convencion de interfaz, no medida de este repositorio**, y se dice.

#### `prefers-reduced-motion` es obligacion

> **Bajo `@media (prefers-reduced-motion: reduce)` no se anima nada. No es una opcion
> ni una mejora: es parte de la entrega.**

Se apagan las tres:

```css
@media (prefers-reduced-motion: reduce){
  .v.dentro       { transition: none }   /* la entrada de la fila */
  .caja .sale,
  .caja .entra2   { transition: none }   /* el fundido de la marca */
  .m.curso i      { animation: none; opacity: 1 }  /* los cuatro cuadros de "en curso" */
}
```

**Con las animaciones apagadas no se pierde ni un estado**, y es la ventaja de haber
resuelto el par de `1.83` con formas: todo sigue siendo legible sin movimiento. `en
curso` se queda con los cuatro cuadros quietos y a plena opacidad, que sigue sin
parecerse a ninguna de las otras seis marcas.

**Verificado en esta maquina, no supuesto:**
`SystemParametersInfo(SPI_GETCLIENTAREAANIMATION)` devuelve `True`, que es el ajuste que
Chromium mapea a esta consulta, asi que aqui resuelve a `no-preference`. Para probar el
otro caso: F12 → Ctrl+Shift+P → *Emulate CSS prefers-reduced-motion: reduce*.

### El indicador de actividad

Una corrida en vuelo **enciende el indicador que ya existe**, el mismo que encienden los
paneles ocupados. Una sola senal de "aqui se esta ejecutando algo", que es exactamente
el nombre que el contrato eligio a proposito.

El frontend lo enciende si el proyecto tiene paneles en `paneles:ocupados` **o** esta en
`corridas:activas`. Las dos senales las resuelve Rust; el frontend solo las junta.

### La celda de detalle

**Al pulsar un vidrio se abre una celda en la rejilla con su detalle.**

**Es una celda como cualquier otra**: cuenta para el tope de cuatro y convive con los
paneles de shell en la misma rejilla. Una regla, no dos — y el tope recupera su sentido
original, porque quien abre celdas vuelve a ser la persona y no el boceto.

Sobre la rejilla `#0c0c0c`, con la monoespaciada del contrato, `'Cascadia Mono'` a `12px`:

| Zona | Contenido | Color |
|---|---|---|
| Titulo | `<id> · <estado>` | `#fde047` |
| Etiquetas | `agente`, `rutas`, `tiempo`, `coste`, `turnos`, `motivo`, `marca` | `vacio-texto` `#847c69` |
| Valores | lo que traiga el vidrio | `#cccccc` |
| El `error` | la frase del cierre, entera | `error-rejilla` `#ef4444` |
| El handoff | lo que diga el archivo | `#cccccc` |
| Sin handoff | `— sin handoff —` | `vacio-texto` |

**La etiqueta por vidrio levanta la prohibicion solo para vidrios.** `panel-pty.md` dice
*"ningun panel lleva etiqueta ni titulo"* y *"la etiqueta se guarda para el modo
corrida"*. Es ahora, y se acota: **los paneles de shell siguen sin etiqueta**, porque
ahi el prompt ya dice donde estas y un titulo encima seria ruido duplicado. Un vidrio la
necesita porque no tiene prompt ni nadie que sepa que es.

### Lo que no lleva tratamiento, a proposito

- **Una fila de vidrio no tiene fondo propio ni hover.** No es un control de navegacion
  como la fila de un proyecto: se pulsa para abrir su detalle y nada mas.
- **No hay barra de progreso, ni porcentaje, ni tiempo estimado.** El motor no sabe
  cuanto va a tardar una tarea y no hay forma de estimarlo. Un porcentaje inventado es
  peor que ningun porcentaje.
- **No hay coste acumulado en vivo en la fila del proyecto.** El total llega en el
  evento `resumen`, al final, y hasta entonces cualquier suma parcial invita a leerla
  como prevision.
- **Los vidrios terminados no se borran solos.** Se quedan hasta que la persona los
  cierre, por la misma razon por la que un panel muerto conserva su scrollback: *"lo
  ultimo que escribio un agente que murio es justo lo que se quiere leer"*.

---

## Lo que se lee de `.vitral/`, y nada mas

`rumbo.md` marcaba como deliberado que *"nada de la interfaz lee `.vitral/`... hasta la
tanda que lo pida"*. Esta lo pide, y **por un milimetro**:

> **`.vitral/handoffs/<id>.md` del proyecto activo, solo lectura, y solo al pulsar un
> vidrio.**

Ni logs, ni boceto, ni historial, ni marcas de incompleto. Si el archivo no esta, la
celda dice `— sin handoff —` y no es un error. **Se lee al abrir la celda, no antes**:
nada de precargarlos al recibir el cierre.

---

## Los bordes

| Caso | Que pasa |
|---|---|
| `lanzar_corrida` con una corrida ya en marcha en ese proyecto | `Err`, y no se lanza un segundo proceso |
| `node` no esta en el PATH | `Err` con el texto del sistema, y se pinta como cualquier error |
| No existe `.vitral/boceto.json` | El motor emite `error` + `fin` con codigo 1. La corrida queda `rechazada` |
| Un guardarrail aborta | Llega `veredicto` de nivel `aborta` y despues `fin`. Corrida `rechazada`, sin ningun vidrio |
| Un trozo de la tuberia sin `\n` | Se acumula. No se emite hasta que llegue el salto |
| La tuberia cierra con un resto sin `\n` | Se descarta. Es un flujo truncado, no un evento |
| Una linea que no parsea como JSON | Se ignora y se cuenta. Si al final hubo alguna, la corrida lo dice en su detalle. **Nunca revienta el escuchador** |
| Llega `corrida:linea` de un proyecto que no esta en el registro | Se ignora sin ruido |
| Se cierra la ventana con una corrida en marcha | **Se deja correr.** Ver la seccion siguiente |
| Se reabre la ventana con una corrida de antes todavia viva | **Es invisible.** Nadie tiene su asa y el flujo se perdio. Se acepta y se dice aqui |
| Se quita el proyecto activo con una corrida en marcha | Sus paneles mueren, como ya pasa. **La corrida sigue**: no es un panel |
| Se cambia de proyecto con una corrida en marcha | Sus vidrios dejan de verse; el indicador de su fila sigue encendido |
| Mas vidrios que alto de barra | La lista de vidrios se desplaza. La lista de proyectos no |
| Se pulsa un vidrio en `esperando` | Se abre su celda igual, con lo poco que hay. No es un error |
| Se pulsa un vidrio con cuatro celdas ya abiertas | No hace nada, como `Ctrl+Shift+N`. El tope cuenta celdas |
| Se pulsa dos veces el mismo vidrio | No se abre una segunda celda. Se le da el foco a la que hay |
| Llega `cierre` de un id que no estaba en `corrida.olas` | Se anade al final. No deberia pasar, y perder un cierre es peor que ensenar uno de mas |
| `--seco` termina | Corrida `terminada` con `seco: true`. **No se lanza la real sola**: la persona decide |
| `prefers-reduced-motion: reduce` | No se anima nada. Los siete estados siguen distinguiendose |

### Al cerrar la ventana, la corrida sigue

`panel-pty.md` dice que *"un `powershell.exe` huerfano que sobrevive a la ventana es un
fallo, no un detalle"*, y **esto no la contradice**: la distincion es que un panel
huerfano no deja nada y nadie lo ve, mientras que **una corrida huerfana termina su
trabajo y lo deja escrito en `.vitral/`** —handoffs, logs e historial—, porque el motor
esta hecho para correr headless desde una terminal.

Asi que al cerrar la ventana **se matan todos los paneles, como ya se hacia, y no se
mata el proceso del motor.** Matarlo tampoco serviria de mucho sin `taskkill /T`: en
Windows el hijo directo de cada agente es `cmd.exe`, asi que matar `node` dejaria vivos
a los agentes.

El precio, escrito para que nadie lo lea como un olvido: **al reabrir, esa corrida es
invisible.**

---

## Que archivos toca cada quien

| Tarea | Archivos |
|---|---|
| `rust-corrida` | `ui/src-tauri/src/main.rs` |
| `flujo` | `ui/web/corrida.js` |
| `barra` | `ui/web/panel.js`, `ui/web/index.html` |
| `revision` | los cuatro, para leerlos |

**Nadie anade dependencias.** `std::process::Command` basta: no hay crate nueva, ni
`Cargo.toml`, ni `Cargo.lock`, ni permisos nuevos en `capabilities/default.json`.

### Que no toca nadie

`src/`, `vitral.mjs`, `pruebas/checks.mjs`, `ejemplo/`, `.vitral/plomo/`,
`.vitral/planificar/`, `.vitral/ui/` incluido este archivo, `.gitignore`,
`ui/src-tauri/Cargo.toml`, `ui/src-tauri/Cargo.lock`,
`ui/src-tauri/capabilities/default.json`, `ui/src-tauri/tauri.conf.json`, y
`ui/web/vendor/`.

---

## Como se comprueba

**Lo que un agente si puede comprobar, y tiene que comprobar:**

```
cargo build --manifest-path ui/src-tauri/Cargo.toml
```

Sin errores y sin avisos propios. **El handoff no dice "funciona": dice que compila**, y
deja la lista de abajo para que una persona la tache con `cargo tauri dev`.

Y una que si se puede comprobar sin ventana, y hay que dejarla hecha:

```
grep -rn "arranque\|latido\|cierre\|veredicto\|resumen" ui/web/
```

Tiene que salir **un solo archivo**: `ui/web/corrida.js`. Si sale otro, el catalogo se
escapo.

### La lista de comprobacion manual

1. Con un proyecto activo, el boton de lanzar corre **`--seco` primero** y aparecen las
   filas de los vidrios en la barra, bajo la fila del proyecto.
2. **Las filas entran juntas, no en desfile.** Y se nota que entran: no es un salto.
3. Con `--seco`, ningun vidrio pasa de `esperando`, y al acabar la corrida queda
   `terminada`. **No se lanza la corrida real sola.**
4. En una corrida real, un vidrio pasa a `en curso` con los cuatro cuadros girando, y al
   cerrar pasa a `ok` **sin que la fila se mueva** y sin que salten las de abajo.
5. `ok` y `FALLO` se distinguen **de un vistazo**, a un metro de la pantalla. Es el par
   medido a `1.83 : 1` y el que decide si la tabla de formas sirve.
6. `saltada` y `no llego a correr` tambien se distinguen. Es el segundo par, a `1.16`.
7. Al fallar una ola, **las tareas de las olas siguientes pasan a `no llego a correr`**,
   no se quedan en `esperando`.
8. El indicador de la fila del proyecto se enciende mientras hay corrida, y se apaga al
   acabar.
9. Al pulsar un vidrio se abre su celda en la rejilla, con la rejilla reacomodandose
   como con cualquier panel.
10. La celda de un vidrio cortado ensena su `motivo`, su `error` entero y la ruta de su
    `marca`.
11. La celda de un vidrio que dejo handoff **ensena el handoff**. La de uno que no,
    `— sin handoff —`.
12. Con cuatro celdas abiertas, pulsar un quinto vidrio no hace nada.
13. Pulsar dos veces el mismo vidrio no abre dos celdas.
14. Cambiar de proyecto oculta los vidrios y **el indicador del otro sigue encendido**.
15. Los vidrios terminados **siguen ahi** hasta cerrarlos a mano.
16. **Cerrar la ventana con una corrida en marcha no la mata**: en el Administrador de
    tareas siguen `node` y los agentes, y al terminar aparecen los handoffs en
    `.vitral/handoffs/`. **No queda ningun `powershell.exe`.**
17. Al reabrir, esa corrida **no aparece**. Es el precio escrito.
18. Con `prefers-reduced-motion: reduce` —F12 → Ctrl+Shift+P → *Emulate CSS
    prefers-reduced-motion*— **no se mueve nada**: ni la entrada, ni el fundido de la
    marca, ni los cuatro cuadros. Y los siete estados se siguen distinguiendo.
19. Un proyecto sin `.vitral/boceto.json`: el boton lanza, el motor devuelve su error, y
    se pinta sin dejar la ventana en blanco.
20. Una tanda de seis vidrios con cuatro proyectos mas en la lista: **la barra sigue
    leyendose como una lista de proyectos.** Es la prueba que eligio el paso 2.
