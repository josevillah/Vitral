# Contrato de la tanda · el motor habla en eventos

Una bandera `--json` en el motor: la misma corrida, emitiendo un evento JSON por
linea en vez del texto pintado de siempre. Es lo que va a leer la interfaz cuando
lance tandas desde la ventana.

Esto lo anticipo la invariante 1 de `motor.md`: solo `salida.mjs` escribe en
pantalla, y su "por que" es literalmente *"en algun momento habra una interfaz
grafica leyendo el motor"*. Esta es esa interfaz.

**Este contrato manda sobre lo que te parezca razonable.** Si algo de aqui te
chirria, hazlo igual y dilo en tu handoff.

---

## La promesa que no se rompe

> **Quien corre `vitral` sin la bandera ve exactamente lo mismo que veia ayer.
> Ni una coma.**

No es un objetivo: es la restriccion de entrada de la tanda. Cualquier cambio en
el texto pintado —una palabra, un espacio, un salto de linea, un color— es un
fallo de la tanda aunque el JSON salga perfecto.

Hay tres capas de red, y las tres son de esta tanda:

1. Los **diecisiete bloques literales** de mas abajo, generados llamando al motor
   real antes de tocar nada. Son contrato.
2. Los **24 checks que ya existen** en `pruebas/checks.mjs`. Siguen pasando sin
   que nadie los modifique. Si uno se cae, el modo texto se movio.
3. La tarea `revision`, que compara el diff con esto.

---

## Que entra y que no

**Entra:** la bandera, el flujo de eventos, y la limpieza de los veredictos que
ese flujo obliga a hacer.

**No entra nada de la interfaz.** Esta tanda es solo el motor. No se escribe
codigo que consuma el flujo, ni en `ui/`, ni en ningun sitio.

**No entra streaming del trabajo del agente.** `agentes.mjs` declara
`salidaEnStreaming`, pero `proceso.mjs` acumula stdout y solo lo parsea al
cerrar. Los momentos del flujo son exactamente los de hoy: arranque, latido cada
60 s, cierre. Ver a un vidrio teclear es otra tanda y no se empieza aqui.

---

## La bandera

```
node vitral.mjs --json              corre y emite un evento JSON por linea
```

Se combina con todas las demas: `--seco`, `--solo`, `--rehacer`, `--boceto`,
`--sin-git`, `--historial`, `--ayuda`.

**`--json` sustituye al texto. No conviven.**

| Canal | Con `--json` |
|---|---|
| `stdout` | **Solo eventos JSON.** Una linea, un evento. Nunca otra cosa |
| `stderr` | La catastrofe: la traza de un error que ni el `.catch` de `vitral.mjs` supo capturar. En una corrida normal queda vacio |

Esto mueve de canal dos cosas que hoy van a `stderr`: los errores
(`imprimirError`) y el aviso de fallo de una ola (`avisoFallo`). **Con `--json`
los dos salen por `stdout`, como eventos.** Sin la bandera siguen en `stderr`,
exactamente igual que hoy.

Asi la interfaz lee un solo canal y nunca tiene que olfatear si una linea es JSON
o no. Y si el motor se muere de verdad, lo que aparezca en `stderr` es
inequivocamente eso: un accidente.

**Los codigos de salida son identicos con y sin bandera.** La bandera cambia como
se dice lo que pasa, no lo que pasa.

### El prescan

`--json` se detecta **antes** del bucle de `parsearBanderas`, con un
`process.argv.includes('--json')`.

Sin eso, `node vitral.mjs --bandera-mala --json` lanzaria el `ErrorVitral` de
bandera desconocida antes de haber leido `--json`, y la interfaz recibiria texto
pintado justo en el caso de error, que es el peor sitio donde puede pasar.

`--seco` se lee igual en el prescan, porque el evento `fin` lo necesita en un
sitio donde ya no hay banderas parseadas a mano.

El prescan es un `includes` pelado: una tarea cuyo id fuera literalmente `--json`
o `--seco` lo confundiria. No se soporta y nunca tuvo sentido; no se le pone
defensa.

---

## El flujo

**JSONL: una linea, un evento, terminada en `\n`.** Cada linea parsea sola con un
`JSON.parse`.

Todo evento lleva dos campos primero, siempre, en este orden:

| Campo | Que |
|---|---|
| `evt` | El nombre del evento, de la tabla de abajo |
| `t` | Marca de tiempo, `new Date().toISOString()` |

Y despues su carga. Ejemplo de la forma, no de un evento real:

```json
{"evt":"arranque","t":"2026-08-20T18:42:07.113Z","id":"backend","agente":"claude","rutas":["app/Models/"]}
```

Cuatro reglas del flujo, y las cuatro importan:

**1. Los campos siempre estan.** Un dato ausente es `null` o `[]`, nunca un campo
que falta. La interfaz no tiene que distinguir "no vino" de "vino vacio".

**2. Numeros crudos.** `ms` es un numero de milisegundos, no `"12s"`. `costo` es
un numero de dolares, no `"$0.4470"`. `formatearDuracion` y `formatearCosto` no
aparecen jamas en un evento: formatear es de quien pinta.

**3. Las rutas van con barras hacia delante**, tambien en Windows. El motor
guarda con `path.sep`; el evento normaliza con
`.split(path.sep).join('/')`, que es la misma cuenta que ya hace `lineaCierre`
para pintar el rastro.

**4. El evento nunca lleva la salida cruda del agente.** Eso ya esta entero en
`.vitral/logs/<id>.json`, y la disposicion de `.vitral/` es de `registro.mjs`.

### No hay campo de version, y es a proposito

La tentacion es poner un `v: 1` en cada linea. No se pone, y se escribe aqui para
que la tanda siguiente no lo lea como un olvido y lo "arregle":

El motor y la interfaz viven en el mismo repositorio y se mueven juntos. No hay
compatibilidad de cable que resolver, no hay un consumidor de otra version por
ahi suelto, y un numero que nadie tiene motivo para incrementar es un catalogo
mas que mantener y que va a mentir la primera vez que alguien cambie un campo sin
tocarlo. Cuando exista un consumidor que no se despliegue con el motor, se anade
entonces, con un motivo.

---

## El catalogo de eventos

**Esta tabla es el origen unico.** Los nombres de eventos y de campos se copian de
aqui, literalmente, sin reordenar ni renombrar. Cada uno sale de una funcion que
`salida.mjs` ya tiene: la lista de momentos no se inventa, es la que el motor ya
reconoce.

| Funcion de `salida.mjs` | `evt` | Campos, despues de `evt` y `t` |
|---|---|---|
| `cabecera` | `corrida` | `nombre`, `boceto`, `rama`, `plomo`, `olas`, `solo`, `otraTanda` |
| `veredicto` | `veredicto` | `nivel`, `mensaje`, `sugerencia`, `detalles` |
| `lineasSaltadas` | `saltada` | `id`, `handoff` — **una por tarea saltada** |
| `imprimirPrompt` | `prompt` | `ola`, `id`, `agente`, `bytes`, `texto` |
| `cabeceraOla` | `ola` | `ola`, `total`, `cuantas` |
| `lineaArranque` | `arranque` | `id`, `agente`, `rutas` |
| `lineaLatido` | `latido` | `id`, `ms` |
| `lineaCierre` | `cierre` | `id`, `ok`, `ms`, `costo`, `turnos`, `denegaciones`, `handoff`, `motivo`, `error`, `marca` |
| `avisoFallo` | `fallo` | `ola`, `ids`, `logs` |
| `resumen` | `resumen` | `costoTotal`, `ms`, `repo`, `diff`, `sinRastrear`, `fuera` |
| `imprimirError` | `error` | `mensaje`, `sugerencia` |
| `imprimirAyuda` | `ayuda` | `texto` |
| `listaHistorial` / `historialVacio` | `historial` | `corridas` |
| `detalleCorrida` | `detalle` | `corrida` |
| `fin` | `fin` | `ok`, `codigo`, `seco` |
| `finOla` | — | **no emite nada** |
| `finEnsayo` | — | **no emite nada** |

### Campo por campo

**`corrida`** — de `cabecera({ nombre, rutaBoceto, rama, plomo, olas, solo, otraTanda })`

| Campo | Tipo | De donde |
|---|---|---|
| `nombre` | string | `nombre` |
| `boceto` | string | `rutaBoceto`, tal cual la escribio la persona, con barras normalizadas |
| `rama` | string \| **null** | `rama`. En texto se pinta `sin git` cuando es `null`; eso es presentacion. El dato es `null` |
| `plomo` | `{ archivos: string[], bytes: number }` | `plomo.archivos` entero —los nombres, no la cuenta— y `Buffer.byteLength(plomo.texto, 'utf8')` |
| `olas` | `string[][]` | **Los ids de cada ola**, no las cuentas: `[["backend","frontend"],["revision"]]`. En texto se pinta `2 -> 1`, que sale de ahi |
| `solo` | objeto \| null | El mismo `{ id, ejecutan, saltadas, rehacer }` que recibe hoy |
| `otraTanda` | objeto \| null | El mismo `{ nombre, cuantos }` que recibe hoy |

`olas` lleva ids y no cuentas a proposito: es lo que permite que el evento `ola`
no cambie la firma de `cabeceraOla`, y con eso `corrida.mjs` no se toca. Ver mas
abajo.

**`veredicto`** — su forma esta contratada entera en la seccion siguiente.

**`saltada`** — de `lineasSaltadas(saltadas, ancho, fechas)`. **Un evento por
tarea saltada**, ninguno si no hay ninguna. `ancho` se ignora.

| Campo | Tipo | De donde |
|---|---|---|
| `id` | string | `tarea.id` |
| `handoff` | string | `fechas.get(tarea.id).toISOString()`. Es un `Date` (`statSync().mtime`) |

**`prompt`** — de `imprimirPrompt(indice, tarea, prompt)`

| Campo | Tipo | De donde |
|---|---|---|
| `ola` | number | `indice + 1`. **Base 1, igual que la pantalla** |
| `id` | string | `tarea.id` |
| `agente` | string | `tarea.agente` |
| `bytes` | number | `Buffer.byteLength(prompt, 'utf8')` |
| `texto` | string | **El prompt entero.** Ensenar los prompts es lo que es `--seco` |

Todos los indices de ola del flujo van en **base 1**, como en pantalla. Dos
numeraciones para la misma cosa es la trampa de catalogo de siempre.

**`ola`** — de `cabeceraOla(indice, total, cuantos)`: `ola` es `indice + 1`,
`total` es `total`, `cuantas` es `cuantos`. La composicion de cada ola ya viajo
en `corrida.olas`, asi que aqui basta la cuenta y la firma no cambia.

**`arranque`** — de `lineaArranque(tarea, ancho)`: `id`, `agente`, `rutas`
(`tarea.rutas`, tal cual las declaro el boceto). `ancho` se ignora.

**`latido`** — de `lineaLatido(id, ancho, ms)`: `id`, `ms`. `ancho` se ignora.

**`cierre`** — de `lineaCierre({ tarea, ancho, resultado, huboHandoff, rutaMarca, raiz })`

| Campo | Tipo | De donde |
|---|---|---|
| `id` | string | `tarea.id` |
| `ok` | boolean | `Boolean(resultado.ok)` |
| `ms` | number | `resultado.ms` |
| `costo` | number | `resultado.costo \|\| 0` |
| `turnos` | number \| null | `resultado.turnos ?? null` |
| `denegaciones` | **number** | `(resultado.denegaciones \|\| []).length`. La cuenta basta: el detalle ya esta en el log. Es la misma decision que ya tomo `registroDeCorrida` en `vitral.mjs` |
| `handoff` | boolean | `huboHandoff` |
| `motivo` | string \| null | `resultado.motivo \|\| null`. **El codigo de maquina**, p. ej. `error_max_budget_usd` |
| `error` | string \| null | `resultado.error \|\| null`. **La frase en castellano.** Sale de `MOTIVOS_CLAUDE` en `agentes.mjs`; el codigo va en `motivo` |
| `marca` | string \| null | `rutaMarca` relativa a `raiz` con barras hacia delante, o `null` |

**`fallo`** — de `avisoFallo(fallidas, indice)`: `ola` es `indice + 1`, `ids` son
`fallidas.map(({ tarea }) => tarea.id)` —**sin las comillas** que pone el texto—,
y `logs` son `.vitral/logs/<id>.json` con barras hacia delante.

**`resumen`** — de `resumen({ costoTotal, ms, repo, diff, sinRastrear, fuera })`:
los seis tal cual. `diff` es la cadena cruda de `git diff --stat`, sin partir ni
recortar: eso lo hace el modo texto al pintar. `null` cuando no hay repo o no hay
cambios. `sinRastrear` y `fuera` van **enteros**: el recorte a diez que hace el
texto es presentacion.

**`error`** — de `imprimirError(mensaje, sugerencia, detalles)`: `mensaje` y
`sugerencia` (`null` si no hay). `detalles` no viaja aqui: nada que llame a
`imprimirError` fuera de `veredicto` las produce.

Un `error` y un `veredicto` de nivel `aborta` son **dos eventos distintos a
proposito**, y es la distincion que ya hace la invariante 2 de `motor.md`: un
`ErrorVitral` es "el plan no se puede ni intentar"; un veredicto que aborta es un
juicio sobre un plan que si se entiende.

**`ayuda`** — `texto` es la constante `AYUDA` entera, con sus saltos de linea.
No se emite un catalogo de banderas: nadie lo ha pedido y seria un catalogo mas
que mantener.

**`historial`** — `corridas` es el array de corridas tal como salen de
`leerHistorial`, sin tocar. **Un solo evento con el array dentro**, no uno por
fila: es una consulta con respuesta finita, no un flujo de momentos. Con el
historial vacio, `corridas` es `[]` y no hay ningun otro evento: eso sustituye a
`historialVacio`.

**`detalle`** — `corrida` es el objeto tal como sale de `leerCorrida`, sin tocar.

**`fin`** — `ok` es `codigo === 0`, `codigo` es el codigo de salida del proceso,
`seco` es si se paso `--seco`.

> **Exactamente un evento `fin` cierra toda invocacion**, incluidas las que
> abortan por un guardarrail, las que revientan con un `ErrorVitral` y las de
> `--ayuda`. La interfaz no tiene que deducir el final de la muerte del proceso.
> Si no llega un `fin`, el motor se murio de algo que nadie previo.

---

## La forma nueva de `veredicto`

Esta es la parte que toca `guardarrailes.mjs`, y es una **forma compartida** de
`motor.md`: dilo en tu handoff.

### El problema, medido

Hoy los veredictos traen maquetacion de terminal metida dentro del dato. Y no
siempre la misma:

| Funcion | Que mete | Por que |
|---|---|---|
| `revisarRama`, `revisarBoceto`, `revisarSolapamientos`, `revisarCwd` | `\n` + **8 espacios** | `imprimirError` escribe `vitral: ` delante, que mide 8 |
| `revisarPresupuestos`, `revisarSobrescritura` | `\n` + **7 espacios** | `imprimirAviso` escribe `aviso: ` delante, que mide 7 |

O sea: hoy cada guardarrail tiene que saber que funcion lo va a pintar y cuanto
mide su prefijo. Eso es presentacion, y por la invariante 1 vive en
`salida.mjs`. En JSON ademas es basura: la interfaz recibiria sangria de terminal
dentro de un campo de datos.

Y hay un segundo problema: `revisarSolapamientos` y `revisarCwd` **aplanan una
lista en prosa**. Los choques de rutas y los cwd fuera de la raiz son una lista
de cosas, y llegan como un parrafo que la interfaz tendria que volver a partir.

### La forma

```
{ nivel: 'aborta' | 'avisa', mensaje, sugerencia, detalles }
```

| Campo | Tipo | Regla |
|---|---|---|
| `nivel` | `'aborta'` \| `'avisa'` | Sin cambios |
| `mensaje` | string | Puede llevar `\n`. **Nunca espacios de sangria** |
| `sugerencia` | string \| null | Igual. `avisa` la deja siempre en `null` |
| `detalles` | string[] | La lista, un elemento por linea. **Siempre un array**; vacio si no hay |

> **Ni `mensaje`, ni `sugerencia`, ni ningun elemento de `detalles` llevan
> espacios de sangria. Los `\n` que lleven son saltos de linea deliberados.**

### Como se pinta, para que salga identico

`salida.mjs` sangra las lineas de continuacion. El orden es **mensaje, detalles,
sugerencia**, que es el que ya tiene el texto de hoy.

**Nivel `aborta`** — por `stderr` en modo texto, como hoy:

```
vitral: <primera linea del mensaje>
        <resto de lineas del mensaje>
        <cada detalle>
        <cada linea de la sugerencia>
```

Ocho espacios en toda linea de continuacion. Colores, exactamente como hoy:
**el mensaje y los detalles en rojo** —hoy las listas viven dentro del mensaje, y
se pintan rojas— y **la sugerencia en tenue**.

**Nivel `avisa`** — por `stdout` en modo texto, como hoy:

```
aviso: <primera linea del mensaje>
       <resto de lineas del mensaje>
       <cada detalle>
```

Siete espacios, todo en amarillo. Hoy ninguna comprobacion produce `detalles` en
un `avisa`, y esta bien: el pintor las recorre igual, sin caso especial.

### Que cambia en cada comprobacion

Ninguna cambia **una sola palabra** de lo que dice. Solo se saca la sangria del
dato, y las dos listas pasan a `detalles`.

| Funcion | Que hacer |
|---|---|
| `revisarRama` | En las dos `aborta`, quitar los 8 espacios de detras de `\n` en la `sugerencia` |
| `revisarBoceto` | Igual: quitar los 8 espacios de la `sugerencia` |
| `revisarSolapamientos` | El `mensaje` se queda en `hay tareas de la misma ola escribiendo en el mismo terreno:` **sin la lista pegada detras**; los choques pasan a `detalles`, uno por elemento, sin `\n` ni espacios. Quitar los 8 espacios de la `sugerencia` |
| `revisarPresupuestos` | En los dos `avisa`, quitar los **7** espacios de detras de `\n` en el `mensaje` |
| `revisarSobrescritura` | Quitar los **7** espacios de detras de `\n` en el `mensaje` |
| `revisarCwd` | En los casos de una sola tarea, nada en el `mensaje`; en los de varias, el `mensaje` se queda en la frase con dos puntos y `listaCwd` pasa a producir `detalles` —`"<id>": <cwd>`, sin `\n` ni espacios—. Quitar los 8 espacios de `FUERA_DE_RAIZ` y de `NO_EXISTE` |

**Los dos textos de singular y de plural de `revisarCwd` se quedan como estan.**
Son redacciones distintas, que es contenido, no maquetacion. El caso de una sola
tarea deja `detalles` en `[]`.

### Los diecisiete bloques literales

**Esto es la salida de hoy, generada llamando al motor real antes de tocar nada,
sin TTY y por tanto sin color. No esta escrita a mano.** Despues de la tanda,
byte a byte, tiene que salir esto mismo.

```
### revisarRama · no es repositorio, sin --sin-git
vitral: esto no es un repositorio git, asi que no puedo saber en que rama estas.
        los agentes van a escribir archivos sin pedir permiso y no habria como deshacerlo.
        corre `git init` y crea una rama de trabajo, o pasa --sin-git si sabes lo que haces

### revisarRama · no es repositorio, con --sin-git
aviso: corriendo con --sin-git: no hay repositorio, no hay red de seguridad, no hay vuelta atras

### revisarRama · en main
vitral: estas en la rama "main".
        los agentes escriben archivos sin pedir permiso y no quieres eso en tu rama principal.
        crea una rama antes: git checkout -b trabajo/boceto

### revisarRama · en main, con --seco
aviso: estas en la rama "main"; sin --seco esto abortaria

### revisarRama · no es repositorio, con --seco
aviso: esto no es un repositorio git; sin --seco esto abortaria, o exigiria --sin-git

### revisarBoceto · fuera del repositorio
vitral: el boceto "C:/otro/.vitral/boceto.json" cae fuera del repositorio.
        sus rutas se resolverian contra esta raiz y sus handoffs se escribirian aqui.
        corre vitral desde el proyecto al que pertenece el boceto

### revisarSolapamientos · un choque
vitral: hay tareas de la misma ola escribiendo en el mismo terreno:
        ola 1: "modelos" con app/Models/ y "pedido" con app/Models/Pedido/, ambas bajo app/Models
        corren en paralelo, asi que el ultimo en guardar borra el trabajo del otro
        sin avisar. Separa las rutas, o manda una de las dos a otra ola con "necesita".

### revisarSolapamientos · dos choques
vitral: hay tareas de la misma ola escribiendo en el mismo terreno:
        ola 1: "modelos" con app/Models/ y "pedido" con app/Models/Pedido/, ambas bajo app/Models
        ola 1: "modelos" con app/Otro/ y "pedido" con app/Otro/Cosa/, ambas bajo app/Otro
        corren en paralelo, asi que el ultimo en guardar borra el trabajo del otro
        sin avisar. Separa las rutas, o manda una de las dos a otra ola con "necesita".

### revisarPresupuestos · presupuesto en tarea opencode
aviso: "suelta" declara presupuesto, pero el agente "opencode" no tiene tope de gasto: se ignora.
       Su unico freno es el timeout (15 min).

### revisarPresupuestos · presupuesto por debajo del piso
aviso: presupuesto por debajo de $0.25 en "tacano" ($0.1): el tope se comprueba entre turnos, no durante,
       asi que el gasto real puede ser varias veces el declarado. Sirve de techo de seguridad, no de control fino.

### revisarSobrescritura · una tarea
aviso: esta corrida va a relanzar "backend", que ya corrio antes y tiene archivos suyos en el arbol de trabajo.
       El agente va a escribir encima de ellos. Conviene tener un commit antes.

### revisarSobrescritura · dos tareas
aviso: esta corrida va a relanzar "backend", "frontend", que ya corrieron antes y tienen archivos suyos en el arbol de trabajo.
       Los agentes van a escribir encima de ellos. Conviene tener un commit antes.

### revisarSobrescritura · una tarea, con --rehacer
aviso: --rehacer va a relanzar "backend", que ya corrio antes y tiene archivos suyos en el arbol de trabajo.
       El agente va a escribir encima de ellos. Conviene tener un commit antes.

### revisarCwd · un cwd fuera de la raiz
vitral: el cwd de "fuera" cae fuera del repositorio: ../otro
        ahi git no ve nada, asi que no hay forma de revisar ni de deshacer lo que
        escriba el agente. Vitral no tiene otra red de seguridad.

### revisarCwd · dos cwd fuera de la raiz
vitral: los cwd de estas tareas caen fuera del repositorio:
        "fuera": ../otro
        "lejos": ../../mas
        ahi git no ve nada, asi que no hay forma de revisar ni de deshacer lo que
        escriba el agente. Vitral no tiene otra red de seguridad.

### revisarCwd · un cwd que no existe
vitral: el cwd de "perdida" no existe: no-existe
        creal antes de lanzar. Si no, el agente falla al arrancar con un ENOENT que
        parece culpa del CLI y no del boceto.

### revisarCwd · dos cwd que no existen
vitral: los cwd de estas tareas no existen:
        "perdida": no-existe
        "otra": tampoco
        creal antes de lanzar. Si no, el agente falla al arrancar con un ENOENT que
        parece culpa del CLI y no del boceto.
```

Estos bloques se generaron llamando al motor **antes** de que esta tanda tocara
nada. Son la fotografia de la salida de ayer y por eso valen como red. **Quien
necesite el texto esperado lo copia de aqui, caracter a caracter. Esta prohibido
obtenerlo ejecutando el motor**: para cuando alguien lo ejecute, el motor ya esta
cambiado, y una red generada a partir de lo que vigila no comprueba nada
—confirma.

---

## `src/salida.mjs`: la API

### Lo que se anade

```
modoJson(activo)                     // lo llama vitral.mjs, una vez, antes de nada
veredicto({ nivel, mensaje, sugerencia, detalles })
fin({ ok, codigo, seco })
```

### Lo que cambia de firma

```
imprimirError(mensaje, sugerencia, detalles = [])
```

### Lo que deja de exportarse

`imprimirAviso` pasa a ser interna: su unico llamador era `resolver()` en
`vitral.mjs`, y ahora `veredicto()` la absorbe. Sigue existiendo dentro del
modulo; deja de estar en el `export`.

### La regla del modo

> **Ninguna funcion exportada cambia de firma salvo `imprimirError`. Cada una
> decide por dentro si pinta o si emite.**

Esa es la pieza que sostiene la tanda entera: con las firmas quietas,
**`src/corrida.mjs` no se toca ni una linea** y sigue sin enterarse de que existe
un modo json. Los parametros que solo sirven para maquetar —`ancho` en
`lineaArranque`, `lineaLatido` y `lineaCierre`— sencillamente se ignoran al
emitir.

La forma es un `if` al principio de cada funcion:

```js
export function lineaArranque(tarea, ancho) {
  if (json) return emitir('arranque', { id: tarea.id, agente: tarea.agente, rutas: tarea.rutas });
  // ...lo que ya hacia, sin tocar una letra
}
```

Y las dos piezas nuevas del modulo:

```js
let json = false;

const emitir = (evt, datos) =>
  process.stdout.write(JSON.stringify({ evt, t: new Date().toISOString(), ...datos }) + '\n');
```

### La paleta

`modoJson(true)` **vacia la paleta entera**, igual que ya hace la ausencia de
TTY. Hoy `C` es un `const` calculado al importar; hay que poder reasignarlo.

Por tuberia la paleta ya sale vacia, asi que en la practica esto solo cambia el
caso de correr `--json` en una terminal de verdad — donde, sin esto, los codigos
ANSI romperian el JSON. Es un borde barato de cerrar y caro de descubrir.

### Las dos funciones que no emiten nada

`finOla()` y `finEnsayo()` **no emiten ningun evento**. En modo texto siguen
pintando exactamente lo que pintan hoy: la linea en blanco y el
`modo seco: no se ejecuto nada.`

Se dice aqui porque una funcion que en un modo no hace nada parece un olvido, y
el agente siguiente la "arregla". No es un olvido: el final del ensayo ya lo dice
el evento `fin` con `seco: true`, y la linea en blanco entre olas es maquetacion
pura.

### El ejemplo del flujo esta pendiente de regenerar

No hay aqui un bloque literal de un flujo completo, porque las funciones que lo
producen no existen todavia. **La tarea `documentacion` lo genera corriendo el
motor de verdad** —`node vitral.mjs --seco --json --boceto ejemplo/boceto.json`,
que no gasta un centimo— y pega la salida literal en `motor.md`. Escribirlo a
mano seria inventarse un segundo formato que nadie mantiene.

---

## `vitral.mjs`: donde va cada cosa

- El **prescan** de `--json` y de `--seco` sobre `process.argv`, antes de
  `parsearBanderas`. Si `--json`, `salida.modoJson(true)` inmediatamente.
- `--json` en `parsearBanderas`, en `banderas`, y en el texto de la sugerencia de
  la bandera desconocida.
- `resolver()` pasa a llamar a `salida.veredicto(veredicto)` y nada mas. Deja de
  repartir entre `imprimirError` e `imprimirAviso`: eso lo decide ahora
  `salida.mjs`, que es donde vive esa decision.
- El evento **`fin`** en el `.then` y en el `.catch` del final. En el `.then`,
  `codigo` es el que devolvio `principal()`. En el `.catch`, es `1`, y va
  **despues** del `imprimirError` que ya hay.
- `--json` **no** entra en `registroDeCorrida`: el historial guarda lo que paso
  en la corrida, no como se conto. Las tres banderas que guarda hoy —`solo`,
  `rehacer`, `sinGit`— se quedan en tres.

---

## Los bordes

Cada uno con su respuesta. Ninguno queda a criterio.

| Situacion | Que sale |
|---|---|
| `--json` con una bandera desconocida | `error` + `fin` codigo 1. Lo salva el prescan |
| `--json` y no hay boceto | `error` + `fin` codigo 1 |
| `--json --ayuda` | `ayuda` + `fin` codigo 0. Nada mas |
| `--json --historial` sin ninguna corrida guardada | **un** `historial` con `corridas: []` + `fin` codigo 0 |
| `--json --historial <id>` que no existe | `error` + `fin` codigo 1 |
| `--json` y un guardarrail aborta | `veredicto` con `nivel: "aborta"` + `fin` codigo 1 |
| `--json --seco` y ninguna tarea saltada | Ningun evento `saltada`. No se emite nada en su lugar |
| `--json` y la corrida falla en una ola | Los `cierre` de esa ola, luego `fallo`, luego `fin` codigo 1. **No hay `resumen`**: hoy tampoco lo hay |
| `--json` y un error que no es `ErrorVitral` | `error` con `mensaje` y con la primera linea de la traza en `sugerencia`, igual que hoy, + `fin` codigo 1 |
| `--json` en una terminal de verdad | Paleta vacia forzada. Nunca un codigo ANSI dentro del JSON |
| Un `cierre` que fue bien | `error: null`, `motivo: "success"`, `marca: null`. Los campos estan igual |
| Un latido sin nada en vuelo | No pasa: el mapa esta vacio y el bucle no itera |

**`corrida` no es siempre el primer evento.** `revisarRama` y `revisarBoceto`
corren antes que `cabecera`, asi que un `veredicto` puede llegar antes. Y si
alguno aborta, **no llega ningun `corrida` en toda la invocacion.** La interfaz
no puede dar por hecha una cabecera.

---

## Que archivos toca cada quien

| Tarea | Archivos |
|---|---|
| `emisor` | `src/salida.mjs` |
| `veredictos` | `src/guardarrailes.mjs` |
| `entrada` | `vitral.mjs` |
| `checks` | `pruebas/checks.mjs` |
| `documentacion` | `README.md`, `.vitral/plomo/motor.md` |
| `revision` | ninguno: escribe su handoff |

### Que no toca nadie

**`src/corrida.mjs`** — y es la afirmacion que sostiene el diseno entero. Si te
encuentras necesitando cambiarlo, algo se salio del contrato: dilo en el handoff
en vez de tocarlo.

Tampoco: `src/prompt.mjs`, `src/proceso.mjs`, `src/agentes.mjs`,
`src/registro.mjs`, `src/boceto.mjs`, `src/olas.mjs`, `src/rutas.mjs`,
`src/git.mjs`, `src/errores.mjs`, `ejemplo/`, `ui/`, `.vitral/ui/`, `.gitignore`,
ni ningun otro archivo de `.vitral/` que no sea `plomo/motor.md`.

**Nadie anade dependencias de npm.** Node 18+, ESM, cero dependencias.
