# Contrato · el preambulo no puede mentir sobre el paralelismo

Esta funcionalidad se reparte entre tres tareas que se escriben en paralelo. Lo que
sigue es lo que todas necesitan compartir.

`.vitral/plomo/motor.md` tambien es obligatorio y no se repite aqui: las tres
invariantes, las formas ya existentes, el grafo de dependencias y el reparto por
modulo siguen valiendo tal cual. Si algo de aqui parece contradecirlo, manda
`motor.md`.

---

## Que se quiere

El preambulo que `construirPrompt` mete en **todos** los prompts afirma, sin
condicion, que hay varios agentes trabajando a la vez. En una ola de una sola tarea
eso es falso, y no es inofensivo.

**Lo que paso, y es la razon de esta tanda.** En la tanda del panel PTY, con un
boceto de **una sola tarea**, el agente escribio en su handoff que "otro agente le
sobrescribio `main.rs` y `panel.js` a mitad de la corrida", con mtimes y todo. No
habia ningun otro agente: la salida de la corrida dice `ola 1/1 · 1 vidrio` y no
habia mas procesos vivos. Se explico sus propias reescrituras con lo que el prompt le
afirmaba. Eso mando a buscar un segundo autor inexistente y pudo costarle turnos
"conservando" trabajo que era suyo.

El agente hizo bien: el prompt es contrato. El que mentia era el prompt.

### Las cinco frases, y cuales son falsas

Salen de leer `src/prompt.mjs` entero, no de acordarse.

| Bloque | Frase | Con un solo vidrio |
|---|---|---|
| Preambulo | "varios agentes editan este mismo repositorio en paralelo, ahora mismo" | **falsa** |
| Preambulo | "el codigo que tienes al lado puede estar cambiando mientras trabajas" | **falsa**, y es la que produjo la confabulacion |
| Preambulo | "Todo lo que necesitas para encajar **con ellos**" | falsa a medias |
| Tus rutas | "Esos archivos son de otro agente y tus cambios chocarian con los suyos" | **falsa** |
| Como terminar | "Es lo unico que van a leer **los agentes** que vengan despues de ti" | falsa en la ultima ola, y omite que la persona tambien lo lee |

Y las que valen siempre y **no se tocan**: "No hay a quien preguntarle", "Nunca
esperes, nunca preguntes, nunca te quedes a medias", el bloque del plomo entero y el
bloque de handoffs —que habla de olas **anteriores**, asi que es igual de cierto con
un vidrio que con nueve.

---

## De donde sale el dato

`construirPrompt` no sabe hoy cuantas tareas tiene su ola. No hace falta ir a
buscarlo: **ya esta en el sitio desde donde se llama.**

`promptDe`, en `src/corrida.mjs:26`, es el unico que llama a `construirPrompt`, y sus
dos unicos invocadores iteran sobre `plan.olas` con la ola en la mano:

- `ensayar`, en el bucle de la linea 48.
- `ejecutarOlas`, en el bucle de la linea 64.

Y las olas se construyen **solo con lo que se va a ejecutar**: en `vitral.mjs:157`,
`calcularOlas(ejecutan, saltadasIds)`. Las tareas saltadas por `--solo` no estan en
la ola, asi que no cuentan como companeras. Sale bien solo.

Por eso el dato **entra por parametro** y `prompt.mjs` no importa nada nuevo. Es lo
que manda `motor.md`: `prompt.mjs` es una hoja del grafo de dependencias, y "si tu
modulo necesita algo de uno que esta por encima, es senal de que el dato deberia
entrar por parametro".

**La invariante 1 no se roza.** `prompt.mjs` no toca `console` ni `process.stdout`
hoy, y sigue sin tocarlos: este cambio es texto que se devuelve, no texto que se
imprime.

---

## Las firmas

### `src/prompt.mjs`

```
construirPrompt(tarea, plomo, handoffs, companeros) -> string
```

`companeros` es un **array de ids** (`string[]`): las **otras** tareas de la misma
ola, sin la propia. Vacio significa que este vidrio esta solo en su ola.

El parametro lleva `= []` por defecto. Un llamador que lo olvide produce el texto de
"solo", que es texto verdadero para una llamada suelta y no inventa companeros.

`handoffsDe` y `extraerHandoff` no cambian.

### `src/corrida.mjs`

```
promptDe(tarea, plan, ola) -> string
```

Calcula los companeros filtrando la ola y se los pasa a `construirPrompt`:

```js
const companerosDe = (tarea, ola) => ola.filter((t) => t.id !== tarea.id).map((t) => t.id);
```

Los dos invocadores le pasan la ola que ya tienen en el bucle: `ensayar` y
`ejecutarOlas`. **Ninguna otra linea de `corrida.mjs` cambia**, y en particular el
latido, el guardado de handoffs y el manejo de fallidas se quedan como estan.

El orden de los ids es el de la ola, sin ordenar ni reordenar. Es determinista
porque `calcularOlas` lo es, y los checks lo comparan literal.

---

## El texto, palabra por palabra

Esto es el origen unico. Lo copian el codigo, los checks y la documentacion. Si algo
no encaja, manda esta seccion.

Solo cambian **un parrafo del preambulo** y **una frase del bloque de rutas**. Todo
lo demas del prompt se queda exactamente como esta hoy, salvo dos reformulaciones que
estan mas abajo.

### El preambulo

El bloque completo es el encabezado, el parrafo variable, y despues dos parrafos
comunes:

```
# Vitral · tarea "<id>"

<PARRAFO VARIABLE>

No hay a quien preguntarle: no puedes hablar con nadie ni esperar respuesta de
nadie.

Todo lo que necesitas para encajar ya esta escrito abajo, en el plomo. Si algo no
esta en el plomo, decidelo tu por la via mas conservadora y anotalo en tu handoff.
Nunca esperes, nunca preguntes, nunca te quedes a medias.
```

**Parrafo variable, sin companeros:**

```
Estas trabajando dentro de un vitral, pero eres el unico agente de esta ola: nadie
mas esta escribiendo en este repositorio mientras trabajas. Si un archivo cambia
bajo tus pies, has sido tu.
```

Esa ultima frase es el antidoto exacto del fallo que motiva la tanda. No se quita ni
se suaviza.

**Parrafo variable, con un companero:**

```
Estas trabajando dentro de un vitral: compartes esta ola con otro agente, "frontend",
que esta editando este mismo repositorio en paralelo ahora mismo, en su propia tarea.
El codigo que tienes al lado puede estar cambiando mientras trabajas.
```

**Parrafo variable, con dos o mas:**

```
Estas trabajando dentro de un vitral: compartes esta ola con otros 2 agentes,
"frontend" y "documentacion", que estan editando este mismo repositorio en paralelo
ahora mismo, cada uno en su propia tarea. El codigo que tienes al lado puede estar
cambiando mientras trabajas.
```

Las tres son literales salvo los ids y el numero. Las reglas que las gobiernan:

| Cuantos | Como se dice |
|---|---|
| 0 | `eres el unico agente de esta ola` |
| 1 | `con otro agente, "<id>",` · verbo en singular: `que esta editando` |
| 2 o mas | `con otros <n> agentes,` mas la lista · verbo en plural: `que estan editando` |

La lista de ids: cada uno entre **comillas dobles**, separados por `, `, y el ultimo
precedido de ` y `. Con tres seria `"a", "b" y "c"`. Sin coma antes de la `y`.

### El bloque "Tus rutas"

Solo cambia la frase del medio. El resto es identico al de hoy:

```
## Tus rutas

Solo puedes crear o modificar archivos dentro de:

- <ruta>

Fuera de ahi puedes leer todo lo que quieras, pero no escribir nada.
<FRASE VARIABLE>
Si crees que hace falta tocar algo fuera de tus rutas, no lo toques: anotalo en tu
handoff, en "Necesito de otros". Al final de la corrida se revisa si algo quedo
fuera de lo declarado.
```

**Con companeros** (la de hoy, sin cambios):

```
Esos archivos son de otro agente y tus cambios chocarian con los suyos.
```

**Sin companeros:**

```
Nadie mas esta escribiendo ahora mismo, pero las rutas no son una sugerencia: son
el reparto que decidio quien planifico la tanda.
```

### Las dos reformulaciones, sin rama

Valen en los dos casos, asi que **no** se bifurcan: se corrigen y ya.

En el bloque del plomo, donde hoy dice `Programa contra el plomo aunque la otra
mitad todavia no exista.`:

```
Programa contra el plomo aunque la pieza que tiene que encajar con la tuya todavia
no exista.
```

En el bloque "Como terminar", donde hoy dice `Es lo unico que van a leer los agentes
que vengan despues de ti, asi que se concreto:`:

```
Lo van a leer las tareas que vengan despues de ti y la persona que revise la
corrida, asi que se concreto:
```

### Lo que no cambia ni una coma

El orden de los bloques, los encabezados `##`, los tres encabezados de handoff de
`ENCABEZADO_HANDOFF`, los dos avisos `AVISO_SIN_HANDOFF` y `AVISO_INCOMPLETO`, el
bloque del plomo salvo la frase de arriba, el bloque de handoffs entero, y los cuatro
campos del handoff final. Hay checks que comparan varios de ellos.

---

## Los bordes

| Caso | Que pasa |
|---|---|
| Ola de una tarea | Texto de "solo" |
| Ola de dos | Texto de "un companero", en singular, nombrandolo |
| Ola de tres o mas | Texto de plural, con la lista completa |
| `--solo <id>` deja la ola en un vidrio | Texto de "solo". Sale gratis: las saltadas no estan en `olas` |
| `--solo <id> --rehacer` rehace la ola entera | Cada tarea ve a las que de verdad se ejecutan con ella |
| `--seco` | Exactamente el mismo texto que la corrida real. `ensayar` y `ejecutarOlas` comparten `promptDe` justo para que el modo seco no pueda mentir |
| Olas distintas de la misma corrida | Cada una calcula los suyos por separado: la ola 1 puede ser de dos y la ola 2 de una |
| `companeros` omitido por un llamador | Texto de "solo", por el valor por defecto `[]` |
| Un id con caracteres raros | Se escribe tal cual entre comillas. No se escapa ni se recorta |

---

## Los checks

`pruebas/checks.mjs` pasa de dieciseis a veinte. Los dieciseis que hay **no se
tocan**: si alguno deja de pasar, es que algo se rompio.

| # | Que comprueba |
|---|---|
| 17 | Un vidrio solo en su ola **no** lee que haya otros agentes. Con `ejemplo/boceto.json` y `--seco`, el prompt de `revision` —que es la ola 2 y va sola— contiene `eres el unico agente de esta ola` y **no** contiene `en paralelo ahora mismo` |
| 18 | Un vidrio acompanado nombra a sus companeros. Dos casos: con `ejemplo/boceto.json`, el prompt de `backend` contiene `con otro agente, "frontend",` en singular; y con un boceto propio de tres tareas independientes en una sola ola, cada prompt contiene `con otros 2 agentes,` y los ids de los otros dos |
| 19 | `--solo` deja la ola en un vidrio y el texto lo refleja. Con `--solo backend --seco`, el prompt de `backend` contiene `eres el unico agente de esta ola`, aunque el boceto tenga tres tareas |
| 20 | Las frases comunes siguen saliendo en los dos casos. Tanto el prompt de `backend` como el de `revision` contienen `No hay a quien preguntarle` y `Nunca esperes, nunca preguntes, nunca te quedes a medias` |

El 20 importa tanto como los otros tres: bifurcar un texto es la forma clasica de
perder por el camino una frase que valia para todos.

Los cuatro se comprueban con `--seco`, sin lanzar agentes, como los dieciseis que ya
hay. Cada uno monta su escenario en el repositorio temporal que el script ya crea, con
`montarRepo` y `bocetoSuelto`, que ya existen.

`ejemplo/boceto.json` vale tal cual para tres de los cuatro y **no se toca**: sus tres
tareas dan una ola de dos (`backend` y `frontend`) y una ola de una (`revision`), que
son justo los dos casos.

---

## Reparto y fronteras

Tres tareas en dos olas.

| Ola | Tarea | Archivos | Que hace |
|---|---|---|---|
| 1 | `texto` | `src/prompt.mjs`, `src/corrida.mjs` | El parametro nuevo y las dos ramas de texto |
| 1 | `documentacion` | `.vitral/plomo/motor.md`, `README.md` | Que recibe cada agente, y la firma nueva |
| 2 | `checks` | `pruebas/checks.mjs` | Los cuatro checks nuevos |

`prompt.mjs` y `corrida.mjs` van **en la misma tarea** porque son los dos lados de una
misma firma: un parametro nuevo no sirve de nada sin quien lo pase. Es el mismo caso
que `guardarrailes.mjs` con `vitral.mjs` en la tanda del `cwd`.

`checks` va en la ola 2 a proposito: en la ola 1 el texto nuevo todavia no existe y
los checks no podrian ejecutarse. En la ola 2 se escriben viendo el codigo de verdad y
se corren antes de darlos por buenos.

`documentacion` no depende de `texto` porque el texto literal esta aqui, en este
contrato, y no en el codigo del otro. Los dos copian de la misma fuente.

### Lo que no toca nadie en esta tanda

- `src/salida.mjs`, `src/boceto.mjs`, `src/olas.mjs`, `src/registro.mjs`,
  `src/guardarrailes.mjs`, `src/agentes.mjs`, `src/proceso.mjs`, `src/rutas.mjs`,
  `src/git.mjs`, `src/errores.mjs`.
- `vitral.mjs`. El dato ya llega solo hasta `corrida.mjs`; la entrada no cambia.
- `ejemplo/boceto.json` y `ejemplo/plomo/`. Sirven tal cual.
- Los dieciseis checks que ya existen.
- `.gitignore`, `.gitattributes`, `LICENSE`.
- Todo `ui/`. La interfaz no tiene nada que ver con esta tanda.

### Lo que no entra

- **No se cambia el orden ni el numero de bloques del prompt.** Solo el contenido de
  dos parrafos.
- **No se anaden las rutas de los companeros al prompt.** Se nombran por id y nada
  mas. Con nueve vidrios, listar las rutas de todos engorda cada prompt por nueve.
- **No se toca `handoffsDe` ni `extraerHandoff`.**
- **No se anade ninguna bandera al CLI.**
- **No se toca la cabecera de `--seco`** ni nada de `salida.mjs`.
