# Contrato · historial de corridas

Esta funcionalidad se reparte entre tres modulos que se escriben en paralelo. Lo
que sigue es lo que los tres necesitan compartir.

`.vitral/plomo/motor.md` tambien es obligatorio y no se repite aqui: las tres
invariantes, las formas ya existentes (`tarea`, `resultado`, `veredicto`, `plan`),
el grafo de dependencias y el reparto de responsabilidades por modulo siguen
valiendo tal cual. Si algo de aqui parece contradecirlo, manda `motor.md`.

---

## Que se quiere

Hoy, cuando termina una corrida, no queda constancia de que paso. Los logs de
`.vitral/logs/<id>.json` son por tarea y **se pisan en la corrida siguiente**: la
del martes borra la del lunes. No hay forma de responder a tres preguntas que se
hacen constantemente:

1. **Cuanto me costo esto.** El coste total de una corrida y el de cada tarea.
2. **Que tarea se me esta desbocando.** Cual tarda mas, da mas turnos, se corta
   por presupuesto o por tiempo, una y otra vez.
3. **Que cambio entre la corrida de ayer y la de hoy.** Que archivos toco cada
   una, sobre que rama, con que boceto.

El historial guarda una entrada por corrida y se consulta con una bandera.

---

## Decision 1: aclaracion sobre `state.json`

**`.vitral/state.json` no existe.** Nunca ha existido en Vitral. Lo que hay es
`.vitral/logs/<id>.json`, un archivo por tarea con la salida cruda, el prompt
entero y el JSON del agente. Eso es lo que se pisa en cada corrida.

Esos logs **se quedan como estan**. No se tocan, no se renombran, no se mueven.
Sirven para otra cosa: depurar *una* tarea concreta cuando algo falla, mirando su
prompt exacto y lo que devolvio el agente. Son grandes, se pisan, y esta bien que
se pisen.

El historial es un artefacto **nuevo y aparte**, que acumula en vez de pisar y que
guarda un resumen, no el detalle. Las dos cosas conviven y responden a preguntas
distintas: el log dice *que le paso a esta tarea*, el historial dice *que ha
pasado en este repositorio*.

---

## Decision 2: que se guarda de cada corrida

El criterio es duro: **si un campo no sirve para responder a una de las tres
preguntas de arriba, no entra.**

Lo que **no** se guarda, y por que:

| Fuera | Por que |
|---|---|
| `prompt` | Miles de bytes por tarea. Se reconstruye con `--seco` cuando haga falta |
| `crudo` | El JSON entero del agente. Es lo que ya guarda el log |
| `stderr` | Ruido. Solo interesa cuando algo falla, y entonces se mira el log |
| El array de `denegaciones` | Basta con cuantas hubo. El detalle esta en el log |
| El hash del commit | Habria que anadir una funcion a `git.mjs`, y `git.mjs` no lo toca nadie en esta tanda. Queda pendiente |

Lo que **si** se guarda esta abajo, campo por campo.

---

## El archivo

**Ruta:** `.vitral/historial.jsonl`

**Formato:** JSONL. Un objeto JSON por linea, sin comas, sin array que lo
envuelva. La corrida mas reciente es **la ultima linea**.

**Por que JSONL y no un `.json` con un array:** se escribe anadiendo una linea al
final. Una corrida que se interrumpa a la mitad puede dejar una linea rota, pero
no puede corromper las anteriores. Un array habria que releerlo, modificarlo y
reescribirlo entero en cada corrida, y ahi un fallo se lleva el historial
completo.

**Al leer, una linea que no parsee se ignora en silencio** y se sigue con las
demas. Es el precio de poder escribir anadiendo.

**Se ignora en git**, como los logs y los handoffs: es un artefacto de corridas,
no parte del proyecto.

---

## La forma de una corrida

Ejemplo completo de una linea, con los saltos puestos para que se lea (en el
archivo va en una sola linea):

```json
{
  "id": "20260819-143012",
  "fecha": "2026-08-19T18:30:12.482Z",
  "boceto": ".vitral/boceto.json",
  "nombre": "Modulo de estados de pedido",
  "rama": "feat/historial",
  "banderas": { "solo": "revision", "rehacer": false, "sinGit": false },
  "ok": false,
  "duracionMs": 84210,
  "costo": 0.6431,
  "olas": [2, 1],
  "tareas": [
    {
      "id": "backend",
      "agente": "claude",
      "modelo": null,
      "ok": true,
      "ms": 41200,
      "costo": 0.3104,
      "turnos": 14,
      "motivo": "success",
      "error": null,
      "denegaciones": 0,
      "sesion": "09514ae8-6238-4915-bc8b-50a8f48586c9"
    },
    {
      "id": "revision",
      "agente": "claude",
      "modelo": "sonnet",
      "ok": false,
      "ms": 4310,
      "costo": 0.0436,
      "turnos": 1,
      "motivo": "error_max_budget_usd",
      "error": "se acabo el presupuesto a mitad de camino: dejo trabajo escrito y no dejo handoff",
      "denegaciones": 0,
      "sesion": "1f2c9b40-7712-4c0a-9a51-2b6de0a1c934"
    }
  ],
  "saltadas": ["frontend"],
  "cambios": {
    "archivos": ["app/Controllers/PedidoEstadoController.php", "app/Models/Pedido.php"],
    "sinRastrear": 2,
    "fueraDeRuta": []
  }
}
```

Campo por campo:

| Campo | Que es |
|---|---|
| `id` | `AAAAMMDD-HHMMSS` en hora local, del momento en que arranco la corrida |
| `fecha` | La misma marca en ISO 8601 UTC, para ordenar sin ambiguedad |
| `boceto` | La ruta del boceto, tal como se paso |
| `nombre` | El `nombre` del boceto |
| `rama` | La rama, o `null` si se corrio sin git |
| `banderas` | Solo las que cambian que se ejecuta: `solo`, `rehacer`, `sinGit` |
| `ok` | `true` si todas las tareas que corrieron terminaron bien |
| `duracionMs` | De principio a fin de la corrida entera |
| `costo` | La suma de lo que costaron las tareas |
| `olas` | El tamano de cada ola, en orden: `[2, 1]` |
| `tareas` | Una entrada por tarea **que se ejecuto**, en el orden en que terminaron |
| `saltadas` | Ids de las que no se ejecutaron por tener handoff en disco |
| `cambios.archivos` | Rutas que la corrida toco, segun git |
| `cambios.sinRastrear` | Cuantas de esas eran archivos nuevos |
| `cambios.fueraDeRuta` | Las que cayeron fuera de las rutas declaradas |

Reglas que no se deducen del ejemplo:

- **`--seco` no guarda nada.** No hay corrida que registrar.
- **Una corrida fallida se guarda igual**, con `ok: false` y solo las tareas que
  llegaron a ejecutarse. Es justamente la corrida que mas interesa consultar
  despues.
- **Si no hay git**, `rama` es `null` y `cambios` va con los tres campos vacios
  (`[]`, `0`, `[]`). No se omite el objeto.
- **Si dos corridas caen en el mismo segundo** comparten `id`. No se corrige:
  `--historial <id>` muestra la mas reciente de las dos.

---

## Firmas nuevas

Estas son las unicas funciones nuevas. Ningun modulo expone nada mas: si expones
algo que nadie importa, sobra (`motor.md`).

### `src/registro.mjs`

```
guardarCorrida(raiz, corrida) -> string
```
Sella `id` y `fecha` (los pone el propio registro, no quien llama), anade una
linea a `.vitral/historial.jsonl` y devuelve el `id` asignado. Crea el archivo si
no existe. Recibe el objeto de arriba **sin** `id` ni `fecha`.

```
leerHistorial(raiz, limite = 10) -> corrida[]
```
Las ultimas `limite` corridas, **la mas reciente primero**. Devuelve `[]` si el
archivo no existe. Las lineas que no parseen se saltan.

```
leerCorrida(raiz, id) -> corrida | null
```
La corrida con ese `id`, o `null` si no hay ninguna. Si hay varias, la mas
reciente.

`registro.mjs` sigue siendo el unico modulo que sabe donde vive nada dentro de
`.vitral/`. La ruta del historial no se escribe en ningun otro archivo.

### `src/salida.mjs`

```
listaHistorial(corridas)
```
La tabla de corridas. Calcula el total a partir del array que recibe: no se le
pasan sumas ya hechas.

```
detalleCorrida(corrida)
```
El desglose de una corrida, tarea por tarea.

```
historialVacio()
```
Lo que se dice cuando todavia no hay ninguna corrida guardada.

Las tres reciben datos ya leidos. `salida.mjs` no abre el historial: no lee el
disco (`motor.md`).

### `src/corrida.mjs`

```
ejecutarOlas(plan) -> { costoTotal, fallidas, ola, resultados }
```
Un campo nuevo: `resultados`, un array plano de `{ tarea, resultado }` con
**todas** las tareas que se ejecutaron, no solo las fallidas. Los tres campos que
ya devolvia no cambian de forma ni de significado.

Sin esto, `vitral.mjs` no tiene de donde sacar el coste y los turnos de las
tareas que fueron bien. Por eso `src/corrida.mjs` entra en las rutas de la tarea
`entrada` y no en las de nadie mas.

---

## La bandera

```
--historial            las ultimas 10 corridas
--historial <n>        las ultimas <n>
--historial <id>       el detalle de esa corrida
```

**Como se distingue `<n>` de `<id>`:** si el argumento son solo digitos, es un
numero de corridas. Si no, es un id. No hay ambiguedad posible porque un id
siempre lleva un guion (`20260819-143012`), y un numero nunca.

Reglas de comportamiento:

- **Es una consulta, no una corrida.** No lee el boceto, no comprueba la rama, no
  toca el disco mas que para leer. Funciona en `main`, funciona sin repositorio
  git, funciona en un directorio sin `.vitral/boceto.json`.
- **Corta antes de los guardarrailes**, en el mismo sitio donde hoy corta
  `--ayuda`.
- **Sale con 0** siempre que pueda responder, aunque el historial este vacio.
- **Un `<id>` que no existe es un error de forma**: se lanza `ErrorVitral` con el
  id que se pidio y la sugerencia de listar con `--historial`. Sale con 1.
- No se combina con `--seco`, `--solo` ni `--rehacer`: si aparecen, se ignoran.
  Es una consulta.

Y una regla que importa mas que las otras:

- **Una corrida normal no dice nada nuevo en pantalla.** Guardar en el historial
  es silencioso. Ni una linea de mas en el resumen, ni un aviso, nada. La
  superficie actual del CLI no cambia: los once checks de regresion tienen que
  seguir pasando sin tocarlos, y varios comparan la salida entera.

`--historial` tambien se anade al texto de la ayuda, que vive en `salida.mjs`.

---

## Que se ve en pantalla

Los tres bloques de abajo **son la salida literal** de `listaHistorial`,
`detalleCorrida` e `historialVacio` con los datos del ejemplo de mas arriba: no
estan escritos a mano. Si tu implementacion no produce exactamente esto, la que
esta mal es tu implementacion.

Formato exacto. Las columnas se alinean con el id mas largo, como ya se hace con
los ids de tarea en la corrida.

### `--historial`

```

historial · 4 corridas · $2.1304

  20260819-143012  19-08 14:30  Modulo de estados de pedido  2 tareas  FALLO  1m 24s  $0.6431
  20260819-101245  19-08 10:12  Modulo de estados de pedido  3 tareas  ok     2m 03s  $0.8912
  20260818-174501  18-08 17:45  Historial de corridas        4 tareas  ok     3m 11s  $0.5961
  20260818-093322  18-08 09:33  Historial de corridas        1 tarea   FALLO  12s     $0.0000

```

- Linea en blanco antes y despues, como la cabecera de una corrida.
- `ok` en verde, `FALLO` en rojo, igual que en el cierre de una tarea.
- `N tareas` cuenta las ejecutadas, no las saltadas. En singular cuando es una.
- El total del encabezado es la suma de las corridas listadas, no de todo el
  archivo. Se dice "4 corridas" porque son las que se ven.

### `--historial <id>`

```

corrida 20260819-143012
  fecha         19-08 14:30
  boceto        .vitral/boceto.json · Modulo de estados de pedido
  rama          feat/historial
  banderas      --solo revision
  olas          2 -> 1
  estado        FALLO  1m 24s  $0.6431

  tareas
    backend   claude  ok     41s  $0.3104  14 turnos
    revision  claude  FALLO  4s   $0.0436   1 turnos
              se acabo el presupuesto a mitad de camino: dejo trabajo escrito y no dejo handoff

  saltadas      frontend
  cambios       2 archivos, 2 sin rastrear
  fuera de ruta nada

```

- Las etiquetas de la izquierda se alinean a 14, como en el resumen de una
  corrida.
- El `error` de una tarea fallida va en su propia linea, debajo, en rojo. Si la
  tarea fue bien no sale nada.
- `banderas` muestra solo las que estaban puestas, con su forma de CLI
  (`--solo revision`, `--rehacer`, `--sin-git`). Si no habia ninguna, `ninguna`.
- `saltadas` lista los ids separados por coma, o `ninguna`.
- `rama` dice `sin git` cuando es `null`.

### Historial vacio

```

historial · todavia no hay ninguna corrida guardada
se guarda una entrada cada vez que termina una corrida real, no en --seco

```

---

## Reparto y fronteras

Tres tareas en paralelo, una por archivo. Ninguna toca el archivo de otra.

| Tarea | Archivos | Que hace |
|---|---|---|
| `persistencia` | `src/registro.mjs` | Las tres funciones de guardar y leer |
| `presentacion` | `src/salida.mjs` | Las tres funciones que pintan, y la ayuda |
| `entrada` | `vitral.mjs`, `src/corrida.mjs` | La bandera, el pegamento y `resultados` |

Cada uno programa contra las firmas de arriba aunque las otras dos mitades no
existan todavia. `presentacion` no espera a que haya datos reales: pinta lo que
recibe. `entrada` llama a funciones que aun no estan escritas.

Lo que **nadie** toca en esta tanda:

- `src/git.mjs`, `src/boceto.mjs`, `src/olas.mjs`, `src/rutas.mjs`,
  `src/prompt.mjs`, `src/proceso.mjs`, `src/agentes.mjs`, `src/errores.mjs`.
- El `.gitignore`. La linea de `.vitral/historial.jsonl` ya esta puesta.
- Los once checks de regresion.
- Cualquier texto que ya salia por pantalla antes de esta funcionalidad.
