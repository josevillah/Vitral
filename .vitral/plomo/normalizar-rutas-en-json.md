# Contrato · las rutas del modo json, tambien dentro de la prosa

`.vitral/plomo/motor.md` tambien es obligatorio y no se repite aqui: las tres
invariantes, las formas ya existentes y el reparto por modulo siguen valiendo tal
cual. Si algo de aqui parece contradecirlo, manda `motor.md`, **salvo en la regla
3 del modo json, que esta tanda cambia a proposito y que la tarea de documentacion
reescribe**.

---

## Que se quiere

En modo json, un consumidor recibe hoy rutas con barra hacia delante en los
campos y con barra invertida dentro de `mensaje` y `sugerencia`. Comprobado en
Windows, no deducido:

```
{"evt":"error","mensaje":"no encuentro el boceto en \".vitral\\boceto.json\".",
 "sugerencia":"crea .vitral/boceto.json o pasa otro con --boceto <archivo>"}

{"evt":"veredicto","nivel":"aborta","mensaje":"el boceto \"..\\fuera.json\" cae fuera del repositorio.", ...}
```

El primero es anterior a todo esto y sale de `main`. El segundo sale de escribir
`--boceto ..\fuera.json`, que es como se teclea una ruta en PowerShell.

**Un consumidor que reciba las dos barras segun donde mire tiene un problema que
no puede resolver desde fuera**, y esa es la razon entera de esta tanda.

### Esto revierte una decision de hace dos tandas, a proposito

La tanda de `plomos` dejo escrito en `motor.md` que `mensaje` y `sugerencia` **no**
se normalizan, porque son prosa y no campos. El argumento era que normalizar la
prosa le da a un consumidor la apariencia de una ruta parseable sin contrato
detras.

Ese argumento sigue siendo cierto y no es el que se revierte: **de `mensaje` no se
extrae una ruta, ni antes ni despues.** Lo que cambia es el otro lado, que pesa
mas: mientras el modo json emita las dos barras, cualquier consumidor que **pinte**
esos textos ensena rutas de dos formas en la misma ventana, y eso no lo arregla
sin adivinar. Se normaliza para que lo que se lee sea uniforme, no para que se
pueda parsear. Sigue sin poder parsearse, y `motor.md` lo sigue diciendo.

---

## Que cambia, exactamente

**Dos sitios de `src/salida.mjs`, no uno.** Los dos unicos eventos que llevan
prosa escrita por otro modulo:

| Funcion | `evt` | Campos que se normalizan |
|---|---|---|
| `imprimirError` | `error` | `mensaje`, `sugerencia` |
| `veredicto` | `veredicto` | `mensaje`, `sugerencia`, y **cada elemento** de `detalles` |

`detalles` entra porque es donde `revisarSolapamientos` y `revisarCwd` ponen sus
listas, y esas listas llevan rutas. Dejarlo fuera arreglaria el evento a medias.

Ningun otro evento lleva prosa ajena: los demas campos con rutas ya pasan por
`conBarras` o por `normalizarRuta`, y siguen igual.

**Ninguna firma cambia.** `conBarras` ya existe en `salida.mjs:42` y es privada;
no se exporta, no se mueve y no se toca. Los dos cambios van dentro del `if (json)`
que cada funcion ya tiene, o sea en la rama que solo corre con la bandera.

### Con `conBarras`, y no reemplazando barras invertidas a mano

```js
const conBarras = (ruta) => ruta.split(path.sep).join('/');
```

Esto no es un detalle de implementacion, es la semantica del contrato: **convierte
el separador de este sistema, no el caracter `\`.**

- En Windows, `path.sep` es `\`, asi que `.vitral\plomo` sale `.vitral/plomo`.
- En POSIX, `path.sep` es `/`, asi que la funcion **no hace nada**, y una barra
  invertida que hubiera dentro de un nombre sobrevive. Correcto: en POSIX `\` es
  un caracter legal de un nombre de archivo y no un separador.

Un `mensaje.replaceAll('\\', '/')` daria lo mismo en Windows y **corromperia**
nombres legitimos en POSIX. No se hace.

La regla que queda dicha: **el evento reporta las rutas en forma canonica para el
sistema que las produjo.**

### Lo que se pierde, y se acepta

Algunos de estos mensajes **citan lo que la persona escribio en su boceto**. Con
esto, en Windows, un `"plomos": ["retirados\\historial.md"]` produce un evento que
dice `retirados/historial.md`: ya no es una cita literal.

Se acepta, y conviene tenerlo escrito para que nadie lo descubra como un fallo.
En modo json todo va canonico, incluida la cita; quien quiera ver lo que se tecleo
tal cual lo tiene en el modo texto, que no se normaliza. La alternativa —
normalizar unas rutas si y las citadas no— exige distinguirlas dentro de una frase
en castellano, que es justo el analisis que no se puede hacer.

---

## Por que el modo texto NO se normaliza

Alguien va a querer unificar las dos salidas. Es lo primero que parece una mejora
y es lo que rompe el contrato con quien usa el CLI. Tres razones, y la tercera es
la que manda.

**1. Hay seis bloques fijados palabra por palabra que se pondrian rojos.** Los
checks 25 a 30 de `pruebas/checks.mjs` comparan caracter a caracter los bloques de
`revisarRama`, `revisarBoceto`, `revisarSolapamientos`, `revisarPresupuestos`,
`revisarCwd` y `revisarSobrescritura`. Normalizar el modo texto los pone en rojo, y
el "arreglo" seria reescribir el texto esperado: o sea, cambiar la superficie de
texto del CLI, que `motor.md` dice que no se cambia de paso mientras se hace otra
cosa.

**2. En un terminal de Windows, `.vitral\plomo` es lo que teclearia quien lo esta
leyendo.** El modo texto tiene un lector humano sentado delante de **este**
sistema; el modo json tiene un programa que junta datos de donde sea.

**3. Los dos modos no son el mismo texto con distinta envoltura, y `motor.md` ya
lo dice: `--json` sustituye al texto, no convive con el.** Ya difieren en mas
cosas —la paleta ANSI vacia, los dos canales fundidos en uno, `ms` y `costo` en
crudo en vez de formateados, `finOla` y `finEnsayo` que no emiten nada—. Que la
misma ruta se pinte distinto en cada uno es de la misma familia: **mismos hechos,
distinta forma de decirlos, segun quien lea.** Lo que si es identico entre modos, y
sigue siendolo, son los codigos de salida.

---

## Los bordes

| Caso | Que pasa |
|---|---|
| Modo texto, cualquier mensaje | **Sin tocar.** Ni una coma. Es la mitad del trabajo |
| `error` en json con una ruta del sistema | `mensaje` y `sugerencia` con barra hacia delante |
| `veredicto` en json con una ruta en `detalles` | Cada elemento normalizado, uno a uno |
| `sugerencia` que ya venia con barra normal | Sale igual: `conBarras` sobre un texto sin `path.sep` no cambia nada |
| `sugerencia` nula | Sigue saliendo `null`. **No se llama a `conBarras` sobre `null`** |
| `detalles` vacio | Sigue saliendo `[]` |
| Un `mensaje` con una barra invertida que no es una ruta, en Windows | Se convierte igual. No hay forma de distinguirlo dentro de una frase, y no se intenta |
| Lo mismo en POSIX | No se convierte, porque ahi `\` no es separador. Es la unica diferencia de comportamiento entre sistemas, y es deliberada |
| Un `avisa` con `detalles` | Mismo tratamiento. Hoy no lo produce ninguna comprobacion, y no lleva caso especial |
| Los campos que ya se normalizaban | Sin tocar: `corrida.boceto`, `cierre.marca`, `fallo.logs`, y lo que viene de `normalizarRuta` |

---

## Los checks

`pruebas/checks.mjs` pasa de **50 a 52**. Los 50 que hay **no se tocan**, y seis de
ellos —del 25 al 30— son la red de esta tanda: si alguno se pone rojo, es que se
normalizo el modo texto, que es el fallo que esta tanda tiene que evitar.

| # | Que comprueba |
|---|---|
| 51 | **El evento `error` sale normalizado y el texto no.** Escenario: un boceto con `"plomos": ["retirados\<sep>historial.md"]`, con el archivo creado de verdad. En json, `mensaje` y `sugerencia` no contienen `path.sep`; en texto, la misma corrida **si** lo contiene. Los dos, en la misma corrida y con el mismo boceto |
| 52 | **El evento `veredicto` sale normalizado, incluido `detalles`.** Escenario: `--boceto` con una ruta que cae fuera del repositorio escrita con `path.sep`, y un boceto con dos tareas que se solapan, cuyo `detalles` lleva rutas |

Son dos y no uno a proposito: son dos eventos emitidos por dos funciones
distintas, y un solo check podria pasar en verde con la mitad del arreglo hecho.

**Los dos se escriben contra `path.sep`, no contra la barra invertida literal.** En
Windows muerden; en POSIX pasan sin comprobar nada, porque ahi no hay nada que
convertir. Eso es honesto y es lo unico que se puede hacer: **este repositorio
corre en Windows**, que es donde el fallo existe. Un check que afirmara la barra
invertida literal afirmaria el sistema operativo, que es el error que ya costo una
correccion en la tanda de `plomos`.

La forma de la asercion, para que no se escriba a ojo: se corre la **misma**
corrida dos veces, con y sin `--json`, y se comparan las dos salidas entre si. No
se escribe a mano el texto esperado: lo que se afirma es la **relacion** entre los
dos modos, que es justo lo que la tanda contrata.

---

## Reparto y fronteras

Tres tareas en dos olas.

| Ola | Tarea | Archivos | Que hace |
|---|---|---|---|
| 1 | `normalizar` | `src/salida.mjs`, `pruebas/checks.mjs` | Los dos sitios y los dos checks |
| 1 | `documentacion` | `.vitral/plomo/motor.md`, `.vitral/plomo/plomos-en-el-boceto.md` | La regla 3, reescrita, y la seccion que queda falsa |
| 2 | `revision` | los cuatro archivos | Que el modo texto no se movio y que el documento dice lo que el codigo hace |

**El codigo y su check van en la misma tarea**, contra la costumbre de las tandas
anteriores de separarlos. Aqui es lo correcto: son dos lineas, y el check es la
unica forma de ver el cambio. Repartirlos entre dos agentes que no pueden hablarse
crearia una ola de espera para un cambio que cabe en una pantalla, y dejaria a uno
de los dos escribiendo a ciegas contra el trabajo del otro.

`documentacion` toca **dos** plomos porque los dos afirman hoy lo contrario de lo
que esta tanda hace: la regla 3 de `motor.md` y la seccion "Y por que aqui no se
normaliza" de `plomos-en-el-boceto.md`, que se escribio hace dos tandas y quedaria
mintiendo dentro del prompt de todos.

### Lo que no toca nadie en esta tanda

- **El modo texto. Nada de lo que se pinta hoy cambia.** Es la frontera de la
  tanda: si un check del 25 al 30 se pone rojo, el arreglo no es tocar el check.
- `src/boceto.mjs`, `src/guardarrailes.mjs`, `src/errores.mjs` y todos los demas
  modulos. Los mensajes **se quedan como estan redactados**: esta tanda cambia como
  se emiten, no que dicen.
- `conBarras`: no se exporta, no se mueve, no cambia.
- Los campos que ya se normalizaban.
- `.vitral/boceto.json`, `.vitral/ui/`, `ejemplo/`, `README.md`. El README habla del
  modo json en prosa corta y no baja a este nivel.
- `ui/` entera.
- Los 50 checks que ya existen.

### Lo que no entra

- **No se unifican los dos modos.** Ver la seccion entera de por que.
- **No se toca el `"crea .vitral/boceto.json"` de `boceto.mjs`.** Esa sugerencia
  dice que teclear, no informa de donde se miro, y su barra hacia delante es
  correcta en las dos plataformas. Ya lo fija el check 50 y sigue en verde.
- **No se intenta distinguir una ruta citada de una ruta del sistema.** Ver "Lo
  que se pierde, y se acepta".
- **No se retira `plomos-en-el-boceto.md`**, aunque su tanda este entregada y sus
  19 KB viajen en cada prompt de esta. Retirarlo mientras `documentacion` tiene que
  corregirlo es dejar un contrato falso donde nadie lo lee. Retirarlo es lo
  siguiente que toca, y es una correccion por su nombre, no una tanda.
