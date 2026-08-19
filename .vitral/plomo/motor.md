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
{ nivel: 'aborta' | 'avisa', mensaje, sugerencia }
```

`aborta` es "no se puede lanzar esto". `avisa` es "se puede, pero que conste".
Una lista vacia es "nada que decir". Un veredicto no imprime ni decide: quien lo
recibe hace las dos cosas.

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
formatearDuracion(ms) -> string          formatearCosto(usd) -> string
imprimirError(mensaje, sugerencia)       imprimirAviso(mensaje)
imprimirAyuda()
cabecera({ nombre, rutaBoceto, rama, plomo, olas, solo })
lineasSaltadas(saltadas, ancho, fechas)
imprimirPrompt(indice, tarea, prompt)    finEnsayo()
cabeceraOla(indice, total, cuantos)      lineaArranque(tarea, ancho)
lineaLatido(id, ancho, ms)               finOla()
lineaCierre({ tarea, ancho, resultado, huboHandoff, rutaMarca, raiz })
avisoFallo(fallidas, indice)
resumen({ costoTotal, ms, repo, diff, sinRastrear, fuera })
```

**No le corresponde:** decidir nada. No aborta, no llama a `process.exit`, no
lee el disco, no pregunta a git, no calcula lo que muestra. Recibe datos ya
cocinados. Si una funcion de aqui necesita ir a buscar un dato, el dato deberia
llegar como parametro.

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

El plomo se lee del directorio del boceto, no de una ruta fija: con
`--boceto ejemplo/boceto.json` los contratos salen de `ejemplo/plomo/`.

**No le corresponde:** decidir el orden de ejecucion, juzgar si el plan es
sensato, imprimir.

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
construirPrompt(tarea, plomo, handoffs) -> string
handoffsDe(tarea, handoffs, incompletos) -> [{ id, estado, contenido }]
extraerHandoff(texto) -> string | null
```

Texto puro. Los bloques del prompt van en este orden y este orden importa:
aviso de paralelismo, plomo, tarea, rutas, handoffs de las dependencias,
instruccion de cierre.

Dos reglas de contenido que se rompieron una vez y costaron caro:

1. **El bloque del plomo y el de los handoffs no pueden contradecirse.** La regla
   es la misma en los dos sitios: manda el plomo. Si una tarea anterior se
   desvio, se corrige el codigo, no el contrato.
2. **Un handoff que falta se dice como ausencia**, con voz de sistema y
   encabezado propio (`estado: 'ausente'` o `'incompleto'`), nunca como si fuera
   contenido dejado por otro agente.

`extraerHandoff` vive aqui a proposito: el modulo que le dice al agente "cierra
con `## Handoff`" es el que sabe encontrarlo. Si cambia el formato, cambia en un
solo archivo. Vale el **ultimo** bloque, porque el agente puede repetir la
plantilla del prompt.

**No le corresponde:** leer ni escribir archivos, imprimir, ejecutar nada.

### `src/registro.mjs`

El unico modulo que conoce la disposicion de `.vitral/`.

```
prepararRegistro(raiz)
cargarHandoffs(raiz, tareas) -> { handoffs: Map, incompletos: Map, fechas: Map }
guardarLog(raiz, tarea, prompt, resultado)
guardarHandoff(raiz, id, texto)
escribirMarcaIncompleta(raiz, tarea, resultado) -> ruta
borrarMarcaIncompleta(raiz, id)
```

Disposicion actual: `logs/<id>.json`, `handoffs/<id>.md`,
`handoffs/<id>.INCOMPLETO.md`. Si cambia, cambia aqui y en ningun otro sitio.

`cargarHandoffs` devuelve **dos mapas separados** a proposito: un handoff de
verdad no es lo mismo que la marca de una tarea que se corto, y confundirlos
borraria marcas que todavia hacen falta.

La marca de corte distingue morir por dinero de morir por tiempo, porque son dos
diagnosticos distintos: el presupuesto corta limpio entre turnos y se sabe lo
gastado; el timeout mata a la fuerza y no se sabe si la tarea iba bien.

**No le corresponde:** imprimir, decidir si una tarea fallo.

### `src/guardarrailes.mjs`

```
revisarRama({ repo, rama, banderas, rutaBoceto }) -> veredicto[]
revisarSolapamientos(olas, raiz) -> veredicto[]
revisarPresupuestos(ejecutan) -> veredicto[]
revisarSobrescritura({ ejecutan, raiz, repo, banderas, handoffs, incompletos }) -> veredicto[]
```

Lo que se comprueba antes de lanzar nada. Ninguna imprime ni aborta.

El solapamiento **solo importa dentro de una misma ola**. Entre olas distintas es
normal y a menudo deliberado: una tarea de revision mira `app/` entera despues de
que otras dos hayan escrito en `app/Models/` y `app/Views/`.

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

**El latido vive aqui y solo aqui.** Es el unico modulo que sabe que existe una
ola y que vidrios siguen en vuelo. `proceso.mjs` ejecuta uno y no sabe de olas;
`salida.mjs` sabe pintar la linea pero no cuando toca. Esta encerrado en
`abrirLatido(ancho)`, que devuelve `{ empieza, termina, cerrar }`: si necesitas
saber que hay en vuelo, usa eso, no montes otro registro.

**No le corresponde:** decidir el codigo de salida, calcular el resumen, validar.

### `vitral.mjs`

La entrada. Parsea banderas, arma el plan, delega, y decide el codigo de salida.

Es el unico sitio que llama a `process.exit` y el unico que captura
`ErrorVitral`. Su funcion `resolver(veredictos)` es la que imprime lo que dicen
los guardarrailes y responde si alguno impide lanzar.

**No le corresponde:** engordar. Si te encuentras anadiendo logica aqui, casi
siempre pertenece a un modulo de `src/`.

---

## Como trabajar sobre el motor en paralelo

- Una tarea por modulo. Las rutas del boceto se declaran por archivo:
  `src/prompt.mjs`, no `src/`.
- Si tu cambio obliga a tocar dos modulos, no lo repartas entre dos agentes:
  ponlo en una sola tarea, o parte el trabajo por otra linea.
- Si necesitas un export nuevo de un modulo que no es tuyo, no lo anadas tu:
  dilo en tu handoff, bajo "Necesito de otros".
- **Nada de exports que nadie importe.** Si expones algo y nadie lo usa, sobra.
- La superficie del CLI —banderas, codigos de salida y texto de los mensajes— es
  contrato con el usuario. No se cambia de paso mientras se hace otra cosa.
