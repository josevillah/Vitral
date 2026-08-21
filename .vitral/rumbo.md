# Rumbo

Hacia donde va Vitral. **No es un plomo**: no gobierna ninguna tanda, no vive en
`plomo/` y no viaja en ningun prompt. Es el contexto que hasta ahora solo existia en
una conversacion, escrito para que las decisiones de las tandas siguientes se tomen
con esto delante.

No hay plazos ni fases aqui. Solo el rumbo, lo que ya funciona y lo que lo cerraria.

---

## Que es Vitral

**Una aplicacion de escritorio donde se abren proyectos**, como un editor abre
carpetas. No es algo que se instala dentro de un proyecto.

- **El proyecto se referencia por ruta.** No se copia, no se importa, no se registra
  en ningun sitio del proyecto. Sigue siendo un repositorio git normal con su vida
  propia, que funciona igual sin Vitral delante.
- **Se pueden abrir varios a la vez**, cada uno con sus paneles.
- **Vitral no lee ni indexa el codigo del proyecto.** No mantiene un modelo de los
  archivos, ni un arbol, ni una cache. Eso lo hace el agente cuando le toca. Vitral
  orquesta: sabe donde esta el proyecto, que tareas hay y quien toca que.

Esa ultima es la que mas facil se rompe sola. Cada vez que aparezca la tentacion de
"y ya que estamos, que la interfaz sepa que archivos hay", la respuesta es que no: en
el momento en que Vitral mantiene un modelo del codigo, tiene que mantenerlo
actualizado mientras nueve agentes escriben a la vez, y eso es otro producto.

## Que se guarda donde

| Que | Donde | Se versiona |
|---|---|---|
| Bocetos, plomos, handoffs, logs, historial | `.vitral/` **dentro del proyecto**, creado la primera vez que se abre | Con el proyecto, porque es suyo |
| La lista de proyectos abiertos y las preferencias del usuario: tema, fuente, tamano | En la aplicacion, fuera de todo repositorio | No |

El reparto no es de comodidad: es de propiedad. Un boceto describe **ese** proyecto y
viaja con el a otro ordenador; el tema oscuro es de **esta** persona en **esta**
maquina y no tiene nada que hacer en el repositorio de nadie.

Para lo segundo, Tauri ya da el sitio: `app_config_dir()` en su API de rutas, que en
Windows cae bajo `%APPDATA%` con el identificador de la aplicacion. No hace falta
inventar una carpeta.

---

## Que ya funciona

**El motor ya es relativo al proyecto, y esta comprobado, no deducido.** Se monto un
repositorio cualquiera fuera del arbol de Vitral, con su `.vitral/boceto.json` y su
`.vitral/plomo/` dentro, y se corrio el motor desde ahi:

```
node C:/Programacion/Vitral/vitral.mjs --seco

vitral · Tanda en un proyecto ajeno
boceto .vitral\boceto.json · rama trabajo/prueba · plomo 1 archivo (0.1 KB) · olas 1
```

Leyo el boceto de ese proyecto, su plomo, y vio **su** rama de git. Ahi no hay nada
que arreglar: los `import` de `vitral.mjs` se resuelven contra el archivo del motor,
no contra el directorio de trabajo, asi que el motor puede vivir en un sitio y el
proyecto en otro.

La pieza que lo hace posible es una linea, `vitral.mjs:130`:

```js
const raiz = process.cwd();
```

La raiz sale del **directorio desde el que se ejecuta**, y de ahi salen todo lo demas:
donde se pregunta a git, contra que se resuelven las rutas de las tareas, donde se
escriben `.vitral/logs/`, `.vitral/handoffs/` y `.vitral/historial.jsonl`, y con que
directorio de trabajo se lanza cada agente.

**Eso es exactamente lo que necesita una aplicacion que abre proyectos**, y conviene
verlo antes de "mejorarlo": quien lanza un proceso decide su directorio de trabajo.
La aplicacion no necesita una bandera `--raiz`; necesita lanzar el motor con el `cwd`
puesto en el proyecto. Ya se puede.

Y `--boceto` acepta cualquier ruta, con el plomo leyendose del directorio del boceto
(`vitral.mjs:140`). Eso es lo que permite que un mismo proyecto tenga varias lineas de
tanda, como aqui conviven `.vitral/boceto.json` y `.vitral/ui/boceto.json`.

## Que no funciona todavia

- **No hay aplicacion que abra proyectos.** Hoy la ventana de `ui/` lanza
  `powershell.exe` heredando el directorio de trabajo del proceso, y no sabe que
  existe la nocion de proyecto. Un panel no puede arrancar en un sitio distinto de
  otro.
- **No hay lista de proyectos ni preferencias.** No se guarda nada fuera del
  repositorio: ni un archivo de configuracion, ni estado de ventana.
- **Nada de la interfaz lee `.vitral/`.** Es deliberado y sigue siendolo hasta la
  tanda que lo pida.

### Lo que dejo pendiente la tanda del modo json

Tres cosas que salieron de esa tanda, ya entregada, y que no entraban en ella.

**La corrida que falla no imprime resumen, y es la que mas lo necesita.**
`vitral.mjs` hace `if (fallidas.length > 0) { avisoFallo(); return 1; }` y se salta
`salida.resumen()`. El dato de "fuera de ruta" **si se calcula y si se guarda** —el
historial de la corrida `20260820-230341` guarda
`["pruebas/.bloques.txt","pruebas/.chunks.js"]`— pero no se ensena. Solo aparece
haciendo `--historial <id>`, que es justo lo que nadie hace despues de un fallo.

**`motor.md` paso de 27,4 KB a 41,4 KB** al absorber el catalogo de eventos. Es
contrato permanente: esos 14 KB los paga cada vidrio de cada tanda futura, en cada
turno, como contexto releido. Vale la pena mirar si se pueden apretar sin perder
contrato.

**El catalogo de eventos no lo ve quien mas lo necesita.** Su origen unico es
`.vitral/plomo/motor.md`, pero las tandas de la interfaz leen su plomo de
`.vitral/ui/plomo/` —el directorio sale de `path.dirname(rutaBoceto)`— y no ven
`motor.md` jamas. No se arregla duplicandolo: un catalogo en dos sitios diverge. Hay
que decidirlo cuando se planifique la primera tanda de interfaz que consuma el flujo,
con el caso delante.

### El contrato de la interfaz no se parte: decidido el 21-08-2026, con la medida delante

**Cerrado.** Esto estuvo abierto como "decision de contenido pendiente" y ya no lo esta.
Se deja escrito con los numeros para que **no se reabra por intuicion**, que es
exactamente como se iba a reabrir: `panel-pty.md` son 79 KB y parece obvio que partirlo
ahorra mucho. No lo es.

**Lo que si hay que hacer siempre, desde ya: declarar `plomos` en todas las tandas de
interfaz.** Eso no es opcional ni "cuando se acuerde alguien". Es de donde sale casi
todo el ahorro disponible, y no cuesta nada.

#### La decision

`.vitral/ui/plomo/` se queda en **dos archivos**: `panel-pty.md` (79.135 B) y
`corrida.md` (25.093 B), los dos permanentes. No se parte en cinco ni en siete.

#### Los datos que la sostienen

**Medido sobre las siete tandas de interfaz que existieron**, cada una contra el
contrato **como era entonces**, no contra el de hoy:

| Tanda | Vidrios | Contrato entonces | Ahorraria partiendo |
|---|---|---|---|
| PTY | 1 | 21.748 B | **0,0%** |
| panel:fin | 1 | 27.104 B | 34,4% |
| cuadricula | 1 | 35.710 B | 35,8% |
| proyectos | 3 | 52.704 B | 17,8% |
| paleta | 1 | 62.720 B | 36,4% |
| densidad | 3 | 75.588 B | 23,6% |
| modo corrida | 4 | 104.209 B | 29,8% |
| **Total** | **14** | | **26,4%** |

**El reparto nucleo/separable.** Dentro de `panel-pty.md`, el nucleo que lee todo el
mundo —cabecera, "Que es esto", el catalogo IPC, "El camino de los datos", "Que no se
toca", "Lo que no entra", "Los bordes" y "Como se comprueba"— son 24.742 B contra
54.373 B de capas separables: **31 / 69**. Contando `corrida.md`, que toda tarea de una
tanda de esa superficie carga entera, lo fijo contra lo que varia es **48 / 52**.

Ese 48 es el techo: **casi la mitad del contrato la lee todo el mundo hiciera lo que
hiciera el corte.**

**El tamano real de una tanda de interfaz.** Catorce vidrios en siete tandas: 1, 1, 1,
3, 1, 3 y 4. Descontando las revisiones, **de una a tres tareas de codigo, nunca cuatro
ni cinco**. La mediana es **un vidrio**. Todo el razonamiento sobre repartir contratos
entre agentes paralelos es, empiricamente, sobre tandas de una a tres tareas.

**Declarar `plomos` ya captura la mayor parte del ahorro, sin tocar un archivo.** Con
los dos archivos que ya existen, una tarea que no pinte vidrios declara
`["panel-pty.md"]` y se ahorra `corrida.md` entero:

| Forma de tanda futura | Solo declarando `plomos` | Ademas partiendo | Lo que ya captura `plomos` |
|---|---|---|---|
| No toca la superficie corrida (3 vidrios) | 24,1% | 33,6% | **72%** |
| La toca (4 vidrios) | 19,0% | 29,8% | **64%** |

Partir compra **entre 9,5 y 10,8 puntos adicionales**. En dinero, con la cifra de
$0.0137 por KB de prompt y por tarea que esta abajo: **entre $0.40 y $0.60 por tanda**.

Y aplicado hacia atras no compraba nada: **seis de las siete tandas habrian ahorrado
exactamente 0% declarando `plomos`, porque en `plomo/` habia un solo archivo.** El campo
reparte piezas; con una sola pieza no hay nada que repartir. `corrida.md` es la primera
segunda pieza que ha existido.

#### Dos cosas que la media esconde, y conviene no redescubrir

**La tanda del PTY ahorra 0% y no es un fallo del corte.** Su unico vidrio declaraba
`ui/` entera y escribia el subsistema completo: leia todo porque necesitaba todo.
Cuando la tanda **es** la superficie, no hay nada que quitar. Volvera a pasar la proxima
vez que se abra una superficie nueva.

**Las tandas de un vidrio ahorran mas (34-36%) que las de tres o cuatro (18-30%).**
Contraintuitivo y directo: una tarea estrecha suelta todo lo demas, mientras que una
tanda grande abarca mas superficies y arrastra una revision que lee entero. La particion
paga mejor donde menos falta hace.

#### Que reabriria esto

Las dos cosas **a la vez**, no una:

1. Una tanda de interfaz con **cuatro o cinco vidrios**, y
2. el contrato de `.vitral/ui/plomo/` **por encima de 120 KB**.

Con las dos, se vuelve a medir con el metodo de arriba: trocear por secciones,
repartir contra las rutas reales de las tareas, y comparar contra lo que ya da
`plomos` sin partir.

**Ojo con la primera:** el modo corrida ya tuvo cuatro vidrios, asi que esa mitad ya
ocurrio una vez. **El disparador real es el tamano.** Hoy son 104 KB; faltan 16.

Y si alguna vez se parte, esto es lo que costaria, ya averiguado: `corrida.md` cita
`panel-pty.md` **por nombre de archivo en cuatro sitios** —la paleta, la prohibicion de
etiquetas, el proceso huerfano y la primacia—, pero las cuatro **traen el hecho
entrecomillado consigo**, asi que solo hay que cambiarles el nombre del archivo. Los que
si hacen dano son **cuatro punteros que no traen el hecho**: "la seccion de la senal
dice por que" (L1376), "ver la nota del teclado" (L1467 y L1473) y "'El cwd de un panel
es del panel', mas abajo" (L399). Dos de ellos van del nucleo hacia una capa, que es la
direccion equivocada. Los cuatro se arreglan subiendo el hecho al nucleo, y en los
cuatro cabe en una frase.

Y una que **no** hay que hacer aunque parezca limpia: sacar la paleta Pergamino a su
propio archivo. En las cinco tandas que la necesitaron, `paleta` y `frontend` viajaron
**siempre juntos, en las dos direcciones**. Ninguna tarea necesito nunca una sin la
otra. Eso no son dos piezas: es una seccion de otra, y separarlas no ahorra un byte.

#### El modelo de coste, que sigue valiendo

Dos cifras que **no son la misma** y conviene no mezclar:

| Que | Cuanto |
|---|---|
| Cachear el prompt **una vez**, por vidrio | ~$0.39 · en una tanda de cuatro, **~$1.55 de suelo** |
| Escritura de cache **de toda la tanda**, porque el prompt se recachea segun crece la conversacion | **~$5.47** en una tanda de cuatro |

La segunda sale de medir, no de estimar: sumando `cacheCreationInputTokens` de las
cinco tareas de la tanda de los eventos —plomo de 53.5 KB, prompt de 58 KB— dan
**396.824 tokens**, o sea **$3.97**, que son **$0.0137 por KB de prompt y por tarea**.

Es la cifra con la que se convierte cualquier ahorro de KB en dolares, aqui y en
cualquier otra decision de plomo.
### Pendiente del motor: el cierre de tanda no tiene detector

**Tanda de motor, pequena, sin escribir. Anotada el 21-08-2026 con el diagnostico.**

Cerrar una tanda son tres cosas: mover su plomo a `retirados/`, borrar el boceto y
borrar los handoffs. **Es el paso que mas se olvida, y no por descuido: de los tres
artefactos, el handoff es el unico cuyo olvido no deja rastro.**

| Artefacto | Si se olvida | Quien lo canta |
|---|---|---|
| El plomo sin retirar | Viaja en el prompt de cada vidrio de cada tanda siguiente, y se paga en cada uno | La cabecera de `--seco`: dice cuantos archivos de plomo hay y cuanto pesan |
| El boceto sin borrar | `node vitral.mjs` a secas lo relanza tal cual | Se nota en cuanto alguien lo lanza. **Y ya paso**: el 21-08-2026 costo $10.79 |
| **El handoff huerfano** | `--solo` se salta la dependencia que lo tiene, sin mirar de que tanda es, e inyecta su contenido en el prompt del dependiente **como si fuera de esta tanda** | **Nadie** |

Un handoff viejo no estorba: **miente**, y miente dentro de un prompt.

#### Lo que hay que hacer, y es una linea reescrita

**El calculo ya existe.** `cargarHandoffs`, en `src/registro.mjs`, ya compara el sello
`.vitral/handoffs/.tanda` con el nombre de la tanda en curso y cuenta los que son de
otra; `salida.mjs` ya pinta el resultado en la cabecera:

```
        1 handoff en disco es de la tanda "El modo corrida: la ventana lanza una tanda": se ignora
```

**Ese es el hallazgo, redactado como nota al margen.** Dice "se ignora", que suena
inofensivo, cuando lo que significa es *"hay una tanda sin cerrar"*. Convertirlo en
aviso es reescribir una linea que ya se calcula.

**Y va en el motor, no en la ventana**, por una razon que no es de gusto: la ventana lee
esa cabecera del evento `corrida`, asi que un aviso en el motor sirve **en los dos
sitios**. Al reves no: un aviso solo en la ventana dejaria mudas las tandas lanzadas
desde una terminal, **que son justo las que se olvidaron de cerrar**.

#### Lo que hay que ampliar, y es lo unico que no es gratis

**El detector de hoy no enumera: mira por nombre.** `cargarHandoffs` recorre las
**tareas del boceto en curso** y hace `existsSync` de `<id>.md` por cada una. Con lo
cual solo ve un handoff huerfano **si su id coincide con el de una tarea de la tanda
nueva**. Es lo que ya dice el contrato del planificador —*"el sello solo lo caza si la
tanda siguiente reutiliza ese id"*— y es lo que hace que el aviso llegue tarde o no
llegue.

Para que sea un detector de verdad hay que leer el directorio, no las tareas. Es un
`readdirSync` en `registro.mjs`, que es el modulo al que le corresponde por la tabla
"Donde va cada cosa": *"Cambiar donde o con que nombre se guarda algo en `.vitral/`"*.
Y el aviso lo pinta `salida.mjs`, por la invariante 1.

**Ojo con dos bordes al escribirla:** no confundir `<id>.INCOMPLETO.md` con un handoff
—son dos artefactos y el segundo tambien queda huerfano—, y **no avisar cuando el sello
coincide**, porque entonces los handoffs son de la tanda que se esta relanzando y estan
donde tienen que estar.

#### Por que no lo hace la ventana

Se evaluo y se descarto. Cerrar tiene siete pasos, cinco mecanicos y tres de juicio, y
el segundo es la puerta: *¿este plomo es permanente o es de esta tanda?* La ventana no
puede responderlo, y hasta el 21-08-2026 **el propio `corrida.md` lo respondia mal de si
mismo** —decia "se retira al cerrar" siendo permanente—, asi que una automatizacion que
lo hubiera leido habria borrado el contrato vivo de esa superficie. Se arreglo poniendo
la declaracion en la cabecera de los tres contratos permanentes.

Ademas, el cierre ocurre en `chore/retirar-<tanda>`, una rama que la persona crea
**antes** de que se toque nada. La ventana no toca git, asi que no puede garantizar esa
precondicion, y borrar en la rama equivocada es peor que el olvido que se queria evitar.

### Un borde que hoy es un fallo latente

`--boceto` puede apuntar a un boceto de **otro** proyecto, y el motor lo ejecuta contra
el directorio actual sin decir nada. Comprobado: desde ese repositorio de prueba, con
el boceto de la interfaz de Vitral, la cabecera sale asi:

```
vitral · La cuadricula de paneles
boceto C:/Programacion/Vitral/.vitral/ui/boceto.json · rama trabajo/prueba · olas 1
```

Contratos de un proyecto, raiz de otro. Las rutas de las tareas se resolverian contra
la raiz equivocada y los handoffs se escribirian en el proyecto equivocado. Nadie lo
detecta. Cuando haya varios proyectos abiertos a la vez, esto deja de ser una
curiosidad.

---

## Que no debe hacerse

Decisiones que cerrarian esta puerta sin que se note hasta que sea cara de reabrir.

**No convertir "el proyecto" en un global.** Ni en Rust, ni en JavaScript, ni en el
motor. Un proyecto es una cosa direccionable, como ya lo es un panel. En el momento en
que exista *la* raiz en singular en algun sitio, abrir dos proyectos pasa a ser una
reescritura.

**El directorio de trabajo de un panel es del panel, no de la aplicacion.** Hoy
`abrir_panel` no recibe ninguno y el shell hereda el de la aplicacion. La tanda que
necesite paneles en proyectos distintos tendra que anadirlo, y la forma correcta es
**un parametro mas del comando**, junto al id, no un ajuste global "la carpeta
actual". Es la misma leccion que ya dio el `id`: lo que algun dia va a variar por
panel, entra por parametro desde el principio.

**El modo corrida es donde mas facil se cierra.** Un panel que representa un vidrio
necesita saber tres cosas —de que proyecto es, de que corrida y de que tarea— y las
tres tienen que viajar con el panel. Si en su lugar se escribe "la corrida en curso"
como estado unico de la aplicacion, quedan fuera para siempre dos cosas que ya estan
en el rumbo: mirar dos proyectos a la vez, y tener un panel suelto de shell al lado de
los vidrios de una corrida.

**No meter el estado de la aplicacion en el proyecto, ni al reves.** La lista de
proyectos no va en ningun `.vitral/`; los bocetos y los handoffs no van en la
configuracion de la aplicacion. Si alguna vez hace falta recordar algo por proyecto
que **no** sea del proyecto —la posicion de la ventana, que paneles estaban abiertos—
va en la configuracion de la aplicacion, indexado por la ruta del proyecto.

**No hacer que el motor dependa de la interfaz.** El motor se corre desde una terminal
y tiene que seguir corriendose asi: es como se prueba, como se depura y como funciona
para quien no quiera ventana. La interfaz lanza el motor; el motor no sabe que existe
la interfaz.

**No indexar el codigo del proyecto.** Repetido a proposito, porque es la que va a
volver cada pocas tandas disfrazada de mejora pequena.
