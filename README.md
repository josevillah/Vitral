# Vitral

Orquestador de agentes de IA por linea de comandos. Corre varios agentes en
paralelo sobre el mismo repositorio, coordinados por un contrato compartido,
usando tu suscripcion en modo headless. Sin API key aparte.

**v0.1: solo el motor.** Un script de Node que lee un plan, lanza agentes en
paralelo y recoge lo que produjeron. Los paneles con PTY vienen despues.

## La idea

Dos agentes trabajando sobre el mismo modulo —uno en la vista, otro en el
controlador— no necesitan hablarse mientras trabajan. Necesitan haberse puesto
de acuerdo **antes**.

Ese acuerdo previo es un archivo markdown: **el plomo**, por el plomo que une los
vidrios de un vitral. Nombres de campos, forma del JSON, rutas del endpoint,
escritos antes de que nadie toque codigo. El agente de frontend programa contra
un endpoint que todavia no existe, y encaja igual cuando el de backend termina.

No hay comunicacion en tiempo real entre agentes. No hace falta.

## Vocabulario

| Termino | Que es |
|---|---|
| **boceto** | El plan: que tareas hay, quien las hace, que depende de que |
| **plomo** | Los contratos compartidos, en markdown |
| **vidrio** | Un agente ejecutando su tarea |
| **handoff** | Lo que un agente deja escrito al terminar, para que otro lo lea |
| **ola** | Grupo de tareas que pueden correr en paralelo |

## Requisitos

- Node 18 o superior. Cero dependencias: solo modulos nativos.
- `claude` en el PATH, con sesion iniciada. Funciona en Windows y en Linux.
- Opcional: `opencode` en el PATH, si vas a usar ese agente.
- Un repositorio git, en una rama que no sea `main` ni `master`.

## Uso

```
node vitral.mjs                    corre .vitral/boceto.json
node vitral.mjs --seco             imprime los prompts sin ejecutar nada
node vitral.mjs --solo <id>        corre una tarea y sus dependencias
node vitral.mjs --solo <id> --rehacer   reejecuta tambien las dependencias
node vitral.mjs --boceto <archivo> usa otro boceto
node vitral.mjs --sin-git          corre sin repositorio git (peligroso)
node vitral.mjs --json             emite eventos JSON en vez del texto de siempre
```

### --json: la misma corrida, contada en eventos

`--json` corre exactamente lo mismo y emite **un evento JSON por linea** en vez
del texto pintado: arranque de cada tarea, latidos, cierres, resumen. Se combina
con todas las demas banderas, y los codigos de salida son identicos con y sin
ella. Es lo que va a leer la interfaz grafica; desde una terminal sirve para
canalizar una corrida a `jq` o guardarla entera en un archivo.

```
node vitral.mjs --json > corrida.jsonl
node vitral.mjs --json | jq -c 'select(.evt == "cierre")'
```

Dos cosas que conviene tener claras:

- **`stdout` es JSONL puro.** Una linea, un evento, siempre parseable con un
  `JSON.parse`. Nunca sale por ahi otra cosa. Los errores y los avisos, que sin
  la bandera van a `stderr`, con `--json` tambien salen por `stdout`, como
  eventos, para que solo haya un canal que leer.
- **`stderr` queda para la catastrofe:** la traza de algo que vitral no supo
  capturar. En una corrida normal queda vacio, y cualquier cosa que aparezca ahi
  es inequivocamente un accidente.

**`--json` no da streaming del trabajo del agente.** Es lo primero que se
malinterpreta y no es lo que hace. Los eventos son los mismos momentos que el
texto ya contaba —una tarea arranca, late cada 60 segundos, termina—, no lo que
el agente va escribiendo: su salida sigue llegando entera cuando el proceso
acaba. Ver a un vidrio trabajar en vivo es lo de los paneles con PTY, y viene
despues.

Sin la bandera **no cambia absolutamente nada**: el texto de siempre, en los
canales de siempre. El catalogo completo de eventos y de campos, para quien vaya
a consumirlos, esta en `.vitral/plomo/motor.md`.

### --solo no repite lo que ya esta hecho

El caso normal de `--solo` es "esta tarea fallo, relanzala", no "reconstruye todo
desde cero". Por eso, cuando `--solo` arrastra una dependencia que **ya dejo su
handoff** en `.vitral/handoffs/<id>.md`, esa dependencia no se ejecuta: se salta y
se reusa el handoff que ya existe. Repetirla costaria dinero y, peor, el agente
nuevo sobrescribiria trabajo que estaba bien.

| Estado de la dependencia | Que pasa |
|---|---|
| Tiene `<id>.md` de esta tanda | Se salta. Su handoff se inyecta igual en quien dependa de ella |
| Tiene `<id>.md` de otra tanda | Se ejecuta: para vitral es como si no lo tuviera (mas abajo) |
| Tiene `<id>.INCOMPLETO.md` | Se ejecuta: quedo a medias, no esta hecha |
| No tiene nada | Se ejecuta |

La tarea que nombras en `--solo` siempre se ejecuta, tenga handoff o no: si la
nombraste es porque la quieres.

```
--solo tres: 1 tarea, 2 saltadas (handoff en disco)

  ~ uno   saltada  handoff del 19-08 14:05
  ~ dos   saltada  handoff del 19-08 14:06
```

`--rehacer` desactiva el salto y reejecuta el arbol entero.

### Un handoff de otra tanda se ignora

Los handoffs se guardan por id de tarea, y **los ids se repiten entre tandas**:
`documentacion` o `checks` pueden ser de dos bocetos distintos, y el disco no
dice de cual. Sin eso, un `--solo` podia saltarse una dependencia que nunca corrio
en esta tanda e inyectar su handoff viejo en el prompt, con voz de trabajo recien
hecho.

Por eso vitral sella el directorio: `.vitral/handoffs/.tanda` guarda el `nombre`
del boceto de la ultima corrida. Al arrancar lo compara con el de la corrida
actual.

| El sello | Que pasa |
|---|---|
| Dice lo mismo que esta corrida | Los handoffs valen. Todo normal |
| Dice otra cosa | Los handoffs y las marcas `INCOMPLETO` **son de otra tanda**: se tratan como ausentes y se dice en la cabecera |
| No existe | Los handoffs valen. Es un proyecto anterior al sello, y tirarle trabajo bueno seria peor que el fallo que esto arregla |

Cuando el sello no coincide, la cabecera lo dice antes de lanzar nada:

```
vitral · El preambulo no puede mentir sobre el paralelismo
boceto .vitral/boceto.json · rama feat/x · plomo 2 archivos (33.1 KB) · olas 2 -> 1
        3 handoffs en disco son de la tanda "Validar presupuesto, modelo y cwd": se ignoran
```

En singular, `1 handoff en disco es de la tanda "...": se ignora`. Se cuentan solo
los handoffs y marcas de los ids que esta corrida usa: uno de un id que no
aparece en el boceto no la afecta y no se nombra.

**No se borra nada.** Vitral los ignora y sigue; limpiarlos es cosa del cierre de
tanda. Con `--solo`, una dependencia cuyo handoff es de otra tanda no se salta:
se ejecuta de verdad. Y `--seco` lee el sello pero no lo escribe, asi que dice
exactamente lo que diria la corrida real sin tocar el disco.

Estructura de trabajo:

```
.vitral/
  boceto.json                 el plan          (se versiona)
  plomo/*.md                  los contratos    (se versiona)
  logs/<id>.json              salida cruda     (artefacto, ignorado)
  handoffs/<id>.md            handoff extraido (artefacto, ignorado)
  handoffs/<id>.INCOMPLETO.md marca de corte   (artefacto, ignorado)
  handoffs/.tanda             sello de tanda   (artefacto, ignorado)
```

El plomo se lee del directorio del boceto: con `--boceto ejemplo/boceto.json`
se leen los contratos de `ejemplo/plomo/`. Los logs y los handoffs siempre van
a `.vitral/`, en la raiz.

Para probar, en `ejemplo/` hay un boceto de tres tareas con su contrato:

```
node vitral.mjs --seco --boceto ejemplo/boceto.json
```

## El boceto

```json
{
  "nombre": "Modulo de estados de pedido",
  "tareas": [
    {
      "id": "backend",
      "agente": "claude",
      "rutas": ["app/Controllers/", "app/Models/"],
      "presupuesto": 3,
      "prompt": "Implementa el endpoint segun el contrato..."
    },
    {
      "id": "revision",
      "necesita": ["backend", "frontend"],
      "rutas": ["app/"],
      "prompt": "Revisa que ambos lados encajen con el contrato..."
    }
  ]
}
```

| Campo | Obligatorio | Que hace |
|---|---|---|
| `id` | si | Nombre de la tarea. Da nombre al log y al handoff |
| `prompt` | si | Lo que tiene que hacer el agente |
| `rutas` | si | Donde puede escribir. Se le dice en el prompt y se revisa al final |
| `agente` | no | `claude` por defecto |
| `necesita` | no | Ids de las tareas que deben terminar antes |
| `presupuesto` | no | Tope de gasto en USD para esa tarea. Numero mayor que cero (lee las limitaciones; ojo con las tareas de revision) |
| `timeout` | no | Minutos antes de matar la tarea. Por defecto 15 |
| `modelo` | no | Alias o nombre de modelo: `sonnet`, `opus`, `claude-fable-5`. Para `opencode`, `proveedor/modelo`. Cadena no vacia y sin espacios |
| `cwd` | no | Directorio de trabajo del agente. Ruta relativa a la raiz, que caiga dentro del repositorio y exista |

### Que valores acepta cada campo opcional

`presupuesto`, `modelo` y `cwd` se comprueban antes de lanzar nada, no cuando el
CLI del agente los rechaza a mitad de una ola.

| Campo | Valido | Invalido |
|---|---|---|
| `presupuesto` | Numero mayor que cero. Omitido significa "sin tope" | `0`, negativos, `NaN`, `Infinity`, cualquier cosa que no sea `number`, incluida la cadena `"3"` |
| `modelo` | Cadena no vacia, sin espacios en blanco | Cadena vacia, cadena con espacios, y cualquier cosa que no sea `string` |
| `cwd` | Cadena no vacia con una ruta **relativa**, que resuelva **dentro de la raiz** y **exista** en disco | Cadena vacia, ruta absoluta, ruta que salga de la raiz, directorio que no existe, y cualquier cosa que no sea `string` |

Los tres siguen siendo opcionales: omitirlos es valido y es lo normal.

Tres decisiones que se tomaron a proposito, porque parecen severas y no lo son:

- **`presupuesto: 0` aborta en vez de significar "sin tope".** Quien quiera correr
  sin limite omite el campo. Aceptar el `0` como ilimitado es exactamente el
  malentendido que hace dano: `0` es justo lo que escribe quien quiere decir
  "nada", y lo que pasaba entonces era correr sin tope ninguno.
- **La cadena `"3"` tambien aborta.** Es un `number` o no lo es. Aceptar cadenas
  numericas invita a `"3 dolares"` y a `"3,5"`.
- **`cwd` tiene que ser relativo y caer dentro del repositorio.** Fuera de el, git
  no ve nada: no hay forma de revisar ni de deshacer lo que escriba el agente, y
  esa es la unica red de seguridad de vitral. Una ruta absoluta aborta aunque
  apunte dentro del repositorio, porque un boceto con rutas absolutas solo
  funciona en un ordenador.

**Vitral no valida que el modelo exista.** No puede: los nombres cambian con la
version del CLI y con el proveedor. Solo comprueba la forma; que el modelo exista
lo decide el CLI, que ademas falla rapido y barato.

La forma —tipo, rango, ruta relativa— se comprueba al leer el boceto. Que el `cwd`
exista en disco y caiga dentro del repositorio se comprueba con los demas
guardarrailes, asi que `--seco` tambien lo caza, sin lanzar ningun agente.

Las tareas se ordenan en olas por dependencias. Las de una misma ola corren en
paralelo; las olas, en serie. Si una tarea falla, la corrida se detiene ahi y las
olas siguientes no se ejecutan.

Una corrida completa (sin `--solo`) nunca salta nada: ejecuta todas las tareas del
boceto, haya handoffs en disco o no.

## Que recibe cada agente

El prompt se le pasa **por stdin**, nunca como argumento, y se arma con estos
bloques en este orden:

1. Un aviso cuyo contenido depende de cuantas tareas tiene su ola. Un vidrio que
   corre solo lee que `eres el unico agente de esta ola` y que `si un archivo
   cambia bajo tus pies, has sido tu`. Uno acompanado lee a quienes le acompanan,
   nombrados por su id, y que `el codigo que tienes al lado puede estar cambiando
   mientras trabajas`. Lo comun a los dos casos: no hay a quien preguntarle, ni
   que esperar a nadie.
2. **El plomo**, entero, marcado como fuente de verdad obligatoria.
3. Su tarea.
4. Sus rutas, con la instruccion de no salirse de ellas.
5. Los handoffs de las tareas de las que depende.
6. La instruccion de cerrar con un bloque `## Handoff` de cuatro campos:
   **Hice** · **Decidi** · **Me desvie** · **Necesito de otros**.

Ese bloque se extrae de la respuesta y se guarda en `.vitral/handoffs/<id>.md`.
Lo leen las tareas que vengan despues y la persona que revise la corrida, y es
lo unico que unas y otra ven del trabajo anterior sin ir al codigo.

El bloque del plomo y el de los handoffs no pueden contradecirse, o el agente
acaba decidiendo solo. La regla es una sola en los dos sitios: **manda el plomo**.
Si una tarea anterior se desvio, lo que se corrige es el codigo; solo si la
desviacion es deliberada y claramente mejor se actualiza el archivo del plomo, y
se dice en el handoff.

Cuando falta un handoff, no se inyecta un hueco: se inyecta la ausencia, con voz
de sistema y encabezado propio, para que no se lea como contenido. Hay tres casos:

| Estado | Que ve el agente |
|---|---|
| Handoff de verdad | `--- handoff de "X" ---` y su contenido |
| Corte por presupuesto | `--- "X" se corto a medias y no dejo handoff ---` y la marca `<id>.INCOMPLETO.md` entera |
| No hay nada | `--- "X" no dejo handoff ---` y el aviso de que pudo fallar o no haberse ejecutado |

En los dos ultimos casos se le dice explicitamente que no de por hecho el trabajo
de esa tarea y que verifique en el codigo que existe de verdad.

## Timeout y senal de vida

Cada tarea tiene un `timeout` en minutos, **15 por defecto**. Si lo supera, vitral
mata el proceso —el arbol entero, porque en Windows el hijo directo es `cmd.exe` y
matarlo solo dejaria vivo al agente— y trata la tarea como fallida.

Esto no es un lujo. Un agente que no termina se lleva por delante la ola y con
ella la corrida entera, y desde fuera **no se distingue de uno que esta trabajando
bien**. Se descubrio con opencode: lanzado con flags equivocados no fallaba, se
quedaba esperando, y colgaba a vitral indefinidamente.

Mientras una ola corre, cada 60 segundos sale una linea por tarea en curso:

```
ola 1/1 · 1 vidrio
  -> lenta  claude  app/Models/
  ·  lenta  en curso  1m 00s
  <- lenta  FALLO  30s  $0.0000
     supero su timeout de 0.5 min y fue matada
     rastro en .vitral/handoffs/lenta.INCOMPLETO.md
```

Sin eso son minutos de silencio absoluto sin forma de saber si algo sigue vivo.

**Morir por tiempo y morir por dinero son diagnosticos distintos**, y la marca
`INCOMPLETO` los separa. El presupuesto corta limpio entre dos turnos y deja dicho
cuanto gasto y cuantos turnos dio. El timeout mata a la fuerza: no se sabe el
gasto, no se sabe el turno, y sobre todo **no se sabe si la tarea iba bien**. A los
15 minutos sin terminar, un agente trabajando correctamente y uno colgado
esperando una confirmacion que nadie va a darle se ven exactamente igual. La marca
lo dice y explica donde mirar para distinguirlos, que depende del agente.

## Los guardarrailes

Los agentes escriben archivos sin pedir permiso (`--permission-mode
bypassPermissions`). Por eso, antes de lanzar nada:

- Si la rama es `main` o `master`, **aborta**.
- Si no hay repositorio git, **aborta**: sin git no se sabe en que rama estas ni
  hay forma de deshacer lo que escriban. Se puede forzar con `--sin-git`, que
  avisa fuerte y deja el riesgo por tu cuenta.
- En `--seco` ninguno de esos dos aborta: solo advierten. El modo seco no ejecuta
  nada, asi que funciona siempre, con o sin git.

**Un boceto de otro proyecto: aborta, y tambien en `--seco`.** La raiz es siempre
el directorio desde el que corres vitral, asi que un `--boceto` que caiga fuera de
ella resolveria las rutas de sus tareas contra esta raiz y escribiria aqui sus
handoffs: contratos de un proyecto, repositorio de otro.

```
vitral: el boceto "C:/otro/.vitral/boceto.json" cae fuera del repositorio.
        sus rutas se resolverian contra esta raiz y sus handoffs se escribirian aqui.
        corre vitral desde el proyecto al que pertenece el boceto
```

Este si aborta en seco, al reves que el de rama: lo que hace dano aqui es que el
modo seco imprimiria prompts con las rutas ya resueltas contra la raiz equivocada,
que es justo lo que se quiere cazar antes de gastar. Un boceto dentro de la raiz
—incluido `ejemplo/boceto.json`— no lo toca; y si la ruta no existe, el error de
siempre lo da la lectura del boceto.

**Reejecutar sobre trabajo existente: avisa.** Si una tarea que va a correr ya
dejo handoff o marca de una corrida anterior, y hay archivos suyos sucios o sin
rastrear bajo sus rutas, se dice antes de lanzar nada: el agente va a escribir
encima. No lo bloquea.

Aplica igual a `--rehacer` y a una corrida completa repetida. La segunda es la
peligrosa: `--rehacer` se escribe a proposito, pero `node vitral.mjs` a secas
despues de un fallo parcial se lanza por costumbre, y arrasa con lo que las tareas
que si terminaron habian dejado bien.

**Rutas que se pisan: aborta siempre.** Si dos tareas de la misma ola declaran
rutas que se solapan, la corrida se detiene antes de lanzar nada y dice que dos
tareas chocan y bajo que prefijo. Dos agentes en paralelo sobre el mismo archivo
no dan un error visible: dan perdida silenciosa de trabajo, porque el ultimo en
guardar pisa al otro.

La comparacion es por segmento de ruta, no por texto: `app/Models/` choca con
`app/Models/Pedido/`, pero no con `app/ModelsViejos/`.

Solo cuenta dentro de una misma ola. Entre olas distintas el solape es normal y
suele ser deliberado: en el ejemplo, `revision` mira `app/` entera despues de que
`backend` y `frontend` hayan escrito en sus rincones. Como corren en serie, no
hay conflicto. Esa es tambien la salida cuando dos tareas chocan: darle a una un
`necesita` y mandarla a la ola siguiente.

Este chequeo tambien corre en `--seco`: es un error del plan, y el modo seco es
donde se revisa el plan.

## Adaptadores de agente

Un objeto `AGENTES` en `src/agentes.mjs`, donde cada entrada define `cmd`,
`args(tarea)` y `parse(salida)`. Anadir un agente es anadir una entrada.

**`claude`** esta verificado contra Claude Code 2.1.232:

```
claude -p --output-format json --permission-mode bypassPermissions
       [--model X] [--max-budget-usd N]
```

Del JSON de salida se usan `result`, `session_id`, `total_cost_usd`, `num_turns`,
`permission_denials`, `subtype` e `is_error`. Todo eso queda en el log de la tarea.

**`opencode`** esta verificado contra opencode 1.18.18:

```
opencode run --format json --auto [--model proveedor/modelo]
```

Tambien lee el prompt por stdin y sale limpio. `--auto` aprueba los permisos sin
preguntar, que es el equivalente de `bypassPermissions`.

La diferencia esta en la forma de la salida: opencode emite **JSONL**, un evento
JSON por linea segun trabaja, en vez de un objeto unico al final. El adaptador
recorre los eventos y junta lo que hace falta: el texto de los `text`, el costo
sumando los `step_finish`, los turnos contando los `step_start` y el `sessionID`.

Esa diferencia importa cuando algo va mal: si matas a opencode a media faena, en
el log queda todo lo que alcanzo a emitir; si matas a claude, no queda nada.

**opencode no tiene tope de gasto.** No existe nada parecido a `--max-budget-usd`,
asi que `presupuesto` no le aplica: se ignora y vitral lo avisa al arrancar. Su
unico freno es el `timeout`.

## Estructura del codigo

El motor esta en `src/`, un modulo por responsabilidad. `vitral.mjs` es solo la
entrada: parsea banderas, arma el plan, delega y decide el codigo de salida.

| Archivo | Que hace |
|---|---|
| `vitral.mjs` | Entrada. El unico que llama a `process.exit` |
| `src/salida.mjs` | Todo lo que ve el usuario. El unico que escribe en pantalla |
| `src/boceto.mjs` | Leer y validar el boceto y el plomo |
| `src/olas.mjs` | Orden topologico y cierre de dependencias |
| `src/rutas.mjs` | Rutas declaradas: normalizar, solapar, contener |
| `src/git.mjs` | Consultas a git. Solo lee, nunca escribe |
| `src/agentes.mjs` | Adaptadores: los flags y el formato de salida de cada CLI |
| `src/proceso.mjs` | Lanzar un agente, alimentarlo por stdin, matarlo si se pasa de tiempo |
| `src/prompt.mjs` | El texto que recibe el agente y el handoff que devuelve |
| `src/registro.mjs` | Lo que queda escrito en `.vitral/`: logs, handoffs, marcas |
| `src/guardarrailes.mjs` | Comprobaciones previas: devuelven veredictos, no abortan |
| `src/corrida.mjs` | Ejecuta las olas, y el ensayo de `--seco` |
| `src/errores.mjs` | `ErrorVitral`, para los fallos de forma |
| `pruebas/checks.mjs` | Los checks de regresion. Monta sus propios escenarios y los borra |

Antes de dar por bueno un cambio en el motor:

```
node pruebas/checks.mjs
```

Checks de regresion, cero dependencias, sale con 0 o con 1; el propio comando dice
cuantos pasan de cuantos, asi que aqui no se repite el numero. Cada uno monta su
propio repositorio temporal con el boceto de `ejemplo/` dentro, asi que el
resultado no depende de en que rama estes ni de lo que quedara de una corrida
anterior. Ninguno lanza agentes de verdad.

El contrato completo esta en **`.vitral/plomo/motor.md`**: que exporta cada
modulo, con que firma, y que no le corresponde. Ese archivo es el plomo del
propio Vitral, para cuando varios agentes trabajen sobre el motor a la vez.

Tres invariantes que no se rompen sin acuerdo previo:

1. **Solo `salida.mjs` escribe en pantalla.** Ningun otro modulo usa `console` ni
   `process.stdout`. Cuando haya interfaz grafica, portar la salida sera tocar un
   archivo en vez de diez.
2. **Solo `vitral.mjs` llama a `process.exit`.** Los guardarrailes devuelven
   veredictos (`{ nivel: 'aborta' | 'avisa', mensaje, sugerencia, detalles }`) y los errores
   de forma lanzan `ErrorVitral`. Asi se puede preguntar "¿esto es seguro?" sin
   morirse en el intento.
3. **Las dependencias van en una direccion.** Sin ciclos.

## Limitaciones

Cosas que conviene saber antes de confiar en esto.

**No hay tope de turnos.** Claude Code 2.1.232 no tiene `--max-turns`. Lo unico
que hay es `--max-budget-usd`, y por eso el boceto usa `presupuesto`, en dolares.

**El presupuesto corta, pero se pasa.** Verificado en una cuenta con
suscripcion: con un tope de $0.01 el agente se detuvo de verdad —dejo 1 de 5
archivos a medio hacer— pero gasto $0.09 antes de parar. La comprobacion ocurre
entre turnos, asi que el tope se rebasa por lo que cueste el turno en curso. Como
techo de seguridad sirve; como control fino de gasto, no.

Por eso, un `presupuesto` por debajo de **$0.25** hace que vitral avise al
arrancar. No lo bloquea: solo deja dicho que a esa escala el sobrepaso puede ser
de varias veces el tope declarado.

**Una tarea de revision necesita mas presupuesto que las que revisa.** Es el
error que comete todo el mundo, y cuesta dinero descubrirlo. Medido: una revision
de dos implementaciones de $1.5 cada una se corto dos veces con un tope de $0.8,
en el turno 8 y en el turno 11.

Parece al reves, porque una revision escribe poco. Pero antes de escribir tiene
que leerlo todo: el codigo de las dos tareas que revisa, sus dos handoffs y el
plomo entero. Ese contexto lo paga por adelantado y se lo lleva arrastrando en
cada turno.

La regla practica: **el presupuesto de una tarea de revision debe ser al menos la
suma de las tareas que revisa.** En el ejemplo, `backend` y `frontend` tienen $3
cada una, asi que `revision` tiene $6.

**Cuando el presupuesto corta, no hay handoff.** La salida viene con
`subtype: error_max_budget_usd` y sin campo `result`: el agente se corta antes de
escribir lo que hizo. Vitral marca la tarea como fallida y detiene la corrida.

Para que quede rastro en el disco y no solo en la consola, en ese caso se escribe
`.vitral/handoffs/<id>.INCOMPLETO.md` con lo que si se sabe: que tarea era,
cuantos turnos alcanzo, cuanto gasto, la sesion, la hora del corte, y el aviso de
que puede haber archivos escritos que no constan en ninguna parte. Ese archivo se
borra solo cuando esa misma tarea vuelva a correr y deje un handoff de verdad.

**Las rutas son una instruccion, no una jaula.** No hay sandbox. Al agente se le
dice en el prompt donde puede escribir, y al final se revisa si algo quedo fuera
comparando `git status` antes y despues. Es deteccion, no prevencion.

**Los agentes de una misma ola no se ven.** Cada uno arranca con el repositorio
tal como estaba al empezar la ola, y el otro esta escribiendo mientras tanto. Lo
unico que los mantiene alineados es el plomo. Si el plomo es vago, no encajan.

**Sin reintentos.** Si algo falla, se ve y se decide a mano. A proposito.

**Sin streaming del trabajo.** No se ve al agente trabajar: su salida llega
entera cuando el proceso termina. Lo unico que hay mientras tanto es una linea de
latido por minuto y por tarea en curso, para saber que sigue viva. **`--json` no
cambia esto**: emite los mismos momentos, no el teclear del agente. Los paneles
en vivo son justo lo que viene despues de esta version.

## Lo que esta medido, no supuesto

Todo lo de abajo salio de correr las herramientas en una maquina real, no de la
documentacion ni de la memoria. Si algun numero deja de cuadrar, es que cambio la
version de la herramienta.

| Hecho | Medido |
|---|---|
| Claude Code no tiene `--max-turns` | v2.1.232, verificado en `--help` |
| `--max-budget-usd` si corta la ejecucion | tope $0.01: paro de verdad, dejo 1 de 5 archivos |
| ...pero se pasa del tope | ese mismo corte gasto $0.09, casi 10x |
| Al cortar por presupuesto no hay `result` | `subtype: error_max_budget_usd`, sin handoff |
| Una revision gasta mas que lo que revisa | $0.8 no bastaron para revisar dos tareas de $1.5; corto en los turnos 8 y 11 |
| opencode lee stdin y sale limpio | v1.18.18, `run --format json --auto` |
| opencode emite JSONL, no un objeto | un evento por linea, `text` / `tool_use` / `step_finish` |
| opencode con flags erroneos no falla: cuelga | se quedo 2m 22s sin responder, hubo que matarlo |
| En Windows matar `cmd.exe` no mata al agente | hace falta `taskkill /T` sobre el arbol |
| `git status --porcelain` colapsa directorios nuevos | reporta `app/` en vez de `app/Models/Pedido.php`; hace falta `-uall` |
| `git diff --stat` no ve archivos nuevos | los agentes crean archivos, asi que hay que listar lo no rastreado aparte |

## Roadmap

- Paneles con PTY: ver a cada vidrio trabajar en vivo, en vez de esperar al final.
- Adaptador de `codex`, verificado como los otros dos.
- Un vidrio por worktree de git, para que el paralelismo no comparta arbol.
- Reanudar una corrida a medias sin repetir las olas que ya salieron bien.
