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
