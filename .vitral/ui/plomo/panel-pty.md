# Contrato · panel de terminal en Tauri

Este es el contrato permanente de la interfaz, como `motor.md` lo es del motor. No
es el plomo de una tanda: sobrevive a las tandas y se corrige cuando el codigo
desmiente algo de aqui.

**Vive en su propio directorio a proposito.** El boceto es `.vitral/ui/boceto.json` y
este es el unico plomo que lo acompana, asi que las corridas de interfaz se lanzan
con `--boceto .vitral/ui/boceto.json`. `.vitral/plomo/motor.md` **no** entra en estos
prompts: son 20 KB de contrato sobre modulos de Node que la interfaz no toca. Lo poco
que hay que saber del motor esta abajo, en tres frases.

---

## Que es esto

Una ventana de escritorio con paneles de terminal dentro, donde se escriben comandos
y se ve su salida: con colores, con cursor, con Ctrl+C funcionando. Terminales de
verdad, no cuadros de texto que imprimen lineas.

Hoy hay **un** panel, a pantalla completa, con `powershell.exe` dentro.

### Lo que hay que saber del motor, y es todo

1. **El motor Node sigue haciendo la orquestacion.** La interfaz no la reimplementa,
   ni ahora ni despues.
2. **El contrato entre interfaz y motor es el sistema de archivos `.vitral/`**, igual
   que el plomo es el contrato entre agentes. Cuando la interfaz lea el estado de una
   corrida, lo leera de ahi.
3. **Hoy nada de eso se usa.** Un panel es un PTY con un renderizador delante. Que
   dentro corra PowerShell hoy y un agente manana no cambia el panel.

No se lee `.vitral/`. No se llama a `vitral.mjs`. No se importa nada de `src/`.

### A donde va esto, para no cerrar la puerta

Habra una cuadricula de paneles, y un modo donde cada panel es un vidrio de una
corrida. Por eso **todo va direccionado por `id`**, aunque hoy solo haya un panel y su
id sea siempre `"1"`. Anadir la cuadricula tiene que ser un bucle en el frontend y
CSS, sin tocar Rust.

Lo que **no** se hace en nombre de esa puerta: ni pestanas, ni divisiones, ni
configuracion, ni guardar el scrollback, ni leer `.vitral/`. Codigo sin usar es codigo
que hay que revisar igual.

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

### Comandos

| Comando | Argumentos | Devuelve |
|---|---|---|
| `abrir_panel` | `id: String`, `filas: u16`, `columnas: u16` | `Result<(), String>` |
| `escribir_en_panel` | `id: String`, `datos: String` | `Result<(), String>` |
| `redimensionar_panel` | `id: String`, `filas: u16`, `columnas: u16` | `Result<(), String>` |
| `cerrar_panel` | `id: String` | `Result<(), String>` |

Los argumentos viajan de JS a Rust en camelCase. Como ninguno lleva mayusculas
intermedias, se escriben igual en los dos lados. Es deliberado: **no se anaden
argumentos de dos palabras**.

```js
await invoke('abrir_panel', { id: '1', filas: 30, columnas: 100 });
```

### Los cuatro comandos son asincronos

```rust
#[tauri::command(async)]
fn abrir_panel(...) -> Result<(), String>
```

**Esto no es opcional y no es estilo.** La documentacion de Tauri v2 lo dice sin
rodeos: *"Commands without the async keyword are executed on the main thread unless
defined with `#[tauri::command(async)]`"*. Un comando sincrono que bloquee —una
escritura a una tuberia llena, un `resize` que no vuelve, un mutex retenido— congela la
ventana entera, no solo el panel.

Hoy ninguna de esas operaciones bloquea; esta medido y esta abajo. La regla es para el
dia que alguna lo haga. Cuesta una linea por comando.

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
esta medido contra `portable-pty` 0.9.0 en esta maquina, no deducido.

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

### Lo que esta medido, no supuesto

Del experimento con `portable-pty` 0.9.0 y `powershell.exe`, reproducido tres veces:

| Hecho | Medida |
|---|---|
| `exit` mata al shell limpio | codigo 0, 0.25 s despues |
| Con el maestro vivo, el lector no ve el final | `read()` sigue bloqueado indefinidamente |
| Soltar el maestro desbloquea al lector | `read()` devuelve `Ok(0)` acto seguido |
| Soltar el maestro no bloquea | `ClosePseudoConsole` retorna en 0.00 s |
| `wait()` sobre un hijo muerto no bloquea | retorna en 0.00 s |
| Escribir con el hijo muerto no bloquea ni falla | `write_all` retorna `Ok` en 0.00 s |
| `resize` con el hijo muerto no bloquea | retorna `Ok` en 0.00 s |
| `kill` sobre un hijo ya muerto no bloquea | retorna `Ok` en 0.00 s |
| Cerrar el extremo de escritura no descarta lo escrito | el eco de `exit` llego entero antes del cierre |

Las cuatro ultimas son la razon de que la ventana **no** se congele hoy. Son tambien la
razon de que la regla de los comandos asincronos sea barata: no arregla nada de hoy,
protege de manana.

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

Declara `core:default` para la ventana `main`. Se eligio el conjunto por defecto y no
un permiso suelto porque `listen` necesita al menos `core:event:default` y no hay forma
de descubrir que mas falta sin arrancar la ventana: un permiso de menos es una ventana
rota que hay que depurar a ciegas. Los cuatro comandos propios no necesitan permiso.

Si al arrancar sale un error de permiso denegado nombrando un comando, se anade **ese**
permiso y solo ese.

---

## El frontend

`ui/web/index.html` carga `vendor/xterm.css`, un contenedor y `panel.js` como modulo.
Nada mas: sin barras, sin menus, sin botones. El panel ocupa la ventana entera.

`ui/web/panel.js` tiene una clase y una sola linea que la usa:

```js
class Panel {
  constructor(id, contenedor)
}

new Panel('1', document.getElementById('panel'));
```

Esa separacion entre la clase y su unico uso es toda la puerta que se deja abierta para
la cuadricula. No se anade nada mas por si acaso.

Lo que hace una instancia:

1. `new Terminal({ ... })` con las opciones de abajo, y `term.loadAddon(fit)`.
2. `term.open(contenedor)` y `fit.fit()`.
3. Engancha los dos escuchadores **antes** de abrir el PTY: si se enganchasen despues,
   lo primero que escribiera el shell podria llegar sin nadie oyendo.
4. `invoke('abrir_panel', { id, filas, columnas })`.
5. `panel:salida`: si el id del evento es el suyo, decodifica el base64 a `Uint8Array`
   y llama a `term.write(bytes)`. **Se comprueba el id** aunque hoy solo haya uno: los
   eventos de Tauri llegan a todos los escuchadores.
6. `panel:fin`: marca el panel muerto y escribe la linea de cierre.
7. `term.onData(...)` se engancha **despues** de que `abrir_panel` haya devuelto, para
   que no se pueda teclear antes de que el PTY este listo. En un panel muerto no manda
   nada.
8. Un `resize` de la ventana llama a `fit.fit()` y despues a `redimensionar_panel`.

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

El `body` no tiene margen y el contenedor ocupa el 100% del ancho y del alto, con el
mismo fondo `#0c0c0c` para que no se vea un borde blanco al redimensionar.

### El teclado

| Tecla | Que hace |
|---|---|
| Ctrl+C | **va al PTY**: interrumpe el proceso. No copia |
| Ctrl+Shift+C | copia la seleccion al portapapeles |
| Ctrl+Shift+V | pega el portapapeles en el PTY |
| seleccion con el raton | la trae xterm de serie |

Se implementa con `term.attachCustomKeyEventHandler`, que devuelve `false` para lo que
maneja el frontend y `true` para todo lo demas. Copiar y pegar usan
`navigator.clipboard`; si el webview no lo concede, esas dos teclas no hacen nada y no
se rompe nada mas.

**Ctrl+Shift+C no llega a la pagina en compilaciones de depuracion.** WebView2 la usa
para el inspector y se la queda antes. No es un fallo del codigo y no se arregla en el
frontend: en release el inspector no existe y la tecla queda libre. La cadena esta
verificada en la fuente —`tauri-runtime-wry-2.11.4/src/lib.rs:5209` solo llama a
`with_devtools` bajo `#[cfg(any(debug_assertions, feature = "devtools"))]`,
`wry-0.55.1/src/lib.rs:836` deja `devtools: false` fuera de depuracion, y
`wry-0.55.1/src/webview2/mod.rs:573` lo pasa a `SetAreDevToolsEnabled`— y la feature
`devtools` no esta entre las de tauri por defecto ni se pide en `Cargo.toml`.

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
| `cerrar_panel` gana la carrera al vigia | La entrada ya no esta cuando el vigia va a quitarla. No es un error, y `panel:fin` se emite igual, una sola vez |
| Se redimensiona la ventana muy rapido | Cada `resize` llama a `fit()` y a `redimensionar_panel`. No hace falta amortiguarlo |
| `fit()` da 0 filas o 0 columnas | Se manda un minimo de 1 y 1. Un `PtySize` con ceros no es valido |
| `powershell.exe` no se puede lanzar | `abrir_panel` devuelve `Err` con el texto del sistema y el frontend lo escribe en el panel. Nunca una ventana en blanco |
| Salida enorme y muy rapida | Se emite segun se lee, en trozos de 4096. No se acumula ni se descarta |
| Un caracter UTF-8 partido entre dos lecturas | Lo resuelve xterm, que recibe bytes. Es la razon del base64 |
| Acentos rotos | Windows PowerShell 5.1 escribe en la pagina de codigos de la consola. Si aparecen rotos, se anota y se deja: es otra tanda |

---

## Que no se toca desde la interfaz

- Todo `src/`, `vitral.mjs` y `pruebas/checks.mjs`. El motor de Node no cambia por una
  tanda de interfaz.
- `.vitral/plomo/`, `.vitral/planificar/` y `.vitral/ui/`, incluido este archivo.
- `ejemplo/`, `.gitattributes`, `LICENSE`.
- `.gitignore`, salvo que una tanda lo pida explicitamente. Las lineas de `cargo` ya
  estan puestas.

## Lo que no entra, hasta que alguien lo pida

- Cuadricula, pestanas, divisiones.
- Nada que lea `.vitral/`.
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

## De donde sale lo que dice este archivo

Los nombres de simbolos de `portable-pty`, los campos de `tauri.conf.json`, la ruta
`window.__TAURI__.core.invoke`, la firma de `term.write`, los nombres de los archivos
vendorizados, la exigencia del `.ico` y la cadena del inspector **estan verificados**
contra la documentacion de las versiones de la tabla y contra el codigo de las cajas en
`~/.cargo/registry`.

La tabla de "lo que esta medido" sale de un experimento con `portable-pty` y
`powershell.exe` corrido tres veces en esta maquina.

Lo que describe el ciclo de vida de un panel con dos hilos **es diseno, no codigo
copiado**: al escribirlo, el vigia todavia no existia. En cuanto exista, manda el
codigo: si algo de aqui no se pudo hacer asi, se dice en el handoff con el motivo y
este archivo se corrige.
