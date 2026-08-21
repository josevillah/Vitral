# Contrato del motor de Vitral

El motor vive en `src/`. `vitral.mjs` es solo la entrada.

Este archivo es el plomo del motor: si vas a tocar un modulo, esto es lo que
puedes dar por cierto de los demas sin abrirlos, y lo que los demas dan por
cierto de ti. Si tu cambio contradice algo de aqui, no cambies el codigo a
escondidas: cambia primero este archivo y dilo en tu handoff.

Node 18+, ESM, cero dependencias. No se anaden paquetes de npm.

---

## Las tres invariantes

Son las que no se rompen sin acuerdo previo. Todo lo demas es negociable.

### 1. Solo `salida.mjs` escribe en pantalla

Ningun otro modulo toca `process.stdout`, `process.stderr` ni `console`. Los
demas calculan y devuelven datos; `salida.mjs` decide como se ven.

**Por que:** en algun momento habra una interfaz grafica leyendo el motor. Si el
texto esta repartido por diez archivos, portarlo es reescribirlo entero. Con esta
invariante, cambiar la forma de la salida es tocar un solo archivo.

Si necesitas mostrar algo nuevo, anade una funcion a `salida.mjs` y llamala. No
imprimas desde tu modulo "solo esta vez".

### 2. Solo `vitral.mjs` llama a `process.exit`

Ningun modulo de `src/` termina el proceso. Los fallos se comunican de dos
maneras, segun su naturaleza:

- **Error de forma** — el plan no se puede ni intentar: boceto invalido, ciclo de
  dependencias, bandera desconocida. Se lanza `ErrorVitral(mensaje, sugerencia)`
  desde donde se detecta. `vitral.mjs` lo captura, lo imprime sin traza y sale
  con 1.
- **Guardarrail** — es un juicio, no un fallo: puede que se pueda lanzar igual.
  Se devuelve una lista de veredictos y quien llama decide.

**Por que:** para poder preguntar "¿esto es seguro?" sin morirse en el intento,
que es lo que va a necesitar la interfaz grafica, y lo que hace falta para probar
un guardarrail sin matar el proceso de pruebas.

### 3. Las dependencias van en una direccion

```
hojas        salida · git · agentes · rutas · prompt · errores
medio        boceto -> agentes, errores        olas -> errores
             proceso -> agentes                registro -> salida, agentes, proceso
             guardarrailes -> agentes, git, proceso, rutas
orquesta     corrida -> salida, prompt, proceso, registro
entrada      vitral.mjs -> todos menos agentes y proceso
```

Nadie importa hacia arriba. Si tu modulo necesita algo de uno que esta por
encima, es senal de que el dato deberia entrar por parametro.

---

## Formas compartidas

Estos objetos cruzan fronteras entre modulos. Cambiar un campo aqui afecta a
varios archivos a la vez: dilo en el handoff.

### `tarea` — una entrada del boceto

```
{ id, prompt, rutas: [], agente, necesita?: [], presupuesto?, timeout?, modelo?, cwd? }
```

`boceto.mjs` garantiza que `id`, `prompt`, `rutas` y `agente` existen y son
validos cuando la tarea sale de ahi. Los demas modulos no revalidan.

Los opcionales tambien tienen forma fija. Omitir cualquiera de ellos es valido y
es lo normal:

| Campo | Valido | Invalido |
|---|---|---|
| `presupuesto` | Numero mayor que cero. Omitido significa "sin tope" | `0`, negativos, `NaN`, `Infinity`, cualquier cosa que no sea `number`, incluida la cadena `"3"` |
| `modelo` | Cadena no vacia, sin espacios en blanco | Cadena vacia, cadena con espacios, y cualquier cosa que no sea `string` |
| `cwd` | Cadena no vacia con una ruta **relativa**, que resuelva **dentro de la raiz** y **exista** en disco | Cadena vacia, ruta absoluta, ruta que salga de la raiz, directorio que no existe, y cualquier cosa que no sea `string` |

De estos tres, la forma la comprueba `boceto.mjs`; el entorno —que el `cwd` exista
y caiga dentro de la raiz— lo juzga `guardarrailes.mjs`.

Tres decisiones que se tomaron a proposito y que no se revierten sin hablarlo:

- **`presupuesto: 0` aborta en vez de significar "sin tope".** Quien quiera correr
  sin limite omite el campo. Aceptar el `0` como ilimitado es exactamente el
  malentendido que hace dano.
- **La cadena `"3"` tambien aborta.** Es un `number` o no lo es. Aceptar cadenas
  numericas invita a `"3 dolares"` y a `"3,5"`.
- **`cwd` tiene que ser relativo y caer dentro de la raiz.** Fuera del repositorio
  git no ve nada, asi que no hay forma de revisar ni de deshacer lo que escriba el
  agente, y no hay otra red de seguridad. Una ruta absoluta aborta aunque apunte
  dentro del repositorio: un boceto con rutas absolutas solo funciona en un
  ordenador.

Vitral no valida que el modelo exista: los nombres cambian con la version del CLI
y con el proveedor. Eso lo decide el CLI, que falla rapido y barato.

### `resultado` — lo que devuelve un vidrio

```
{ ok, resultado, sesion, costo, turnos, denegaciones, motivo, explicacion,
  crudo, ms, salida, errores, codigo, error }
```

`ok` es la unica senal de exito. `motivo` es tecnico y depende del agente; los
dos valores que el motor interpreta son `'error_max_budget_usd'` y `'timeout'`,
que disparan la marca de corte incompleto. `error` es el texto ya legible.

### `veredicto` — lo que dice una comprobacion

```
{ nivel: 'aborta' | 'avisa', mensaje, sugerencia, detalles }
```

`aborta` es "no se puede lanzar esto". `avisa` es "se puede, pero que conste".
Una lista vacia es "nada que decir". Un veredicto no imprime ni decide: quien lo
recibe hace las dos cosas.

| Campo | Tipo | Regla |
|---|---|---|
| `nivel` | `'aborta'` \| `'avisa'` | |
| `mensaje` | string | Puede llevar `\n` |
| `sugerencia` | string \| null | `avisa` la deja siempre en `null` |
| `detalles` | string[] | La lista, un elemento por linea. **Siempre un array**; vacio si no hay |

> **Ni `mensaje`, ni `sugerencia`, ni ningun elemento de `detalles` llevan
> espacios de sangria. Los `\n` que lleven son saltos de linea deliberados.**

La sangria de las lineas de continuacion —ocho espacios detras de `vitral: `,
siete detras de `aviso: `— la pone `salida.mjs` al pintar, que es donde vive la
maquetacion por la invariante 1. Antes la ponia cada guardarrail, lo que le
obligaba a saber que funcion iba a pintarlo y cuanto media su prefijo; y en un
evento JSON esa sangria seria basura dentro de un campo de datos.

`detalles` existe por lo mismo: los choques de rutas de `revisarSolapamientos` y
los cwd fuera de la raiz de `revisarCwd` son **una lista de cosas**, y estaban
aplanados en prosa dentro del `mensaje`. Quien pinta los recorre; quien emite los
manda como array. Un `avisa` con `detalles` no lo produce hoy ninguna
comprobacion, y el pintor los recorre igual, sin caso especial.

El orden al pintar es **mensaje, detalles, sugerencia**.

### `plan` — lo que circula por la corrida

```
{ raiz, olas, ejecutan, plomo, handoffs, incompletos }
```

Ojo con esto: `plan.handoffs` y `plan.incompletos` **se mutan durante la
corrida**. Cuando una tarea de la ola 1 deja su handoff, se mete en el mapa para
que la ola 2 lo reciba en su prompt. Es deliberado y es la unica mutacion
compartida del motor.

---

## Modulo por modulo

### `src/salida.mjs`

Todo lo que ve el usuario.

```
modoJson(activo)                         formatearDuracion(ms) -> string
formatearCosto(usd) -> string            imprimirAyuda()
imprimirError(mensaje, sugerencia, detalles = [])
veredicto({ nivel, mensaje, sugerencia, detalles })
fin({ ok, codigo, seco })
cabecera({ nombre, rutaBoceto, rama, plomo, olas, solo, otraTanda })
lineasSaltadas(saltadas, ancho, fechas)
imprimirPrompt(indice, tarea, prompt)    finEnsayo()
cabeceraOla(indice, total, cuantos)      lineaArranque(tarea, ancho)
lineaLatido(id, ancho, ms)               finOla()
lineaCierre({ tarea, ancho, resultado, huboHandoff, rutaMarca, raiz })
avisoFallo(fallidas, indice)
resumen({ costoTotal, ms, repo, diff, sinRastrear, fuera })
listaHistorial(corridas)                 historialVacio()
detalleCorrida(corrida)
```

`otraTanda` es el campo que le llega a `cabecera` desde `cargarHandoffs`. Cuando
no es `null`, la cabecera imprime **una linea mas**, justo debajo de la del
boceto y con la misma sangria de ocho espacios que usan las sugerencias:

```
vitral · El preambulo no puede mentir sobre el paralelismo
boceto .vitral/boceto.json · rama feat/x · plomo 2 archivos (33.1 KB) · olas 2 -> 1
        3 handoffs en disco son de la tanda "Validar presupuesto, modelo y cwd": se ignoran
```

En singular, `1 handoff en disco es de la tanda "...": se ignora`. Con
`otraTanda` en `null` no se imprime nada: la cabecera es la de siempre.

`imprimirAviso(mensaje, detalles)` **existe pero no se exporta.** Su unico
llamador era `resolver()` en `vitral.mjs`, y `veredicto()` lo absorbio: ahora la
decision de si un veredicto se pinta como error o como aviso vive aqui, que es
donde vive la presentacion. Sigue dentro del modulo, fuera del `export`.

**No le corresponde:** decidir nada. No aborta, no llama a `process.exit`, no
lee el disco, no pregunta a git, no calcula lo que muestra. Recibe datos ya
cocinados. Si una funcion de aqui necesita ir a buscar un dato, el dato deberia
llegar como parametro.

#### El modo json

`node vitral.mjs --json` corre exactamente lo mismo, emitiendo **un evento JSON
por linea** en vez del texto pintado. Es lo que va a leer la interfaz grafica que
anticipa la invariante 1.

> **Quien corre `vitral` sin la bandera ve exactamente lo mismo que veia antes.
> Ni una coma.** Cualquier cambio en el texto pintado es un fallo, aunque el JSON
> salga perfecto.

`vitral.mjs` detecta `--json` en un **prescan** sobre `process.argv`, antes de
`parsearBanderas`, y llama a `modoJson(true)` de inmediato. Sin eso, una bandera
desconocida lanzaria su `ErrorVitral` antes de haberse leido `--json`, y la
interfaz recibiria texto pintado justo en el caso de error. `--seco` se lee en el
mismo prescan porque el evento `fin` lo necesita fuera de `principal()`. El
prescan es un `includes` pelado: una tarea cuyo id fuera literalmente `--json` lo
confundiria, y eso no se soporta.

`--json` **sustituye** al texto, no convive con el:

| Canal | Con `--json` |
|---|---|
| `stdout` | **Solo eventos JSON.** Una linea, un evento. Nunca otra cosa |
| `stderr` | La catastrofe: la traza de un error que ni el `.catch` de `vitral.mjs` supo capturar. En una corrida normal queda vacio |

Eso mueve de canal dos cosas que sin la bandera van a `stderr` —los errores de
`imprimirError` y el aviso de fallo de una ola— para que la interfaz lea un solo
canal y nunca tenga que olfatear si una linea es JSON. **Los codigos de salida
son identicos con y sin bandera:** la bandera cambia como se dice lo que pasa, no
lo que pasa.

**`--json` no da streaming del trabajo del agente**, y conviene decirlo porque es
lo primero que se malinterpreta. Los momentos del flujo son exactamente los que el
motor ya tenia: arranque, latido cada 60 s, cierre. `agentes.mjs` declara
`salidaEnStreaming`, pero `proceso.mjs` acumula stdout y solo lo parsea al cerrar:
ver a un vidrio teclear es otra cosa y no depende de esta bandera.

`modoJson(true)` **vacia la paleta entera**, igual que ya hace la ausencia de
TTY, para que ningun codigo ANSI acabe dentro del JSON al correr `--json` en una
terminal de verdad. Por eso `C` es reasignable y no un `const` calculado al
importar.

Las dos piezas que sostienen el modo:

```js
let json = false;

const emitir = (evt, datos) =>
  process.stdout.write(JSON.stringify({ evt, t: new Date().toISOString(), ...datos }) + '\n');
```

> **Ninguna funcion exportada cambia de firma salvo `imprimirError`. Cada una
> decide por dentro si pinta o si emite**, con un `if (json) return emitir(...)`
> al principio. Con las firmas quietas, **`src/corrida.mjs` no se toca ni una
> linea** y sigue sin enterarse de que existe un modo json. Los parametros que
> solo sirven para maquetar —`ancho` en `lineaArranque`, `lineaLatido` y
> `lineaCierre`— se ignoran al emitir.

**Cuatro reglas del flujo**, y las cuatro importan:

1. **Los campos siempre estan.** Un dato ausente es `null` o `[]`, nunca un campo
   que falta. La interfaz no distingue "no vino" de "vino vacio".
2. **Numeros crudos.** `ms` es milisegundos, `costo` es dolares.
   `formatearDuracion` y `formatearCosto` no aparecen jamas en un evento:
   formatear es de quien pinta.
3. **Las rutas van con barras hacia delante**, tambien en Windows:
   `.split(path.sep).join('/')`.
4. **El evento nunca lleva la salida cruda del agente.** Eso ya esta entero en
   `.vitral/logs/<id>.json`, y esa disposicion es de `registro.mjs`.

Todo evento lleva dos campos primero, siempre, en este orden: `evt`, el nombre; y
`t`, un `new Date().toISOString()`. Despues, su carga.

**No hay campo de version, y es a proposito.** El motor y la interfaz viven en el
mismo repositorio y se mueven juntos: no hay compatibilidad de cable que
resolver, y un numero que nadie tiene motivo para incrementar va a mentir la
primera vez que alguien cambie un campo sin tocarlo. Cuando exista un consumidor
que no se despliegue con el motor, se anade entonces, con un motivo.

##### El catalogo de eventos

**Esta tabla es el origen unico.** Los nombres de eventos y de campos se copian
de aqui, literalmente, sin reordenar ni renombrar. Cada uno sale de una funcion
que `salida.mjs` ya tenia: la lista de momentos no se invento, es la que el motor
ya reconocia.

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

Lo que no es evidente de cada campo:

- **`corrida`** — `boceto` es la ruta tal cual la escribio la persona, con barras
  normalizadas. `rama` es `null` sin git: en texto se pinta `sin git`, pero eso
  es presentacion. `plomo` es `{ archivos: string[], bytes: number }` con los
  **nombres** de los archivos, no la cuenta. `olas` son **los ids de cada ola**
  —`[["backend","frontend"],["revision"]]`—, no las cuentas: de ahi sale el
  `2 -> 1` que se pinta, y es lo que permite que el evento `ola` no cambie la
  firma de `cabeceraOla`. `solo` y `otraTanda` son los mismos objetos que recibe
  `cabecera`, o `null`.
- **`saltada`** — un evento **por tarea saltada**, ninguno si no hay ninguna.
  `handoff` es la fecha en ISO, del `Date` que trae el mapa `fechas`.
- **`prompt`** — `texto` es **el prompt entero**: ensenar los prompts es lo que
  es `--seco`. `bytes` es `Buffer.byteLength(prompt, 'utf8')`.
- **`cierre`** — `denegaciones` es **la cuenta**, no la lista: el detalle ya esta
  en el log, que es la misma decision que ya tomaba `registroDeCorrida`.
  `motivo` es el codigo de maquina (`error_max_budget_usd`); `error` es la frase
  en castellano que sale de `MOTIVOS_CLAUDE`. `marca` es la ruta relativa a la
  raiz, o `null`. Un cierre que fue bien lleva `error: null`,
  `motivo: "success"`, `marca: null`.
- **`fallo`** — `ids` van **sin las comillas** que les pone el texto, y `logs`
  son `.vitral/logs/<id>.json` con barras hacia delante.
- **`resumen`** — `diff` es la cadena cruda de `git diff --stat`, sin partir ni
  recortar. `sinRastrear` y `fuera` van **enteros**: el recorte a diez que hace
  el texto es presentacion.
- **`error`** — `detalles` no viaja aqui: nada que llame a `imprimirError` fuera
  de `veredicto` las produce. Un `error` y un `veredicto` de nivel `aborta` son
  **dos eventos distintos a proposito**, y es la distincion de la invariante 2:
  un `ErrorVitral` es "el plan no se puede ni intentar"; un veredicto que aborta
  es un juicio sobre un plan que si se entiende.
- **`historial`** — **un solo evento con el array dentro**, no uno por fila: es
  una consulta con respuesta finita, no un flujo de momentos. Vacio, `corridas`
  es `[]` y no hay ningun otro evento: eso sustituye a `historialVacio`.

**Todos los indices de ola van en base 1**, como en pantalla. Dos numeraciones
para la misma cosa es la trampa de catalogo de siempre.

> **Exactamente un evento `fin` cierra toda invocacion**, incluidas las que
> abortan por un guardarrail, las que revientan con un `ErrorVitral` y las de
> `--ayuda`. La interfaz no tiene que deducir el final de la muerte del proceso.
> Si no llega un `fin`, el motor se murio de algo que nadie previo.

**`finOla()` y `finEnsayo()` no emiten nada, y no es un olvido.** En modo texto
siguen pintando lo de siempre; el final del ensayo ya lo dice el `fin` con
`seco: true`, y la linea en blanco entre olas es maquetacion pura. Se escribe
aqui para que nadie las "arregle".

**`corrida` no es siempre el primer evento.** `revisarRama` y `revisarBoceto`
corren antes que `cabecera`, asi que un `veredicto` puede llegar antes; y si
alguno aborta, no llega ningun `corrida` en toda la invocacion. La interfaz no
puede dar por hecha una cabecera.

##### Los bordes

| Situacion | Que sale |
|---|---|
| Bandera desconocida | `error` + `fin` codigo 1. Lo salva el prescan |
| No hay boceto | `error` + `fin` codigo 1 |
| `--ayuda` | `ayuda` + `fin` codigo 0. Nada mas |
| `--historial` sin ninguna corrida guardada | **un** `historial` con `corridas: []` + `fin` codigo 0 |
| `--historial <id>` que no existe | `error` + `fin` codigo 1 |
| Un guardarrail aborta | `veredicto` con `nivel: "aborta"` + `fin` codigo 1 |
| `--seco` y ninguna tarea saltada | Ningun evento `saltada`. No se emite nada en su lugar |
| La corrida falla en una ola | Los `cierre` de esa ola, luego `fallo`, luego `fin` codigo 1. **No hay `resumen`**: en texto tampoco lo hay |
| Un error que no es `ErrorVitral` | `error` con la primera linea de la traza en `sugerencia`, igual que en texto, + `fin` codigo 1 |
| Un latido sin nada en vuelo | No pasa: el mapa esta vacio y el bucle no itera |

##### Un flujo entero

Salida literal de `node vitral.mjs --seco --json --boceto ejemplo/boceto.json`,
con `stderr` vacio y codigo 0. **Solo se recorta el campo `texto` de los tres
eventos `prompt`** —el prompt entero mide entre 4 y 5 KB—; todo lo demas va tal
cual salio:

```
{"evt":"corrida","t":"2026-08-21T03:04:10.024Z","nombre":"Modulo de estados de pedido","boceto":"ejemplo/boceto.json","rama":"feat/eventos","plomo":{"archivos":["estados-pedido.md"],"bytes":2004},"olas":[["backend","frontend"],["revision"]],"solo":null,"otraTanda":null}
{"evt":"prompt","t":"2026-08-21T03:04:10.026Z","ola":1,"id":"backend","agente":"claude","bytes":4438,"texto":"# Vitral · tarea \"backend\"\n\nEstas trabajando dentro de un vitral: co [...]"}
{"evt":"prompt","t":"2026-08-21T03:04:10.026Z","ola":1,"id":"frontend","agente":"claude","bytes":4445,"texto":"# Vitral · tarea \"frontend\"\n\nEstas trabajando dentro de un vitral: c [...]"}
{"evt":"prompt","t":"2026-08-21T03:04:10.026Z","ola":2,"id":"revision","agente":"claude","bytes":5352,"texto":"# Vitral · tarea \"revision\"\n\nEstas trabajando dentro de un vitral, p [...]"}
{"evt":"fin","t":"2026-08-21T03:04:10.026Z","ok":true,"codigo":0,"seco":true}
```

`--seco` no ejecuta nada, asi que no hay `ola`, ni `arranque`, ni `latido`, ni
`cierre`, ni `resumen`: el ensayo va de `corrida` a `fin` pasando por los
prompts. Este bloque se regenera corriendo el comando, nunca a mano.

### `src/errores.mjs`

```
class ErrorVitral extends Error   // .message, .sugerencia
```

**No le corresponde:** nada mas. Es una sola clase a proposito. Un `ErrorVitral`
se muestra sin traza porque es una situacion prevista; cualquier otro error es un
fallo del programa y ahi si interesa la traza.

### `src/agentes.mjs`

El unico modulo que conoce los flags y el formato de salida de cada CLI.

```
AGENTES = {
  <nombre>: {
    cmd,                     // el ejecutable
    presupuestoSoportado,    // si el CLI sabe cortarse solo al llegar a un tope
    salidaEnStreaming,       // si escribe segun trabaja o de una vez al final
    args(tarea) -> string[], // argumentos, SIN el prompt
    parse(salida, codigo) -> resultado parcial
  }
}
```

`parse` devuelve `{ ok, resultado, sesion, costo, turnos, denegaciones, motivo,
explicacion, crudo }`. `proceso.mjs` le anade `ms`, `salida`, `errores`, `codigo`
y `error`.

**Anadir un agente es anadir una entrada aqui y nada mas.** Antes de escribirla,
corre su `--help` en la maquina y una prueba real: los flags recordados mienten.
Lo que hace falta es modo no interactivo, salida parseable, prompt por stdin y
que no pare a pedir permisos.

**No le corresponde:** lanzar procesos, imprimir, tocar el disco.

### `src/git.mjs`

```
hayGit(raiz) -> bool                 ramaActual(raiz) -> string | null
estadoGit(raiz) -> Set<string>       archivoDeLinea(linea) -> string
diffStat(raiz) -> string | null
cambiosDesde(raiz, estadoAntes) -> { tocados: [], sinRastrear: [] }
```

**Solo lee.** Nunca hace commit, add, checkout ni toca el indice. Vitral observa
el repositorio del usuario, no lo modifica: es su unica red de seguridad.

Dos cosas que no son evidentes y estan medidas: `git status --porcelain` colapsa
un directorio nuevo entero en una linea, por eso siempre va con `-uall`; y
`git diff --stat` no ve los archivos sin rastrear, por eso `cambiosDesde` los
devuelve aparte.

### `src/rutas.mjs`

```
normalizarRuta(raiz, tarea, ruta) -> string     rutasDeclaradas(tareas, raiz) -> string[]
seSolapan(a, b) -> bool                         dentroDe(archivo, rutas) -> bool
```

Logica pura sobre cadenas. La comparacion es **por segmento**, nunca por texto:
`app/Models` contiene a `app/Models/Pedido` pero no a `app/ModelsViejos`. Romper
eso produce falsos positivos que nadie va a entender.

**No le corresponde:** tocar el disco, preguntar a git, juzgar si un solapamiento
es grave. Quien juzga es `guardarrailes.mjs`.

### `src/boceto.mjs`

```
leerBoceto(rutaBoceto) -> boceto      // lanza ErrorVitral si la forma esta mal
leerPlomo(dirPlomo) -> { texto, archivos }
```

Valida forma: campos obligatorios, tipos, dependencias que apuntan a tareas que
existen, agente conocido. Rellena `agente` con `'claude'` si falta.

Los opcionales entran ahi: `presupuesto` numero mayor que cero, `modelo` cadena no
vacia sin espacios, `cwd` cadena no vacia y relativa. Es forma, o sea lo que se
decide mirando el valor y nada mas, que es todo lo que se puede hacer aqui:
`leerBoceto(rutaBoceto)` no recibe la raiz. Si el `cwd` existe en disco y si cae
dentro del repositorio no es forma: eso lo juzga `guardarrailes.mjs`.

El plomo se lee del directorio del boceto, no de una ruta fija: con
`--boceto ejemplo/boceto.json` los contratos salen de `ejemplo/plomo/`.

**No le corresponde:** decidir el orden de ejecucion, juzgar si el plan es
sensato, imprimir, ni ir al disco a comprobar si un `cwd` existe.

### `src/olas.mjs`

```
calcularOlas(tareas, yaListas?) -> tarea[][]    // lanza ErrorVitral si hay ciclo
cerrarDependencias(tareas, id) -> tarea[]
```

Orden topologico por niveles: cada nivel es una ola que corre en paralelo.
`yaListas` son ids que cuentan como terminados sin estar en `tareas`, porque se
van a saltar. Sin ese parametro, saltar una dependencia haria que sus
dependientes parezcan un ciclo.

**No le corresponde:** saber que es un agente, tocar el disco, imprimir.

### `src/proceso.mjs`

```
TIMEOUT_MINUTOS = 15
ejecutarVidrio(tarea, prompt, raiz) -> Promise<resultado>
```

Sabe de procesos del sistema operativo. Dos cosas medidas que no se tocan sin
motivo:

- En Windows se llama a `cmd.exe /d /s /c <agente>`, no `shell: true`. Con
  `shell: true` Node avisa en cada corrida de que no escapa los argumentos.
- Al matar por timeout hace falta `taskkill /T` sobre el arbol: en Windows el
  hijo directo es `cmd.exe` y matarlo solo dejaria vivo al agente.

El prompt **siempre** entra por stdin, nunca como argumento. Eso evita infiernos
de comillas y limites de longitud, y vale para cualquier agente que se anada.

**No le corresponde:** interpretar la salida (eso es `parse` del adaptador),
saber que existen las olas o el latido, imprimir.

### `src/prompt.mjs`

```
construirPrompt(tarea, plomo, handoffs, companeros) -> string
handoffsDe(tarea, handoffs, incompletos) -> [{ id, estado, contenido }]
extraerHandoff(texto) -> string | null
```

`companeros` es un array de ids (`string[]`): las **otras** tareas de la misma
ola, sin la propia. Vacio significa que este vidrio esta solo en su ola. Lleva
`= []` por defecto, asi que un llamador que lo olvide produce el texto de "solo",
que es verdad para una llamada suelta y no inventa companeros. El dato entra por
parametro porque `prompt.mjs` es una hoja del grafo y no va a buscarlo.

Texto puro. Los bloques del prompt van en este orden y este orden importa:
aviso de paralelismo, plomo, tarea, rutas, handoffs de las dependencias,
instruccion de cierre.

Tres reglas de contenido que se rompieron una vez y costaron caro:

1. **El bloque del plomo y el de los handoffs no pueden contradecirse.** La regla
   es la misma en los dos sitios: manda el plomo. Si una tarea anterior se
   desvio, se corrige el codigo, no el contrato.
2. **Un handoff que falta se dice como ausencia**, con voz de sistema y
   encabezado propio (`estado: 'ausente'` o `'incompleto'`), nunca como si fuera
   contenido dejado por otro agente.
3. **El preambulo no puede afirmar paralelismo sin condicion.** Con `companeros`
   vacio dice `eres el unico agente de esta ola`; solo con companeros afirma que
   el codigo de al lado puede estar cambiando. En la tanda del panel PTY, un
   vidrio solo en su ola se explico sus propias reescrituras escribiendo en el
   handoff que otro agente le habia pisado `main.rs` y `panel.js`, con mtimes y
   todo, porque el prompt le afirmaba sin condicion que ese otro agente existia.

`extraerHandoff` vive aqui a proposito: el modulo que le dice al agente "cierra
con `## Handoff`" es el que sabe encontrarlo. Si cambia el formato, cambia en un
solo archivo. Vale el **ultimo** bloque, porque el agente puede repetir la
plantilla del prompt.

**No le corresponde:** leer ni escribir archivos, imprimir, ejecutar nada.

### `src/registro.mjs`

El unico modulo que conoce la disposicion de `.vitral/`.

```
prepararRegistro(raiz, tanda)
cargarHandoffs(raiz, tareas, tanda) -> { handoffs: Map, incompletos: Map, fechas: Map, otraTanda }
guardarLog(raiz, tarea, prompt, resultado)
guardarHandoff(raiz, id, texto)
escribirMarcaIncompleta(raiz, tarea, resultado) -> ruta
borrarMarcaIncompleta(raiz, id)
```

Disposicion actual: `logs/<id>.json`, `handoffs/<id>.md`,
`handoffs/<id>.INCOMPLETO.md`, `handoffs/.tanda`. Si cambia, cambia aqui y en
ningun otro sitio. El sello es un archivo mas de `.vitral/`, asi que entra por la
misma puerta que los demas: la disposicion la conoce este modulo y solo este.

`cargarHandoffs` devuelve **dos mapas separados** a proposito: un handoff de
verdad no es lo mismo que la marca de una tarea que se corto, y confundirlos
borraria marcas que todavia hacen falta.

#### El sello de tanda

`.vitral/handoffs/<id>.md` se guarda por id de tarea, y los ids se repiten entre
tandas. Nada en el disco decia de que tanda era un handoff, asi que un `--solo`
podia saltarse una dependencia que nunca corrio en esta tanda e inyectar su
handoff viejo en el prompt del dependiente, con voz de trabajo recien hecho.

**El sello es `.vitral/handoffs/.tanda`, con el nombre del boceto dentro.** Texto
plano, una linea, terminada en salto de linea, y se compara recortando los
espacios de los extremos. Vive dentro de `handoffs/`, que ya esta ignorado por
git. `tanda` es el `nombre` del boceto, que `boceto.mjs` garantiza que siempre
existe.

`prepararRegistro` lo escribe, ademas de lo que ya hacia. `cargarHandoffs` lo lee
y decide:

| Situacion | Que pasa |
|---|---|
| El sello dice lo mismo que esta corrida | Los handoffs valen. Todo como antes |
| El sello dice otra cosa | Los handoffs y las marcas de incompleto son de otra tanda: se tratan como ausentes, y se dice en la cabecera |
| No hay sello | Los handoffs valen. Es el caso de un proyecto anterior al sello, y descartarle el trabajo bueno seria peor que el fallo que esto arregla |

Los archivos que se ignoran **no se borran**: borrarlos es del cierre de tanda, no
de una corrida que solo queria leerlos.

`otraTanda` es `null` cuando no hay nada que decir, y si no:

```
{ nombre: <lo que dice el sello>, cuantos: <cuantos archivos se ignoraron> }
```

`cuantos` cuenta los handoffs y las marcas de incompleto que existian en disco
**para los ids de esta corrida** y se descartaron. Solo esos: un handoff de un id
que esta corrida no usa no la afecta y no se cuenta. Si el sello no coincide pero
ningun id de esta corrida tenia handoff, `otraTanda` es `null`.

Dos cosas de orden que no se pueden invertir:

- `cargarHandoffs` se llama **antes** que `prepararRegistro`. Si el sello se
  escribiera antes de leerlo, siempre coincidiria y esto no serviria de nada.
- Como `--seco` no llama a `prepararRegistro`, el modo seco **lee el sello pero no
  lo escribe**: dice exactamente lo que diria la corrida real, sin tocar el disco.

Efecto lateral buscado: al tratarse como ausentes, el aviso de sobrescritura deja
de dispararse por handoffs huerfanos **sin tocar `revisarSobrescritura`**, porque
lee esos mismos mapas.

La marca de corte distingue morir por dinero de morir por tiempo, porque son dos
diagnosticos distintos: el presupuesto corta limpio entre turnos y se sabe lo
gastado; el timeout mata a la fuerza y no se sabe si la tarea iba bien.

**No le corresponde:** imprimir, decidir si una tarea fallo.

### `src/guardarrailes.mjs`

```
revisarRama({ repo, rama, banderas, rutaBoceto }) -> veredicto[]
revisarBoceto({ rutaBoceto, raiz }) -> veredicto[]
revisarSolapamientos(olas, raiz) -> veredicto[]
revisarPresupuestos(ejecutan) -> veredicto[]
revisarSobrescritura({ ejecutan, raiz, repo, banderas, handoffs, incompletos }) -> veredicto[]
revisarCwd(ejecutan, raiz) -> veredicto[]
```

Lo que se comprueba antes de lanzar nada. Ninguna imprime ni aborta.

El solapamiento **solo importa dentro de una misma ola**. Entre olas distintas es
normal y a menudo deliberado: una tarea de revision mira `app/` entera despues de
que otras dos hayan escrito en `app/Models/` y `app/Views/`.

El `cwd` se juzga aqui y no en `boceto.mjs` porque hacen falta el disco y la raiz.
`revisarCwd` devuelve `aborta` por los `cwd` que caen fuera de la raiz y por los
que no existen; la forma —cadena no vacia y relativa— ya viene comprobada de
`boceto.mjs`. Para saber si cae dentro vale la misma cuenta que usa
`normalizarRuta`: resolver contra la raiz y mirar si el relativo empieza por `..`.
Un `cwd` que apunta a un archivo que existe cuenta como "no existe": no sirve de
directorio de trabajo y el agente fallaria igual al arrancar.

`revisarBoceto` devuelve `aborta` cuando el boceto resuelve **fuera de la raiz**.
La cuenta es la misma que usa `revisarCwd`: resolver contra la raiz y mirar si lo
relativo empieza por `..`, contando tambien el caso de otra unidad de Windows,
que tambien es estar fuera. No mira si el archivo existe: de eso ya se encarga
`leerBoceto` con su propio error, asi que una ruta que no existe pero cae dentro
de la raiz no le arranca ningun veredicto. El veredicto, literal —sin un solo
espacio de sangria, que es lo que contrata la forma `veredicto`:

```js
{
  nivel: 'aborta',
  mensaje: 'el boceto "C:/otro/.vitral/boceto.json" cae fuera del repositorio.',
  sugerencia: 'sus rutas se resolverian contra esta raiz y sus handoffs se escribirian aqui.\n'
    + 'corre vitral desde el proyecto al que pertenece el boceto',
  detalles: [],
}
```

La `sugerencia` lleva un `\n` entre sus dos lineas y nada mas: los ocho espacios
que se ven en la terminal detras de `vitral: ` los pone `salida.mjs` al pintar.
Pintado sale igual que siempre, byte a byte:

```
vitral: el boceto "C:/otro/.vitral/boceto.json" cae fuera del repositorio.
        sus rutas se resolverian contra esta raiz y sus handoffs se escribirian aqui.
        corre vitral desde el proyecto al que pertenece el boceto
```

La ruta se muestra **tal como la escribio la persona**, sin normalizar, que es
como la va a reconocer.

`vitral.mjs` lo llama **despues de `revisarRama` y antes de `leerBoceto`**: si el
boceto esta fuera, da igual si ademas esta bien escrito. Y **aborta tambien con
`--seco`**, a diferencia del guardarrail de rama, que en seco solo avisa porque el
modo seco no ejecuta nada: aqui el dano es que el modo seco imprimiria prompts con
las rutas resueltas contra la raiz equivocada, que es justo lo que se quiere cazar
antes de gastar.

Que `raiz` sea `process.cwd()` es la primitiva, y no se cambia: quien lanza un
proceso decide su directorio de trabajo. Con esa primitiva, un boceto fuera de la
raiz no es un uso avanzado, es siempre un error.

**No le corresponde:** imprimir, terminar el proceso, modificar el plan.

### `src/corrida.mjs`

```
ensayar(plan)                        // --seco
ejecutarOlas(plan) -> Promise<{ costoTotal, fallidas, ola }>
```

Las olas van en serie, las tareas de una ola en paralelo. Si alguna falla, se
detiene ahi y devuelve las fallidas: **no** termina el proceso.

`ensayar` y `ejecutarOlas` comparten el armado del prompt (`promptDe`) a
proposito. Si el modo seco tuviera su propio camino, podria mentir sobre lo que
se va a ejecutar de verdad.

`promptDe(tarea, plan, ola)` recibe la ola que los bucles de `ensayar` y de
`ejecutarOlas` ya tienen en la mano, filtra de ella la tarea propia y le pasa a
`construirPrompt` los ids de las demas como `companeros`. Ese es el unico sitio
donde se calculan: `prompt.mjs` no sabe que existen las olas. El orden de los ids
es el de la ola, sin ordenar ni reordenar, y es determinista porque
`calcularOlas` lo es. Las tareas saltadas por `--solo` no estan en la ola, asi
que no cuentan como companeras.

**El latido vive aqui y solo aqui.** Es el unico modulo que sabe que existe una
ola y que vidrios siguen en vuelo. `proceso.mjs` ejecuta uno y no sabe de olas;
`salida.mjs` sabe pintar la linea pero no cuando toca. Esta encerrado en
`abrirLatido(ancho)`, que devuelve `{ empieza, termina, cerrar }`: si necesitas
saber que hay en vuelo, usa eso, no montes otro registro.

**No le corresponde:** decidir el codigo de salida, calcular el resumen, validar.

### `vitral.mjs`

La entrada. Parsea banderas, arma el plan, delega, y decide el codigo de salida.

Es el unico sitio que llama a `process.exit` y el unico que captura
`ErrorVitral`. Su funcion `resolver(veredictos)` pasa cada veredicto a
`salida.veredicto()` y responde si alguno impide lanzar. **No decide como se
muestra ninguno:** repartir entre error y aviso es de `salida.mjs`.

El **prescan** de `--json` y de `--seco` sobre `process.argv` vive aqui, antes de
`parsearBanderas`, y tambien el evento `fin`: en el `.then` con el codigo que
devolvio `principal()`, y en el `.catch` con codigo `1`, despues del
`imprimirError` que ya habia. `--json` **no** entra en `registroDeCorrida`: el
historial guarda lo que paso en la corrida, no como se conto.

**No le corresponde:** engordar. Si te encuentras anadiendo logica aqui, casi
siempre pertenece a un modulo de `src/`.

---

## Como trabajar sobre el motor en paralelo

### Donde va cada cosa

Deducir a que modulo pertenece un cambio es donde mas se falla. Los casos que se
dan de verdad:

| Si te piden | Donde va |
|---|---|
| Cambiar el texto, el color o el formato de un mensaje | `salida.mjs`, y nada mas |
| Anadir una bandera al CLI | `vitral.mjs` la parsea y la usa; `salida.mjs` si sale en la ayuda |
| Anadir un agente | `agentes.mjs`, y nada mas. Antes, corre su `--help` y una prueba real |
| Cambiar lo que se le dice al agente en el prompt | `prompt.mjs`, y nada mas |
| Cambiar el bloque `## Handoff` que se le pide | `prompt.mjs`: la instruccion y `extraerHandoff` se cambian juntas o dejan de encajar |
| Cambiar lo que dice la marca de corte incompleto | `registro.mjs` |
| Cambiar donde o con que nombre se guarda algo en `.vitral/` | `registro.mjs`, y nada mas. Tambien el sello `handoffs/.tanda` |
| Cambiar cuando un handoff en disco vale y cuando se ignora | `registro.mjs`: lo decide `cargarHandoffs` con el sello. `salida.mjs` solo pinta el `otraTanda` que salga de ahi |
| Anadir un campo al boceto | `boceto.mjs` lo valida, y quien lo consuma: `agentes.mjs` si acaba en un flag, `proceso.mjs` si cambia como se lanza, `prompt.mjs` si el agente lo lee |
| Cambiar que aborta y que solo avisa | `guardarrailes.mjs`. Solo toca `vitral.mjs` si cambia el orden en que se resuelven |
| Anadir una comprobacion previa nueva | `guardarrailes.mjs` la escribe y devuelve veredictos; `vitral.mjs` la llama en su sitio del orden y decide si el modo seco la respeta |
| Cambiar que cuenta como solape o como "fuera de ruta" | `rutas.mjs` la regla, `guardarrailes.mjs` el juicio |
| Cambiar como se agrupan las olas | `olas.mjs` |
| Cambiar que se salta con `--solo` | `vitral.mjs`: decidir que se ejecuta es parte de armar el plan. Pero **que handoffs hay** se lo da `registro.mjs`, que ya descarta los de otra tanda |
| Cambiar como se lanza o se mata un proceso, o el timeout | `proceso.mjs` |
| Cambiar la cadencia o el momento del latido | `corrida.mjs` decide cuando, `salida.mjs` como se ve |
| Anadir un dato al resumen final | `git.mjs` si hay que calcularlo, `salida.mjs` como se ve, `vitral.mjs` los une |
| Anadir un campo a un evento json, o un evento nuevo | `salida.mjs`, y esta tabla del catalogo. El evento sale de la funcion que ya pinta ese momento: si no hay funcion, primero hay un momento nuevo que pintar |

Dos senales de que te equivocaste de modulo:

- **Necesitas imprimir desde tu modulo.** Entonces el cambio no es tuyo: el dato
  sale de aqui y la linea la pinta `salida.mjs`.
- **Necesitas importar hacia arriba en el grafo.** Entonces el dato deberia
  llegarte por parametro, no ir a buscarlo tu.

### Escribir el plomo de una tanda

Esto no va del motor, va de como se escriben los contratos que lo cambian. Sale
de la primera tanda de agentes sobre el propio Vitral, la del historial: **los
tres fallos que encontro la revision fueron del plomo, ninguno de los agentes.**

- Un `.gitignore` que el plomo daba por puesto y nadie habia puesto.
- Un ejemplo de salida con dos formatos de duracion distintos en la misma pagina,
  y un recuento de tareas que contradecia la regla escrita tres parrafos antes.
- Un caso de borde, `--historial 0`, que el plomo no cubria y cada agente
  resolvio a su manera.

Tres agentes trabajando a ciegas no se compensan entre ellos: si el contrato
dice algo raro, los tres lo copian igual de raro. El plomo es el unico punto
donde un error se multiplica por el numero de vidrios.

De ahi tres reglas:

**Los ejemplos de un plomo son contrato, no ilustracion.** El agente no los lee
para hacerse una idea: los copia. Si el ejemplo pone `0m 12s` donde la funcion
produce `12s`, el agente escribe codigo que produce `0m 12s`, y hace bien, porque
el plomo manda sobre lo que le parezca.

**Un ejemplo escrito a mano que no salga del codigo real es una fuente de
desviaciones.** En cuanto el ejemplo muestre algo que ya produce una funcion
—una duracion, un coste, una fecha, una tabla alineada— generalo llamando a esa
funcion y pega la salida literal, o copiala de una corrida de verdad. Escribir a
mano lo que una funcion ya sabe escribir es inventarse un segundo formato que
nadie mantiene. Si la funcion todavia no existe porque es parte de la tanda,
escribe el ejemplo a mano, pero **vuelve a generarlo en cuanto exista** y
sustituyelo: el plomo de hoy es el contrato de la tanda siguiente.

**Repasa los bordes antes de dar el plomo por bueno.** Cero, vacio, ausente,
negativo, uno solo, mas de los que caben. Un caso que el plomo no cubre no lo
deja "abierto": lo deja a la interpretacion de tres agentes que no pueden
hablarse, y cada uno elige distinto.

Y una cosa que el plomo debe decir siempre, aunque parezca obvia: **que archivos
no toca nadie en esta tanda.** Sin esa lista, lo que un agente da por hecho que
alguien mas hara, no lo hace nadie.

### Reparto del trabajo

- Una tarea por modulo. Las rutas del boceto se declaran por archivo:
  `src/prompt.mjs`, no `src/`.
- Si tu cambio obliga a tocar dos modulos, no lo repartas entre dos agentes:
  ponlo en una sola tarea, o parte el trabajo por otra linea.
- Si necesitas un export nuevo de un modulo que no es tuyo, no lo anadas tu:
  dilo en tu handoff, bajo "Necesito de otros".
- **Nada de exports que nadie importe.** Si expones algo y nadie lo usa, sobra.
- La superficie del CLI —banderas, codigos de salida y texto de los mensajes— es
  contrato con el usuario. No se cambia de paso mientras se hace otra cosa.
