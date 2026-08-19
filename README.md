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
- Un repositorio git, en una rama que no sea `main` ni `master`.

## Uso

```
node vitral.mjs                    corre .vitral/boceto.json
node vitral.mjs --seco             imprime los prompts sin ejecutar nada
node vitral.mjs --solo <id>        corre una tarea y sus dependencias
node vitral.mjs --boceto <archivo> usa otro boceto
node vitral.mjs --sin-git          corre sin repositorio git (peligroso)
```

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
| `presupuesto` | no | Tope de gasto en USD para esa tarea (lee las limitaciones) |
| `modelo` | no | Alias o nombre de modelo: `sonnet`, `opus`, `claude-fable-5` |
| `cwd` | no | Directorio de trabajo del agente, relativo a la raiz |

Las tareas se ordenan en olas por dependencias. Las de una misma ola corren en
paralelo; las olas, en serie. Si una tarea falla, la corrida se detiene ahi y las
olas siguientes no se ejecutan.

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

## Los guardarrailes

Los agentes escriben archivos sin pedir permiso (`--permission-mode
bypassPermissions`). Por eso, antes de lanzar nada:

- Si la rama es `main` o `master`, **aborta**.
- Si no hay repositorio git, **aborta**: sin git no se sabe en que rama estas ni
  hay forma de deshacer lo que escriban. Se puede forzar con `--sin-git`, que
  avisa fuerte y deja el riesgo por tu cuenta.
- En `--seco` nada de esto aborta: solo advierte. El modo seco no ejecuta nada,
  asi que funciona siempre, con o sin git.

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

**`opencode`** es un esqueleto **sin verificar**. Los flags y los nombres de
campo estan marcados con `// VERIFICAR`: hay que correr `opencode --help` y
confirmarlos antes de usarlo.

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

**Sin streaming.** La salida de cada agente llega entera al final, cuando el
proceso termina. Durante la corrida solo se ve que tarea arranco. Los paneles en
vivo son justo lo que viene despues de esta version.

## Roadmap

- Paneles con PTY: ver a cada vidrio trabajar en vivo, en vez de esperar al final.
- Adaptadores verificados de `opencode` y `codex`.
- Un vidrio por worktree de git, para que el paralelismo no comparta arbol.
- Reanudar una corrida a medias sin repetir las olas que ya salieron bien.
