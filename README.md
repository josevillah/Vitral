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
```

### --solo no repite lo que ya esta hecho

El caso normal de `--solo` es "esta tarea fallo, relanzala", no "reconstruye todo
desde cero". Por eso, cuando `--solo` arrastra una dependencia que **ya dejo su
handoff** en `.vitral/handoffs/<id>.md`, esa dependencia no se ejecuta: se salta y
se reusa el handoff que ya existe. Repetirla costaria dinero y, peor, el agente
nuevo sobrescribiria trabajo que estaba bien.

| Estado de la dependencia | Que pasa |
|---|---|
| Tiene `<id>.md` | Se salta. Su handoff se inyecta igual en quien dependa de ella |
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

Estructura de trabajo:

```
.vitral/
  boceto.json                 el plan          (se versiona)
  plomo/*.md                  los contratos    (se versiona)
  logs/<id>.json              salida cruda     (artefacto, ignorado)
  handoffs/<id>.md            handoff extraido (artefacto, ignorado)
  handoffs/<id>.INCOMPLETO.md marca de corte   (artefacto, ignorado)
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
| `presupuesto` | no | Tope de gasto en USD para esa tarea (lee las limitaciones; ojo con las tareas de revision) |
| `timeout` | no | Minutos antes de matar la tarea. Por defecto 15 |
| `modelo` | no | Alias o nombre de modelo: `sonnet`, `opus`, `claude-fable-5`. Para `opencode`, `proveedor/modelo` |
| `cwd` | no | Directorio de trabajo del agente, relativo a la raiz |

Las tareas se ordenan en olas por dependencias. Las de una misma ola corren en
paralelo; las olas, en serie. Si una tarea falla, la corrida se detiene ahi y las
olas siguientes no se ejecutan.

Una corrida completa (sin `--solo`) nunca salta nada: ejecuta todas las tareas del
boceto, haya handoffs en disco o no.

## Que recibe cada agente

El prompt se le pasa **por stdin**, nunca como argumento, y se arma con estos
bloques en este orden:

1. Aviso de que hay otros agentes tocando el repo ahora mismo y no hay a quien
   preguntarle.
2. **El plomo**, entero, marcado como fuente de verdad obligatoria.
3. Su tarea.
4. Sus rutas, con la instruccion de no salirse de ellas.
5. Los handoffs de las tareas de las que depende.
6. La instruccion de cerrar con un bloque `## Handoff` de cuatro campos:
   **Hice** · **Decidi** · **Me desvie** · **Necesito de otros**.

Ese bloque se extrae de la respuesta y se guarda en `.vitral/handoffs/<id>.md`.
Es lo unico que los agentes posteriores leen del trabajo anterior.

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
- En `--seco` nada de esto aborta: solo advierte. El modo seco no ejecuta nada,
  asi que funciona siempre, con o sin git.

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

Un objeto `AGENTES` en `vitral.mjs`, donde cada entrada define `cmd`,
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
latido por minuto y por tarea en curso, para saber que sigue viva. Los paneles en
vivo son justo lo que viene despues de esta version.

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
