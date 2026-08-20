# Contrato · tres defectos del motor

Esta funcionalidad se reparte entre varias tareas que se escriben en paralelo. Lo que
sigue es lo que todas necesitan compartir.

`.vitral/plomo/motor.md` tambien es obligatorio y no se repite aqui: las tres
invariantes, las formas ya existentes, el grafo de dependencias y el reparto por
modulo siguen valiendo tal cual. Si algo de aqui parece contradecirlo, manda
`motor.md`.

Tres defectos, ninguno urgente, los tres verificados en el codigo antes de escribir
esto. Van juntos porque son pequenos y del mismo modulo de responsabilidad: lo que el
motor da por sentado y no comprueba.

---

## UNO · `String()` que sobra, y uno que no

En `src/agentes.mjs`, los dos adaptadores hacen esto:

```js
if (tarea.modelo) args.push('--model', String(tarea.modelo));
if (tarea.presupuesto) args.push('--max-budget-usd', String(tarea.presupuesto));
```

**El de `modelo` sobra.** `boceto.mjs` garantiza que si `modelo` viene, es una cadena
no vacia sin espacios. `String()` sobre una cadena no hace nada. Esta dos veces, una
en `claude` y otra en `opencode`.

**El de `presupuesto` no sobra y se queda.** `presupuesto` es un `number` garantizado,
asi que ahi `String()` hace una conversion de verdad. Quitarlo funciona hoy solo
porque Node convierte los argumentos numericos en silencio —comprobado en esta
maquina, `spawn(node, ['-e', '...', 3.5])` hace que el hijo reciba `"3.5"` en
node v24.15.0— pero la documentacion de Node dice que `args` es `string[]`. No se
cambia una conversion explicita por una implicita que nadie promete.

Queda asi, y **con el comentario**, que es la mitad del cambio: sin el, la proxima
revision vuelve a marcarlo como redundante y alguien lo quita.

```js
if (tarea.modelo) args.push('--model', tarea.modelo);
// String() aqui no sobra: presupuesto es un number y spawn quiere cadenas.
// Node convierte los numeros el solo, pero no lo promete en su documentacion.
if (tarea.presupuesto) args.push('--max-budget-usd', String(tarea.presupuesto));
```

Ninguna otra linea de `agentes.mjs` cambia. En particular no se tocan los `parse`, ni
`MOTIVOS_CLAUDE`, ni las banderas de ningun CLI.

---

## DOS · Handoffs de otra tanda

### Que pasa hoy

`.vitral/handoffs/<id>.md` se guarda por id de tarea, y los ids se repiten entre
tandas: `documentacion` y `checks` han sido de dos tandas distintas ya. Nada en el
disco dice de que tanda es un handoff.

Dos consecuencias, y no son igual de graves:

**El aviso de sobrescritura.** `revisarSobrescritura` no avisa solo por tener handoff:
cruza con `estadoGit` y con las rutas declaradas de esa tarea, asi que un handoff
huerfano solo hace ruido si ademas las rutas de la tarea actual estan sucias. Molesto,
no grave.

**El salto de `--solo`, que si es grave.** En `vitral.mjs`, `saltadas` son las
dependencias que tienen handoff en disco, sin mirar nada mas. Un `--solo` puede
saltarse una dependencia que **nunca corrio en esta tanda** e inyectar su handoff
viejo en el prompt del dependiente, con voz de trabajo recien hecho. No ha pasado por
suerte, no por diseno.

Hay deteccion, tenue: `lineasSaltadas` ya imprime `handoff del <dd-mm hh:mm>` por cada
saltada. Ni previene, ni lleva ano.

### El sello

Nada en el repositorio identifica una tanda. Lo mas barato que ya existe es el
`nombre` del boceto, y `boceto.mjs:95` garantiza que siempre hay uno:
`boceto.nombre = boceto.nombre || path.basename(rutaBoceto)`.

**El sello es un archivo, `.vitral/handoffs/.tanda`, con el nombre del boceto dentro.**
Texto plano, una linea, terminada en salto de linea. Se compara recortando los
espacios de los extremos. Vive dentro de `.vitral/handoffs/`, que ya esta ignorado por
git.

Reglas, y las tres importan:

| Situacion | Que pasa |
|---|---|
| El sello dice lo mismo que esta corrida | Los handoffs valen. Todo como hoy |
| El sello dice otra cosa | Los handoffs y las marcas de incompleto **son de otra tanda**: se tratan como ausentes, y se dice en la cabecera |
| **No hay sello** | Los handoffs valen. Es el caso de un proyecto que ya venia funcionando antes de que existiera el sello, y descartarle el trabajo bueno seria peor que el fallo que esto arregla |

Los archivos que se ignoran **no se borran**. Borrarlos es del cierre de tanda, que ya
esta escrito en `planificador.md`, y no de una corrida que solo queria leerlos. El
sello se reescribe al preparar el registro de la corrida siguiente.

Nota util: al tratarse como ausentes, el aviso de sobrescritura deja de dispararse por
handoffs huerfanos **sin tocar `revisarSobrescritura`**, porque lee esos mismos mapas.
Un defecto se arregla solo.

### Las firmas

En `src/registro.mjs`:

```
prepararRegistro(raiz, tanda)
cargarHandoffs(raiz, tareas, tanda) -> { handoffs, incompletos, fechas, otraTanda }
```

`tanda` es el `nombre` del boceto. `prepararRegistro` escribe el sello, ademas de lo
que ya hacia. `cargarHandoffs` lo lee y decide.

`otraTanda` es `null` cuando no hay nada que decir, y si no:

```
{ nombre: <lo que dice el sello>, cuantos: <cuantos archivos se ignoraron> }
```

`cuantos` cuenta los handoffs y las marcas de incompleto que existian en disco para
los ids de esta corrida y se descartaron. Solo esos: un handoff de un id que esta
corrida no usa no se cuenta, porque no la afecta.

En `src/salida.mjs`, `cabecera` recibe un campo mas, `otraTanda`, y cuando no es
`null` imprime **una linea mas**, justo debajo de la del boceto y con la misma sangria
de ocho espacios que usan las sugerencias:

```
vitral · El preambulo no puede mentir sobre el paralelismo
boceto .vitral/boceto.json · rama feat/x · plomo 2 archivos (33.1 KB) · olas 2 -> 1
        3 handoffs en disco son de la tanda "Validar presupuesto, modelo y cwd": se ignoran
```

En singular, `1 handoff en disco es de la tanda "...": se ignora`.

En `vitral.mjs`, dos llamadas cambian para pasar `boceto.nombre`, y la cabecera recibe
el `otraTanda` que devuelva `cargarHandoffs`. Nada mas.

### El orden importa

`cargarHandoffs` se llama **antes** que `prepararRegistro`, y eso ya es asi hoy. Tiene
que seguir siendolo: si el sello se escribiera antes de leerlo, siempre coincidiria y
esto no serviria de nada.

Y como `--seco` no llama a `prepararRegistro`, el modo seco **lee el sello pero no lo
escribe**: dice exactamente lo que diria la corrida real, sin cambiar nada en disco.
Eso es lo que se espera de `--seco` y hay que conservarlo.

---

## TRES · Un boceto de otro proyecto

`--boceto` acepta cualquier ruta. La raiz, en cambio, es `process.cwd()`
(`vitral.mjs:130`), y de ella salen git, las rutas de las tareas y donde se escribe
`.vitral/`. Un boceto de otro proyecto se ejecuta contra el directorio actual sin que
nadie diga nada: contratos de un proyecto, raiz de otro.

Comprobado, desde un repositorio de prueba y con el boceto de la interfaz de Vitral:

```
vitral · La cuadricula de paneles
boceto C:/Programacion/Vitral/.vitral/ui/boceto.json · rama trabajo/prueba · olas 1
```

Las rutas se habrian resuelto contra la raiz equivocada y los handoffs se habrian
escrito en el proyecto equivocado.

**Que `raiz` salga del `cwd` es lo correcto y no se cambia.** Lo dice
`.vitral/rumbo.md`: Vitral va a ser una aplicacion que abre varios proyectos, y quien
lanza un proceso decide su directorio de trabajo. La aplicacion lanzara el motor con
el `cwd` puesto en el proyecto. Con esa primitiva, un boceto fuera de la raiz no es un
uso avanzado: es siempre un error.

### La firma

En `src/guardarrailes.mjs`:

```
revisarBoceto({ rutaBoceto, raiz }) -> veredicto[]
```

Devuelve `aborta` cuando el boceto resuelve fuera de la raiz. La cuenta es la misma
que ya usa `revisarCwd`, y se hace igual: resolver contra la raiz y mirar si lo
relativo empieza por `..`, contando tambien el caso de otra unidad de Windows, que
tambien es estar fuera.

No mira si el archivo existe: de eso ya se encarga `leerBoceto` con su propio error.

El mensaje, literal:

```
el boceto "C:/otro/.vitral/boceto.json" cae fuera del repositorio.
        sus rutas se resolverian contra esta raiz y sus handoffs se escribirian aqui.
        corre vitral desde el proyecto al que pertenece el boceto
```

La ruta se muestra **tal como la escribio la persona**, sin normalizar, que es como la
va a reconocer.

### Donde se llama

En `vitral.mjs`, junto a las otras comprobaciones previas, **despues de
`revisarRama` y antes de `leerBoceto`**:

```js
if (resolver(guardarrailes.revisarBoceto({ rutaBoceto, raiz }))) return 1;
```

Antes de leer el boceto a proposito: si esta fuera, da igual si ademas esta bien
escrito.

**Aborta tambien con `--seco`.** No es como el guardarrail de rama, que en seco solo
avisa porque el modo seco no ejecuta nada: aqui el dano es que el modo seco imprimiria
prompts con las rutas resueltas contra la raiz equivocada, que es justo lo que se
quiere cazar antes de gastar.

---

## Los bordes

| Caso | Que pasa |
|---|---|
| `modelo` omitido | Como hoy: no se anade la bandera |
| `presupuesto` omitido | Como hoy: no se anade la bandera |
| `presupuesto` en una tarea `opencode` | Como hoy: el adaptador no lo mira y el aviso que ya existe sigue saliendo |
| Primera corrida de un proyecto, sin `.vitral/handoffs/` | No hay handoffs ni sello. Nada que ignorar, nada que decir |
| Hay handoffs pero no hay sello | Valen. Se escribe el sello al preparar el registro |
| El sello coincide | Todo como hoy |
| El sello no coincide y hay 1 handoff afectado | Se ignora; la cabecera lo dice en singular |
| El sello no coincide y hay marcas `INCOMPLETO` | Se ignoran igual: una marca de otra tanda miente lo mismo que un handoff |
| El sello no coincide y ningun id de esta corrida tiene handoff | `otraTanda` es `null`: no hay nada que ignorar y no se dice nada |
| El sello no coincide y se usa `--solo` | Las dependencias no se saltan, porque para el motor no tienen handoff. Corren de verdad |
| `--seco` con el sello sin coincidir | Se dice en la cabecera y no se escribe nada en disco |
| Dos tandas con el mismo `nombre` | El sello coincide y no se distingue. Se acepta: el nombre lo pone una persona y repetirlo es decir que es la misma tanda |
| `--boceto` con una ruta dentro de la raiz | Como hoy. Es el caso normal, incluido `ejemplo/boceto.json` |
| `--boceto` con una ruta fuera de la raiz | Aborta, en seco tambien |
| `--boceto` con una ruta que no existe, dentro de la raiz | El guardarrail no dice nada; `leerBoceto` da su error de siempre |
| `--historial` | No lee el boceto ni pasa por estos guardarrailes. No cambia nada |

---

## Los checks

`pruebas/checks.mjs` pasa de veinte a veinticuatro. Los veinte que hay **no se
tocan**: si alguno deja de pasar, es que algo se rompio.

| # | Que comprueba |
|---|---|
| 21 | Un `--boceto` que cae fuera de la raiz aborta, y tambien con `--seco` |
| 22 | Con un sello de otra tanda, los handoffs en disco se ignoran y la cabecera lo dice |
| 23 | Sin sello, los handoffs en disco se siguen usando. Es el caso de migracion y es el que evita que este arreglo destruya trabajo bueno |
| 24 | Con un sello de otra tanda, `--solo` **no** se salta la dependencia: la ejecuta |

Los cuatro se comprueban con `--seco`, sin lanzar agentes, como los veinte que ya hay.
Cada uno monta su escenario con `montarRepo` y `bocetoSuelto`, que ya existen, y el 22,
23 y 24 escriben a mano el handoff y el sello en el repositorio temporal, que es la
unica forma de montar el escenario sin correr una tanda de verdad.

---

## Reparto y fronteras

Cuatro tareas en dos olas.

| Ola | Tarea | Archivos | Que hace |
|---|---|---|---|
| 1 | `agentes` | `src/agentes.mjs` | El defecto UNO |
| 1 | `motor` | `src/registro.mjs`, `src/guardarrailes.mjs`, `src/salida.mjs`, `vitral.mjs` | Los defectos DOS y TRES |
| 1 | `documentacion` | `.vitral/plomo/motor.md`, `README.md` | Las firmas nuevas y lo que cambia para quien usa el CLI |
| 2 | `checks` | `pruebas/checks.mjs` | Los cuatro checks nuevos |

**DOS y TRES van en la misma tarea** porque los dos tocan `vitral.mjs`, y dos tareas
de la misma ola sobre el mismo archivo no dan error: dan perdida silenciosa de
trabajo. Separarlas obligaria a ponerlas en olas distintas, que es tres olas en serie
para un cambio pequeno.

`agentes` va suelta en la ola 1 porque `agentes.mjs` no lo toca nadie mas.

`documentacion` no depende de las otras dos: las firmas y los textos literales estan
aqui, en este contrato, y los tres los copian de la misma fuente.

`checks` va en la ola 2 porque en la ola 1 el codigo todavia no existe y no podrian
ejecutarse.

### Lo que no toca nadie en esta tanda

- `src/prompt.mjs`, `src/olas.mjs`, `src/rutas.mjs`, `src/git.mjs`, `src/corrida.mjs`,
  `src/proceso.mjs`, `src/boceto.mjs`, `src/errores.mjs`.
- `ejemplo/`, y en particular `ejemplo/boceto.json`, que sirve tal cual.
- Los veinte checks que ya existen.
- Todo `ui/`. La interfaz no tiene nada que ver con esta tanda.
- `.gitignore`: `.vitral/handoffs/` ya esta ignorado, y el sello vive dentro.
- `.vitral/rumbo.md`, que es una nota de rumbo y no un plomo.

### Lo que no entra

- **No se cambia que `raiz` sea `process.cwd()`.** Es la primitiva que el rumbo da por
  buena.
- **No se anade ninguna bandera al CLI.**
- **No se borran handoffs.** El motor los ignora; borrarlos es del cierre de tanda.
- **No se toca `revisarSobrescritura`.** Se arregla solo al vaciarse los mapas.
- **No se cambia el formato de un handoff** ni se le mete cabecera: lo que se sella es
  el directorio, no cada archivo, justo para no tocar lo que acaba en los prompts.
