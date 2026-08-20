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

**Solo escribe dentro de `.vitral/`**, y en la practica solo dos sitios:
`.vitral/plomo/*.md` y el boceto. Nada mas. Ni `src/`, ni `README.md`, ni
`.gitignore` —aunque el plan lo necesite: eso se anota como pendiente para la
persona, porque es justo el tipo de cosa que un plomo da por hecha y nadie hace.

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
| **Abrir** | `feat/<tanda>` | Se escriben `.vitral/boceto.json` y `.vitral/plomo/<tanda>.md` |
| **Ejecutar y verificar** | la misma `feat/<tanda>` | Lo que escriban los agentes. Se verifica y se mergea a `main` |
| **Cerrar** | `chore/retirar-<tanda>` | El plomo se mueve a `.vitral/plomo/retirados/`, y se borran el boceto y los handoffs de la tanda |

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
| El planificador | Mueve el plomo a `retirados/`, borra el boceto, borra los handoffs de los ids de la tanda |
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

Y un aviso mas, si la persona esta en `main` o `master`: la corrida real va a
abortar. Es deliberado.

Y lo tercero, que es lo que mas se olvida porque pasa dias despues: **dejar escrito
el pendiente del cierre**, con los nombres ya rellenados, no en abstracto. El
planificador no va a estar delante cuando la tanda termine, asi que lo deja dicho
ahora:

```
Cuando esto este mergeado en main, la tanda se cierra en chore/retirar-<tanda>:
retirar .vitral/plomo/<tanda>.md a retirados/, borrar .vitral/boceto.json y
borrar los handoffs de <ids de la tanda>.
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
6. **Decir que queda para la persona:** commitear en `chore/retirar-<tanda>` y
   mergear. Y si el cierre revelo algo —un pendiente que nadie hizo, un contrato que
   habria que promover a permanente—, decirlo aqui, que es la ultima oportunidad.

Lo que **no** se toca en una sesion de cierre: `.vitral/plomo/retirados/LEEME.md`,
cualquier subsistema con boceto propio como `.vitral/ui/`, y todo lo que este fuera de
`.vitral/`.

---

## Como se ve

La variabilidad se concentra donde el contrato calla, y en lo visual se nota a
simple vista. Esta fase no trae ningun principio nuevo: es la pregunta que cierra
la lista de mas abajo —*¿hay algo que importe que salga igual y que el contrato no
este diciendo?*— aplicada al sitio donde falla mas veces y mas rapido.

Produce una sola cosa: la tabla "Como se ve" del plomo, con valores literales.

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
| Paleta | La persona | El planificador propone dos o tres completas; ella elige una |
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

### Como se propone

Aqui es donde la fase se estropea si se hace mal. **Se proponen paletas completas
y con valores, no adjetivos.** Una paleta "sobria y profesional" no es una paleta:
es la misma nada que "ya lo iremos viendo", y acaba igual, con tres agentes
eligiendo tres cosas distintas.

Lo que se pone delante de la persona son dos o tres bloques cerrados, cada uno con
todos sus valores, listos para copiar:

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

Ella elige una letra. No rellena un hueco, no busca un color, no aprende nada de
diseno. Y si dice "la A pero el acento mas apagado", eso es una eleccion valida:
el planificador cierra el valor nuevo y repite el bloque entero, para que lo que
se lleva al plomo siga siendo una paleta completa y no un parche.

**El numero de colores sale de los estados, no al reves.** Primero se enumera que
estados tiene la superficie; despues se propone una paleta que los cubra todos. Al
reves salen paletas bonitas a las que les falta el color de "deshabilitado", y ese
color acaba eligiendolo un agente.

**Y la paleta casi nunca esta en blanco.** Si ya hay superficie entregada, sus colores
ya son contrato y las propuestas nacen dentro de ellos, no al lado. Conviene decirle a
la persona cuales son antes de que elija, porque son la restriccion real: en la tanda de
proyectos, cuatro valores del terminal ya estaban fijados y la barra lateral tenia que
nacer dentro de esos cuatro.

**Los contrastes se miden, no se estiman.** Cuesta un minuto y evita fijar en el
contrato un texto secundario que no se lee. En esa misma tanda, el `texto-tenue` de las
tres propuestas se quedaba entre 3.6 y 3.8 sobre su fondo, por debajo del minimo de 4.5,
y se corrigio antes de ensenarlas. El estado deshabilitado es la excepcion y va por
debajo a proposito: tiene que verse apagado.

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

**Las rutas se declaran por archivo exacto, no por carpeta.** `src/registro.mjs`,
no `src/`. La comparacion de solapamiento es por segmento de ruta, asi que
`src/registro.mjs` y `src/salida.mjs` conviven sin problema, pero `src/` choca con
las dos. Declarar una carpeta le da al agente permiso para escribir en archivos
que no son suyos, y el motor no lo va a impedir si esta declarado.

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

Los tres ultimos se validan solo si vienen, y ojo con `null`: omitido y `null` no
son lo mismo, y `null` es invalido en los tres.

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
| Proponer paletas sin preguntar antes si ya hay direccion | Nadie lo detecta, y el coste lo paga la persona teniendo que frenar al planificador. Es la primera pregunta de la fase 3 |
| Proponer colores sin mirar los que ya son contrato | Nadie lo detecta. Si hay superficie entregada, sus valores son la restriccion de entrada y se dicen antes de que la persona elija |
| Un plomo de una tanda vieja que sigue en `.vitral/plomo/` | La cabecera de `--seco` dice cuantos archivos de plomo hay y cuanto pesan |
| Un boceto ya ejecutado que sigue en `.vitral/boceto.json` | Nadie lo detecta. `node vitral.mjs` sin banderas lo relanza tal cual, y si su plomo ya se movio, los agentes corren sin contrato y el prompt no lo dice |
| Un handoff viejo de un id que se repite entre tandas | Nadie lo detecta. `--solo` se salta las dependencias que tienen handoff en disco sin mirar de que tanda son, e inyecta el contenido viejo en el prompt del dependiente |
| El mismo dato explicado en dos prompts | Nadie lo detecta. Buscar el dato repetido: si esta en dos prompts, es plomo |
| Un ejemplo del plomo escrito a mano | Nadie lo detecta. Generarlo llamando al codigo real y pegar la salida |
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
