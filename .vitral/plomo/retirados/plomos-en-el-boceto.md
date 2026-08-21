# Contrato · que cada tarea declare que plomos lee

Esta funcionalidad se reparte entre varios archivos que se escriben en paralelo.
Lo que sigue es lo que todos necesitan compartir.

`.vitral/plomo/motor.md` tambien es obligatorio y no se repite aqui: las tres
invariantes, las formas ya existentes, el grafo de dependencias y el reparto por
modulo siguen valiendo tal cual. Si algo de aqui parece contradecirlo, manda
`motor.md`, **salvo en los dos puntos que esta tanda cambia a proposito y que van
marcados abajo**: la firma de `leerBoceto` y la arista nueva del grafo.

---

## Que se quiere

Hoy `leerPlomo` concatena **todos** los `.md` del directorio del boceto y esa
cadena unica entra entera en el prompt de **todas** las tareas. No hay forma de
dar media.

Eso ya duele, medido el 21-08-2026 sobre `.vitral/ui/boceto.json`:

| | |
|---|---|
| `.vitral/ui/plomo/panel-pty.md` | 79.135 B |
| `.vitral/ui/plomo/corrida.md` | 25.093 B |
| Lo que recibe **cada una** de las 4 tareas | 104.228 B |
| Lo que se manda en la tanda entera | 416.912 B |

Y no se arregla retirando nada: `panel-pty.md` es contrato **permanente** de la
superficie, no plomo de una tanda entregada, asi que no se retira al cerrar.
`corrida.md` tampoco. El coste no viene de acumular basura, viene de que el motor
no sabe repartir.

Lo que esta tanda anade es un campo opcional del boceto, `plomos`, con el que una
tarea declara que archivos del directorio lee. Nada mas. **La particion de
`panel-pty.md` no entra aqui** y no hace falta para que esto valga.

**Esto ya se declara hoy, pero en prosa.** Las cuatro tareas de
`.vitral/ui/boceto.json` empiezan su prompt diciendo cual leer —*"Lee del plomo de
la tanda, entero y antes de tocar nada: 'Como se lanza el motor', 'El catalogo IPC:
lo que se anade' y la tabla 'Los bordes'"*—. La declaracion existe; el motor no la
ve, y manda todo igual. Esta tanda no inventa un concepto: sube a campo una
convencion que ya se escribe a mano.

---

## Las dos reglas que gobiernan todo lo demas

Estas dos no se negocian y el resto del contrato se lee a su luz.

**1. Omitir `plomos` significa "todos", y eso no cambia nunca.** Todos los bocetos
que existen hoy —`.vitral/boceto.json`, `.vitral/ui/boceto.json`,
`ejemplo/boceto.json`, y los que tenga cualquier proyecto ajeno— siguen
funcionando sin tocar una coma, y **reciben byte a byte el mismo prompt que
recibian antes de esta tanda**.

No es una promesa de buena fe: es una consecuencia de como esta escrito el
reparto. Con `plomos` omitido, `plomoDe` devuelve **el mismo `plomo.texto`** que
ya se construia, el mismo objeto, sin recomponerlo. No hay un segundo camino que
pueda divergir. Un check lo fija.

**2. Un `plomos` que pida algo que no se puede dar aborta en `boceto.mjs`**, con
`ErrorVitral`, como el resto de la validacion de forma, y antes de lanzar nada. Un
contrato que se pide y no llega es peor que no pedirlo: el agente no sabe que le
falta, programa contra el hueco y el fallo aparece en la revision, ya con la ola
pagada.

---

## Que es un valor valido

**Cada entrada de `plomos` es una ruta relativa al directorio del plomo, sin
subdirectorios.**

| Campo | Valido | Invalido |
|---|---|---|
| `plomos` | Array de cadenas. Cada una es una **ruta relativa al directorio del plomo**, **sin subdirectorios**, que nombra un `.md` que existe ahi. Sin duplicados. **Omitido significa "todos"**. `[]` significa "ninguno" | `null`, cadena suelta, array con algo que no sea `string`, cadena vacia, nombre repetido, cualquier ruta con separador, y cualquier nombre que no este en el directorio |

Sigue siendo opcional, y omitirlo es lo normal.

### Por que "ruta relativa sin subdirectorios" y no las otras dos formas

Hoy da lo mismo escribirlo de una manera o de otra: sin subdirectorios, una ruta
relativa al directorio del plomo **es** un nombre de archivo suelto. La diferencia
no esta en lo que se teclea, esta en lo que el campo significa, y por eso se
contrata asi y no de las otras dos maneras que se consideraron:

- **No es "una ruta relativa" a secas.** Con esa, `["retirados/historial.md"]`
  seria sintacticamente valido y semanticamente absurdo: `.vitral/plomo/retirados/`
  se llama asi precisamente porque nada de ahi gobierna nada. Un campo que acepta
  escribir eso invita a escribirlo.
- **No es "el nombre sin extension"**, `["motor"]`. Ahorra cuatro caracteres y
  pierde lo unico que importa: de donde sale. Quien lea `["motor"]` no sabe si
  busca en subdirectorios, si hay una convencion de nombres detras, ni si la
  extension se supone. Con `["motor.md"]` no queda nada que suponer.

La regla dice **de donde se resuelve el nombre** y **hasta donde**. Que las dos
mitades den hoy el mismo resultado que un nombre suelto no las hace redundantes:
son las dos preguntas que alguien se va a hacer.

### Los tres casos, que son tres y no dos

| En el boceto | Que recibe la tarea |
|---|---|
| Sin el campo | Todos los `.md`, en orden alfabetico. **Exactamente lo de hoy** |
| `"plomos": ["a.md"]` | Solo `a.md` |
| `"plomos": []` | Ninguno, y el prompt lo dice con su propia frase |

**`[]` es valido y significa "ninguno".** Es la unica forma de expresarlo, y quien
escribe el campo y lo deja vacio esta diciendo algo, no olvidandose de algo:
olvidarse es no escribir el campo. Esto **no** contradice la regla del
`presupuesto: 0` de `motor.md`, que aborta: alli el `0` es un valor del mismo tipo
que el valido y se confunde con "sin tope"; aqui el array vacio y el campo ausente
son distinguibles sin ambiguedad y significan cosas distintas.

**`null` es invalido**, y por el mismo motivo que ya vale para `presupuesto`,
`modelo` y `cwd`: `null` no es lo mismo que omitido, y aceptarlo seria un tercer
camino que nadie mantiene.

**La comprobacion es `tarea.plomos === undefined`.** No `!tarea.plomos`, no
`tarea.plomos || plomo.archivos`: con `[]` las dos dan lo contrario de lo que
dice la tabla.

### El orden es el declarado, no el alfabetico

Con `plomos` declarado, los archivos entran en el prompt **en el orden en que
estan escritos en el array**. Sin el campo, en orden alfabetico, como hoy.

No es una inconsistencia, es la lectura natural de las dos formas: "todos" no
tiene mas orden que el del directorio, y "estos" se lee "estos, en este orden".
Y arregla de paso algo que hoy pasa sin que se note: en `.vitral/ui/plomo/`,
`corrida.md` se lee **antes** que `panel-pty.md` porque la `c` va antes que la
`p`, o sea el contrato de la tanda antes que el permanente, al reves de lo que
dice la propia cabecera de `corrida.md`.

---

## Donde va cada comprobacion

`leerBoceto` no puede decidir hoy si un nombre existe: no sabe donde esta el
directorio del plomo. Se resuelve **pasandole la lista**, no yendo a buscarla.

```js
// vitral.mjs — las dos lineas cambian de orden
const plomo = leerPlomo(path.join(path.dirname(rutaBoceto), 'plomo'));
const boceto = leerBoceto(rutaBoceto, plomo);
```

Esto sigue siendo forma, y por eso va en `boceto.mjs`: *"¿este nombre lleva
separador?"* y *"¿esta en esta lista?"* se deciden mirando el valor y un dato que
ya se recibio, sin tocar el disco. Es el mismo criterio que ya separa el `cwd`
—cuya forma valida `boceto.mjs` y cuya existencia en disco juzga
`guardarrailes.mjs`—, y cae del lado de la forma porque el directorio del plomo
**no depende de la raiz**: sale de `rutaBoceto`, que `leerBoceto` ya recibe.

**`guardarrailes.mjs` no se toca.** No hay nada de entorno que juzgar aqui.

### El orden de las dos comprobaciones importa

Primero el separador, despues la lista. Al reves, `"retirados/historial.md"`
saldria por el error de "no existe", que es verdad y no explica nada: diria que la
ruta no esta cuando el problema es que esa ruta **no se puede pedir aunque el
archivo este ahi**. Un check lo fija montando el archivo de verdad dentro del
subdirectorio y comprobando que aun asi sale el mensaje del separador.

### Se miran las dos barras, y no se nombra ningun subdirectorio

Cuenta como separador tanto `/` como `\`, igual que el `cwd` ya mira las dos
formas de ruta absoluta. Un `"retirados\\historial.md"` escrito en Windows tiene
que fallar igual que con la barra normal.

**Y el mensaje no nombra `retirados/`.** Esa carpeta es una convencion de *este*
repositorio, no del motor: otro proyecto puede tener cualquier subdirectorio
dentro de su `.vitral/plomo/`. La regla se explica por lo que es cierto en todos
—lo que cuelga de un subdirectorio no ha entrado nunca en un prompt, porque
`leerPlomo` hace un `readdirSync` sin recursion—, y de ahi se sigue lo otro sin
tener que decirlo: un subdirectorio es donde se deja un contrato para que deje de
gobernar. Si alguien "mejora" esto anadiendo un caso especial para `retirados`,
se ha metido una convencion de proyecto dentro del motor.

---

## Firmas nuevas

### `src/boceto.mjs`

```
leerBoceto(rutaBoceto, plomo) -> boceto      // lanza ErrorVitral si la forma esta mal
leerPlomo(dirPlomo) -> { texto, archivos, porArchivo, dir }
plomoDe(tarea, plomo) -> string
```

**`leerBoceto` gana un segundo parametro obligatorio.** Sin `= []` por defecto y
sin defensa: un valor por defecto haria que un llamador que lo olvide rechace
como invalido un boceto que esta bien, que es peor que reventar. Hoy hay un solo
llamador, `vitral.mjs`. Esto **corrige la firma que aparece en `motor.md`**, y la
tarea de documentacion la pone al dia.

**`leerPlomo` gana dos claves y no cambia ninguna de las que ya tenia.**

| Clave | Que es |
|---|---|
| `texto` | La concatenacion de todos, **igual que hoy, byte a byte** |
| `archivos` | `string[]` con los nombres, **igual que hoy** |
| `porArchivo` | `Map<nombre, string>`: el trozo ya montado de cada archivo, con su linea `--- plomo: <nombre> ---` delante |
| `dir` | El directorio que se recibio, tal cual, sin normalizar |

Que `archivos` siga siendo una lista de nombres y no de objetos es deliberado:
asi **`salida.mjs` no se toca ni una linea** y el evento `corrida` del modo json
—cuyo campo `plomo` es `{ archivos: string[], bytes: number }`— sigue valiendo
exactamente lo que decia. Ese catalogo esta copiado literalmente dentro del
boceto de la interfaz; cambiarle la forma costaria una tanda ajena.

Cada valor de `porArchivo` se monta como se monta hoy cada trozo, sin cambiar una
letra: el contenido del archivo con `.trim()`, precedido de
`` `--- plomo: ${nombre} ---\n\n` ``. Y `texto` es esos valores unidos por
`'\n\n'`, en orden alfabetico. O sea: `texto` se puede construir **desde**
`porArchivo`, y asi es como tiene que construirse, para que no existan dos
maneras de montar lo mismo.

**`plomoDe` es la pieza nueva y cabe en cuatro lineas:**

- `tarea.plomos === undefined` → devuelve `plomo.texto`, sin recomponer nada.
- Si no → une con `'\n\n'` los valores de `porArchivo` de los nombres
  declarados, **en el orden del array**. Con `[]` sale la cadena vacia.

Vive en `boceto.mjs` porque es quien conoce la forma del plomo. No lleva
validacion: cuando `plomoDe` corre, `leerBoceto` ya garantizo que todos los
nombres son pedibles y existen, igual que los demas modulos no revalidan `id` ni
`rutas`.

### El grafo de dependencias

`corrida.mjs` pasa a importar `plomoDe` de `boceto.mjs`. Es una arista nueva:

```
orquesta     corrida -> salida, prompt, proceso, registro, boceto
```

Va hacia abajo —`boceto` esta en el medio, `corrida` en la orquesta—, asi que la
invariante 3 se cumple. **La tarea de documentacion actualiza el bloque del grafo
en `motor.md`.**

### `src/prompt.mjs`

**Ninguna firma cambia.** `construirPrompt(tarea, plomo, handoffs, companeros)`
sigue recibiendo el plomo **ya resuelto, como cadena**, y sigue sin leer archivos,
sin imprimir y sin ejecutar nada.

Lo unico que cambia es el texto de respaldo del bloque del plomo, que hoy tiene un
caso y pasa a tener dos. `construirPrompt` ya recibe `tarea`, asi que distingue
mirando `tarea.plomos`, sin parametros nuevos.

---

## Los textos, literales

Los cuatro unicos textos que esta tanda escribe o cambia. Se copian caracter a
caracter. Los dos errores estan generados llamando a `salida.imprimirError`, no
escritos a mano.

**El respaldo de hoy, cuando no hay plomo ninguno que dar** — no se toca:

```
(no hay contratos declarados: no existe el directorio plomo/ o esta vacio)
```

**El respaldo nuevo, cuando la tarea declaro `"plomos": []`:**

```
(esta tarea declara que no lee ningun contrato)
```

Se dicen distinto porque son cosas distintas: la primera es que no habia nada que
dar; la segunda es una decision de quien planifico. Un agente que lea la primera
cuando la verdad es la segunda se pone a buscar un contrato que nadie escribio.

**El error de un plomo con separador**, que es el que tiene que explicar el
motivo entero y no solo que la ruta no vale:

```
vitral: la tarea "barra" pide el plomo "retirados/historial.md", y "plomos" no baja a subdirectorios.
        solo entran en el prompt los .md que hay sueltos en ".vitral\plomo".
        Un subdirectorio es donde se deja un contrato para que deje de gobernar:
        lo que cuelga de uno no lo lee ningun agente, y por eso no se puede pedir.
        plomos disponibles: motor.md, plomos-en-el-boceto.md
```

O sea, `ErrorVitral` con la primera linea de mensaje y las otras cuatro de
sugerencia, separadas por `\n`. La sangria de ocho espacios **no va en la cadena**:
la pone `salida.mjs` al pintar, como manda la invariante 1.

**El error de un plomo que no existe**, que se queda corto porque no hay nada mas
que decir:

```
vitral: la tarea "barra" pide el plomo "paleta.md", que no existe en ".vitral\plomo".
        plomos disponibles: motor.md, plomos-en-el-boceto.md
```

Es la misma forma que el error del agente desconocido que ya esta ahi
(`agentes disponibles: ...`), a proposito.

**Cuando el directorio esta vacio o no existe**, la lista disponible seria vacia y
la ultima linea quedaria colgando. En ese caso, en los dos errores, esa linea es:

```
no hay ningun .md en ".vitral\plomo"
```

### La unica parte de estos bloques que no es literal

**El directorio se pinta tal cual lo trae `plomo.dir`, sin normalizar barras**, y
`plomo.dir` sale de un `path.join`. Los tres bloques de arriba estan generados
corriendo el motor **en Windows**, que es donde corre esto, y por eso dicen
`".vitral\plomo"`. En una maquina POSIX la misma linea dice `".vitral/plomo"`.

Todo lo demas de los tres bloques se compara caracter a caracter. Esa cadena, no:
se compara contra `path.join('.vitral', 'plomo')`, como ya hace
`pruebas/checks.mjs`. **Afirmar la barra literal seria afirmar el sistema
operativo de quien escribio el ejemplo**, que es justo el fallo que costo la
primera version de esta seccion: se genero llamando al codigo, como manda
`motor.md`, pero en la maquina equivocada. Generar no basta; hay que generar
donde corre.

### Y por que estos bloques no se normalizan, aunque el modo json si

Cuidado con esta seccion si vienes de leer la regla 3 del modo json de
`motor.md`: **en el modo json esa ruta si sale normalizada**, tambien dentro de
`mensaje` y de `sugerencia`. Un evento `error` con cualquiera de los mensajes de
arriba dice `".vitral/plomo"` aunque corra en Windows. La regla 3 dejo de tener
excepcion de prosa, y esta seccion decia antes lo contrario.

**Lo que no se normaliza es el modo texto, y los tres bloques de arriba son modo
texto.** Por eso se quedan **exactamente como estan**, con su barra invertida, y
siguen siendo correctos: estan generados pintando en Windows, que es donde corre
esto, y se comparan contra `path.join('.vitral', 'plomo')` como ya se dijo. Que
nadie los "arregle" la proxima vez que lea la regla 3: cambiarlos seria cambiar
la superficie de texto del CLI, que es contrato con quien lo usa, y ademas
pondria rojos los checks que los comparan caracter a caracter.

En pantalla, ademas, `".vitral\plomo"` es lo que teclearia quien esta leyendo el
error en Windows. El modo texto tiene delante a una persona sentada en **este**
sistema; el modo json lo lee un programa que junta datos de donde sea. Los dos
modos no son el mismo texto con distinta envoltura: `--json` sustituye al texto,
no convive con el.

**Y en json la cita deja de ser literal.** Estos dos errores **citan lo que la
persona escribio en su boceto**, asi que un `"plomos": ["retirados\historial.md"]`
tecleado en Windows produce un evento que dice `retirados/historial.md`: el
evento **no** repite letra por letra lo que hay en el boceto. Es deliberado y
esta razonado en `normalizar-rutas-en-json.md`, en "Lo que se pierde, y se
acepta": en json todo va canonico, incluida la cita, y quien quiera ver lo que se
tecleo tal cual lo tiene en el modo texto. La alternativa —normalizar unas rutas
si y las citadas no— exige distinguirlas dentro de una frase en castellano, que
es justo el analisis que no se puede hacer.

**De `mensaje` sigue sin poder extraerse una ruta**, ni antes ni despues de esto:
se normaliza para que se **lea** uniforme, no para que se parsee. Si alguna vez
la interfaz necesita esa ruta como dato, **se le da un campo**, no una barra.

---

## Los bordes

| Caso | Que pasa |
|---|---|
| `plomos` omitido | Todos, en orden alfabetico. Prompt **identico** al de antes de esta tanda |
| `"plomos": []` | Ninguno, y el bloque del plomo lleva la frase de "declara que no lee ningun contrato" |
| `"plomos": ["a.md"]` con `a.md` en el directorio | Solo `a.md`, con su linea `--- plomo: a.md ---` |
| `"plomos": ["b.md", "a.md"]` | Los dos, **en ese orden**: `b.md` primero |
| `"plomos": ["fantasma.md"]` | **Aborta** con el error de "no existe" |
| `"plomos": ["retirados/historial.md"]` | **Aborta** con el error del separador, **aunque el archivo este ahi de verdad**. Es el caso que motiva el mensaje largo |
| `"plomos": ["retirados\\historial.md"]` | Igual: se miran las dos barras |
| `"plomos": ["./motor.md"]` | **Aborta** con el error del separador. No se normaliza nada antes de mirar |
| `"plomos": ["C:/x/motor.md"]` | **Aborta** con el error del separador. Una ruta absoluta lleva separador, asi que no necesita regla propia |
| `"plomos": ["retirados"]` | **Aborta** con el error de "no existe": no lleva separador y no es un `.md` de la lista |
| `"plomos": ["a.md", "a.md"]` | **Aborta**: nombre repetido. Mismo criterio que un `id` repetido |
| `"plomos": ["a.txt"]` | **Aborta** con el error de "no existe": `leerPlomo` solo lista `.md`, asi que no esta en la lista. No necesita regla propia |
| `"plomos": null` | **Aborta**: no es un array |
| `"plomos": "a.md"` | **Aborta**: no es un array. Una cadena suelta no se itera letra a letra |
| `"plomos": [""]` o `[123]` | **Aborta**: no es una cadena util |
| `"plomos": ["a.md"]` sin directorio `plomo/` | **Aborta**, con la ultima linea de "no hay ningun .md en ..." |
| `plomos` omitido y sin directorio `plomo/` | El respaldo de hoy, sin cambios. **Es el caso normal de un proyecto sin contratos** |
| Un archivo del directorio que **nadie** declara | No pasa nada. Que un `.md` no lo lea ninguna tarea es legitimo y no se avisa |
| `--solo` sobre una tarea con `plomos` | Recibe los suyos. `--solo` no cambia nada de esto |
| `--seco` | Imprime el prompt entero de cada tarea, o sea **ya ensena que plomo recibio cada una**. Es como se comprueba esta tanda sin gastar |
| La cabecera dice `plomo 2 archivos (104.2 KB)` | Sigue diciendo lo mismo: describe **el directorio**, no lo que recibe un vidrio. Ver "Lo que no entra" |

---

## Los checks

`pruebas/checks.mjs` pasa de **41 a 50**. Los 41 que hay **no se tocan**: si alguno
deja de pasar, es que algo se rompio. Dos de ellos son la red de esta tanda y
conviene saber cuales, porque son los que tienen que seguir verdes sin ayuda:
`'el plomo entra entero en los tres prompts'` y
`'revision recibe los handoffs de backend y frontend'`.

| # | Que comprueba |
|---|---|
| 42 | **Omitir `plomos` da el prompt de siempre.** Con dos `.md` en el directorio y ningun `plomos` en el boceto, los dos aparecen en el prompt de todas las tareas |
| 43 | **Declarar uno da uno.** `"plomos": ["a.md"]` y el prompt de esa tarea lleva `a.md` y **no** lleva `b.md`; el de otra tarea sin campo lleva los dos |
| 44 | **El orden es el declarado.** `["b.md","a.md"]` deja `b.md` antes que `a.md` en el prompt |
| 45 | **`[]` no da ninguno**, y el prompt lleva la frase literal `(esta tarea declara que no lee ningun contrato)` |
| 46 | **Un nombre que no existe aborta.** Codigo 1, y el mensaje nombra la tarea, el archivo pedido y los disponibles |
| 47 | **Un subdirectorio aborta con SU mensaje, no con el de "no existe".** El escenario **crea de verdad** `plomo/retirados/historial.md` y pide `"retirados/historial.md"`: aborta igual, y el texto es el del separador. Se comprueban las dos barras |
| 48 | **La forma mal escrita aborta.** Casos: `null`, `"a.md"` como cadena suelta, `[123]`, `[""]`, `["a.md","a.md"]` |
| 49 | **La cabecera no se movio.** La linea `plomo ... KB` es **identica** con y sin `plomos` declarado en el boceto |
| 50 | **El boceto que no existe sigue fallando igual**, con el mismo texto y el mismo codigo, pese a que `leerPlomo` ahora corre antes |

El 47 es el unico que no se puede escribir de memoria: si se monta sin crear el
archivo, pasaria igual con el orden de comprobaciones invertido, que es justo el
fallo que tiene que cazar.

Los 49 y 50 valen tanto como los demas: son los dos sitios por donde esta tanda
puede romper algo que ya funcionaba, y ninguno de los dos se nota mirando el
campo nuevo.

Todos se comprueban con `--seco`, sin lanzar agentes, como los 41 que ya hay.

**Cada check nuevo monta su propio repositorio con `montarRepo`, con nombre
propio.** El directorio de plomo de los escenarios que ya existen viene copiado de
`ejemplo/plomo/` y tiene **un solo** archivo; escribir un segundo `.md` dentro de
un repositorio compartido cambiaria lo que ven checks que hoy pasan. El helper
`promptDe(texto, id)` que ya esta en el archivo es lo que hay que usar para mirar
el prompt de **una** tarea: la salida entera de `--seco` lleva los de todas, y en
este asunto dicen justo lo contrario.

---

## Reparto y fronteras

Cinco tareas en tres olas.

| Ola | Tarea | Archivos | Que hace |
|---|---|---|---|
| 1 | `forma` | `src/boceto.mjs`, `vitral.mjs` | Valida `plomos`, `leerPlomo` con `porArchivo` y `dir`, `plomoDe`, y las dos lineas de `vitral.mjs` |
| 1 | `reparto` | `src/corrida.mjs`, `src/prompt.mjs` | Llamar a `plomoDe` y el respaldo nuevo del bloque del plomo |
| 1 | `documentacion` | `README.md`, `.vitral/plomo/motor.md` | El campo en las dos tablas, las firmas, el grafo |
| 2 | `checks` | `pruebas/checks.mjs` | Los nueve checks nuevos |
| 3 | `revision` | los seis archivos | Que todo encaje |

`forma` y `reparto` van en la **misma ola** aunque `reparto` consuma `plomoDe`,
que todavia no existe cuando arranca. Eso es exactamente para lo que sirve un
plomo: la firma esta contratada arriba y se programa contra ella. `reparto` **no
abre `src/boceto.mjs`** y **no se escribe su propio `plomoDe`** si al mirar no lo
encuentra: lo importa y ya.

`vitral.mjs` va con `forma` porque el segundo parametro de `leerBoceto` no sirve
de nada sin la llamada que se lo pasa, y esa llamada son dos lineas en
`vitral.mjs`. Es el mismo caso que `guardarrailes` en la tanda de validacion.

`corrida.mjs` y `prompt.mjs` van juntos porque son el mismo cambio visto por sus
dos extremos —de donde sale la cadena y como se cuenta cuando esta vacia— y
partirlo entre dos agentes que no pueden hablarse deja el caso de `[]` en tierra
de nadie.

`checks` va en la ola 2 a proposito: en la ola 1 el campo todavia no existe y los
checks nuevos no podrian ejecutarse. En la ola 2 se escriben viendo el codigo de
verdad y se corren antes de darlos por buenos.

### Lo que no toca nadie en esta tanda

- `src/salida.mjs`. **Es la frontera mas importante de la tanda**: la cabecera, el
  evento `corrida` y el modo json se quedan exactamente como estan. Si te
  encuentras editandolo, te saliste del contrato.
- `src/guardarrailes.mjs`, `src/agentes.mjs`, `src/proceso.mjs`, `src/rutas.mjs`,
  `src/registro.mjs`, `src/olas.mjs`, `src/errores.mjs`, `src/git.mjs`.
- `.vitral/plomo/retirados/`, incluido su `LEEME.md`. Esta tanda le da una razon
  mas para estar ahi, pero no le cambia una letra.
- `.vitral/boceto.json` y `.vitral/ui/boceto.json`. **Ninguna tarea anade `plomos`
  a ningun boceto de este repositorio.** El campo se estrena cuando se parta
  `panel-pty.md`, que es otra tanda. Anadirlo ahora dejaria bocetos declarando
  trozos de archivos que todavia no existen.
- `ejemplo/boceto.json` y `ejemplo/plomo/`. Sin `plomos`, siguen funcionando, y
  eso es justo lo que hay que demostrar.
- `.vitral/rumbo.md`. Ya lleva anotada la particion de `panel-pty.md` con la
  medida del 21-08-2026; no es un plomo y no gobierna nada.
- Los 41 checks que ya existen.
- `ui/` entera. Esta tanda es del motor.
- Cualquier mensaje que ya salia por pantalla antes de esta tanda.

### Lo que no entra

- **No se parte `panel-pty.md`.** Esta tanda construye la herramienta; usarla es
  la siguiente. Se hacen por separado a proposito: partir el contrato es una
  decision de contenido, con sus referencias cruzadas que arreglar, y no se toma
  de rebote mientras se toca el motor.
- **La cabecera no dice cuanto plomo recibe cada tarea.** Hoy dice
  `plomo 2 archivos (104.2 KB)` y seguira diciendolo, describiendo el directorio.
  Anadir una cifra por tarea es tocar la superficie de texto del CLI, que es
  contrato con quien lo usa y no se cambia de paso mientras se hace otra cosa.
  Mientras tanto la verdad por tarea ya esta en dos sitios: `--seco`, que imprime
  el prompt entero, y el campo `bytes` del evento `prompt` en modo json.
- **`leerPlomo` no pasa a ser recursivo, ni ahora ni como opcion.** Que no baje a
  subdirectorios es lo que hace que `retirados/` funcione, y es lo que el mensaje
  del separador da por cierto.
- **No se avisa de un `.md` que no lee ninguna tarea.** Parece un guardarrail
  util y no lo es: en cuanto haya varios bocetos sobre el mismo directorio de
  plomo, avisaria de archivos que si lee alguien, solo que en otra corrida.
- **`plomos` no acepta comodines.** Ni `"*.md"` ni nada parecido. Un comodin
  volveria a hacer que anadir un archivo al directorio cambie en silencio lo que
  lee una tarea, que es exactamente el problema del que se sale con esta tanda.
- **No se valida `necesita` como array**, que sigue siendo el fallo que era. Es
  otro campo y otra tanda.
