# Contrato · validar presupuesto, modelo y cwd

Esta funcionalidad se reparte entre varios archivos que se escriben en paralelo.
Lo que sigue es lo que todos necesitan compartir.

`.vitral/plomo/motor.md` tambien es obligatorio y no se repite aqui: las tres
invariantes, las formas ya existentes, el grafo de dependencias y el reparto por
modulo siguen valiendo tal cual. Si algo de aqui parece contradecirlo, manda
`motor.md`.

---

## Que se quiere

`leerBoceto` valida hoy `id`, `prompt`, `rutas`, `timeout`, `agente` y `necesita`.
No valida `presupuesto`, `modelo` ni `cwd`, y los tres llegan al motor tal cual.
Esto es lo que pasa hoy, comprobado ejecutandolo, no deducido:

| Valor | Que llega al CLI | Que dice el guardarrail | Que pasa de verdad |
|---|---|---|---|
| `presupuesto: 3` | `--max-budget-usd 3` | callado | correcto |
| `presupuesto: "tres"` | `--max-budget-usd tres` | **callado**, porque `"tres" < 0.25` es falso | el CLI lo rechaza con codigo 1 |
| `presupuesto: []` | `--max-budget-usd ""` | avisa `($)` | el CLI lo rechaza con codigo 1 |
| `presupuesto: -5` | `--max-budget-usd -5` | avisa "por debajo de $0.25" | el CLI lo rechaza con codigo 1 |
| `presupuesto: 0` | **ningun flag** | callado | **corre sin tope ninguno** |
| `modelo: 123` | `--model 123` | — | el CLI lo rechaza |
| `modelo: {a:1}` | `--model [object Object]` | — | el CLI lo rechaza |
| `cwd: ".."` | — | — | el agente trabaja **fuera del repositorio** |
| `cwd` inexistente | — | — | `no se pudo lanzar "claude": spawn ... ENOENT` |

Tres problemas distintos, y conviene no confundirlos:

**El rechazo del CLI es limpio pero llega tarde y mal explicado.** Un
`--max-budget-usd tres` muere antes de llamar a la API, asi que no cuesta dinero
por si mismo, pero Vitral lo traduce a `"claude" salio con codigo 1 y no escribio
nada`, que no nombra la causa. Y para entonces las otras tareas de la misma ola ya
corrieron y ya se pagaron. Es un error de forma que se puede cazar gratis con
`--seco`, y hoy cuesta una ola.

**`presupuesto: 0` no falla: corre sin limite.** Es el unico caso silencioso, y es
justo lo que escribe quien quiere decir "nada".

**`cwd` puede sacar al agente del repositorio.** Un `cwd: ".."` hace que las rutas
declaradas se resuelvan a `../src/x.mjs`, y ahi git no ve nada. El guardarrail de
rama, la revision de "fuera de ruta" y el aviso de sobrescritura dependen todos de
git: ninguno cubre eso. Es el unico de los tres con consecuencias que no se pueden
deshacer.

---

## Que es un valor valido

| Campo | Valido | Invalido |
|---|---|---|
| `presupuesto` | Numero mayor que cero. Omitido significa "sin tope" | `0`, negativos, `NaN`, `Infinity`, cualquier cosa que no sea `number`, incluida la cadena `"3"` |
| `modelo` | Cadena no vacia, sin espacios en blanco | Cadena vacia, cadena con espacios, y cualquier cosa que no sea `string` |
| `cwd` | Cadena no vacia con una ruta **relativa**, que resuelva **dentro de la raiz** y **exista** en disco | Cadena vacia, ruta absoluta, ruta que salga de la raiz, directorio que no existe, y cualquier cosa que no sea `string` |

Los tres siguen siendo opcionales. Omitirlos es valido y es lo normal: ninguno de
los bocetos del repositorio usa `modelo` ni `cwd`.

Tres decisiones que se tomaron a proposito y que conviene no revertir sin hablarlo:

**`presupuesto: 0` aborta en vez de significar "sin tope".** Quien quiera correr
sin limite omite el campo. Aceptar el `0` como "ilimitado" es exactamente el
malentendido que hoy hace dano.

**La cadena `"3"` tambien aborta.** Es un `number` o no es. Aceptar cadenas
numericas invita a `"3 dolares"` y a `"3,5"`.

**Vitral no valida que el modelo exista.** No puede: los nombres cambian con la
version del CLI y con el proveedor. Solo valida la forma; que el modelo exista lo
decide el CLI, que ademas falla rapido y barato.

---

## Donde va cada comprobacion

La separacion de `motor.md` se respeta, y aqui tiene una consecuencia concreta:

**`src/boceto.mjs` valida forma.** Tipo, rango y formato: lo que se puede decidir
mirando el valor y nada mas. Lanza `ErrorVitral`.

**`src/guardarrailes.mjs` juzga el entorno.** Si un directorio existe y si cae
dentro del repositorio no es forma: hace falta el disco y la raiz. Ademas
`leerBoceto(rutaBoceto)` **no recibe la raiz** y no podria resolverlo sin cambiarle
la firma. Devuelve veredictos.

Reparto exacto de las tres validaciones de `cwd`:

| Comprobacion | Donde | Como falla |
|---|---|---|
| Es cadena no vacia | `boceto.mjs` | `ErrorVitral` |
| Es relativa, no absoluta | `boceto.mjs` | `ErrorVitral` |
| Resuelve dentro de la raiz | `guardarrailes.mjs` | veredicto `aborta` |
| Existe en disco | `guardarrailes.mjs` | veredicto `aborta` |

---

## Los mensajes

Se fijan aqui porque los checks van a compararlos. Siguen el estilo de los que ya
hay en `boceto.mjs`: mensaje corto que nombra la tarea y el campo, y sugerencia
que dice como arreglarlo.

**Aviso sobre estos ejemplos:** estan escritos a mano porque las funciones todavia
no existen. En cuanto existan hay que regenerarlos llamando al codigo y
sustituirlos aqui, como manda `motor.md`. Mientras tanto, mandan estos.

### En `boceto.mjs`, con `ErrorVitral`

El valor invalido se muestra con `JSON.stringify`, como ya hace el mensaje de
`timeout`.

```
la tarea "backend" tiene un "presupuesto" invalido: 0.
        debe ser un numero de dolares mayor que cero; omite el campo para correr sin tope
```

```
la tarea "backend" tiene un "modelo" invalido: 123.
        debe ser una cadena sin espacios; omite el campo para usar el modelo por defecto
```

```
la tarea "backend" tiene un "cwd" invalido: "C:/otro".
        debe ser una ruta relativa no vacia, como "sub/modulo"
```

### En `guardarrailes.mjs`, con veredictos

Un veredicto por problema, no uno por tarea: si varias tareas fallan por lo mismo
se nombran todas en el mismo mensaje, como hace `revisarSolapamientos`.

```
vitral: el cwd de "backend" cae fuera del repositorio: ../otro-proyecto
        ahi git no ve nada, asi que no hay forma de revisar ni de deshacer lo que
        escriba el agente. Vitral no tiene otra red de seguridad.
```

```
vitral: el cwd de "backend" no existe: sub/que-no-esta
        creal antes de lanzar. Si no, el agente falla al arrancar con un ENOENT que
        parece culpa del CLI y no del boceto.
```

---

## Los bordes

Todos tienen que estar cubiertos. Un caso que el contrato no cubre lo resuelve
cada agente a su manera.

### `presupuesto`

| Valor | Resultado |
|---|---|
| omitido | valido: sin tope |
| `3`, `0.5`, `11` | valido |
| `0` | **aborta** |
| `-5` | **aborta** |
| `"3"`, `"tres"` | **aborta**: no es `number` |
| `[]`, `{}`, `true` | **aborta** |
| `null` | **aborta**: se distingue de omitido |
| `NaN`, `Infinity` | **aborta**: son `number`, pero no sirven como tope |
| `0.1` | valido, y el guardarrail de `PISO_PRESUPUESTO` sigue avisando como hoy |
| `3` en una tarea `opencode` | valido de forma, y el aviso de "no tiene tope de gasto" sigue como hoy |

### `modelo`

| Valor | Resultado |
|---|---|
| omitido | valido: el modelo por defecto del CLI |
| `"sonnet"`, `"anthropic/claude-sonnet-4-5"` | valido |
| `""` | **aborta** |
| `"   "` | **aborta** |
| `"claude sonnet"` | **aborta**: lleva espacio |
| `123`, `{}`, `null` | **aborta** |

### `cwd`

| Valor | Resultado |
|---|---|
| omitido | valido: la raiz |
| `"."` | valido: es la raiz, escrita a mano |
| `"sub"`, `"sub/modulo"` | valido si el directorio existe |
| `"sub/"` | valido: la barra final no molesta |
| `"sub/.."` | valido: relativo y resuelve dentro |
| `""` | **aborta** en `boceto.mjs` |
| `".."`, `"../otro"` | **aborta** en `guardarrailes.mjs`: sale de la raiz |
| `"C:/algo"`, `"/algo"` | **aborta** en `boceto.mjs`: es absoluta |
| `"sub/que-no-esta"` | **aborta** en `guardarrailes.mjs`: no existe |
| `123`, `null` | **aborta** en `boceto.mjs` |

Una ruta absoluta aborta **aunque apunte dentro del repositorio**: un boceto con
rutas absolutas solo funciona en un ordenador.

---

## Firmas nuevas

La unica funcion nueva. Ningun modulo expone nada mas.

### `src/guardarrailes.mjs`

```
revisarCwd(ejecutan, raiz) -> veredicto[]
```

Recibe las tareas que se van a ejecutar y la raiz del repositorio. Devuelve
veredictos `aborta` por los `cwd` que caen fuera de la raiz y por los que no
existen. Lista vacia si no hay nada que decir.

Para saber si un `cwd` cae dentro de la raiz vale la misma cuenta que ya usa
`normalizarRuta`: resolver contra la raiz y mirar si el resultado relativo empieza
por `..`.

### `vitral.mjs`

`revisarCwd` necesita un sitio donde llamarse. Va junto a las otras
comprobaciones previas, con el mismo patron:

```
if (resolver(guardarrailes.revisarCwd(ejecutan, raiz))) return 1;
```

Debe ir **antes de la cabecera y antes de la rama `--seco`**, donde ya esta
`revisarSolapamientos`, para que `--seco` lo cace gratis. Ninguna otra linea de
`vitral.mjs` cambia.

---

## Los checks

`pruebas/checks.mjs` pasa de doce a dieciseis. Los doce que hay **no se tocan**:
si alguno deja de pasar, es que algo se rompio.

| # | Que comprueba |
|---|---|
| 13 | Un `presupuesto` que no es numero mayor que cero aborta. Casos: `0`, `-5`, `"tres"`, `"3"` |
| 14 | Un `modelo` que no es cadena util aborta. Casos: `123`, `""`, `"con espacio"` |
| 15 | Un `cwd` fuera del repositorio o inexistente aborta. Casos: `".."`, `"sub/que-no-esta"`, `"C:/algo"` |
| 16 | Un boceto con los tres campos bien escritos **sigue pasando**. Caso: `presupuesto: 3`, `modelo: "sonnet"`, `cwd: "sub"` con el directorio creado |

El 16 importa tanto como los otros tres: una validacion nueva que rechaza lo que
antes funcionaba es peor que no tenerla.

Todos se comprueban con `--seco`, sin lanzar agentes, como los doce que ya hay.
Cada uno monta su escenario en el repositorio temporal que el script ya crea.

---

## Reparto y fronteras

Cinco tareas en tres olas.

| Ola | Tarea | Archivos | Que hace |
|---|---|---|---|
| 1 | `forma` | `src/boceto.mjs` | Valida la forma de los tres campos |
| 1 | `guardarrailes` | `src/guardarrailes.mjs`, `vitral.mjs` | `revisarCwd` y su llamada |
| 1 | `documentacion` | `README.md`, `.vitral/plomo/motor.md` | Que valores son validos, en las dos tablas de campos |
| 2 | `checks` | `pruebas/checks.mjs` | Los cuatro checks nuevos |
| 3 | `revision` | los seis archivos | Que todo encaje |

`checks` va en la ola 2 a proposito: en la ola 1 la validacion todavia no existe y
los checks nuevos no podrian ejecutarse. En la ola 2 se escriben viendo el codigo
de verdad y se corren antes de darlos por buenos.

`vitral.mjs` va con `guardarrailes` porque una funcion nueva de guardarrail no
sirve de nada sin su llamada, y esa llamada es una linea en `vitral.mjs`. Es el
mismo caso que `corrida.mjs` en la tanda del historial.

### Lo que no toca nadie en esta tanda

- `src/agentes.mjs`, `src/proceso.mjs`, `src/rutas.mjs`, `src/prompt.mjs`,
  `src/registro.mjs`, `src/salida.mjs`, `src/olas.mjs`, `src/errores.mjs`,
  `src/git.mjs`, `src/corrida.mjs`.
- `ejemplo/boceto.json` y `ejemplo/plomo/`. No hace falta: sus tres presupuestos
  ya son numeros validos y no usa `modelo` ni `cwd`.
- Los doce checks que ya existen.
- El `.gitignore`.
- Cualquier mensaje que ya salia por pantalla antes de esta tanda.

### Lo que no entra

- **No se toca `proceso.mjs`.** Hoy un `cwd` inexistente da un ENOENT que parece
  culpa del CLI, pero con el guardarrail nuevo la corrida aborta antes de llegar
  ahi. Arreglar tambien el mensaje seria tocar un modulo que nadie mas toca, por
  un camino que ya no se alcanza.
- **No se valida `necesita` como array.** Hoy un `"necesita": "backend"` itera la
  cadena letra a letra y da un mensaje confuso. Es un fallo real, pero es otro
  campo y otra tanda.
- **No se cambia `PISO_PRESUPUESTO` ni el aviso que ya existe.** Sigue avisando de
  los presupuestos por debajo de $0.25, que ahora seran siempre numeros validos.
