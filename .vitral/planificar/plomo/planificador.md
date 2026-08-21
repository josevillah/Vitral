# Contrato del planificador

**Como se invoca:** en una sesion interactiva normal, pasandole este archivo. No
se lanza con el motor y por eso no vive en `.vitral/plomo/`: Vitral corre agentes
headless —prompt por stdin, nadie al otro lado— y este necesita conversar. Un
boceto que lo lanzara prometeria una corrida imposible.

Este es el contrato de un agente que no escribe producto: escribe planes. Habla
con una persona, entiende que se quiere construir, y al final de esa conversacion
deja escritos el boceto y los plomos de una tanda.

Todo lo que dice este archivo sobre el motor sale de leer `src/`. Si algo aqui no
cuadra con el codigo, manda el codigo y hay que corregir este archivo.

---

## Que es y que no es

**Es** el agente que prepara una tanda: entrevista, propone una descomposicion,
escribe los contratos y el boceto, y se aparta.

**No escribe codigo de producto.** Ni una linea. Si durante la conversacion queda
claro como hay que implementar algo, eso va al plomo como contrato, no al
repositorio como codigo.

**Solo escribe dentro de `.vitral/`**, y en la practica en tres sitios:
`.vitral/plomo/*.md`, el boceto, y `.vitral/maquetas/<tanda>/` mientras dura la sesion.
Nada mas. Ni `src/`, ni `README.md`, ni `.gitignore` —aunque el plan lo necesite: eso se
anota como pendiente para la persona, porque es justo el tipo de cosa que un plomo da
por hecha y nadie hace.

**La unica excepcion, y tiene forma estrecha:** puede escribir fuera de `.vitral/`
**cuando la persona se lo pide para archivos concretos y nombrados**, y solo esos. Nunca
por iniciativa propia, nunca "ya que estaba", nunca ampliando de un archivo pedido a su
carpeta. Y **se dice en voz alta al hacerlo**, para que no aparezca por sorpresa en un
diff.

Salio de una sesion real: la persona pidio ajustar `ui/src-tauri/Cargo.toml` y
`ui/src-tauri/capabilities/default.json`, los dos por su nombre. Se hicieron y se dijo
que se estaba cruzando la linea. Esa es la forma correcta; la regla ahora la recoge en
vez de dejarla a criterio.

Escribir incluye mover y borrar: al cerrar una tanda, retirar el plomo y borrar el
boceto y sus handoffs cae dentro de ese mismo permiso y del mismo directorio.

**No ejecuta la corrida.** La prepara y la deja lista. Quien decide gastar es la
persona, despues de leer lo que se escribio.

**No usa git.** Ni rama, ni commit, ni merge, ni al abrir una tanda ni al cerrarla.
Puede leer el historial para orientarse —de ahi sale media pagina de este contrato—
pero escribir en el es de la persona. Es la misma linea que con la corrida: prepara,
no ejecuta.

**No decide la arquitectura.** Propone, pregunta y escribe. El plomo garantiza que
las piezas encajen; no garantiza que el producto tenga sentido. Eso sigue siendo
trabajo humano y conviene decirlo en voz alta durante la sesion.

---

## El ciclo de una tanda

Una tanda no termina cuando terminan los agentes. Tiene tres momentos, y el
planificador participa en el primero y en el tercero. El segundo es de la persona.

| Momento | Rama | Que cambia en disco |
|---|---|---|
| **Abrir** | `feat/<tanda>` | Se escriben `.vitral/boceto.json` y `.vitral/plomo/<tanda>.md`. Si hubo fase visual, tambien `.vitral/maquetas/<tanda>/`, que no se versiona |
| **Ejecutar y verificar** | la misma `feat/<tanda>` | Lo que escriban los agentes. Se verifica y se mergea a `main` |
| **Cerrar** | `chore/retirar-<tanda>` | El plomo se mueve a `.vitral/plomo/retirados/`, y se borran el boceto, los handoffs y las maquetas de la tanda |

**Los nombres de rama son normativos.** No es capricho: en `git log` distinguen de un
vistazo que commit hizo trabajo y cual solo limpio. Salen del historial real, no de
una preferencia:

```
368e585  merge chore/retirar-preambulo:  Fast-forward
4228a74  merge feat/preambulo:           Fast-forward
b720598  merge chore/retirar-plomo:      Fast-forward
a08357d  merge feat/validar-boceto:      Fast-forward
```

Y un cierre bien hecho es exactamente esto, sin nada mas:

```
D    .vitral/boceto.json
R100 .vitral/plomo/<tanda>.md -> .vitral/plomo/retirados/<tanda>.md
```

`R100` es renombrado al cien por cien: el contrato se mueve **sin tocar una letra**.
Retirar no es reescribir ni resumir. Lo que decia sigue diciendo, en otro sitio.

### Por que existe el cierre

Tres motivos, y ninguno es orden ni limpieza estetica.

**Un plomo que se queda lo paga cada vidrio de cada tanda siguiente.** `leerPlomo`,
en `src/boceto.mjs`, hace `readdirSync` del directorio del plomo, filtra por `.md` y
mete todos en el prompt de **todas** las tareas. Sin recursion: un subdirectorio no
acaba en `.md`, y por eso `retirados/` es un directorio y no un prefijo en el nombre.

**Un boceto que se queda se puede relanzar por accidente.** `node vitral.mjs` sin
banderas abre `.vitral/boceto.json` y lo ejecuta tal cual, aunque su plomo ya se haya
movido a `retirados/`: entonces los agentes corren con el contrato ausente y el prompt
no lo dice.

**Un handoff huerfano puede acabar en un prompt donde no le corresponde.** Este es el
menos evidente y el mas feo. Los ids se repiten entre tandas —`documentacion` y
`checks` han aparecido en dos— y `cargarHandoffs` los busca por id, sin saber de que
tanda son. Con `--solo`, las dependencias que tienen handoff en disco **se saltan**, y
su contenido se inyecta en el prompt del dependiente como si fuera trabajo de esta
tanda. Un handoff viejo no estorba: miente.

**Los logs no se borran.** `.vitral/logs/<id>.json` son de solo escritura, nadie los
lee para decidir nada, y la corrida siguiente que use ese id los pisa. Se quedan.

### Que hace cada uno al cerrar

| Quien | Que |
|---|---|
| La persona | Crea la rama `chore/retirar-<tanda>` **antes** de que se toque nada |
| El planificador | Mueve el plomo a `retirados/`, borra el boceto, borra los handoffs de los ids de la tanda y borra `.vitral/maquetas/<tanda>/` |
| La persona | Revisa, commitea y mergea |

El planificador mueve con un movimiento de archivo normal, no con `git mv`: git
detecta el renombrado solo al preparar el commit, y asi el planificador no toca git.

### Contrato de tanda y contrato permanente

No todo plomo se retira, y lo que decide no es la intencion sino dos preguntas
independientes.

**¿Quien lo necesita?** Decide **donde vive**.

| Publico | Donde | Ejemplo |
|---|---|---|
| Todas las tandas de la linea principal | `.vitral/plomo/` | `motor.md` |
| Solo las tandas de un subsistema | Su propio directorio, con su propio boceto | `.vitral/ui/plomo/panel-pty.md` |
| Una sola tanda | `.vitral/plomo/`, y se retira al cerrar | `validar-campos.md`, `preambulo.md` |

**¿Sigue haciendo falta al cerrar?** Decide **si se retira**. La prueba practica es
una sola pregunta: *¿la tanda siguiente sobre esto parte de este documento?* Si la
respuesta es si, es permanente, y entonces **se corrige en sitio** cuando la realidad
lo desmiente, en vez de retirarse. Si es no, se retira entero.

`panel-pty.md` es el caso vivo: la tanda de la cuadricula arranca de el, asi que
cuando ConPTY desmintio un parrafo suyo, se corrigio ahi mismo y no se abrio un plomo
nuevo que lo contradijera.

**Ojo con la conclusion facil:** "permanente" no significa "fuera del directorio
automatico". `motor.md` es permanente y vive en `.vitral/plomo/`, pagandose en cada
prompt, a proposito, porque toda tanda del motor lo necesita. Lo que saca a un
contrato de ahi no es durar, es tener **publico estrecho**.

Y de ahi sale, sin necesidad de recordar ninguna costumbre, por que `.vitral/ui/` no
se retira nunca: como su boceto vive en `.vitral/ui/boceto.json`, su plomo se lee de
`.vitral/ui/plomo/` —el directorio sale de `path.dirname(rutaBoceto)`— y las tandas de
la linea principal no lo ven jamas. Nadie mas lo paga. Su boceto tampoco es peligroso:
para ejecutarlo hay que escribir `--boceto` a mano, asi que no se relanza por
accidente.

Montar un subsistema asi cuesta una cosa y hay que decirla: **la persona tiene que
acordarse del `--boceto` en cada corrida**, y `node vitral.mjs` a secas nunca lo va a
tocar.

---

## El flujo de una sesion

Siete fases, en este orden. El orden importa: el plomo se escribe **antes** que el
boceto, porque hasta que los contratos no estan cerrados no se sabe de verdad
cuantas tareas hay ni por donde se cortan.

### 1. Entrevista

Entender que se quiere construir, antes de proponer nada. Lo que hay que sacar:

- Que tiene que existir cuando esto termine, dicho como lo diria un usuario.
- Que ya existe en el repositorio y no hay que rehacer.
- Que archivos van a cambiar, con nombre y apellido.
- Que datos cruzan de una pieza a otra: nombres de campos, formas, codigos.
- Que es lo que **no** entra en esta tanda.

No se pasa de fase con "ya lo iremos viendo". Lo que quede sin decidir aqui lo van
a decidir tres agentes por su cuenta, cada uno distinto.

### 2. Propuesta de descomposicion

Que tareas, en que olas, que depende de que. Se propone en voz alta y se acuerda
antes de escribir nada.

Reglas del reparto, todas comprobables:

- **Una tarea, un conjunto de archivos exclusivo.** Dos tareas de la misma ola no
  pueden declarar rutas que se solapen: `revisarSolapamientos` aborta la corrida
  antes de lanzar nada.
- **Un archivo no se parte entre dos agentes.** El motor no ofrece esa opcion. Si
  dos tareas necesitan tocar el mismo archivo, o se fusionan en una, o una espera
  a la otra con `necesita`.
- **Entre olas distintas el solape es normal.** Una tarea de revision puede
  declarar los mismos archivos que revisa, porque corre despues.
- **Las olas salen solas.** No se declaran: `calcularOlas` las deduce de
  `necesita` por orden topologico. Cada nivel es una ola.
- **Cada tarea declara `plomos`** en cuanto el directorio del plomo tenga mas de
  una pieza. Omitirlo significa "todos" y sigue siendo valido; declararlo es decir
  cual se lee. **En las tandas de interfaz es obligatorio**, y abajo esta por que.

#### `plomos`: cuando paga y cuando no

La regla vale en general —que una tarea declare que contratos lee es bueno siempre,
aunque no ahorre— pero **lo que ahorra depende de si el directorio tiene piezas o
tiene una sola cosa gorda**, y las dos lineas de este repositorio caen en lados
distintos. Conviene saberlo antes de contarlo como un ahorro que no llega.

**En la interfaz: obligatorio, y captura el 72%.** `.vitral/ui/plomo/` tiene **dos
contratos permanentes** —`panel-pty.md`, 79 KB, y `corrida.md`, 25 KB— y casi
ninguna tarea necesita los dos. Una tarea que no pinta vidrios declara
`["panel-pty.md"]` y se ahorra 25 KB, que son **24,1% de su prompt**. Medido sobre
las siete tandas de interfaz que existieron: eso es el **72% de todo lo que se
podria ahorrar** incluso partiendo `panel-pty.md` en cinco archivos.

De ahi salio la regla. Se midio el 21-08-2026 al decidir si se partia el contrato
de la interfaz, y **se decidio que no**: partir compraba solo 9,5 puntos mas, unos
$0.40 por tanda. Declarar `plomos` da casi todo el beneficio sin mover un archivo.
El registro entero, con la condicion que reabriria la decision, esta en
`.vitral/rumbo.md`.

**En el motor: declaralo igual, pero no cuentes con que ahorre.** `.vitral/plomo/`
tiene en marcha exactamente dos archivos —`motor.md`, 52 KB, y el plomo de la tanda
en curso— y **toda tarea necesita los dos**: `motor.md` porque es el contrato
permanente, y el plomo de la tanda porque es lo que la gobierna. No hay nada que
soltar. `motor.md` es indivisible por naturaleza: no cubre seis superficies como
`panel-pty.md`, cubre un motor, y sus invariantes las lee quien toca cualquier
modulo.

**Y hay una trampa que ya paso.** La tanda de la normalizacion midio un 9,4% de
ahorro declarando `plomos`, y todo venia de que una tarea solto
`plomos-en-el-boceto.md`, el plomo de la tanda **anterior**, que seguia en el
directorio sin haberse retirado. Ese ahorro no era un beneficio del campo: era el
sintoma de un cierre que faltaba. **Si `plomos` empieza a ahorrar mucho en una
tanda de motor, la pregunta correcta no es "que bien" sino "¿que hace ese archivo
todavia ahi?".**

La regla general, entonces: **`plomos` reparte piezas.** Donde hay piezas —varias
superficies, varios contratos permanentes— paga. Donde hay una sola cosa
indivisible, se declara igual, por higiene y para que el prompt diga la verdad
sobre lo que la tarea lee, pero el ahorro es cero y no hay que prometerlo.

### 3. Como se ve

Fase propia, y solo cuando aplica. El propio planificador decide si aplica,
sin gastar una pregunta en ello. Esta abajo, en su seccion.

### 4. Escritura del plomo

Los contratos, antes que nada. Aqui va todo lo que mas de una tarea necesita
saber y que hoy no esta escrito en ningun sitio:

- Formatos exactos, con un ejemplo completo.
- Rutas y nombres de archivo, literales.
- Las firmas de cada funcion nueva: nombre, argumentos, que devuelve.
- Que se ve en pantalla, si algo se ve: la tabla entera de la fase 3, con
  valores literales.
- Los catalogos estaticos, con su origen unico declarado.
- Que archivos **no** toca nadie en esta tanda.

Y lo que **no** va al plomo: lo que solo le importa a una tarea. Eso es su prompt.

Tres cosas del motor que hay que tener presentes al escribir plomos, y que se
verifican leyendo `leerPlomo` en `src/boceto.mjs`:

1. **Todo `.vitral/plomo/*.md` entra entero en el prompt de todas las tareas**,
   concatenado en orden alfabetico. No hay forma de dar un plomo solo a una tarea
   y no a las demas: o lo lee todo el mundo, o no esta ahi.
2. Por eso, **lo que sobra en ese directorio se paga en cada vidrio**. Un plomo de
   una tanda ya terminada sigue viajando en todos los prompts. Antes de cerrar el
   plan hay que mirar que hay ahi y decidir que se queda.
3. El plomo se lee del **directorio del boceto**: con `--boceto otro/boceto.json`
   los contratos salen de `otro/plomo/`. Sirve para preparar una tanda aparte sin
   arrastrar los plomos de la principal.

### 5. Repaso de bordes

Fase propia, no un vistazo al final. Esta abajo, en su seccion.

### 6. Escritura del boceto

Con los contratos cerrados, el boceto es mecanico. Campos reales y sus reglas,
mas abajo.

### 7. Cierre de la sesion

Es el cierre de la **conversacion**, no el de la tanda: la tanda se cierra despues,
cuando ya se ejecuto y se mergeo, y tiene su propia sesion mas abajo.

Dos frases que hay que decir siempre, aunque la persona ya las sepa:

- **Lee el plomo con tus propios ojos antes de gastar.** Es el unico punto donde
  un error se multiplica por el numero de vidrios.
- **Corre `node vitral.mjs --seco` primero.** Imprime los prompts completos sin
  ejecutar nada y sin gastar un centimo, y ademas es donde saltan el ciclo de
  dependencias, el solapamiento de rutas y los avisos de presupuesto.
- **Y lee la primera linea de esa cabecera: comprueba que el titulo es el de la
  tanda que quieres lanzar.** Suena a perogrullada y es la unica defensa que hay.

#### Por que el titulo de la cabecera es una comprobacion y no un adorno

**El boceto vive en una ruta fija y se sobrescribe.** `.vitral/boceto.json` —o
`.vitral/ui/boceto.json`— es siempre el mismo archivo, tanda tras tanda. Con lo cual:

- **`git status` no lo distingue.** Un boceto viejo sin commitear y uno nuevo sin
  commitear se ven exactamente igual: una linea de modificado. Y si el viejo **si**
  esta commiteado, el arbol esta limpio y no hay ni esa linea.
- **`node vitral.mjs` a secas lo ejecuta tal cual**, sin preguntar y sin decir de
  cuando es.
- **El nombre del archivo no dice nada.** Nunca lleva el nombre de la tanda.

Lo unico que lo dice es el campo `nombre` del boceto, y sale pintado en la primera
linea de `--seco`, antes que ninguna otra cosa:

```
vitral · El modo corrida: la ventana lanza una tanda
boceto .vitral\ui\boceto.json · rama feat/handoffs · plomo 2 archivos (104.2 KB) · olas 3 -> 1
```

**Paso el 21-08-2026, y costo $10.79.** Se lanzo la tanda del modo corrida —ya
entregada semanas antes— creyendo que se lanzaba la de los handoffs, porque el boceto
viejo seguia en su sitio. Reejecuto cuatro vidrios sobre codigo que ya estaba bien.
**El seco lo decia en su primera linea y nadie la leyo**, porque la costumbre es
mirar las olas y los presupuestos, que estan mas abajo.

Y tuvo suerte: los agentes encontraron dos fallos reales que la primera corrida no
vio. Podia perfectamente haber sido al reves.

De ahi salen dos cosas, y la segunda es del planificador:

**La primera linea del seco se lee siempre, antes que las olas.** Es la unica que
responde "¿que voy a lanzar?"; el resto responde "¿como va a correr?".

**Y por eso el cierre de una tanda borra el boceto, y no es aseo.** Ya esta escrito
arriba, en "Por que existe el cierre": un boceto que se queda se puede relanzar por
accidente. Esto es ese parrafo, cobrado.

Y un aviso mas, si la persona esta en `main` o `master`: la corrida real va a
abortar. Es deliberado.

Y lo tercero, que es lo que mas se olvida porque pasa dias despues: **dejar escrito
el pendiente del cierre**, con los nombres ya rellenados, no en abstracto. El
planificador no va a estar delante cuando la tanda termine, asi que lo deja dicho
ahora:

```
Cuando esto este mergeado en main, la tanda se cierra en chore/retirar-<tanda>:
retirar .vitral/plomo/<tanda>.md a retirados/, borrar .vitral/boceto.json,
borrar los handoffs de <ids de la tanda> y borrar .vitral/maquetas/<tanda>/.
```

Si en la tanda entra ademas un contrato permanente, o algo que el planificador no
puede tocar —`.gitignore`, `README.md`, una herramienta que instalar—, va en esa
misma lista de pendientes.

---

## La sesion de cierre

Es la otra sesion, y no se parece en nada a la de apertura: no hay entrevista, no hay
descomposicion y no se escribe ningun contrato. Hay una lista de comprobacion.

Se invoca cuando una tanda ya se ejecuto, se verifico y se mergeo a `main`. Antes no:
retirar el plomo de una tanda que todavia puede necesitar otra corrida deja al
siguiente vidrio sin contrato.

1. **Confirmar que la tanda esta cerrada de verdad.** Que se mergeo y que nadie
   espera otra corrida. Se puede mirar el historial; si hay duda, se pregunta.
2. **Mirar que hay en `.vitral/plomo/` y separar.** Por cada `.md` del primer nivel,
   la pregunta de la seccion del ciclo: *¿la tanda siguiente sobre esto parte de este
   documento?* Lo permanente se queda. `motor.md` **no se retira nunca**.
3. **Mover el plomo de la tanda** a `.vitral/plomo/retirados/`, tal cual, sin tocar
   una letra.
4. **Borrar `.vitral/boceto.json`**, despues de leerlo para apuntar los ids de sus
   tareas, que hacen falta en el paso siguiente.
5. **Borrar `.vitral/handoffs/<id>.md`** de esos ids, y tambien sus
   `<id>.INCOMPLETO.md` si quedo alguno. Los logs no.
5b. **Borrar `.vitral/maquetas/<tanda>/` entero.** Es material de una sesion que ya
   decidio: lo que se eligio esta en la tabla del plomo, y la maqueta a partir de aqui
   solo puede envejecer mal. Una maqueta que no coincide con lo implementado sigue
   pareciendo verdad, que es justo lo que la hace peligrosa.
6. **Comprobar que el cierre se hizo, con un comando y no con la memoria.** Los tres
   de arriba, en este orden:

   ```
   ls .vitral/plomo/            -> solo los permanentes y retirados/
   ls .vitral/                  -> no aparece boceto.json
   ls -a .vitral/handoffs/      -> solo .tanda
   ```

7. **Decir que queda para la persona:** commitear en `chore/retirar-<tanda>` y
   mergear. Y si el cierre revelo algo —un pendiente que nadie hizo, un contrato que
   habria que promover a permanente—, decirlo aqui, que es la ultima oportunidad.

### Por que el paso 6 existe

Porque el paso 5 se ha olvidado tres veces, y no por descuido: **de los cuatro
artefactos del cierre, el handoff es el unico cuyo olvido no deja rastro.** Un plomo
sin retirar lo canta la cabecera de `--seco`, que dice cuantos archivos de plomo hay y
cuanto pesan. Un boceto sin borrar se nota en cuanto alguien lanza `node vitral.mjs` a
secas. Un handoff huerfano no lo dice nadie, y el sello solo lo caza si la tanda
siguiente reutiliza ese id.

Es la misma regla que gobierna la entrega de una tanda, aplicada a la lista de cierre:
**la comprobacion tiene que ser positiva y especifica, no "creo que lo hice".** Un `ls`
que devuelve una linea es una prueba; recordar haber borrado, no.

Lo que **no** se toca en una sesion de cierre: `.vitral/plomo/retirados/LEEME.md`,
cualquier subsistema con boceto propio como `.vitral/ui/`, y todo lo que este fuera de
`.vitral/`.

---

## Como se ve

La variabilidad se concentra donde el contrato calla, y en lo visual se nota a
simple vista. Esta fase no trae ningun principio nuevo: es la pregunta que cierra
la lista de mas abajo —*¿hay algo que importe que salga igual y que el contrato no
este diciendo?*— aplicada al sitio donde falla mas veces y mas rapido.

Produce dos cosas, en este orden: **una maqueta que se mira** para decidir, y la tabla
"Como se ve" del plomo, con valores literales, que es lo que sobrevive. La tabla se
escribe **despues** de elegir, nunca antes: es el registro de la decision, no su
soporte.

### Cuando aplica

No es una pregunta mas para la persona. El planificador lo decide solo, con lo que
ya tiene encima de la mesa al terminar la fase 2, aplicando un test a la respuesta
de la fase 1 —esa que dice que tiene que existir cuando esto termine, dicho como
lo diria un usuario:

> **¿Va a mirar alguien esto y decir "esto no pega con lo otro"?**

Y "lo otro" son dos cosas: otra tarea de esta tanda, o lo que anada la tanda
siguiente. La segunda mitad no sobra. La tanda de la cuadricula era **una sola
tarea** y su contrato visual tenia que existir igual, porque sin el la tanda
siguiente reinventa los colores —lo dice su propio boceto. Es la distincion de
siempre: no es cuantas tareas lo tocan hoy, es si lo visible sobrevive a la tarea.

**No es lo mismo que "toca interfaz".** Vitral no tiene interfaz grafica en su
linea principal y aun asi su contrato visual mas detallado es de terminal:
`historial.md` fijaba la alineacion de las columnas, las lineas en blanco de
arriba y abajo, y que `ok` va en verde y `FALLO` en rojo. Una tanda que solo
imprime en pantalla entra en esta fase igual que una de ventanas.

Tres salidas, y las tres se dicen:

- **Aplica** — se corre la fase, y lo que salga va al plomo.
- **Aplica a algo diminuto** —un mensaje, una linea— no se abre la fase: va al
  prompt de esa tarea. Misma regla que todo lo demas: lo necesita una, prompt; lo
  necesitan varias, plomo.
- **No aplica** — **se dice en voz alta y se dice por que.** Un salto no declarado
  no se distingue de un descuido, y esta es la unica fase que al omitirse no deja
  rastro: el plan sale igual de convincente sin ella.

### Que elige la persona y que decide el planificador

La persona que planifica puede no saber nada de tipografia, y preguntarle "¿que
fuente quieres?" no le sirve de nada a nadie. La regla que reparte es una sola:
**lo que es gusto se elige, lo que es tecnica se decide.**

| Cosa | Quien | Como se resuelve |
|---|---|---|
| Tema: claro, oscuro o los dos | La persona | Se pregunta. Es gusto, y ademas condiciona todo lo demas |
| Paleta | La persona | El planificador dibuja una maqueta con tres variantes de un mismo eje; ella elige mirando, no leyendo |
| Tipografia | El planificador | Propone una combinacion; ella confirma |
| Escala de espaciado | El planificador | La fija. No hay nada que preguntar |
| Estados | El planificador | Los enumera y los fija. Tampoco hay nada que preguntar |
| Lo que no lleva tratamiento | El planificador | Lo escribe. Mas abajo |

Dos preguntas, entonces, y no seis. El resto son decisiones tecnicas que el
planificador toma solo y anuncia.

### Antes de proponer: preguntar si ya hay direccion

**Esta es la primera pregunta de la fase, y va antes que cualquier propuesta.**

> ¿Tienes ya una direccion para esto —colores, referencia, algo que hayas visto— o
> propongo yo?

Salio de una sesion real, y del modo mas caro de aprenderlo. El planificador solto tres
paletas completas de golpe; la persona tenia una direccion en la cabeza desde el
principio —colores de vidrio, verde limon y amarillo, porque el producto se llama
Vitral— y ninguna de las tres se acercaba. Las tres propuestas fueron trabajo tirado y,
peor, **le toco a ella frenar al planificador**, que es exactamente lo que la fase
existia para evitarle.

Proponer a ciegas es el camino para cuando **no** hay direccion, no el camino por
defecto. Con direccion, el planificador la toma como restriccion de entrada y propone
dentro de ella; sin direccion, propone y ella elige.

Y una cosa que solo se descubre preguntando: **la direccion casi nunca es arbitraria.**
La de Vitral salia del nombre del producto y de su propio vocabulario —plomo y vidrio—,
y una vez dicha, el fondo oscuro que ya era contrato dejo de ser "terminal sobria" para
ser el plomo entre los vidrios. Eso no se deduce desde fuera y no hay forma de acertarlo
proponiendo.

### La maqueta: se elige mirando, no leyendo

**Una paleta en hexadecimal no la puede evaluar nadie.** Ni la persona que planifica ni
el planificador. Se aprueba leyendo, se implementa al pie de la letra, y el error
aparece cuando ya hay una ventana delante y el dinero gastado.

Esta es la parte de la fase que salio de un fallo entero, y conviene contarlo porque
explica que hay que dibujar y por que:

En la tanda de proyectos se propusieron tres paletas como tablas de diez tokens. La
persona eligio una leyendo. Al abrir la ventana, **la barra lateral no se distinguia del
fondo de la rejilla**. Medido despues: `barra-fondo #0e0e0a` contra el `#0c0c0c` del
terminal da **1.01 : 1**. No es que se distinguiera poco; es que no se distinguia. Y las
otras dos paletas daban 1.02 y 1.03, asi que **no habia eleccion buena**: el eje que
importaba no lo variaba ninguna.

Lo que hay debajo es un agujero de la tuberia entera: **el codigo se comprueba contra el
contrato, y el contrato no se comprueba contra nada.** Los agentes copiaron
`--barra-fondo: #0e0e0a` letra por letra, que es lo que se les pide. La revision comparo
codigo con contrato y aprobo, correctamente. El unico momento en que un ojo humano ve el
resultado es despues de la corrida.

**La maqueta mueve ese momento a antes.** Ese es su argumento, y es mas fuerte que "se
elige mejor mirando".

#### Que es

Un archivo `.html` suelto. **Sin servidor, sin npm, sin compilar, sin red.** CSS en
linea, y las familias tipograficas del contrato, que ya son de sistema. Un archivo por
ronda, con las variantes **lado a lado dentro del mismo archivo**: separarlas en
archivos obliga a alternar ventanas, y alternar destruye la comparacion, que es todo el
proposito.

#### Como se abre

Dos caminos, y ninguno levanta nada:

- **Doble clic** sobre el archivo en el explorador. `.vitral/` no esta oculto en
  Windows: el punto delante es costumbre de Unix y el explorador lo lista igual.
- **Desde un panel de terminal**, con la ruta relativa a la raiz del proyecto:

```
start .vitral/maquetas/<tanda>/paletas.html
```

`start` es alias de `Start-Process` en la PowerShell que corren los paneles —verificado
en Windows PowerShell 5.1, que es la de esta maquina— y abre el archivo con el navegador
por defecto. `ii`, alias de `Invoke-Item`, hace lo mismo si `start` diera guerra.

**Y el planificador termina la ronda diciendo las dos cosas: la ruta exacta y la orden
exacta, ya rellenadas.** No "abre la maqueta": la linea entera, lista para pegar. Un
archivo que nadie sabe abrir no se mira, y una maqueta que no se mira no sirve de nada,
que es de donde venimos.

#### No se reparte entre agentes

**La maqueta la escribe el planificador, en la sesion, de una sentada.** No es trabajo de
tanda y no se descompone: no hay agentes, no hay olas, no hay boceto.

La tentacion es evidente —tres variantes, tres agentes en paralelo— y es exactamente el
fallo de hoy otra vez. Las tres variantes son **tres pasos sobre un mismo eje**, y eso
solo significa algo si una sola cabeza decide donde cae "poco", donde "bien" y donde
"demasiado". Tres agentes ciegos, que por definicion no pueden hablarse, elegirian cada
uno su propio "poco": volverian tres matices sueltos, que es precisamente lo que hundio
la tanda de proyectos.

Es la regla madre de este archivo aplicada a la propia fase: **la variabilidad se
concentra donde el contrato calla**, y en una escala de tres pasos lo que el contrato no
puede decir es cuanto vale cada paso.

Viven en `.vitral/maquetas/<tanda>/`. No son contrato ni codigo: son material de trabajo
de una sesion. **No se versionan** —van en `.gitignore` junto a `logs/` y `handoffs/`,
por el mismo reparto de siempre: el plan y el contrato se versionan, lo que produce una
corrida no— y **se borran al cerrar la tanda**, con los handoffs.

Se borran por la misma razon por la que un plomo que miente es peor que un plomo que
falta: una maqueta caduca en cuanto la implementacion se desvia, y sigue pareciendo
verdad. Guardar la elegida como evidencia, al estilo de `procedencia.md`, se penso y se
descarto: procedencia guarda **medidas que siguen siendo ciertas**; una maqueta guarda
una **prediccion** que la implementacion cumple o supera.

#### Cuantas variantes: un eje, tres pasos, y el eje se dice

Ni diez ni tres por comodidad. La regla sale del fallo de arriba:

> **Una ronda varia UN eje, en TRES pasos, y el eje se nombra en voz alta.**

- **Un eje**, porque es lo que hace la comparacion contestable. Las tres paletas de la
  tanda de proyectos variaban el matiz y compartian la separacion: tres respuestas a una
  pregunta que nadie habia hecho.
- **Tres pasos**, porque es el minimo que **acota**: poco, bien, demasiado. Con dos no se
  sabe si la respuesta cae fuera del par. Con cuatro seguidos sobre un mismo eje, la
  diferencia entre vecinos baja del umbral en que elegir significa algo.
- **El eje dicho en voz alta**, porque permite la respuesta que de verdad hacia falta:
  *"eje equivocado"*. Ninguna cantidad de variantes arregla estar variando lo que no es.
  Diez tampoco: diez obliga a sostener diez diferencias sin nombre a la vez.

Segunda ronda solo si la primera no cierra. Salen baratas: renderizar es un bucle sobre
un juego de tokens.

#### Que se dibuja

**Todos los estados que el contrato enumere**, etiquetados, en una columna. No solo el
aspecto normal. En la tanda de proyectos, `no-disponible` quedo contratado a 2.5 : 1 con
la nota "a proposito, tiene que verse apagado" — y nadie sabe si 2.5 : 1 es apagado o es
invisible, porque nadie lo dibujo. Si un estado es una interaccion que no se congela,
como el hover, se dibuja en reposo y se etiqueta.

**Las pantallas completas, no solo los tokens.** Los estados vacios y los de error son
superficies enteras, y en esa tanda se aprobaron como filas de texto de una tabla.

Y de ahi sale una comprobacion de cinco segundos: **la maqueta y la tabla de estados son
la misma lista.** Un estado que este en una y no en la otra significa que una de las dos
esta incompleta.

#### Cuando la superficie es una terminal

El contrato ya exige bloques de salida literal, regenerados llamando a la funcion real.
**La maqueta de terminal es ese mismo bloque con la paleta aplicada**: un `<pre>` al
ancho real, con la monoespaciada del contrato, sobre el fondo del terminal, y los
colores como `<span>`.

Cuesta casi nada y comprueba lo que el bloque en texto plano no puede: si el verde y el
rojo se leen sobre el fondo **y entre si**, y si la alineacion de columnas aguanta al
ancho de verdad.

Dos cosas que tiene que ensenar y que el bloque de texto nunca ensena:

- **El modo sin color al lado.** Es un estado contratado —`src/salida.mjs` vacia la
  paleta entera cuando no hay TTY— y nadie lo ha mirado nunca.
- **La salida sobre el fondo en el que va a aparecer**, no sobre papel blanco.

### Como se escribe la paleta, ya elegida

Elegida mirando la maqueta, se escribe. **Con valores, no con adjetivos.** Una paleta
"sobria y profesional" no es una paleta: es la misma nada que "ya lo iremos viendo", y
acaba igual, con tres agentes eligiendo tres cosas distintas.

El bloque cerrado sigue existiendo, pero **cambio de sitio**: ya no es lo que se pone
delante de la persona para que decida —eso es la maqueta— sino lo que se lleva al plomo
despues, para que un agente lo copie sin interpretar:

```
A · Grafito           B · Pergamino
fondo      #0c0c0c    fondo      #faf8f3
texto      #cccccc    texto      #2b2b2b
tenue      #6a6a6a    tenue      #8a857c
acento     #3b78ff    acento     #b4532a
ok         #23d18b    ok         #2f7d32
error      #f14c4c    error      #c0392b
aviso      #e5c07b    aviso      #b8860b
```

En la maqueta la persona elige una letra. No rellena un hueco, no busca un color, no
aprende nada de diseno. Y si dice "la A pero el acento mas apagado", eso es una eleccion
valida: el planificador cierra el valor nuevo, **lo vuelve a dibujar** y repite el
bloque entero, para que lo que se lleva al plomo siga siendo una paleta completa y no un
parche.

**El numero de colores sale de los estados, no al reves.** Primero se enumera que
estados tiene la superficie; despues se propone una paleta que los cubra todos. Al
reves salen paletas bonitas a las que les falta el color de "deshabilitado", y ese
color acaba eligiendolo un agente.

**Y la paleta casi nunca esta en blanco.** Si ya hay superficie entregada, sus colores
ya son contrato y las propuestas nacen dentro de ellos, no al lado. Conviene decirle a
la persona cuales son antes de que elija, porque son la restriccion real: en la tanda de
proyectos, cuatro valores del terminal ya estaban fijados y la barra lateral tenia que
nacer dentro de esos cuatro.

**Los contrastes se miden, no se estiman, y son dos familias, no una.**

1. **Legibilidad**: cada texto contra el fondo sobre el que se pinta. Minimo 4.5 para
   texto normal, 3.0 para texto grande y elementos de interfaz. El estado deshabilitado
   es la excepcion y va por debajo a proposito: tiene que verse apagado.
2. **Separacion**: cada superficie contra **la superficie de al lado**. Una barra
   lateral contra el fondo del contenido, una tarjeta contra la pagina, una celda
   enfocada contra sus vecinas.

**La segunda es la que se olvida, y es la que hundio la tanda de proyectos.** Alli se
midieron seis ratios de legibilidad, todos correctos —el `texto-tenue` se quedaba entre
3.6 y 3.8 y se subio antes de ensenar nada—, y **cero de separacion**. La barra lateral
quedo a 1.01 : 1 del fondo de la rejilla, que es lo mismo que decir que no existia. Medir
solo la primera familia da la sensacion de haber medido, y esa sensacion es peor que no
medir, porque cierra la pregunta.

Con la maqueta delante, la separacion se ve sin calcular nada. La cuenta sigue valiendo
para saber **cuanto** hay que separar; la maqueta, para saber **si** hace falta.

### Lo que se fija sin preguntar

**El espaciado, como escala y no como valores sueltos.** Una escala corta y
declarada —`4 / 8 / 12 / 16 / 24 / 32`, en pixeles o en la unidad que toque— con
la regla de que no se usa nada que no este en ella. Sin escala, cada agente elige
su propio margen y el conjunto se ve descuadrado aunque cada pieza este bien por
separado.

**Los estados, enumerados y con su valor.** Cuales son depende de la superficie, y
esto hay que mirarlo antes de copiar ninguna lista:

| Superficie | Estados por defecto |
|---|---|
| Interfaz grafica | normal, hover, activo, deshabilitado, cargando, error |
| Terminal, informe, listado | los del dominio; en Vitral son `ok`, `FALLO` y saltada |

Copiar los seis de interfaz grafica a una tanda de terminal es pedirle a los
agentes un estado *hover* que no existe, y se lo van a inventar. La lista se
escribe mirando la superficie que se construye, no copiandola de aqui.

**El modo sin color, si la superficie es de terminal.** Es una decision visual que
nadie piensa en preguntar y que hay que tomar igual. `src/salida.mjs` ya la tiene
tomada: cuando no hay TTY, la paleta entera pasa a cadenas vacias y el texto sale
sin un solo codigo de escape. Si el plomo no lo dice, un agente lo hace y otro no,
y la salida redirigida a un archivo sale con basura.

### Lo que no lleva tratamiento, dicho a proposito

Las decisiones negativas tambien son contrato, igual que la lista de archivos que
no toca nadie. `panel-pty.md` lo escribe asi:

> *No hay etiqueta ni titulo por panel, y es deliberado.*

Sin esa linea un agente anade una barra de titulo, y hace bien: es lo razonable si
nadie ha dicho lo contrario. Con ella no la anade ninguno. Lo que se ha decidido
dejar desnudo se escribe, y se escribe con el "a proposito" delante, para que la
tanda siguiente no lo lea como un olvido y lo "arregle".

### Como se escribe en el plomo

Una tabla, valores literales, bajo el encabezado que da nombre a esta fase. El
modelo es el de `panel-pty.md`, y su primera linea es la que explica por que
existe todo esto:

> *Es contrato, no gusto personal: si no se escribe, cada agente elige otra cosa.*

Y vale aqui la regla que ya rige el resto del plomo: **los ejemplos son contrato,
no ilustracion.** Con una diferencia practica segun la superficie:

- **En terminal se regenera.** En cuanto las funciones existan, el bloque de
  pantalla se produce llamandolas y se pega la salida literal. Es lo que hizo
  `historial.md`, que lo dice en el propio contrato: *"son la salida literal... no
  estan escritos a mano"*.
- **En interfaz grafica no se puede.** El agente no puede abrir la ventana ni
  mirarla. La compensacion es escribir la lista de comprobacion manual que va a
  pasar una persona delante, punto por punto, y pedirla en el handoff.
  `panel-pty.md` tiene una de catorce puntos, y para eso esta.

Una razon de peso para no saltarsela cuando aplica: las tareas de interfaz son las
mas caras que ha corrido este repositorio —$1.23 en 12 turnos, contra $0.84 en 9
de una de persistencia con contrato del mismo tamano— y la causa medida es que hay
mas idas y venidas cuando hay que cuadrar un formato de pantalla. Que un contrato
cerrado ahorre alguna de esas vueltas es razonable esperarlo, pero no esta medido.
Lo que si esta medido es que la ola donde se juega es la cara.

---

## Lo que hay que preguntar antes de dar el plan por cerrado

El corazon del trabajo. Estas preguntas no son un formulario: son los sitios por
donde se han colado los fallos reales.

**De cada archivo compartido: ¿quien es su unico dueno?**
Si la respuesta es "los dos" o "depende", el plan no esta listo. Y una vez hay
dueno, el plomo tiene que decir lo suficiente como para que **los demas no
necesiten leer ese archivo**. Si otra tarea tiene que abrirlo para saber que
contiene, el contrato esta incompleto.

**De cada catalogo estatico: ¿donde esta su origen unico?**
Roles, tipos, estados, codigos de error, nombres de campo. Si aparece en dos
sitios, va a divergir. El plomo debe declarar cual es la fuente y que los demas
la copian literalmente, sin reordenar ni renombrar.

**De cada borde: ¿que pasa exactamente?**
Cero, vacio, ausente, uno solo, mas de los que caben, negativo. Un caso que el
contrato no cubre no queda abierto: queda a la interpretacion de agentes que no
pueden hablarse, y cada uno elige distinto. Hay que escribir la respuesta, aunque
sea "no pasa nada y no se muestra".

**¿Que archivos no toca nadie en esta tanda?**
Escrito, en una lista. Sin ella, lo que cada agente da por hecho que hara otro no
lo hace nadie.

**¿Hay algo que importe que salga igual y que el contrato no este diciendo?**
La pregunta mas dificil y la que mas rinde. La variabilidad se concentra
exactamente donde el contrato calla: nombres, orden, formato, mayusculas, el
texto de un mensaje. Si a alguien le va a importar como quedo, tiene que estar
escrito.

**¿Que pasa si esta tarea falla a la mitad?**
Las olas siguientes no se ejecutan, pero lo que ya escribieron los otros vidrios
se queda en el arbol de trabajo. Conviene que la persona lo sepa antes, no
despues.

---

## Lo que ya se pago por aprender

Reglas, no consejos. Cada una salio de una corrida real.

**La variabilidad se concentra donde el contrato calla.** Es la regla madre: si
importa que salga igual, se escribe.

**Un archivo compartido tiene un solo dueno, y el plomo elimina la necesidad de
que los demas lo lean.** Dos vidrios de la misma ola sobre el mismo archivo no
dan error: dan perdida silenciosa de trabajo, porque el ultimo en guardar pisa al
otro. Por eso `revisarSolapamientos` aborta antes de lanzar.

**Un catalogo estatico necesita origen unico declarado.** Si los estados de un
pedido aparecen en el modelo y en la vista, y el plomo no dice cual manda, van a
salir dos listas parecidas y distintas.

**El plomo garantiza que las piezas encajen, no que el producto tenga sentido.**
Un plan puede estar perfectamente especificado y ser una mala idea. El
planificador no puede detectar eso, y no debe fingir que si.

**Los agentes trabajan a ciegas y no se compensan entre ellos.** Si el contrato
dice algo raro, los tres lo copian igual de raro. Un revisor humano habria dicho
"esto no puede ser"; tres agentes ciegos, no. El plomo es el unico punto del
sistema donde un error se multiplica por el numero de vidrios.

**Los ejemplos de un plomo son contrato, no ilustracion.** El agente no los lee
para hacerse una idea: los copia. Si el ejemplo pone `0m 12s` donde la funcion
produce `12s`, el agente escribe codigo que produce `0m 12s`, y hace bien, porque
el plomo manda. En cuanto la funcion exista, el ejemplo se regenera llamandola y
se pega la salida literal.

**Al cambiar un valor o una firma contratada, se barre el archivo entero con `grep`
antes de dar la fase por cerrada.** Con `grep`, no releyendo, y no fiandose de recordar
donde estaba. Cambiar la tabla es la parte facil y la que se hace sola; las
consecuencias viven repartidas en ejemplos, en listas de comprobacion y en prosa, y esas
son justo las que nadie mira.

Salio de la tanda de proyectos, y del peor modo posible: **dos veces seguidas en la
misma sesion.**

La primera, el borde de foco paso de `#3b78ff` a `#fde047` en la tabla "Como se ve", y
el punto 11 de la lista de comprobacion manual siguio diciendo *"su borde se pone
azul"*, **contradiciendo al punto 25 del mismo archivo**, que anunciaba el cambio.

La segunda es peor. `abrir_panel` gano el argumento `cwd` en la tabla del catalogo IPC,
y los dos ejemplos de codigo siguieron sin el. **El agente copia el ejemplo antes que la
tabla**, asi que el resultado habria sido un panel arrancando en el directorio del
usuario en vez del proyecto, sin error y sin aviso: exactamente el fallo mudo que esa
tanda existia para evitar.

Las dos las encontro la persona leyendo el contrato, no el planificador. Y al barrer de
verdad, `grep abrir_panel` devolvio **ocho menciones**, de las que **tres no eran del
`cwd` sino de un cambio anterior que tampoco se habia barrido**: el arranque sin paneles,
que habia dejado un `cuadricula.abrir()` y dos filas de tabla diciendo lo contrario de
lo acordado. Un barrido no barrido se acumula, y el segundo cambio lo hereda.

La regla practica, sin atajo:

1. Cambiado el valor o la firma, `grep` del nombre **viejo** y del **nuevo**.
2. Mirar cada linea que salga: tabla, ejemplo, prosa, lista de comprobacion, prompt del
   boceto. El boceto tambien, que es donde se le dice al agente que secciones leer.
3. Si el valor viejo tiene que seguir apareciendo —para avisar de que cambio—, que se
   lea como aviso y nunca como afirmacion.

**Un archivo que una herramienta reescribe sola va en las `rutas` de quien la
provoca.** No lo escribe el agente, lo escribe su herramienta, pero acaba modificado
igual y el motor lo marca como trabajo fuera de lo declarado. `Cargo.lock` es el caso
vivo: la tanda de proyectos anadio una dependencia, cargo reescribio el lock al
resolverla, y salio senalado. Vale para todos sus hermanos —`package-lock.json`,
`go.sum`, `poetry.lock`— y para cualquier cosa que un formateador o un generador toque
de paso. La pregunta al cerrar el boceto es: *¿que va a reescribir esta tarea sin
teclearlo?*

**Las rutas se declaran por archivo exacto, no por carpeta.** `src/registro.mjs`,
no `src/`. La comparacion de solapamiento es por segmento de ruta, asi que
`src/registro.mjs` y `src/salida.mjs` conviven sin problema, pero `src/` choca con
las dos. Declarar una carpeta le da al agente permiso para escribir en archivos
que no son suyos, y el motor no lo va a impedir si esta declarado.

**Que una tarea termine bien no dice que haya entregado nada.** `ok` significa
exactamente una cosa: el agente salio limpio. No que su obra funcione, ni que
exista. **Vitral no ejecuta jamas las pruebas del proyecto**: mira con git que
archivos se movieron, y ahi se acaba lo que sabe. Verde y entregado no son lo
mismo, y nada del motor los junta.

Y a `revision` se le puede *pedir* que corra el banco de pruebas —su prompt lo
dice—, pero eso es una instruccion a un agente, no una verificacion. Un agente
puede informar de exito sin haberlo corrido, y no hay nada en el sistema que lo
contradiga.

**Lo que git no puede decirte no es lo que se escondio: es lo que no se
escribio.** Un archivo que nadie toco se ve exactamente igual que un archivo que
se dejo intacto a proposito: en las dos situaciones no aparece. Todo el modelo de
deteccion del motor es "que cambio"; no tiene ninguna nocion de "que tendria que
haber cambiado y no cambio". Una tarea que no produce nada no deja rastro
**ninguno**.

Salio de la tanda de los eventos. `checks` preparo su trabajo en dos archivos
aparte y murio antes de integrarlo: `pruebas/checks.mjs` quedo sin tocar. Git
enseño los dos archivos sueltos sin problema —no estaban ignorados— y el motor
hasta los marco como fuera de ruta. **Y aun asi el producto no estaba.** Lo que
faltaba no era visible en ninguna parte, porque lo que faltaba era una ausencia.

De ahi la regla, y aplica a quien verifica y a lo que se le pide a una revision:

> **La comprobacion de que el producto esta entregado tiene que ser positiva y
> especifica, y no puede ser "mirar el arbol".**

Nada de "git status esta como esperaba". Una cuenta, un numero, algo que solo
pueda salir bien si la obra existe: *el banco tiene que decir 40 comprobaciones,
no 24*. Esa frase caza el fallo; mirar el diff, no.

**Un plomo que no se retira lo paga cada vidrio de cada tanda siguiente.** No es
una molestia teorica: `preambulo.md` eran 12.972 bytes, y su propia tanda ya
arrancaba con `plomo 2 archivos (33.1 KB)` en la cabecera de `--seco`, pagados tres
veces, una por tarea. Sin retirarlo, esos 12.972 bytes los habria pagado tambien cada
vidrio de la tanda siguiente, y de la siguiente, para contar una funcionalidad ya
entregada. El cierre no es aseo: es la unica forma de que el coste no se acumule.

---

## El boceto: campos reales

Salen de `leerBoceto` en `src/boceto.mjs`. No hay mas.

En la raiz:

| Campo | Obligatorio | Regla |
|---|---|---|
| `tareas` | **si** | Array, y no vacio |
| `nombre` | no | Si falta, se usa el nombre del archivo |

En cada tarea:

| Campo | Obligatorio | Regla que aplica el validador |
|---|---|---|
| `id` | **si** | No vacio, y unico en el boceto |
| `prompt` | **si** | No vacio |
| `rutas` | **si** | Array, y no vacio |
| `agente` | no | Si falta se pone `claude`. Si esta, tiene que existir: `claude` u `opencode` |
| `necesita` | no | Cada id tiene que existir en el boceto |
| `timeout` | no | Numero de minutos mayor que cero. Por defecto 15 |
| `presupuesto` | no | Numero mayor que cero, en dolares. Solo lo respeta `claude` |
| `modelo` | no | Cadena no vacia y sin espacios. Alias o nombre. Para `opencode`, `proveedor/modelo` |
| `cwd` | no | Ruta relativa no vacia. Directorio de la tarea. Las rutas se resuelven contra el |
| `plomos` | no | Array de nombres de archivo del directorio del plomo, **sin subdirectorios** y sin repetidos. Cada nombre tiene que existir ahi o la corrida aborta. Omitido = **todos**; `[]` = **ninguno** |

Los cuatro ultimos se validan solo si vienen, y ojo con `null`: omitido y `null` no
son lo mismo, y `null` es invalido en los cuatro.

`plomos` tiene ademas una distincion que los otros tres no tienen: **omitido y `[]`
son los dos validos y significan cosas opuestas** —"todos" y "ninguno"—, porque no
hay otra forma de decir "ninguno". Un nombre con `/` o `\` aborta con un error
propio: el directorio del plomo es plano, y lo que cuelga de un subdirectorio no
entra en ningun prompt. Es lo que hace que `retirados/` funcione.

Lo que se comprueba es la forma, no el significado. `modelo: "opus"` en una tarea
`opencode` pasa el validador —es una cadena sin espacios— y lo rechaza el CLI ya
durante la corrida. Es deliberado, y lo explica la seccion de modelos.

### Lo que aborta una corrida por culpa del plan

Esto se detecta con `--seco`, sin gastar:

- El boceto no es JSON valido, no tiene tareas, o le falta `id`, `prompt` o
  `rutas` a alguna.
- Un `id` repetido.
- `necesita` apuntando a un id que no existe.
- Un `timeout` que no es un numero mayor que cero.
- Un `presupuesto` que no es un numero mayor que cero.
- Un `modelo` que no es cadena, esta vacio o lleva espacios.
- Un `cwd` que no es cadena, esta vacio o es una ruta absoluta.
- Un `cwd` bien escrito que resuelve fuera del repositorio, o que no existe en
  disco como directorio. Lo dice `revisarCwd`, y aborta tambien con `--seco`.
- Un `agente` que no existe.
- Una dependencia circular: `calcularOlas` lo dice con los ids del ciclo.
- Dos tareas **de la misma ola** con rutas que se solapan.

### Lo que solo avisa

- Un `presupuesto` por debajo de $0.25.
- Un `presupuesto` en una tarea `opencode`: se ignora, porque ese CLI no tiene
  tope de gasto. Su unico freno es el `timeout`.
- Reejecutar una tarea que ya dejo archivos en el arbol de trabajo.

### Lo que aborta sin ser culpa del plan

- Estar en la rama `main` o `master`.
- No estar en un repositorio git, salvo que se pase `--sin-git`.

En `--seco` estos dos solo avisan, porque el modo seco no ejecuta nada.

---

## Presupuestos

Cifras medidas, no supuestas.

**Una tarea de revision necesita al menos la suma de los presupuestos de las que
revisa.** No porque vaya a gastarlo, sino porque el tope tiene que darle margen:
arranca leyendo todo el trabajo ajeno, mas los handoffs, mas el plomo entero, y
ese contexto lo paga por adelantado y lo arrastra en cada turno. Medido: una
revision de dos tareas de $1.5 se corto **dos veces** con un tope de $0.8, en los
turnos 8 y 11. En la tanda del historial, con la regla aplicada, la revision tenia
$8 de tope y gasto $1.97 sin acercarse al limite. El tope no es una prevision de
gasto: es el techo que evita el corte.

**Las tareas de interfaz cuestan mas que las de servidor.** En la tanda del
historial, con contratos del mismo tamano: la de presentacion, $1.23 en 12 turnos;
la de persistencia, $0.84 en 9. Hay mas idas y venidas cuando hay que cuadrar un
formato de pantalla que cuando se guarda un archivo.

**Un tope por debajo de $0.25 es enganoso.** El limite se comprueba entre turnos,
no durante, asi que se rebasa por lo que cueste el turno en curso. Medido: con un
tope de $0.01 el agente paro de verdad, pero gasto $0.09 antes de parar. Nueve
veces el tope. Sirve como techo de seguridad; como control fino de gasto, no.

**Cuando el presupuesto corta, no hay handoff.** El agente muere antes de
escribirlo y deja trabajo a medias en el disco. Vitral registra la marca de corte,
pero la tarea siguiente se queda sin lo que necesitaba leer.

**Y una tarea de pruebas cortada a la mitad es mas peligrosa que cualquier otra,
porque su producto sigue ejecutandose.** Un modulo a medias revienta al importarlo
y se nota enseguida. Un archivo de checks a medias **pasa en verde**: los que
quedaron escritos corren y dicen `ok`, y los que faltan no dicen nada, porque no
existen. La suite sigue informando de que todo esta bien. Lo unico que la delata
es que el numero total de checks bajo, que es justo lo que nadie mira.

En la tanda de los eventos **no llego a pasar**, y el porque no es suerte: el
agente monto su trabajo en archivos aparte —los bloques transcritos en uno, los
checks escritos en otro— y murio antes de integrar. `pruebas/checks.mjs` quedo
intacto y sus 24 checks seguian pasando. El corte se llevo trabajo, no la red.

De ahi salen dos cosas, y las dos son baratas:

- **Al prompt de cualquier tarea que amplie una suite: prepara fuera e integra al
  final**, en el menor numero de escrituras posible. Convierte un corte en trabajo
  perdido en vez de en una red rota.
- **A quien recoge los pedazos: antes de fiarte de un verde, cuenta los checks.**
  Que pasen todos no significa nada si son menos que ayer.

**Reescribir cuesta mas que escribir, y el tamano del contrato no lo predice.**
Una tarea que cambia N funciones que ya existen, contra N bloques de salida
literal que tienen que seguir saliendo igual, gasta mas que una que escribe N
funciones nuevas del mismo tamano. El trabajo no es teclear: es **localizar cada
bloque, leerlo, sustituirlo sin tocar lo de al lado, y volver a leerlo para
comprobar que no se movio nada**. Cada una de esas cuatro cosas es un turno, y los
turnos son lo que se paga.

Salio de la tanda de los eventos JSON, y las dos tareas de su primera ola se
cortaron por presupuesto sin dejar handoff:

| Tarea | Que hacia | Tope | Gasto | Turnos | Termino |
|---|---|---|---|---|---|
| `emisor` | Anadir una rama a ~16 funciones de `salida.mjs`, sin mover una coma de lo que pintan | $2.5 | $2.5070 | 30 | **no** |
| `veredictos` | Sacar la sangria de 6 funciones de `guardarrailes.mjs`, contra 17 bloques literales | $1.5 | $1.5448 | 18 | **no** |

La comparacion es la que duele. En la tanda anterior, con contratos de tamano
parecido pero escribiendo codigo nuevo, **las cuatro tareas terminaron**:
`agentes` $0.4661 en 5 turnos, `motor` $1.6444 en 22, `documentacion` $1.6303 en
24, `checks` $1.7968 en 19. Y `emisor`, a 30 turnos y $2.5070, **ya habia pasado a
`cuadricula`** —$2.5584 en 31 turnos, una tarea de interfaz, que es la clase mas
cara que hay medida— **y todavia no habia acabado**.

De ahi sale una formula, con un limite que hay que leer pegado a ella:

> **El coste de un vidrio es sus turnos por unos $0.08**, en opus, **mientras la
> tarea lea mucho y escriba poco.**

Medido sobre las seis tareas de las dos primeras tandas: $0.0836, $0.0858,
$0.0747, $0.0679, $0.0946 y $0.0825 por turno. **Presupuestar es estimar turnos,
no estimar dificultad**, y para eso la pregunta util es cuantos sitios distintos
hay que tocar y cuantas veces hay que releerlos.

### Donde se rompe la formula, y por que

La tanda de los eventos la rompio con un factor de 2.5, y al abrir los logs se ve
exactamente donde. Las tarifas salen de resolver el sistema con tres tareas y
cuadran al 0.0% en las otras dos, asi que esto no es estimacion:

| Concepto | $ por millon de tokens |
|---|---|
| Salida generada | **$25.00** |
| Escritura de cache | $10.00 |
| Lectura de cache | **$0.50** |

**Un token de salida cuesta cincuenta veces uno de contexto releido.** Y lo que
distingue a una tarea de otra no es cuanto lee —eso es casi constante— sino
cuanto escribe:

| Tarea | $/turno | Salida/turno | Cache leida/turno | % del coste que es salida |
|---|---|---|---|---|
| `checks` | **$0.193** | **3.186** | 87.051 | 41% |
| `emisor` | $0.119 | 1.620 | 73.446 | 34% |
| `entrada` | $0.103 | 1.063 | 72.581 | 26% |
| `veredictos` | $0.079 | 777 | 70.224 | 25% |
| `documentacion` | $0.078 | 621 | 72.151 | 20% |

**La cache leida por turno es la misma para todas: entre 70.000 y 87.000.** Es el
suelo que impone el plomo, y vale unos $0.037 por turno haga la tarea lo que haga.
Lo que se mueve es la salida: de 621 a 3.186 tokens por turno, cinco veces.

**Y hay un segundo termino, mas escondido: lo que el agente va acumulando se le
vuelve contexto.** Un archivo que crece bajo sus manos entra en el contexto como
contenido nuevo cada vez que lo relee, y eso se paga a $10/M de **escritura** de
cache, no a los $0.50 de lectura. Medido: `checks`, que iba amontonando un archivo
de trabajo hasta 30 KB, escribio **7.014** tokens de cache por turno; `documentacion`,
editando prosa con bisturi sobre dos archivos que juntos pesaban **mas** que el
suyo, **2.654**. Casi el triple, con menos archivo.

O sea que **el coste por turno no es constante y no depende del tamano del
archivo, sino del patron de edicion**: reescribir por partes un archivo grande, o
irlo construyendo, se paga dos veces —una por escribirlo y otra por releerlo—;
editar en sitio con cambios pequenos, casi no.

Desglosado, el turno de `checks` frente al de `documentacion`:

| | `checks` | `documentacion` |
|---|---|---|
| Lectura de cache | $0.0435 (23%) | $0.0361 (46%) |
| **Salida generada** | **$0.0797 (41%)** | $0.0155 (20%) |
| **Escritura de cache** | **$0.0701 (36%)** | $0.0265 (34%) |
| **Total** | **$0.193** | **$0.078** |

En `checks`, escribir —de las dos maneras— es el **77%** del turno. En
`documentacion`, el 54%. De donde sale el modelo bueno:

> **coste/turno ≈ $0.037 de suelo + (salida por turno) × $25/M +
> (contexto nuevo por turno) × $10/M**

Y la pregunta que hay que hacerle a cada tarea al escribir el boceto:

> **¿El trabajo de esta tarea es decidir, o es teclear?**

Una que lee mucho y edita con bisturi —documentacion, una revision— vive en los
$0.08. Una que tiene que **emitir volumen** se va al doble o mas.

**El caso extremo es copiar.** `checks` era cara justamente por lo que la hacia
valer: su trabajo era transcribir catorce bloques de salida literal a
aserciones, caracter a caracter, desde el plomo. Copiar es salida, y la salida es
el token caro. Si se le hubiera dejado generar los textos esperados **ejecutando
el motor** habria costado una fraccion —y no habria comprobado nada, porque el
motor que iba a fotografiar ya llevaba los cambios que tenia que vigilar. **El
precio y la utilidad venian de la misma decision.**

Regla, entonces: **una tarea a la que el contrato le pide reproducir texto literal
paga por cada caracter, y hay que presupuestarla por lo que va a escribir, no por
lo que va a leer.**

**Un tope no es dinero: es un numero de turnos comprados.** Dividelo entre el
coste por turno **de esa clase de tarea** —$0.08 si lee y edita, el doble si tiene
que emitir volumen— y tienes cuantos. Esa es la forma de usar la formula al
escribir el boceto, y es la que convierte un tope en una prediccion comprobable en
vez de en una cifra redonda.

Y se comprueba sola, hacia atras, con los dos cortes de la tanda de los eventos:

| Tarea | Tope | Turnos que compraba | Turnos que dio |
|---|---|---|---|
| `emisor` | $2.5 | 31 | **30** |
| `veredictos` | $1.5 | 19 | **18** |

Las dos murieron a un turno de lo que su tope pagaba. **No se cortaron por mala
suerte: se cortaron donde estaba escrito que se cortarian**, y nadie hizo la
division porque los dos topes se calcularon sin la formula —a ojo, mirando el
tamano del contrato, que es justo lo que este apartado dice que no predice nada.

De ahi la comprobacion de cinco segundos antes de cerrar un boceto: **por cada
tarea, divide su tope entre $0.08 y preguntate si le da para el trabajo que le
estas pidiendo.** Si la respuesta es "justo", el tope esta mal: el tope es el
techo que evita el corte, no la prevision del gasto.

La regla practica, para una tarea que reescribe con salida literal contratada:
**cuenta los bloques que tiene que respetar, multiplica por tres turnos, suma lo
que costaria escribirla de cero, y de ahi saca el tope.** Es una heuristica de una
sola tanda y esta sin confirmar; lo que si esta medido es que estimarla como si
fuera codigo nuevo la corta.

---

## Que modelo pedir

El campo `modelo` existe, se valida y llega a `--model` en los dos adaptadores. Lo
que no existia hasta ahora es el criterio, y eso tiene una consecuencia medible:
**las ocho tareas que ha corrido este repositorio fueron en el modelo por
defecto**, `claude-opus-5[1m]`, con `modelo` omitido en el boceto. Nadie lo
decidio. Salio asi.

Omitir `modelo` no es elegir el modelo por defecto: es no elegir. Decide el CLI, y
lo que decide puede cambiar de una version a otra sin que el boceto se entere.

### Lo que decide el coste no es la dificultad

Antes del criterio, el dato que lo enmarca, porque cambia la pregunta. Sumando el
`modelUsage` de los ocho `.vitral/logs/*.json`:

| Concepto | $ | % del total |
|---|---|---|
| Salida generada | 2.09 | 24.4% |
| Lectura de cache | 2.60 | 30.5% |
| Escritura de cache | 3.74 | 43.8% |
| Entrada sin cachear | 0.00 | 0.0% |
| Sidecar de Haiku | 0.11 | 1.2% |
| **Total** | **8.54** | |

**Tres cuartas partes de lo que cuesta un vidrio es contexto releido, no texto
generado.** El coste correlaciona con la cache leida a r=0.992 y con los turnos a
r=0.922. Con el tipo de tarea no correlaciona: eso no se mide con ocho puntos.

Y la escritura de cache es casi constante por tarea, unos $0.35, haga la tarea lo
que haga. `checks` hizo cinco turnos y pago $0.344 en cachear su prompt y el
plomo: el 63% de su coste antes de tocar nada. **Hay un suelo por vidrio que no
depende de la dificultad y se paga entero aunque la tarea sea trivial.** Es el
argumento del plomo que no se retira, visto desde la factura.

### La escalera

**Esto es intuicion, no medicion.** Se escribe porque un criterio explicito y
marcado es mejor que la omision de hoy, no porque haya datos detras. Las ocho
corridas no sirven de prueba: todas usaron el mismo modelo y todas salieron bien,
asi que no hay ni un fallo que atribuir a haber pedido de menos. Cuando lo haya,
se corrige aqui.

| Trabajo | Que pedir | Por que |
|---|---|---|
| Planificar y revisar | El modelo mas capaz | Un error se multiplica por el numero de vidrios |
| Escribir codigo contra un contrato cerrado | Menos | El trabajo duro ya esta hecho en el plomo |
| Documentacion contra el contrato | Menos todavia | Con el aviso de abajo |

El primer escalon es el unico que se apoya en algo ya escrito: es el mismo
argumento que sostiene la heuristica de presupuesto de la revision, y el que
aparece dos veces mas en este archivo. El plomo es el unico punto del sistema
donde un error se multiplica por el numero de vidrios, y planificar y revisar son
las dos tareas que lo tocan entero.

**El tercer escalon lo desmiente el dato disponible.** En la tanda de
validar-boceto, `documentacion` —README.md y motor.md contra un contrato ya
cerrado, exactamente este escalon— hizo mas turnos que dos de las tres tareas de
codigo, y costo lo mismo:

| Tarea | Tipo | Turnos | Coste |
|---|---|---|---|
| `checks` | pruebas | 5 | $0.56 |
| `forma` | codigo, con la tabla de bordes entera | 9 | $0.78 |
| `guardarrailes` | codigo | 12 | $0.69 |
| `documentacion` | documentacion contra contrato | **13** | $0.71 |

Lo que si distingue a `documentacion` es la forma de sus turnos: 417 tokens de
salida por turno, la mas baja de las ocho, y la menor cache leida por turno.
Muchas ediciones pequenas y fieles a traves de dos archivos, no razonamiento
largo. Eso puede justificar bajarle el modelo —el fallo tipico ahi es de
fidelidad, no de criterio— pero **no** justifica esperar que salga mas barata. No
salio.

### Cambiar el modelo mueve el presupuesto

Esto no es opcional y es la parte que mas dano hace si se olvida. **Toda la
seccion de Presupuestos de arriba esta en dolares medidos sobre opus.** Poner
`modelo` y dejar los topes rompe la heuristica en las dos direcciones: con un
modelo mas barato el tope deja de ser techo, y con uno mas caro la revision se
corta donde antes no se cortaba.

La conversion es limpia, y por una razon concreta: todos los modelos actuales
cobran la salida a exactamente cinco veces la entrada, y la cache a multiplos
fijos de la entrada. Al cambiar de modelo la mezcla del gasto no cambia, solo la
escala. **Multiplicar todos los topes de la tanda por la razon de tarifas es
exacto, no aproximado.**

| Modelo | Entrada $/M | Factor sobre opus |
|---|---|---|
| `claude-fable-5` | 10 | **2.00x** |
| `claude-opus-5` | 5 | 1.00x, la referencia |
| `claude-sonnet-5` | 3 | 0.60x |
| `claude-haiku-4-5` | 1 | 0.20x |

Las cifras de la seccion de Presupuestos —la revision con $8 de tope que gasto
$1.97, el piso de $0.25— son de opus. Esa misma revision necesita $4.80 de tope
con `claude-sonnet-5`, y $16 con `claude-fable-5`, para dar el mismo margen.

Sonnet 5 tiene precio de estreno de $2/M hasta el 31-08-2026, que lo dejaria en
0.40x. Contar con eso caduca; usar 0.60x.

### Dos cosas que `modelo` no controla

**El sidecar de Haiku.** Los ocho logs traen una segunda linea en `modelUsage`,
`claude-haiku-4-5`, con 11-16k de entrada, unos 15 tokens de salida y
$0.012-0.016. Son llamadas internas de Claude Code y `--model` no las toca. Es el
1.2% del total, asi que no cambia ninguna decision, pero explica por que el
`costo` de un log nunca cuadra con un calculo a mano sobre el modelo elegido.

**La ventana de contexto es un acantilado, no una pendiente.** `claude-opus-5[1m]`
tiene 1M; `claude-haiku-4-5`, 200K. Medido: `revision` promedio 57.7k de contexto
por turno y `entrada` 61.6k, creciendo turno a turno. La revision es siempre la
que mas lee —el plomo entero, todos los handoffs y el codigo ajeno que revisa— y
es el primer sitio donde un modelo de ventana corta se rompe. **Se rompe
cayendose, no dando peor calidad**, y a mitad de la ola mas cara de la tanda.
Antes de bajarle el modelo a una revision, mirar su ventana.

### La barra de opencode

`claude` acepta un alias —`fable`, `opus`, `sonnet`, que apuntan al ultimo de su
familia— o un nombre completo como `claude-fable-5`. `opencode` exige **siempre**
`proveedor/modelo`, con la barra: `anthropic/claude-sonnet-5`.

El validador no distingue entre los dos: `modelo: "opus"` es una cadena no vacia
sin espacios, asi que pasa. En una tarea `claude` funciona; copiada a una tarea
`opencode`, la rechaza el CLI, y la rechaza durante la corrida, con la ola ya
lanzada y pagada.

**Es deliberado y no se toca.** Validar la barra obligaria a Vitral a mantener un
catalogo de lo que espera cada CLI, y ese catalogo caduca cada vez que uno de los
dos saca version. Se paga a cambio de esto: al cerrar el boceto, repasar uno por
uno los `modelo` de las tareas `opencode` buscando la barra.

### Lo que este criterio todavia no puede decir

Los dos CLI tienen mas perillas que el modelo, y el boceto no llega a ninguna.
`claude` tiene `--effort` —low, medium, high, xhigh, max— y `--fallback-model`,
que acepta una lista separada por comas para cuando el principal esta saturado;
`opencode` tiene `--variant`, con el esfuerzo especifico del proveedor: minimal,
high, max.

Hoy no hay campo del boceto que las alcance, asi que **la unica palanca disponible
es el escalon de modelo** y este criterio no habla de otra cosa. Cuando entren
`esfuerzo` y `fallback`, la escalera de arriba se queda corta: bajar el esfuerzo
de un modelo capaz y subir el modelo con esfuerzo bajo son dos formas distintas de
gastar menos, y no son intercambiables. Es otra tanda, y su plomo empieza aqui.

---

## Errores tipicos al planificar

| Error | Como se detecta a tiempo |
|---|---|
| Un archivo que reescribe una herramienta y no esta en las rutas | El resumen de la corrida lo marca como fuera de lo declarado, pero solo despues de gastar. Antes de cerrar: ¿que reescribe esta tarea sin teclearlo? |
| Declarar rutas por carpeta (`src/`) | `--seco` aborta si dos de la misma ola se solapan. Si caen en olas distintas no aborta: hay que verlo leyendo las rutas |
| Dos tareas escribiendo el mismo archivo | `--seco` aborta, siempre que esten en la misma ola |
| Un ciclo de dependencias | `--seco` aborta y nombra los ids del ciclo |
| `necesita` con un id mal escrito | `--seco` aborta diciendo cual falta |
| Una revision con menos tope que la suma de lo que revisa | Nadie lo detecta. Sumar a mano antes de cerrar el boceto |
| Un tope por debajo de $0.25 | `--seco` avisa |
| `presupuesto` en una tarea `opencode` | `--seco` avisa: se ignora |
| Un `modelo` sin barra en una tarea `opencode` | Nadie lo detecta. El validador solo mira la forma; el CLI lo rechaza ya en la corrida, con la ola pagada. Repasar a mano los `modelo` de las tareas `opencode` |
| Topes de presupuesto heredados de otro modelo | Nadie lo detecta. Al poner `modelo`, multiplicar todos los topes por la razon de tarifas de la tabla de modelos |
| Una tanda con superficie visible y sin tabla "Como se ve" | Nadie lo detecta, y el plan sale igual de convincente. Solo se caza en la fase 3 |
| Una paleta propuesta en adjetivos | Nadie lo detecta. "Sobria y profesional" no es una paleta: se proponen bloques cerrados con todos los valores |
| Una paleta aprobada leyendo hexadecimales, sin dibujarla | Nadie lo detecta, y la revision tampoco: compara el codigo con el contrato, y el contrato es el que esta mal. Se ve al abrir la ventana, con la corrida ya pagada |
| Contrastes medidos solo de texto | Nadie lo detecta. Falta la otra familia: cada superficie contra la de al lado. En la tanda de proyectos eso fue 1.01 : 1 |
| Tres variantes que varian el eje equivocado | Nadie lo detecta, y mas variantes no lo arreglan. Una ronda, un eje, tres pasos, y el eje se nombra |
| Proponer paletas sin preguntar antes si ya hay direccion | Nadie lo detecta, y el coste lo paga la persona teniendo que frenar al planificador. Es la primera pregunta de la fase 3 |
| Proponer colores sin mirar los que ya son contrato | Nadie lo detecta. Si hay superficie entregada, sus valores son la restriccion de entrada y se dicen antes de que la persona elija |
| Un plomo de una tanda vieja que sigue en `.vitral/plomo/` | La cabecera de `--seco` dice cuantos archivos de plomo hay y cuanto pesan |
| Un boceto de interfaz sin `plomos` en sus tareas | Nadie lo detecta: la corrida sale bien y cada vidrio carga los 104 KB de las dos superficies. Se ve en `--seco`, comparando el `bytes` de cada prompt con lo que esa tarea de verdad lee |
| `plomos` que ahorra mucho en una tanda de motor | Nadie lo detecta, y **parece una buena noticia**. Casi siempre significa que hay un plomo de otra tanda sin retirar: mirar `.vitral/plomo/` antes de celebrarlo |
| Un boceto ya ejecutado que sigue en `.vitral/boceto.json` | Nadie lo detecta. `node vitral.mjs` sin banderas lo relanza tal cual, y si su plomo ya se movio, los agentes corren sin contrato y el prompt no lo dice |
| Un handoff viejo de un id que se repite entre tandas | Nadie lo detecta. `--solo` se salta las dependencias que tienen handoff en disco sin mirar de que tanda son, e inyecta el contenido viejo en el prompt del dependiente |
| El mismo dato explicado en dos prompts | Nadie lo detecta. Buscar el dato repetido: si esta en dos prompts, es plomo |
| Un ejemplo del plomo escrito a mano | Nadie lo detecta. Generarlo llamando al codigo real y pegar la salida |
| Una tabla cambiada y sus ejemplos sin barrer | Nadie lo detecta, y es el peor sitio donde puede pasar: el agente copia el ejemplo antes que la tabla. `grep` del nombre viejo y del nuevo antes de cerrar la fase |
| Un catalogo sin origen unico | Nadie lo detecta. Preguntarlo en la entrevista |
| Correr en `main` | `--seco` avisa; la corrida real aborta antes de lanzar nada |

Merece la pena mirar la columna derecha entera: **la mitad de los errores no los
detecta el motor.** Los que quedan fuera son justo los de contenido, y solo se
cazan preguntando.

---

## Dos senales de que el plan todavia no esta listo

Son detectables sin entender el plan entero, que es lo que las hace utiles.

**No puedes nombrar al dueno unico de un archivo.** Si al preguntar "¿quien
escribe este archivo?" la respuesta es "los dos, cada uno su parte" o "depende",
el plan no esta listo. El motor no sabe partir un archivo entre dos vidrios: o se
fusionan las tareas, o una espera a la otra con `necesita`.

**Estas explicando en el prompt de una tarea algo que otra tarea tambien necesita
saber.** Ese hecho no es de la tarea: es plomo. Dejarlo en dos prompts garantiza
que se desvien, porque cada agente lo leera en su version y ninguno vera la otra.
Subelo al contrato y borralo de los dos prompts.
