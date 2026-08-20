# Contrato · panel de terminal en Tauri

Este es el contrato permanente de la interfaz, como `motor.md` lo es del motor. No
es el plomo de una tanda: sobrevive a las tandas y se corrige cuando el codigo
desmiente algo de aqui.

**Vive en su propio directorio a proposito.** El boceto es `.vitral/ui/boceto.json` y
este es el unico plomo que lo acompana, asi que las corridas de interfaz se lanzan
con `--boceto .vitral/ui/boceto.json`. `.vitral/plomo/motor.md` **no** entra en estos
prompts: son 20 KB de contrato sobre modulos de Node que la interfaz no toca. Lo poco
que hay que saber del motor esta abajo, en tres frases.

**Lo que no esta aqui:** como se verifico cada cosa —el experimento de ConPTY con sus
nueve medidas, la procedencia de cada simbolo y la cadena del inspector— vive en
`.vitral/ui/procedencia.md`, fuera de `plomo/` y por tanto fuera de estos prompts.
Sigue versionado y sin tocar una letra. Aqui se queda lo que hay que cumplir; alli,
como se supo. Cuando una regla de este archivo parezca prescindible, la respuesta
esta en ese archivo antes que en releer esta.

---

## Que es esto

Una ventana de escritorio con paneles de terminal dentro, donde se escriben comandos
y se ve su salida: con colores, con cursor, con Ctrl+C funcionando. Terminales de
verdad, no cuadros de texto que imprimen lineas.

Hoy hay **hasta cuatro** paneles en una rejilla, cada uno con su `powershell.exe`
dentro.

### Lo que hay que saber del motor, y es todo

1. **El motor Node sigue haciendo la orquestacion.** La interfaz no la reimplementa,
   ni ahora ni despues.
2. **El contrato entre interfaz y motor es el sistema de archivos `.vitral/`**, igual
   que el plomo es el contrato entre agentes. Cuando la interfaz lea el estado de una
   corrida, lo leera de ahi.
3. **Hoy nada de eso se usa.** Un panel es un PTY con un renderizador delante. Que
   dentro corra PowerShell hoy y un agente manana no cambia el panel.

No se lee `.vitral/`. No se llama a `vitral.mjs`. No se importa nada de `src/`.

### La puerta que se dejo abierta, y que ya se cruzo

Cuando solo habia un panel, este contrato prometia que anadir la cuadricula seria "un
bucle en el frontend y CSS, sin tocar Rust", porque todo iba direccionado por `id`
desde el primer dia. **Se cumplio.** La cuadricula no cambio ni una letra de Rust ni
del catalogo IPC: el mapa ya estaba direccionado por id, los comandos ya llevaban id,
los eventos ya lo traian, y el vigia ya era uno por panel.

Conviene dejarlo escrito porque es la unica prueba que hay de que la disciplina sale
a cuenta: el `HashMap` y el parametro `id` que durante dos tandas valieron siempre
`"1"` parecian codigo sin usar, y eran justo lo contrario.

### A donde va esto

Queda **el modo corrida**: que cada panel sea un vidrio de una tanda, con el id de la
tarea, su comando en vez de un shell suelto, y el estado leido de `.vitral/`. Eso es
otra tanda y aqui no se prepara nada para ella, salvo lo que ya esta: los ids y el
`cwd` por panel.

La tanda de proyectos, que es la que introdujo la barra lateral, dio un paso mas en la
misma direccion: `abrir_panel` recibe su directorio por parametro, y ni Rust ni el
frontend tienen un "proyecto actual" global. Vale la misma leccion que con el `id`.

Lo que **no** se hace mientras tanto: ni pestanas, ni divisiones arrastrables, ni
configuracion, ni guardar el scrollback entre arranques, ni leer `.vitral/`. Codigo
sin usar es codigo que hay que revisar igual.

---

## Las versiones

Salen de crates.io, del registro de npm y de la maquina, comprobadas el 19-08-2026. No
se cambian por otras "mas nuevas" sin comprobarlo igual.

| Pieza | Version | Nota |
|---|---|---|
| `tauri` | 2.11.5 | con las features por defecto; **sin** la feature `devtools` |
| `tauri-cli` | 2.11.4 | instalado con `cargo install tauri-cli --locked` |
| `portable-pty` | 0.9.0 | la de wezterm. Es quien habla ConPTY |
| `base64` | 0.23.1 | para los bytes del PTY |
| `serde` | 1, feature `derive` | las cargas de los eventos necesitan `Serialize` |
| `@xterm/xterm` | 6.0.0 | vendorizado, no por npm |
| `@xterm/addon-fit` | 0.11.0 | vendorizado, no por npm |

**No se usa `tauri-plugin-pty`.** Existe y envuelve estas mismas piezas, pero tiene 44k
descargas y no declara repositorio en crates.io. Demasiada confianza ciega para la
unica pieza que de verdad importa. Si aparece la tentacion a mitad de una tarea: no.

## La maquina

`rustc` y `cargo` 1.97.1, toolchain `x86_64-pc-windows-msvc`, Visual Studio 2022 Build
Tools, WebView2 151.

Existe `powershell.exe` (Windows PowerShell 5.1) y **no** existe `pwsh.exe`. El shell
del panel es `powershell.exe`, en una constante y en un solo sitio.

Tauri solo necesita Node.js si el frontend usa un framework de JavaScript. Este no usa
ninguno: **no hay `package.json` ni `node_modules` en ningun sitio del repositorio**.

---

## Disposicion de archivos

```
ui/
  web/
    index.html
    panel.js
    vendor/
      xterm.mjs          de @xterm/xterm 6.0.0, lib/xterm.mjs
      xterm.css          de @xterm/xterm 6.0.0, css/xterm.css
      addon-fit.mjs      de @xterm/addon-fit 0.11.0, lib/addon-fit.mjs
  src-tauri/
    Cargo.toml
    Cargo.lock           se versiona: es una aplicacion, no una biblioteca
    build.rs
    tauri.conf.json
    capabilities/
      default.json
    icons/
      icon.ico           obligatorio, ver abajo
    src/
      main.rs
```

**Regla que no se rompe: toda ruta se nombra completa desde la raiz del repositorio.**
Hay dos directorios llamados `src` y significan cosas distintas:

| Ruta | Que es | Quien la toca |
|---|---|---|
| `src/` | el motor de Vitral, Node/ESM | **nadie**, en ninguna tanda de interfaz |
| `ui/src-tauri/src/` | el crate de Rust de la interfaz | las tandas de interfaz |

Nunca se escribe `src/main.rs` a secas. Se escribe `ui/src-tauri/src/main.rs`.

El frontend va en `ui/web/` y no en `ui/src/`, que es lo que genera el andamio de
Tauri, para que no haya un tercer `src`.

### El icono es obligatorio aunque no se empaquete

`ui/src-tauri/icons/icon.ico` existe y **no se borra**, pese a que no se empaqueta
ningun instalador. `tauri-build` 2.6.3 compila el recurso de Windows en toda
compilacion para `*-windows-*` sin mirar `bundle.active`, y aborta con
`` `icons/icon.ico` not found `` si falta: el valor por defecto esta en
`tauri-build-2.6.3/src/lib.rs:618`, en un `.unwrap_or("icons/icon.ico")`. Poner
`bundle.icon: []` no lo salta.

Es un `.ico` minimo de 32x32 en `#0c0c0c`, 4286 bytes. No hace falta un juego de
iconos hasta que haya instalador.

### De donde salen los archivos vendorizados

Del paquete oficial con `npm pack`, que descarga el tgz sin instalar nada:

```
npm pack @xterm/xterm@6.0.0
npm pack @xterm/addon-fit@0.11.0
```

Dentro del tgz estan en `package/lib/xterm.mjs`, `package/css/xterm.css` y
`package/lib/addon-fit.mjs`. Se copian a `ui/web/vendor/` con los nombres de la tabla
y **sin modificarlos**. El tgz no se deja en el repositorio.

`xterm.mjs` exporta `Terminal` como export con nombre:

```js
import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';
```

---

## El catalogo IPC: origen unico

Esta tabla es la **unica** fuente de los nombres que cruzan de Rust a JavaScript. Se
copia literal en los dos lados: sin traducir, sin reordenar, sin renombrar.

La cuadricula no la toco: cuatro comandos con `id` y dos eventos con `id` bastaban para
N paneles igual que para uno. La tanda de proyectos si la toca, y en lo minimo: un
argumento mas en `abrir_panel` y cuatro comandos nuevos que no hablan de paneles.

### Comandos

| Comando | Argumentos | Devuelve |
|---|---|---|
| `abrir_panel` | `id: String`, `cwd: String`, `filas: u16`, `columnas: u16` | `Result<(), String>` |
| `escribir_en_panel` | `id: String`, `datos: String` | `Result<(), String>` |
| `redimensionar_panel` | `id: String`, `filas: u16`, `columnas: u16` | `Result<(), String>` |
| `cerrar_panel` | `id: String` | `Result<(), String>` |
| `leer_estado` | — | `Result<Estado, String>` |
| `anadir_proyecto` | `ruta: String` | `Result<Estado, String>` |
| `quitar_proyecto` | `ruta: String` | `Result<Estado, String>` |
| `guardar_preferencias` | `activo: Option<String>`, `plegada: bool` | `Result<(), String>` |

`Estado` es lo que ve el frontend, y **no** es lo que hay en el archivo: lleva el nombre
y la disponibilidad ya calculados, que el archivo no guarda.

```json
{
  "proyectos": [
    { "ruta": "C:\\Programacion\\Proyectos\\Vitral", "nombre": "Vitral", "disponible": true },
    { "ruta": "D:\\viejo\\motor", "nombre": "motor", "disponible": false }
  ],
  "activo": "C:\\Programacion\\Proyectos\\Vitral",
  "plegada": false
}
```

Los tres comandos que devuelven `Estado` devuelven **el estado entero ya recalculado**,
no un parche. El frontend repinta con lo que recibe y no mantiene su propia copia
divergente.

Los argumentos viajan de JS a Rust en camelCase. Como ninguno lleva mayusculas
intermedias, se escriben igual en los dos lados. Es deliberado: **no se anaden
argumentos de dos palabras**.

```js
await invoke('abrir_panel', {
  id: '1',
  cwd: 'C:\\Programacion\\Proyectos\\Vitral',
  filas: 30,
  columnas: 100,
});
```

**`cwd` no es opcional y va siempre absoluto.** Omitirlo, o mandarlo relativo, es el
fallo mudo de esta tanda: el panel abre igual, el prompt aparece igual, y arranca en el
home del usuario. Nadie lo ve hasta que escribe `pwd`.

Y los de proyecto, que no hablan de paneles:

```js
const estado = await invoke('leer_estado');
await invoke('anadir_proyecto', { ruta: 'C:\\Programacion\\Proyectos\\motor' });
await invoke('quitar_proyecto', { ruta: 'C:\\Programacion\\Proyectos\\motor' });
await invoke('guardar_preferencias', { activo: null, plegada: true });
```

### Todos los comandos son asincronos

```rust
#[tauri::command(async)]
fn abrir_panel(...) -> Result<(), String>
```

**Esto no es opcional y no es estilo.** La documentacion de Tauri v2 lo dice sin
rodeos: *"Commands without the async keyword are executed on the main thread unless
defined with `#[tauri::command(async)]`"*. Un comando sincrono que bloquee —una
escritura a una tuberia llena, un `resize` que no vuelve, un mutex retenido— congela la
ventana entera, no solo el panel.

Hoy ninguna de esas operaciones bloquea: `wait()`, `write_all`, `resize` y `kill`
sobre un hijo ya muerto retornan en 0.00 s, y soltar el maestro tambien. Esta medido
tres veces, y las nueve cifras estan en `.vitral/ui/procedencia.md`. La regla es para
el dia que alguna lo haga. Cuesta una linea por comando.

Vale para los ocho, no solo para los de panel. Los cuatro de proyecto tocan disco
—leen y escriben `estado.json`, y comprueban directorios— y un disco lento o una unidad
de red que no responde bloquearian la ventana entera exactamente igual.

El `Mutex` del mapa es el de la biblioteca estandar y **no se sostiene a traves de
ningun `await`**: los comandos no esperan a nada mientras lo tienen. Si algun dia uno
necesita esperar, primero suelta el bloqueo.

### Eventos

| Evento | Carga | Cuando |
|---|---|---|
| `panel:salida` | `{ id: String, datos: String }` | cada vez que el PTY escribe algo |
| `panel:fin` | `{ id: String, codigo: u32 }` | una vez, cuando el proceso del panel termina |

`datos` en `panel:salida` es **base64**, no texto.

### Errores

Todo comando devuelve `Result<(), String>`. Cuando falla, el `String` es un mensaje en
espanol, corto y en minuscula, que nombra el panel:

```
no hay ningun panel con id "3"
ya existe un panel con id "1"
no se pudo lanzar "powershell.exe": <lo que diga el sistema>
```

**Ningun comando entra en panic.** Un `unwrap()` sobre algo que puede fallar mata la
aplicacion entera y deja la ventana en blanco sin decir por que. Un `Mutex` envenenado
tambien se convierte en `Err`.

---

## El camino de los datos

Los dos sentidos no son simetricos.

**Del teclado al proceso.** xterm entrega lo tecleado como texto ya interpretado, en su
evento `onData`, que da un `string`. Ese texto se manda tal cual en
`escribir_en_panel`, y Rust escribe sus bytes UTF-8 en el escritor del PTY.

**Del proceso a la pantalla.** Aqui no vale texto: el PTY devuelve bytes, y un caracter
UTF-8 de varios bytes puede quedar partido entre dos lecturas. Si Rust convierte cada
lectura a `String` por su cuenta, esa mitad se vuelve un simbolo de reemplazo y el
caracter se pierde. Por eso:

1. Rust lee bytes crudos del PTY, en trozos de 4096.
2. Los codifica en base64 y los emite en `panel:salida`.
3. El frontend decodifica a `Uint8Array`.
4. Se lo pasa a xterm con `term.write(bytes)`.

`write` acepta `string | Uint8Array`, y con bytes hace el decodificado UTF-8 el mismo,
arrastrando los caracteres partidos de una escritura a la siguiente. Se deja que lo
haga quien sabe.

Mandar `Vec<u8>` sin codificar tambien funciona, pero Tauri lo serializa como un array
JSON de numeros: cuatro veces mas grande por byte.

---

## ConPTY: lo que hay que saber y no es evidente

Esta seccion existe porque cada punto de aqui costo una sesion de diagnostico. Todo
esta medido contra `portable-pty` 0.9.0 en esta maquina, no deducido: el experimento
y sus nueve medidas estan en `.vitral/ui/procedencia.md`.

### El fin del PTY no lo marca la muerte del hijo

**Es la trampa central de ConPTY y ya rompio la interfaz una vez.**

En Unix, cerrar el descriptor del lado esclavo es lo que hace que el maestro lea EOF.
**En Windows eso es falso**, y creerlo cuesta un panel que se queda mudo:

- Maestro y esclavo **comparten el mismo estado**: en
  `portable-pty-0.9.0/src/win/conpty.rs`, `ConPtySlavePty` se construye con
  `inner: master.inner.clone()`, un `Arc<Mutex<Inner>>`. Soltar el esclavo no cierra
  nada, solo suelta una referencia.
- El extremo de escritura de la tuberia que alimenta al lector se lo quedo
  `CreatePseudoConsole`; la copia propia se suelta dentro de `PsuedoCon::new`.
- Ese extremo solo se cierra en `Drop for PsuedoCon`, que llama a
  `ClosePseudoConsole`. Y `Inner` vive mientras viva **el maestro**.

Conclusion, y es la regla: **el lector solo ve el final del PTY cuando se suelta el
maestro.** Mientras el maestro este guardado en algun sitio, `read()` se queda dentro
para siempre aunque el proceso lleve un cuarto de hora muerto.

Un `drop(par.slave)` despues de lanzar el proceso es inofensivo, pero **no** hace lo
que parece. Si se deja en el codigo, se deja sin comentario que prometa un EOF, porque
ese comentario es lo que hizo que alguien se fiara.

### ConPTY pregunta donde esta el cursor antes de arrancar

`portable-pty` crea la pseudoconsola con el flag `PSUEDOCONSOLE_INHERIT_CURSOR`
(`src/win/psuedocon.rs`). Con ese flag, lo primero que ConPTY escribe son cuatro bytes,
`\x1b[6n`, y **se queda esperando la respuesta del terminal** antes de arrancar al
cliente. Sin respuesta no hay prompt, no llega la entrada y el proceso no muere nunca.

xterm.js contesta sola, que es la razon de que la interfaz funcione. Cualquier cosa que
lea de este PTY sin ser un emulador de terminal completo —una prueba, un volcado a
archivo, un futuro modo sin ventana— **tiene que contestar** `\x1b[1;1R` o quedarse
colgada en el primer paso.

---

## El ciclo de vida de un panel

### Abrir

Con los simbolos exactos de `portable-pty` 0.9.0:

- `native_pty_system()` da el sistema nativo, que en Windows es ConPTY.
- `.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })` devuelve un
  `PtyPair` con `.master` y `.slave`. Los campos se llaman `rows` y `cols` en ingles
  porque son de la biblioteca; los argumentos del comando se llaman `filas` y
  `columnas` porque son nuestros. No se mezclan.
- `CommandBuilder::new(SHELL)` arma el proceso. **No se le fija `cwd`**: hereda el del
  proceso de la aplicacion.
- `pair.slave.spawn_command(cmd)` lo lanza y devuelve el `Child`.
- `pair.master.take_writer()` da el escritor que se guarda.
- `pair.master.try_clone_reader()` da el lector que se lleva el hilo lector.
- `hijo.clone_killer()` da el verdugo que se guarda para `cerrar_panel`.

El estado compartido, direccionado por id:

```rust
struct Panel {
    escritor: Box<dyn Write + Send>,
    maestro: Box<dyn MasterPty + Send>,
    verdugo: Box<dyn ChildKiller + Send + Sync>,
}

struct Paneles(Mutex<HashMap<String, Panel>>);
```

`abrir_panel` con un id que ya existe devuelve `Err` y **no** abre un segundo PTY.

### Los dos hilos, y quien hace que

Cada panel arranca **dos** hilos. El reparto es contrato, porque de el depende que la
linea de cierre salga y salga en su sitio:

| Hilo | Que hace |
|---|---|
| **lector** | Lee del PTY en trozos de 4096 y emite `panel:salida`. Sale del bucle con `Ok(0)` o con `Err`, indistintamente. **Al salir no emite nada mas** |
| **vigia** | `hijo.wait()`, que bloquea hasta que el proceso muere. Con el codigo en la mano: quita la entrada del mapa, espera a que el lector termine, y emite `panel:fin` |

El orden dentro del vigia importa y es el siguiente:

1. `hijo.wait()` devuelve el estado. `estado.exit_code()` es el codigo.
2. Quitar la entrada del mapa. **Eso suelta el maestro**, y soltarlo es lo unico que
   desbloquea al lector: la seccion de ConPTY explica por que. Si la entrada ya no
   esta —porque alguien cerro el panel o la ventana— no es un error.
3. **Soltar el bloqueo del mapa antes de seguir.** Esperar al lector con el mutex en la
   mano bloquearia a los comandos sin ninguna necesidad.
4. Esperar a que el hilo lector termine (`join`). El lector todavia tiene que vaciar lo
   que quedara en la tuberia: cerrar el extremo de escritura no descarta lo ya escrito,
   asi que la ultima salida llega **antes** del `Ok(0)`.
5. Emitir `panel:fin` con el id y el codigo.

Ese `join` es lo que garantiza que la linea de cierre aparezca **despues** del ultimo
trozo de salida y no en medio. Es la razon de que emita el vigia y no el lector.

`panel:fin` se emite **exactamente una vez** por panel, pase lo que pase.

Si `wait()` devuelve `Err` —no deberia—, se emite igual con `codigo: 1`, porque el
contrato promete que la linea de cierre siempre sale. Vale mas un codigo aproximado que
un panel que se queda mudo, que es justo el fallo que esto arregla.

**Los cinco pasos no se simplifican.** El vigia parece mas complicado de lo necesario y
no lo es: cada paso esta ahi por un fallo que ya ocurrio o por una medida concreta.
Cuatro cambios que se ven baratos y estan prohibidos:

- **Quitar el `join` del paso 4.** Parece que el lector ya habra terminado, porque el
  proceso esta muerto. No lo ha hecho: cerrar el extremo de escritura no descarta lo ya
  escrito, asi que queda salida en la tuberia. Sin el `join`, `panel:fin` sale **en
  medio** del ultimo trozo.
- **Esperar al lector con el bloqueo del mapa en la mano**, ahorrandose el paso 3.
  Bloquea a los cuatro comandos durante toda la espera y congela la ventana entera, no
  solo el panel que murio.
- **Poner un `drop(par.slave)` y fiarse de que llegue un EOF.** Es la trampa central de
  ConPTY, esta explicada arriba, y ya rompio la interfaz una vez.
- **Emitir `panel:fin` desde el lector al salir del bucle**, que parece lo natural. El
  lector no sabe el codigo de salida y ademas sale antes de que el vigia lo sepa. Por
  eso el lector, al salir, **no emite nada**.

`ui/src-tauri/src/main.rs` implementa estos cinco pasos numerados y en orden, y
sobrevivio a la tanda de la cuadricula sin tocarse. Reordenarlos o fundirlos es cambiar
el contrato, no refactorizar: se dice en el handoff antes de tocar nada.

### Un panel muerto ya no esta en el mapa

Cuando el proceso termina solo, el vigia **borra la entrada**. A partir de ese momento
los tres comandos sobre ese id devuelven el error de id desconocido que ya existe:

```
no hay ningun panel con id "1"
```

Y esta bien asi: el frontend ya marco el panel como muerto al recibir `panel:fin` y no
vuelve a llamarlos. La ventana sigue mostrando el panel con todo su scrollback; quien
lo olvida es Rust, no el usuario.

### Cerrar

`cerrar_panel` quita la entrada del mapa y llama a `.kill()` sobre el verdugo. Matar un
proceso que ya murio falla en Windows y **no es un error**: el panel queda cerrado, que
es lo que se pedia.

Al cerrar la ventana (`WindowEvent::CloseRequested`) se matan todos los paneles vivos.
Un `powershell.exe` huerfano que sobrevive a la ventana es un fallo, no un detalle.

### Dos cosas de Tauri v2 que cuestan una tarde

- **Para `.emit()` hace falta `use tauri::Emitter;`.** En v1 el metodo se llamaba
  `emit_all` y estaba en otro sitio; los ejemplos viejos de internet no compilan.
- **Para `.manage()` y `.state()` hace falta `use tauri::Manager;`.**

---

## `ui/src-tauri/tauri.conf.json`

| Campo | Valor | Por que |
|---|---|---|
| `app.withGlobalTauri` | `true` | **Sin esto no hay interfaz.** Es lo que pone la API en `window.__TAURI__`. Por defecto es `false`, y entonces `invoke` solo se puede importar del paquete npm `@tauri-apps/api`, que aqui no existe |
| `build.frontendDist` | `"../web"` | Apunta a `ui/web/`, relativo a `ui/src-tauri/`. **Sin `devUrl`**: no hay servidor de desarrollo porque no hay bundler |
| `app.security.csp` | `null` | Desactiva la politica inyectada. Decision consciente: xterm inyecta estilos y una CSP mal puesta se manifiesta como una ventana en blanco sin ningun mensaje. Se revisa cuando la interfaz cargue datos de verdad |
| `bundle.active` | `false` | No se empaqueta instalador. Ojo: esto **no** exime del icono, ver arriba |

`identifier` es `com.vitral.ui`, el binario se llama `vitral-ui.exe`, la ventana `main`
se titula `Vitral` y arranca en 1000 x 700.

En JavaScript, con `withGlobalTauri`:

```js
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
```

Ojo al `.core`: en v1 era `window.__TAURI__.invoke` y en v2 ahi no hay nada. Es el error
mas repetido al migrar y no da un mensaje util, solo `undefined`.

## `ui/src-tauri/capabilities/default.json`

Para la ventana `main`, y con exactamente estos permisos:

| Permiso | Por que |
|---|---|
| `core:default` | El conjunto por defecto de Tauri. Se eligio entero y no un permiso suelto porque `listen` necesita al menos `core:event:default` y no hay forma de descubrir que mas hace falta sin arrancar la ventana: un permiso de menos es una ventana rota que hay que depurar a ciegas |
| `core:window:allow-close` | Cerrar la ventana desde JavaScript. **No** entra en `core:default`, y sin el la llamada falla con `window.close not allowed` |
| `dialog:allow-open` | El selector nativo de carpeta con el que se anade un proyecto. Lo trae `tauri-plugin-dialog`, y es el unico permiso suyo que se pone: no se abre su conjunto `default`, que traeria ademas `allow-message` y `allow-save` |

Los **ocho** comandos propios de la aplicacion no necesitan permiso: las capabilities
gobiernan los comandos de Tauri y de sus plugins, no los que declara uno. Por eso leer y
escribir `estado.json` no anade ninguna entrada aqui, y en cambio abrir el selector si:
ese comando es del plugin, no nuestro.

Si al arrancar sale un error de permiso denegado nombrando un comando, se anade **ese**
permiso y solo ese. Asi salio `core:window:allow-close`: la cuadricula lo destapo al
probar el caso limite de cerrar el ultimo panel, el mensaje nombraba el permiso que
faltaba, y se anadio ese. No se abrio la capability entera por comodidad.

---

## Proyectos

Vitral abre proyectos. Un proyecto es **una ruta en disco y nada mas**: no se copia, no
se importa, no se registra nada dentro de el. Lo fija el rumbo y esta tanda no lo
discute.

**Vitral no lee ni indexa el codigo del proyecto.** Ni un arbol, ni una cache, ni una
lista de archivos. Lo unico que se mira de una ruta es que exista y sea un directorio.
Si al implementar aparece la tentacion de enumerar lo que hay dentro, la respuesta es
no, y se anota en el handoff en vez de hacerlo.

### Donde se guarda la lista

En la aplicacion, fuera de todo repositorio:

```
%APPDATA%\com.vitral.ui\estado.json
```

Verificado en la fuente, no supuesto: `app.path().app_config_dir()` de tauri 2.11.5
(`src/path/desktop.rs:238`) resuelve a `dirs::config_dir()/${identifier}`; en Windows
`dirs 6.0.0` devuelve `known_folder_roaming_app_data()`; y el `identifier` de
`tauri.conf.json` es `com.vitral.ui`. En esta maquina, eso es
`C:\Users\josee\AppData\Roaming\com.vitral.ui\`.

**Esto no necesita ningun permiso nuevo.** Los permisos de Tauri v2 gobiernan lo que
invoca el webview. El archivo lo lee y lo escribe Rust, y lo expone con comandos
propios, que no llevan entrada de capability. La prueba esta en este mismo repositorio:
los cuatro comandos de panel funcionan con `core:default` y `core:window:allow-close` y
nada mas.

### La forma del archivo

Guarda **rutas y preferencias, nada calculado**:

```json
{
  "proyectos": [
    "C:\\Programacion\\Proyectos\\Vitral",
    "C:\\Programacion\\Proyectos\\motor"
  ],
  "activo": "C:\\Programacion\\Proyectos\\Vitral",
  "plegada": false
}
```

| Campo | Tipo | Regla |
|---|---|---|
| `proyectos` | array de cadenas | Rutas absolutas y normalizadas, en el orden en que se anadieron |
| `activo` | cadena o `null` | Una de las de `proyectos`, o `null` si no hay ninguno activo |
| `plegada` | booleano | Si la barra lateral esta plegada |

**El nombre de un proyecto no se guarda**: es el ultimo segmento de su ruta, calculado
cada vez. Su disponibilidad tampoco: se comprueba contra el disco. El archivo guarda
rutas; el comando devuelve la vista.

### Cuando se escribe y cuando se lee

Se escribe entero —no se parchea— despues de cada cambio que lo afecte: anadir, quitar,
cambiar de activo, plegar o desplegar. Si la escritura falla, el comando devuelve `Err`
y el frontend lo dice, pero **el estado en memoria no se revierte**: lo que el usuario
ve en pantalla ya cambio, y deshacerlo por detras es peor que avisar.

Se lee una vez al arrancar. Si no existe, se arranca con la lista vacia y **el archivo
no se crea hasta el primer cambio**. Si existe y no parsea, o le falta un campo, o un
campo tiene el tipo equivocado:

- Se arranca con la lista vacia.
- **El archivo no se borra ni se sobrescribe** hasta que el usuario haga un cambio.
  Borrar la lista de alguien por un fallo nuestro no es una opcion.
- Se dice en pantalla, con el texto de la tabla de estados vacios.

### Disponibilidad

Una ruta esta **disponible** si existe y es un directorio. Se comprueba en dos momentos
y en ninguno mas: **al arrancar** y **al activar**. No hay comprobacion periodica, ni al
recuperar el foco de la ventana.

Consecuencia que hay que aceptar, y por eso se escribe: si un disco se desconecta con su
proyecto ya activo, la lista lo sigue mostrando disponible y sus paneles siguen vivos,
porque su PTY ya arranco con el `cwd` puesto. Abrir un panel nuevo ahi falla con el
error de ruta. Es deliberado: comprobar en cada pintada seria tocar disco sin parar para
un caso que casi nunca pasa.

Un proyecto no disponible **se queda en la lista**, marcado, y no se puede activar. No
se borra: un disco desmontado vuelve, y quitarle la entrada al usuario por una causa
temporal es perderle trabajo.

### Anadir un proyecto

El selector nativo lo abre el frontend:

```js
import { open } from '@tauri-apps/plugin-dialog';
const ruta = await open({ directory: true, multiple: false });
```

Devuelve la ruta o `null` si se cancela; `null` no es un error y no muestra nada.

**`recursive` no se pone nunca.** Su propia documentacion dice *"indicates that it will
be read recursively later"*, que es exactamente lo que el rumbo prohibe. Por lo mismo se
descarto `<input webkitdirectory>`, que enumera el proyecto entero.

La ruta va a `anadir_proyecto`, que la valida **en Rust**. El frontend no valida rutas:
no sabe de discos.

| Caso | Que hace `anadir_proyecto` |
|---|---|
| Ruta valida y nueva | La anade al final de `proyectos` y devuelve el estado |
| Ruta que ya esta en la lista | **No la duplica.** Devuelve el estado sin cambios |
| Ruta que no existe | `Err` con el mensaje de la tabla |
| Ruta que existe pero es un archivo | `Err`, el mismo mensaje: aqui un archivo es "no hay directorio" |
| Ruta relativa | `Err`. Solo se guardan absolutas |

**La comparacion de rutas no distingue mayusculas**, porque esto es Windows, y se hace
sobre la forma absoluta y normalizada. `C:\Proy\Vitral` y `c:/proy/vitral` son el mismo
proyecto y no entran dos veces.

### Quitar un proyecto

Quitar **mata sus paneles**, como si se hubieran cerrado uno a uno: mismo camino que
`cerrar_panel`, sin atajos.

Si el que se quita es el activo, **`activo` pasa a `null`** y la rejilla muestra el
estado vacio, aunque queden otros proyectos en la lista. No se elige uno por el usuario.

### El `cwd` de un panel es del panel

`abrir_panel` recibe `cwd` como un parametro mas, junto al `id`. **No hay ningun
"directorio actual" global**, ni en Rust ni en JavaScript. Es la misma leccion que dio
el `id`: lo que algun dia va a variar por panel entra por parametro desde el principio.

Y **Rust no sabe cual es el proyecto activo.** Rust conoce dos cosas: el archivo de
estado, que persiste, y los paneles, cada uno con su `cwd`. Quien esta activo lo sabe el
frontend. Si Rust guardara "el proyecto actual", abrir dos a la vez seria una
reescritura, y eso es justo lo que el rumbo manda no cerrar.

**Rust valida el `cwd` antes de lanzar, y no es opcional.** Verificado en la fuente de
`portable-pty` 0.9.0, `CommandBuilder::current_directory()` en `src/cmdbuilder.rs`:

```rust
let cwd = self.cwd.as_deref().filter(|path| Path::new(path).is_dir());
let dir = cwd.or(home);
```

**Un `cwd` que no existe se descarta en silencio** y el proceso arranca en
`USERPROFILE`. No hay error y no hay aviso: el panel abre, el prompt aparece, y esta en
el home del usuario en vez de en el proyecto. `CreateProcessW` no falla, porque el
directorio malo ya se tiro antes de llegar ahi.

Asi que `abrir_panel` comprueba que `cwd` existe y es un directorio **antes** de
`openpty`, y devuelve `Err` si no. Y se pasa siempre **absoluto**: `portable-pty` une las
rutas relativas contra `std::env::current_dir()`, que es exactamente el global que no
debe existir.

### Los mensajes exactos

Se copian literales. Los checks futuros los van a comparar palabra por palabra.

| Situacion | Mensaje |
|---|---|
| Ruta que no existe o no es un directorio | `no hay ningun directorio en "<ruta>"` |
| Ruta relativa al anadir | `la ruta del proyecto tiene que ser absoluta: "<ruta>"` |
| `cwd` invalido en `abrir_panel` | `el directorio del panel "<id>" no existe: <cwd>` |
| No se pudo escribir el estado | `no se pudo guardar la lista de proyectos: <causa>` |
| No se pudo leer el estado | `no se pudo leer la lista de proyectos: <causa>` |

---

## El frontend

`ui/web/index.html` carga `vendor/xterm.css`, la barra lateral, un contenedor de rejilla
y `panel.js` como modulo. Sin menus, sin botones de ventana, sin titulos. La barra y la
rejilla se reparten el ancho; juntas ocupan la ventana entera.

**Cada proyecto tiene su propia rejilla.** Al cambiar de activo se oculta la del anterior
y se muestra la del nuevo; los paneles ocultos **siguen vivos**, con su PTY corriendo.
Al volver a mostrarlos hay que reajustarlos, porque sus celdas pudieron cambiar de
tamano mientras no se veian: es el mismo `ResizeObserver` que ya existe, pero un
elemento oculto no dispara nada, asi que **el reajuste al mostrar se hace a mano**.

`ui/web/panel.js` tiene dos piezas y una linea de arranque:

```js
class Panel {
  constructor(id, cwd, celda)  // un terminal y su PTY, arrancado en cwd
}

const rejillas = { ... }  // una rejilla por proyecto: quien hay, quien manda, como se colocan

leer_estado();             // al cargar: la lista y el proyecto activo. NINGUN panel
```

**Un panel nace sabiendo su `cwd`**, igual que nace sabiendo su `id`, y lo recibe de la
rejilla a la que pertenece. No lo va a buscar a ningun sitio: no hay ningun sitio donde
buscarlo, porque no hay proyecto activo global.

**Al cargar no se abre ningun panel.** Se lee el estado, se pinta la lista y, si hay un
proyecto activo disponible, se muestra su rejilla vacia. El primer panel lo abre la
persona con `Ctrl+Shift+N`. Esto cambio en la tanda de proyectos: antes se abria uno
solo al cargar, y ahora abrirlo exigiria adivinar en que proyecto.

`Panel` no sabe que existe la rejilla; la rejilla no sabe que hay dentro de un panel.
Esa frontera es lo que hara que el modo corrida pueda crear paneles con otro comando
sin tocar la disposicion.

### El registro y el unico escuchador

**Los escuchadores de Tauri se enganchan una sola vez, no uno por panel.** Con la
cuadricula esto deja de ser estilo y pasa a ser correccion:

- `listen()` devuelve la funcion para desengancharse, y hasta ahora ese valor se
  tiraba. Con paneles que se abren y se cierran, cada panel cerrado dejaba dos
  escuchadores vivos para siempre, escribiendo en un xterm que ya no esta en la
  pagina.
- Los eventos de Tauri llegan a **todos** los escuchadores, asi que N paneles con N
  escuchadores hacen que cada trozo de salida se evalue N veces.

Asi que hay **un** `listen('panel:salida')` y **un** `listen('panel:fin')`, montados
al arrancar y nunca desmontados, que buscan el id en el registro y reparten:

```js
listen('panel:salida', ({ payload }) => {
  const panel = cuadricula.paneles.get(payload.id);
  if (panel) panel.escribir(payload.datos);
});
```

Un evento cuyo id no esta en el registro **se ignora sin ruido**. Es lo normal, no un
fallo: entre que un panel se cierra y su PTY se entera puede llegar un ultimo trozo.

### Los ids

Un contador que solo sube: `"1"`, `"2"`, `"3"`... **Un id no se reutiliza nunca**,
aunque su panel se haya cerrado. Es lo que garantiza que `abrir_panel` no pueda chocar
con una entrada que todavia no se ha limpiado en Rust, y de paso hace que los ids del
log y los de la pantalla signifiquen lo mismo durante toda la sesion.

### Que hace un panel

1. `new Terminal({ ... })` con las opciones de abajo, y `term.loadAddon(fit)`.
2. `term.open(celda)` y `fit.fit()`.
3. Se registra en la cuadricula **antes** de abrir el PTY: si se registrase despues,
   lo primero que escribiera el shell llegaria sin nadie a quien repartirselo.
4. `invoke('abrir_panel', { id, cwd, filas, columnas })`, con el `cwd` que le dio su
   rejilla, absoluto. **Nunca se omite.**
5. `escribir(datos)`: decodifica el base64 a `Uint8Array` y llama a `term.write(bytes)`.
6. `morir(codigo)`: marca el panel muerto y escribe la linea de cierre.
7. `term.onData(...)` se engancha **despues** de que `abrir_panel` haya devuelto, para
   que no se pueda teclear antes de que el PTY este listo. En un panel muerto no manda
   nada.

### La disposicion

Rejilla automatica: el numero de paneles decide la forma, y no hay nada que arrastrar
ni que guardar.

| Paneles | Forma | Aproximadamente, en la ventana de 1000x700 |
|---|---|---|
| 1 | uno a pantalla completa | 118 columnas x 41 filas |
| 2 | dos columnas | 59 x 41 |
| 3 | dos arriba, el tercero abajo ocupando el ancho | 59 x 20 los de arriba, 118 x 20 el de abajo |
| 4 | 2x2 | 59 x 20 |

**Con un numero impar, el ultimo se estira y ocupa el hueco.** No existe la celda
vacia: no hay que dibujarla ni decidir que hace al pulsarla.

**El tope son cuatro paneles**, y cuenta celdas, no procesos vivos: un panel muerto
sigue ocupando la suya. Al llegar al tope, `Ctrl+Shift+N` **no hace nada** y no se
muestra ningun aviso, porque el unico sitio donde se podria escribir es dentro de un
terminal, y eso seria ensuciar contenido con mensajes de la aplicacion.

El tope es cuatro por una cuenta, no por gusto: a 14px cada caracter ocupa unos
8,4 x 17 px, asi que un 3x3 en esta ventana dejaria unas 39 columnas por 13 filas por
panel. Treinta y nueve columnas no llegan para un prompt de PowerShell con la ruta
entera mas el comando.

### El reajuste

**Un `ResizeObserver` por celda**, y ningun `window.addEventListener('resize')`. El
observador cubre de una vez los dos casos, y el segundo es el que hoy no existe y
seria un fallo silencioso:

- La ventana cambia de tamano.
- **El numero de paneles cambia**, y con el cambia el tamano de todas las celdas sin
  que la ventana se haya movido. Un `resize` de ventana no se dispara aqui, asi que
  sin observador los PTY se quedarian con las filas y columnas viejas y el texto
  saldria partido donde no toca.

Cuando una celda cambia de tamano: `fit.fit()` y despues `redimensionar_panel` con las
filas y columnas nuevas. Al anadir o quitar un panel se reajustan **todos**, no solo
el que entra o sale.

### Crear, cerrar y el foco

| Accion | Que pasa |
|---|---|
| Al cargar la pagina | **No se abre ningun panel.** Se pinta la lista y la rejilla del proyecto activo, vacia |
| `Ctrl+Shift+N` sin proyecto activo | No hace nada. Un panel necesita un `cwd`, y sin proyecto no hay ninguno |
| `Ctrl+Shift+N` | Abre uno mas, hasta el tope, y el nuevo se lleva el foco |
| `Ctrl+Shift+W` | Cierra el enfocado. El foco pasa al anterior en orden, o al primero si era el primero |
| `Ctrl+Shift+W` con un solo panel | **La rejilla se queda vacia; la ventana NO se cierra.** Cambio de la tanda de proyectos: ahora la aplicacion existe sin paneles —arranca asi— y cerrar el ultimo terminal no puede llevarse la lista de proyectos por delante |
| Clic en un panel | Ese panel recibe el foco |

Cerrar un panel es `invoke('cerrar_panel', { id })` y quitar su celda del DOM. Si el
panel ya estaba muerto, Rust responde `Err` de id desconocido porque el vigia ya quito
la entrada: **se ignora**, la celda se quita igual.

Los atajos se capturan en `attachCustomKeyEventHandler` de cada terminal y se delegan
a la cuadricula. No valen en un `keydown` de `window`: el terminal enfocado se come las
teclas antes de que lleguen ahi.

### Como se ve

Es contrato, no gusto personal: si no se escribe, cada agente elige otra cosa.

| Opcion | Valor |
|---|---|
| `fontFamily` | `'Cascadia Mono', Consolas, monospace` |
| `fontSize` | `14` |
| `cursorBlink` | `true` |
| `theme.background` | `#0c0c0c` |
| `theme.foreground` | `#cccccc` |
| `scrollback` | `10000` |

El `body` no tiene margen y la rejilla ocupa el 100% del ancho y del alto, con el
mismo fondo `#0c0c0c` para que no se vea un borde blanco al redimensionar.

Y la rejilla:

| Cosa | Valor |
|---|---|
| Separacion entre celdas | `2px` |
| Borde de una celda | `2px` solido, siempre presente |
| Borde de la celda enfocada | `#fde047` |
| Borde de las demas | `#2a2a2a` |

El borde esta **siempre**, y solo cambia de color. Si apareciera y desapareciera, cada
cambio de foco moveria dos pixeles todas las celdas y dispararia el reajuste de todos
los PTY sin ninguna razon.

Con cuatro rectangulos negros iguales, el borde de foco y el propio prompt son lo unico
que distingue un panel de otro. **No hay etiqueta ni titulo por panel, y es
deliberado**: la etiqueta es justo lo que hara falta cuando un panel sea un vidrio y
tenga el id de una tarea que mostrar, y eso es la tanda del modo corrida.

### Como se ve la barra lateral

Es contrato, no gusto personal: si no se escribe, cada agente elige otra cosa.

Paleta **Vidriera**. Un vitral es vidrio de color separado por plomo: el fondo oscuro es
el plomo, y el color solo aparece en lo que esta vivo.

| Token | Valor | Donde |
|---|---|---|
| `barra-fondo` | `#0e0e0a` | fondo de la barra lateral |
| `barra-borde` | `#262218` | divisor entre la barra y la rejilla |
| `texto` | `#d0cbbd` | nombre de un proyecto |
| `texto-tenue` | `#847c69` | texto secundario y estados vacios |
| `hover-fondo` | `#17140c` | fila con el raton encima |
| `activo-fondo` | `#201a0c` | fila del proyecto activo |
| `activo-marca` | `#bef264` | barra vertical en el borde izquierdo de la fila activa |
| `activo-texto` | `#fde047` | nombre del proyecto activo |
| `no-disponible` | `#5a5347` | nombre de un proyecto cuya ruta no resuelve |
| `error` | `#ef4444` | mensajes de error |

Contrastes medidos contra su propio fondo, no supuestos: texto 11.9, tenue 4.7, marca
13.2, texto activo 13.1, error 5.1. **`no-disponible` se queda en 2.5 a proposito**: es
el estado deshabilitado y tiene que verse apagado.

**Los dos amarillos y el lima significan cosas distintas y no se intercambian:**

- **`#fde047` es "lo que esta activo ahora"**, en dos niveles: el nombre del proyecto
  activo en la barra, y el borde del panel enfocado en la rejilla. Es el mismo amarillo
  a proposito, y por eso el borde de foco dejo de ser azul.
- **`#bef264` marca cual es el proyecto activo**, no donde esta el foco. Solo aparece en
  la barra, nunca en la rejilla.

### Medidas de la barra

| Cosa | Valor |
|---|---|
| Ancho desplegada | `260px` |
| Ancho plegada | `24px` |
| Divisor con la rejilla | `1px` solido, `barra-borde` |
| Alto de una fila | `32px` |
| Marca del proyecto activo | `3px` de ancho, alto completo de la fila |
| Escala de espaciado | `4 / 8 / 12 / 16 / 24`, y **nada fuera de ella** |
| Tipografia | `'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif` |
| Tamano de la lista | `13px` |

El terminal **no cambia de tipografia**: sigue en `'Cascadia Mono'` a `14`, como dice la
tabla de arriba.

La ruta completa **no ocupa linea**: va como atributo `title` de la fila, que el sistema
muestra al detenerse encima. Un nombre que no cabe en `260px` se corta con puntos
suspensivos.

### Los estados de una fila

| Estado | Como se ve |
|---|---|
| normal | `texto` sobre `barra-fondo`, sin marca |
| hover | fondo `hover-fondo` |
| activo | fondo `activo-fondo`, nombre en `activo-texto`, marca `activo-marca` a la izquierda |
| no disponible | nombre en `no-disponible`, sin hover y sin cursor de mano |
| error | el mensaje va en `error` debajo de la lista, **no** dentro de la fila |

**No hay estado de carga, y es deliberado.** Leer un JSON pequeno y comprobar que unos
directorios existen es instantaneo; un indicador que nunca se ve es codigo muerto que
alguien tendra que revisar igual. Si algun dia se comprueban rutas de red lentas, entra
entonces y con su tanda.

### Los estados vacios, que no son el mismo

Se distinguen a proposito: caer del segundo en el primero, en silencio, esconde que algo
se rompio. Textos literales, centrados en la zona de la rejilla:

| Cuando | Texto exacto | Color |
|---|---|---|
| La lista esta vacia | `Todavia no has abierto ningun proyecto.` | `texto-tenue` |
| Hay proyectos pero ninguno activo | `Elige un proyecto de la lista.` | `texto-tenue` |
| El ultimo activo ya no esta disponible | `El ultimo proyecto abierto ya no esta disponible.` | `error` |
| Hay proyecto activo pero ningun panel | `Ctrl+Shift+N para abrir un panel.` | `texto-tenue` |
| El archivo de estado no se pudo leer | `No se pudo leer la lista de proyectos. No se ha borrado nada.` | `error` |

### Lo que no lleva tratamiento, a proposito

- **Ningun panel lleva etiqueta ni titulo**, y sigue siendo cierto con proyectos: la
  rejilla entera es del proyecto activo, que ya esta dicho en la barra. La etiqueta se
  guarda para el modo corrida, que es cuando un panel tendra algo propio que decir.
- **No hay icono por proyecto.** Ni de carpeta, ni de lenguaje, ni derivado del
  contenido: deducirlo obligaria a mirar dentro del proyecto, que es lo que no se hace.
- **No hay contador de paneles por proyecto en la barra.** Es informacion de la rejilla,
  y meterla en la lista adelanta trabajo del modo corrida sin que nadie lo haya pedido.
- **La barra no se puede redimensionar arrastrando.** El ancho es `260px` y punto;
  arrastrar pide guardar la medida, y eso es una preferencia mas que nadie ha pedido.

### El teclado

| Tecla | Que hace |
|---|---|
| Ctrl+C | **va al PTY**: interrumpe el proceso. No copia |
| Ctrl+Shift+C | copia la seleccion al portapapeles |
| Ctrl+Shift+V | pega el portapapeles en el PTY |
| Ctrl+Shift+N | abre un panel mas, hasta el tope |
| Ctrl+Shift+W | cierra el panel enfocado; si es el ultimo, cierra la ventana |
| Ctrl+Shift+B | pliega y despliega la barra lateral |
| seleccion con el raton | la trae xterm de serie |
| clic en un panel | le da el foco |

**Los dos atajos nuevos hay que comprobarlos a mano.** La lista de teclas que WebView2
se queda esta documentada —Ctrl+F, F3, Ctrl+P, Ctrl+R, F5, Ctrl+mas y Ctrl+menos,
Ctrl+Shift+C, F12, y atras, adelante y buscar— y ni Ctrl+Shift+N ni Ctrl+Shift+W estan
en ella; ademas, dentro de un webview embebido no hay ventana nueva ni pestana sobre la
que puedan actuar. Pero la documentacion dice "incluyendo pero no limitado a", asi que
la unica certeza es pulsarlas. **Si alguna no llega, el reemplazo escrito es
`Ctrl+Alt+N` y `Ctrl+Alt+W`**, y es un cambio de tres lineas, no de diseno.

Se implementa con `term.attachCustomKeyEventHandler`, que devuelve `false` para lo que
maneja el frontend y `true` para todo lo demas. Copiar y pegar usan
`navigator.clipboard`; si el webview no lo concede, esas dos teclas no hacen nada y no
se rompe nada mas.

**Ctrl+Shift+C no llega a la pagina en compilaciones de depuracion.** WebView2 la usa
para el inspector y se la queda antes. No es un fallo del codigo y no se arregla en el
frontend: en release el inspector no existe y la tecla queda libre. Esta verificado en
la fuente de `tauri-runtime-wry` y `wry`, y la cadena entera esta en
`.vitral/ui/procedencia.md`.

Si alguna vez hace falta que funcione tambien en depuracion, la unica via limpia es
bajar al webview nativo con `with_webview` y poner
`AreBrowserAcceleratorKeysEnabled = false`, lo que arrastra la caja `webview2-com` y
codigo COM en `unsafe`. No se hace por una tecla sin que alguien lo pida.

### La linea de proceso terminado

Cuando llega `panel:fin`, el panel escribe **exactamente** esto y deja de aceptar
teclas:

```
\r\n[el proceso termino con codigo 0]\r\n
```

Con el codigo que venga en el evento. Los `\r\n` son los dos, no solo `\n`: en una
terminal cruda un `\n` baja de linea pero no vuelve al margen izquierdo, y el texto sale
en escalera.

La ventana **no** se cierra y el scrollback **no** se borra: cuando un panel sea un
vidrio, lo ultimo que escribio un agente que murio es justo lo que se quiere leer.

---

## Los bordes

Un caso que el contrato no cubre lo resuelve cada agente a su manera.

| Caso | Que pasa |
|---|---|
| `abrir_panel` con un id que ya existe | `Err`, y no se abre un segundo PTY |
| Cualquier comando con un id desconocido | `Err` con el mensaje de la tabla. Nunca un panic |
| Se teclea antes de que el PTY este listo | No puede pasar: `onData` se engancha despues de que `abrir_panel` haya devuelto |
| **El proceso termina solo** | El vigia lo detecta, borra la entrada del mapa, espera al lector y emite `panel:fin`. El frontend escribe la linea de cierre y marca el panel muerto |
| Se teclea en un panel muerto | El frontend no manda nada. Si algo se colara, Rust responde `Err` de id desconocido y el frontend lo ignora |
| Se redimensiona un panel muerto | Igual: el frontend no lo llama, y si lo llamara seria `Err` de id desconocido |
| Llega un evento de otro id | Se ignora. Por eso se comprueba el id |
| Se cierra la ventana con procesos vivos | Se matan todos. No queda ningun `powershell.exe` huerfano |
| Se cierra la ventana con el panel ya muerto | El vigia ya borro la entrada; no hay nada que matar y no es un error |
| `abrir_panel` con un `cwd` que no existe | `Err` **antes** de abrir el PTY. `portable-pty` no avisaria: arrancaria en el home |
| Se desconecta el disco del proyecto activo | Sus paneles siguen vivos; la lista lo sigue dando por disponible hasta el proximo arranque o activacion. Abrir uno nuevo falla |
| Se anade una ruta que ya esta en la lista | No se duplica. El estado vuelve sin cambios y no es un error |
| Se quita el proyecto activo | Sus paneles mueren y `activo` pasa a `null`. La rejilla muestra el estado vacio aunque queden otros |
| Se activa un proyecto no disponible | No se deja. La fila no responde al clic |
| `estado.json` no parsea | Lista vacia, el archivo **no se toca**, y se dice en pantalla |
| El selector de carpeta se cancela | Devuelve `null`. No es un error y no se muestra nada |
| Se pliega la barra con un panel enfocado | El foco no se mueve. Solo cambia el ancho, y se reajustan todos los PTY |
| `cerrar_panel` gana la carrera al vigia | La entrada ya no esta cuando el vigia va a quitarla. No es un error, y `panel:fin` se emite igual, una sola vez |
| Se redimensiona la ventana muy rapido | Cada aviso del `ResizeObserver` llama a `fit()` y a `redimensionar_panel`. No hace falta amortiguarlo |
| `Ctrl+Shift+N` con cuatro paneles ya abiertos | No hace nada, y no se muestra ningun aviso |
| `Ctrl+Shift+N` con cuatro celdas de las que tres estan muertas | Tampoco: el tope cuenta celdas, no procesos vivos. Hay que cerrar alguna |
| `Ctrl+Shift+W` sobre un panel ya muerto | Se quita la celda igual. Rust responde `Err` de id desconocido porque el vigia ya limpio, y se ignora |
| `Ctrl+Shift+W` con un solo panel | Se cierra la ventana, que mata lo que quede vivo |
| Se cierra el panel enfocado | El foco pasa al anterior en orden; al primero si era el primero |
| Cambia el numero de paneles | Cambia el tamano de **todas** las celdas sin que la ventana se mueva. El `ResizeObserver` lo caza y se reajustan todos los PTY |
| Llega `panel:salida` de un id que ya no esta en el registro | Se ignora sin ruido. Es lo normal entre que se cierra un panel y su PTY se entera |
| `fit()` da 0 filas o 0 columnas | Se manda un minimo de 1 y 1. Un `PtySize` con ceros no es valido |
| `powershell.exe` no se puede lanzar | `abrir_panel` devuelve `Err` con el texto del sistema y el frontend lo escribe en el panel. Nunca una ventana en blanco |
| Salida enorme y muy rapida | Se emite segun se lee, en trozos de 4096. No se acumula ni se descarta |
| Un caracter UTF-8 partido entre dos lecturas | Lo resuelve xterm, que recibe bytes. Es la razon del base64 |
| Acentos rotos | Windows PowerShell 5.1 escribe en la pagina de codigos de la consola. Si aparecen rotos, se anota y se deja: es otra tanda |

---

## Que no se toca desde la interfaz

- Todo `src/`, `vitral.mjs` y `pruebas/checks.mjs`. El motor de Node no cambia por una
  tanda de interfaz. **Tampoco por la tanda de proyectos**: la interfaz no lanza el
  motor todavia, y cuando lo lance sera con el `cwd` puesto, sin bandera nueva.
- `.vitral/plomo/`, `.vitral/planificar/` y `.vitral/ui/`, incluido este archivo.
- `ejemplo/`, `.gitattributes`, `LICENSE`.
- `.gitignore`, salvo que una tanda lo pida explicitamente. Las lineas de `cargo` ya
  estan puestas.

## Lo que no entra, hasta que alguien lo pida

- Pestanas, divisiones arrastrables, disposiciones a medida. La rejilla se calcula
  sola a partir de cuantos paneles hay, y no se guarda entre arranques.
- Mas de cuatro paneles. El tope esta puesto por una cuenta de caracteres, no por
  miedo: subirlo pide antes una ventana mas grande o una fuente mas pequena.
- Etiquetas o titulos por panel.
- Nada que lea `.vitral/`. Ni el de la aplicacion ni el de ningun proyecto.
- Lanzar el motor, y cualquier cosa del modo corrida.
- Leer, indexar o enumerar el contenido de un proyecto, por ningun camino.
- Redimensionar la barra arrastrando, y guardar su ancho.
- Reabrir los paneles que habia al arrancar. Se recuerda el proyecto activo, no sus paneles.
- Ningun `package.json` ni `node_modules`.
- Ningun instalador, ningun juego de iconos.
- Ni Linux ni macOS. El codigo sale portable porque `portable-pty` lo es, pero lo unico
  que se prueba y se sostiene es Windows.
- Configuracion del usuario: la fuente, el tema y el shell son constantes.

---

## Como se comprueba una tanda de interfaz

Una aplicacion de escritorio no se verifica sin ojos delante. Conviene decirlo antes de
que nadie de nada por bueno.

**Lo que un agente si puede comprobar, y tiene que comprobar:**

```
cargo build --manifest-path ui/src-tauri/Cargo.toml
```

Sin errores, y sin avisos propios.

**Lo que un agente no puede comprobar:** que la ventana abra, que el prompt aparezca,
que las teclas lleguen. Eso lo hace una persona con `cargo tauri dev`.

Por lo tanto **el handoff no dice "funciona": dice que compila**, y deja la lista de
comprobacion manual para que alguien la tache:

1. La ventana abre y se ve un prompt de PowerShell.
2. `dir` escribe la salida con sus colores.
3. Redimensionar la ventana reajusta el texto y no lo parte.
4. Ctrl+C corta un `ping -t localhost`.
5. Ctrl+Shift+V pega. Ctrl+Shift+C copia **solo en release**, ver la nota del teclado.
6. `exit` deja la linea `[el proceso termino con codigo 0]`, la ventana sigue
   respondiendo y el scrollback se conserva.
7. Al cerrar la ventana no queda ningun `powershell.exe` vivo en el Administrador de
   tareas.
8. **Ctrl+Shift+N abre un panel**, y la rejilla se reacomoda. Si no llega, probar el
   reemplazo de la nota del teclado.
9. **Ctrl+Shift+W cierra el enfocado**, y la rejilla se reacomoda. Con un solo panel,
   cierra la ventana.
10. Con dos, tres y cuatro paneles, el texto de cada uno se reajusta al cambiar el
    numero: nada de lineas partidas ni de zonas muertas dentro de una celda.
11. Al hacer clic en un panel, su borde se pone amarillo `#fde047` y el teclado va a
    ese; el cursor solo parpadea en el enfocado. Los otros tres bordes siguen en
    `#2a2a2a`, y el enfocado tiene que distinguirse de un vistazo.
12. Con cuatro abiertos, Ctrl+Shift+N no hace nada.
13. Con cuatro paneles escribiendo a la vez (por ejemplo, cuatro `ping -t localhost`),
    la salida de cada uno va a su celda y ninguna se mezcla.
14. Al cerrar la ventana con cuatro vivos no queda ningun `powershell.exe` en el
    Administrador de tareas.

Y los de la tanda de proyectos. El punto 15 es el que mas facil se da por bueno sin
mirar, y es el que justifica la tanda entera:

15. **Con un proyecto activo, un panel nuevo arranca dentro de el.** Se comprueba
    escribiendo `pwd` en el panel: tiene que salir la ruta del proyecto, no la del
    usuario ni la de la aplicacion.
16. Anadir un proyecto con el selector lo mete en la lista y lo deja activable.
17. Anadir el mismo dos veces no lo duplica.
18. Cambiar de proyecto oculta la rejilla del anterior y muestra la del nuevo, y los
    paneles del anterior siguen escribiendo cuando se vuelve a el.
19. Al volver a un proyecto, sus paneles tienen el tamano correcto: nada cortado, nada
    con la salida en escalera.
20. Quitar el proyecto activo mata sus paneles y deja el estado vacio.
21. Renombrar la carpeta de un proyecto por fuera y reiniciar: sale marcado como no
    disponible, sigue en la lista, y no se puede activar.
22. Borrar `estado.json` y arrancar: lista vacia, sin error, y el archivo no reaparece
    hasta anadir el primer proyecto.
23. Meter basura en `estado.json` y arrancar: lista vacia, el mensaje de error, y el
    archivo **sigue con la basura dentro**, sin sobrescribir.
24. Ctrl+Shift+B pliega y despliega, y los PTY se reajustan en los dos sentidos.
24b. **Al arrancar no hay ningun panel abierto**, y cerrar el ultimo con Ctrl+Shift+W
    deja la rejilla vacia sin cerrar la ventana. Los dos cambiaron en esta tanda
    respecto a lo que probaste en la cuadricula.
25. **Aviso para quien probo la cuadricula: el punto 11 cambio.** El borde de foco era
    `#3b78ff` y ahora es `#fde047`. No es un fallo de la implementacion; se cambio a
    proposito en esta tanda, porque el azul se separaba de los bordes vecinos por
    3.6:1 y el amarillo lo hace por 10.9:1.
