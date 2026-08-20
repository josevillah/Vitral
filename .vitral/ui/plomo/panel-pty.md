# Contrato · panel de terminal en Tauri

**Esta tanda vive en su propio directorio a proposito.** El boceto es
`.vitral/ui/boceto.json` y este es el unico plomo que lo acompana, asi que la
corrida se lanza con `--boceto .vitral/ui/boceto.json`.

`.vitral/plomo/motor.md` **no** entra en este prompt, y no es un olvido: son 20 KB
de contrato sobre modulos de Node que esta tanda no toca ni una vez. Lo poco que
hay que saber del motor esta aqui abajo, en tres frases.

---

## Que se quiere

Una ventana de escritorio con **un** panel de terminal dentro, donde se escriban
comandos de PowerShell y se vea su salida: con colores, con cursor, con Ctrl+C
funcionando. Una terminal de verdad, no un cuadro de texto que imprime lineas.

Es el primer paso de una interfaz para Vitral. Hoy es una terminal suelta y nada
mas.

### Lo que hay que saber del motor, y es todo

1. **El motor Node sigue haciendo la orquestacion.** La interfaz no la
   reimplementa, ni ahora ni despues.
2. **El contrato entre interfaz y motor es el sistema de archivos `.vitral/`**,
   igual que el plomo es el contrato entre agentes. Cuando la interfaz lea el
   estado de una corrida, lo leera de ahi.
3. **En esta tanda nada de eso se usa.** Un panel es un PTY con un renderizador
   delante. Que dentro corra PowerShell hoy y un agente manana no cambia el panel.

No se lee `.vitral/`. No se llama a `vitral.mjs`. No se importa nada de `src/`.

### A donde va esto despues, para no cerrar la puerta

Habra una cuadricula de paneles, y un modo donde cada panel es un vidrio de una
corrida. Por eso **todo va direccionado por `id` desde hoy**, aunque hoy solo haya
un panel y su id sea siempre `"1"`. Anadir la cuadricula manana tiene que ser un
bucle en el frontend y CSS, sin tocar Rust.

Lo que **no** se hace hoy en nombre de esa puerta: ni pestanas, ni divisiones, ni
configuracion, ni guardar el scrollback, ni leer `.vitral/`. Codigo sin usar es
codigo que hay que revisar igual.

---

## Las versiones, verificadas el 19-08-2026

Salen de crates.io, del registro de npm y de la maquina. No se cambian por otras
"mas nuevas" sin comprobarlo igual.

| Pieza | Version | De donde sale |
|---|---|---|
| `tauri` | 2.11.5 | crates.io, publicada el 01-07-2026 |
| `tauri-cli` | 2.11.4 | crates.io, publicada el 28-06-2026 |
| `portable-pty` | 0.9.0 | crates.io, publicada el 11-02-2025. Es la de wezterm |
| `base64` | 0.23.1 | crates.io, publicada el 04-08-2026 |
| `@xterm/xterm` | 6.0.0 | registro de npm |
| `@xterm/addon-fit` | 0.11.0 | registro de npm |

**`portable-pty` es quien habla ConPTY.** En Windows no se llama a la API de
ConPTY a mano: `portable-pty` la envuelve y da la misma interfaz que en Unix. Que
lleve desde febrero de 2025 sin publicar no es abandono: ConPTY es una API de
Windows estable y esta caja es la que usa wezterm en produccion, con 11.9 millones
de descargas.

**No se usa `tauri-plugin-pty`.** Existe, es mas nuevo (0.3.1, julio de 2026) y
envuelve exactamente estas mismas piezas, pero tiene 44k descargas y **no declara
repositorio** en crates.io. Es demasiada confianza ciega para la unica pieza que de
verdad importa aqui. Si aparece la tentacion a mitad de la tarea: no.

## La maquina donde esto tiene que correr

Comprobado, no supuesto: `rustc` y `cargo` 1.97.1 con toolchain
`x86_64-pc-windows-msvc`, Visual Studio 2022 Build Tools instalado, WebView2 151.

Y el dato que fija una decision: **existe `powershell.exe` (Windows PowerShell 5.1)
y no existe `pwsh.exe`.** El shell del panel es `powershell.exe` y esta escrito en
un solo sitio del codigo.

Tauri solo necesita Node.js si el frontend usa un framework de JavaScript. Este no
usa ninguno, asi que **en esta tanda no se ejecuta npm ni se crea ningun
`package.json`**.

---

## Disposicion de archivos

```
ui/
  web/
    index.html
    panel.js
    vendor/
      xterm.mjs          copiado de @xterm/xterm 6.0.0, lib/xterm.mjs
      xterm.css          copiado de @xterm/xterm 6.0.0, css/xterm.css
      addon-fit.mjs      copiado de @xterm/addon-fit 0.11.0, lib/addon-fit.mjs
  src-tauri/
    Cargo.toml
    build.rs
    tauri.conf.json
    capabilities/
      default.json
    src/
      main.rs
```

**Regla que no se rompe: toda ruta se nombra completa desde la raiz del
repositorio.** En este repo hay dos directorios llamados `src` y significan cosas
distintas:

| Ruta | Que es | Quien la toca en esta tanda |
|---|---|---|
| `src/` | el motor de Vitral, Node/ESM | **nadie** |
| `ui/src-tauri/src/` | el crate de Rust de la interfaz | esta tarea |

Nunca se escribe `src/main.rs` a secas. Se escribe `ui/src-tauri/src/main.rs`.

El frontend va en `ui/web/` y no en `ui/src/`, que es lo que genera el andamio de
Tauri, justo para que no haya un tercer `src` en el repo.

### De donde salen los tres archivos vendorizados

No se escriben a mano ni se bajan de un CDN. Se sacan del paquete oficial con
`npm pack`, que descarga el tgz sin instalar nada en el repositorio:

```
npm pack @xterm/xterm@6.0.0
npm pack @xterm/addon-fit@0.11.0
```

Dentro del tgz de `@xterm/xterm` los archivos estan en `package/lib/xterm.mjs` y
`package/css/xterm.css`; en el de `@xterm/addon-fit`, en
`package/lib/addon-fit.mjs`. Se copian a `ui/web/vendor/` con los nombres de la
tabla de arriba y **sin modificarlos**. El tgz no se deja en el repositorio.

Comprobado: `xterm.mjs` pesa 345 KB, `xterm.css` 7 KB, y `xterm.mjs` exporta
`Terminal` como export con nombre, o sea que se importa asi:

```js
import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';
```

---

## El catalogo IPC: origen unico

Esta tabla es la **unica** fuente de los nombres que cruzan de Rust a JavaScript.
Se copia literal en los dos lados: sin traducir, sin reordenar, sin renombrar. Si
un nombre de aqui no encaja con el codigo, manda esta tabla.

### Comandos, que invoca el frontend

| Comando | Argumentos | Devuelve |
|---|---|---|
| `abrir_panel` | `id: String`, `filas: u16`, `columnas: u16` | `Result<(), String>` |
| `escribir_en_panel` | `id: String`, `datos: String` | `Result<(), String>` |
| `redimensionar_panel` | `id: String`, `filas: u16`, `columnas: u16` | `Result<(), String>` |
| `cerrar_panel` | `id: String` | `Result<(), String>` |

Ojo con una trampa de Tauri: los argumentos viajan de JS a Rust **en camelCase**.
Como estos nombres no llevan mayusculas intermedias, `filas`, `columnas`, `datos` e
`id` se escriben igual en los dos lados y no hay conversion que recordar. Es
deliberado: no se anaden argumentos de dos palabras en esta tanda.

Desde JavaScript se llaman asi, con los argumentos en un objeto:

```js
await invoke('abrir_panel', { id: '1', filas: 30, columnas: 100 });
```

### Eventos, que emite Rust

| Evento | Carga | Cuando |
|---|---|---|
| `panel:salida` | `{ id: String, datos: String }` | cada vez que el PTY escribe algo |
| `panel:fin` | `{ id: String, codigo: u32 }` | cuando el proceso del panel termina |

`datos` en `panel:salida` es **base64**, no texto. Por que, abajo.

### Errores

Todo comando devuelve `Result<(), String>`. Cuando falla, el `String` es un mensaje
en espanol, corto y en minuscula, que nombra el panel:

```
no hay ningun panel con id "3"
ya existe un panel con id "1"
no se pudo lanzar "powershell.exe": <lo que diga el sistema>
```

**Ningun comando entra en panic.** Un `unwrap()` sobre algo que puede fallar mata
la aplicacion entera y deja la ventana en blanco sin decir por que. Un `Mutex`
envenenado tambien se convierte en `Err`, no en panic.

---

## El camino de los datos

Los dos sentidos no son simetricos y conviene ver por que antes de escribir nada.

### Del teclado al proceso

xterm entrega lo que el usuario teclea como **texto** ya interpretado, en su evento
`onData`, que da un `string`. Ese texto se manda tal cual en `escribir_en_panel`, y
Rust escribe sus bytes UTF-8 en el escritor del PTY.

### Del proceso a la pantalla

Aqui no vale texto. El PTY devuelve **bytes**, y un caracter UTF-8 de varios bytes
puede quedar partido entre dos lecturas: la primera trae medio caracter y la
segunda la otra mitad. Si Rust convierte cada lectura a `String` por su cuenta, esa
mitad se convierte en un simbolo de reemplazo y el caracter se pierde para siempre.

Por eso:

1. Rust lee bytes crudos del PTY, en trozos de 4096.
2. Los codifica en **base64** y los emite en `panel:salida`.
3. El frontend decodifica el base64 a un `Uint8Array`.
4. Se lo pasa a xterm con `term.write(bytes)`.

`write` de xterm acepta `string | Uint8Array` —comprobado en las declaraciones de
tipos de la version 6.0.0— y cuando recibe bytes hace el decodificado UTF-8 el
mismo, arrastrando los caracteres partidos de una escritura a la siguiente. Se deja
que lo haga quien sabe hacerlo.

La alternativa de mandar `Vec<u8>` sin codificar tambien funciona, pero Tauri lo
serializa como un array JSON de numeros: cuatro veces mas grande por cada byte de
salida. Con `cargo build` escupiendo miles de lineas, se nota.

---

## Rust, pieza por pieza

Esta seccion es mas explicita de lo normal a proposito: quien lee esto no programa
en Rust, y los nombres de abajo estan copiados de la documentacion de
`portable-pty` 0.9.0, no recordados.

### El estado compartido

La aplicacion guarda los paneles en un mapa direccionado por id, registrado con
`.manage()` y recibido en cada comando como `tauri::State`:

```rust
struct Panel {
    escritor: Box<dyn Write + Send>,
    maestro: Box<dyn MasterPty + Send>,
    verdugo: Box<dyn ChildKiller + Send + Sync>,
}

struct Paneles(Mutex<HashMap<String, Panel>>);
```

Hoy el mapa nunca tiene mas de una entrada. Da igual: la firma es la que va a
seguir valiendo cuando tenga nueve.

### Abrir un panel

Los simbolos exactos de `portable-pty` 0.9.0:

- `native_pty_system()` da el sistema de PTY nativo, que en Windows es ConPTY.
- `.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })` devuelve un
  `PtyPair` con `.master` y `.slave`. Los campos de `PtySize` se llaman `rows` y
  `cols` en ingles porque son de la biblioteca; los argumentos del comando se
  llaman `filas` y `columnas` porque son nuestros. No se mezclan.
- `CommandBuilder::new("powershell.exe")` arma el proceso. **No se le fija `cwd`**:
  hereda el del proceso de la aplicacion.
- `pair.slave.spawn_command(cmd)` lo lanza y devuelve el `Child`.
- `pair.master.take_writer()` da el `Box<dyn Write + Send>` que se guarda.
- `pair.master.try_clone_reader()` da el `Box<dyn Read + Send>` que se lleva el hilo
  lector.
- `hijo.clone_killer()` da el `Box<dyn ChildKiller + Send + Sync>` que se guarda
  para `cerrar_panel`. Se necesita porque el `Child` se lo lleva el hilo lector para
  poder esperarlo, y sin esta copia nadie podria matarlo desde fuera.

Cuando `abrir_panel` recibe un id que ya esta en el mapa, devuelve
`Err("ya existe un panel con id \"1\"")` y **no** abre un segundo PTY.

### El hilo que lee

Un `std::thread::spawn` por panel. Necesita un `AppHandle` clonado para poder
emitir eventos desde fuera del hilo principal, y el `Child` completo para esperarlo:

```
bucle:
  n = lector.read(&mut buf)
  si n == 0 -> se acabo, salir del bucle
  emitir "panel:salida" con base64 de buf[..n]

estado = hijo.wait()
emitir "panel:fin" con estado.exit_code()
```

Dos cosas que Tauri v2 cambio respecto de v1 y que cuestan una tarde si no se
saben:

- **Para llamar a `.emit()` hay que tener el trait `Emitter` en alcance:**
  `use tauri::Emitter;`. En v1 el metodo se llamaba `emit_all` y estaba en otro
  sitio; los ejemplos viejos de internet no compilan.
- **Para `.manage()` y `.state()` hace falta `use tauri::Manager;`.**

`read` devolviendo `0` es la senal de que el proceso cerro su lado del PTY. No es un
error y no se reporta como tal.

### Cerrar

`cerrar_panel` llama a `.kill()` sobre el verdugo guardado y quita la entrada del
mapa. Cerrar la ventana con el proceso vivo **tiene que matar al hijo**: un
PowerShell huerfano que sobrevive a la ventana es un fallo, no un detalle.

---

## `ui/src-tauri/tauri.conf.json`

Cuatro campos no son opcionales aqui, y tres de ellos son justo donde se atasca
quien monta Tauri sin bundler:

| Campo | Valor | Por que |
|---|---|---|
| `app.withGlobalTauri` | `true` | **Sin esto no hay interfaz.** Es lo que pone la API de Tauri en `window.__TAURI__`. Por defecto es `false`, y entonces `invoke` solo se puede importar del paquete npm `@tauri-apps/api`, que en esta tanda no existe |
| `build.frontendDist` | `"../web"` | Apunta a `ui/web/`, relativo a `ui/src-tauri/`. Tauri busca ahi el `index.html` y lo sirve. **No se pone `devUrl`**: no hay servidor de desarrollo porque no hay bundler |
| `app.security.csp` | `null` | Desactiva la politica de contenido inyectada. Es una decision consciente para esta tanda: xterm inyecta estilos y una CSP mal puesta se manifiesta como una ventana en blanco sin ningun mensaje. Cuando la interfaz cargue datos de verdad, esto se revisa |
| `bundle.active` | `false` | Esta tanda no empaqueta un instalador, asi que no hacen falta iconos. Es lo que evita el desvio de generar un juego de `.ico` que nadie va a usar |

El `identifier` es `com.vitral.ui`. El titulo de la ventana es `Vitral`, y arranca
en 1000 x 700.

En JavaScript, con `withGlobalTauri`, las dos funciones se sacan asi:

```js
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
```

Fijarse en el `.core`: en Tauri v1 era `window.__TAURI__.invoke` y en v2 ya no
existe ahi. Es el error mas repetido al migrar y no da un mensaje util, solo
`undefined`.

## `ui/src-tauri/capabilities/default.json`

Tauri v2 no deja invocar nada sin permiso declarado. Hace falta una capability para
la ventana `main` que habilite lo que use el frontend. Los comandos propios de la
aplicacion —los cuatro de la tabla— no necesitan permiso; lo que si hay que
declarar es lo que se use de los plugins de Tauri. Si al arrancar sale un error de
permiso denegado nombrando un comando, se anade **ese** permiso y solo ese: no se
abre la capability entera por comodidad.

---

## El frontend

`ui/web/index.html` carga `vendor/xterm.css`, un contenedor y `panel.js` como
modulo. Nada mas: sin barras, sin menus, sin botones. El panel ocupa la ventana
entera.

`ui/web/panel.js` exporta una clase:

```js
class Panel {
  constructor(id, contenedor)   // crea la Terminal, la monta y llama a abrir_panel
}
```

y al final del archivo, la unica linea que hoy la usa:

```js
new Panel('1', document.getElementById('panel'));
```

Esa separacion entre la clase y su unico uso es toda la puerta que se deja abierta
para la cuadricula. No se anade nada mas por si acaso.

Lo que hace una instancia:

1. Crea `new Terminal({ ... })` con las opciones de la tabla de abajo y carga
   `FitAddon` con `term.loadAddon(fit)`.
2. `term.open(contenedor)` y `fit.fit()`.
3. `invoke('abrir_panel', { id, filas: term.rows, columnas: term.cols })`.
4. `listen('panel:salida', ...)`: si el `id` del evento es el suyo, decodifica el
   base64 a `Uint8Array` y llama a `term.write(bytes)`. **Se comprueba el id**
   aunque hoy solo haya uno: los eventos de Tauri llegan a todos los escuchadores.
5. `listen('panel:fin', ...)`: escribe la linea de proceso terminado y marca el
   panel como muerto.
6. `term.onData(datos => invoke('escribir_en_panel', { id, datos }))`, salvo si el
   panel esta muerto.
7. Un `resize` de la ventana llama a `fit.fit()` y despues a
   `redimensionar_panel` con las filas y columnas nuevas.

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

El `body` no tiene margen y el contenedor del panel ocupa el 100% del ancho y del
alto de la ventana, con el mismo fondo `#0c0c0c` para que no se vea un borde blanco
al redimensionar.

### El teclado

| Tecla | Que hace |
|---|---|
| Ctrl+C | **va al PTY**, o sea interrumpe el proceso. No copia |
| Ctrl+Shift+C | copia la seleccion al portapapeles |
| Ctrl+Shift+V | pega el portapapeles en el PTY |
| seleccion con el raton | la trae xterm de serie, no hay que hacer nada |

Es lo que hacen Windows Terminal y VS Code. Se implementa con
`term.attachCustomKeyEventHandler`, que devuelve `false` para las combinaciones que
maneja el frontend y `true` para todo lo demas.

### La linea de proceso terminado

Cuando llega `panel:fin`, el panel escribe **exactamente** esto, y despues deja de
aceptar teclas:

```
\r\n[el proceso termino con codigo 0]\r\n
```

Con el codigo que venga en el evento. Los `\r\n` son los dos, no solo `\n`: en una
terminal cruda un `\n` baja de linea pero no vuelve al margen izquierdo, y el texto
sale en escalera.

La ventana **no** se cierra y el scrollback **no** se borra: cuando un panel sea un
vidrio, lo ultimo que escribio un agente que murio es justo lo que se quiere leer.

---

## Los bordes

Todos tienen que estar cubiertos. Un caso que el contrato no cubre lo resuelve cada
agente a su manera.

| Caso | Que pasa |
|---|---|
| `abrir_panel` con un id que ya existe | `Err`, y no se abre un segundo PTY |
| `escribir_en_panel` / `redimensionar_panel` / `cerrar_panel` con un id desconocido | `Err` con el mensaje de la tabla de errores. Nunca un panic |
| Se teclea antes de que el PTY este listo | No puede pasar: `onData` se conecta despues de que `abrir_panel` haya devuelto |
| El proceso termina solo (`exit`, o lo mata alguien de fuera) | `panel:fin` con su codigo, linea de cierre, panel muerto |
| Se teclea en un panel muerto | No se envia nada y no se muestra ningun error. Las teclas simplemente no hacen nada |
| Llega `panel:salida` de otro id | Se ignora. Por eso se comprueba el id |
| Se cierra la ventana con el proceso vivo | Se mata el hijo. No queda ningun `powershell.exe` huerfano |
| Se redimensiona la ventana muy rapido | Cada `resize` llama a `fit()` y a `redimensionar_panel`. No hace falta amortiguarlo en esta tanda |
| La ventana se hace tan pequena que `fit()` da 0 filas o 0 columnas | Se manda un minimo de 1 fila y 1 columna. Un `PtySize` con ceros no es valido |
| `powershell.exe` no existe o no se puede lanzar | `abrir_panel` devuelve `Err` con el texto del sistema, y el frontend lo escribe en el panel para que se vea. No se deja la ventana en blanco |
| Salida enorme y muy rapida (`cargo build`) | Se emite tal como se lee, en trozos de 4096. No se acumula ni se descarta |
| Un caracter UTF-8 partido entre dos lecturas | Lo resuelve xterm, porque recibe bytes y no texto. Es la razon del base64 |
| Acentos que salen mal pese a todo | Windows PowerShell 5.1 escribe en la pagina de codigos de la consola. Si aparecen acentos rotos, **se anota en el handoff y se deja**: se arregla en otra tanda, no aqui |

---

## Que archivos no toca nadie en esta tanda

- Todo `src/`, `vitral.mjs` y `pruebas/checks.mjs`. Esta tanda no cambia ni una
  linea del motor de Node.
- `.vitral/plomo/`, `.vitral/planificar/` y `.vitral/ui/` —incluido este archivo.
- `ejemplo/`.
- `.gitignore`. Las lineas que hacen falta **ya estan puestas** antes de la corrida;
  si faltan, se dice en el handoff y no se anaden.
- `.gitattributes` y `LICENSE`.

## Lo que no entra

- **Ninguna cuadricula, ninguna pestana, ninguna division.** Un panel, pantalla
  completa.
- **Nada que lea `.vitral/`.** El panel no sabe que existe Vitral.
- **Ningun `package.json` ni `node_modules`** en ninguna parte del repositorio.
- **Ningun instalador.** `bundle.active` es `false`.
- **Ningun icono.**
- **Ni Linux ni macOS.** El codigo sale portable porque `portable-pty` lo es, pero
  lo unico que se prueba y se sostiene hoy es Windows.
- **Ninguna configuracion del usuario.** La fuente, el tema y el shell son
  constantes en el codigo.

---

## Como se sabe que esto esta terminado

Una aplicacion de escritorio no se puede verificar sin ojos delante, y conviene
decirlo en voz alta antes de que nadie de nada por bueno.

**Lo que el agente si puede comprobar, y tiene que comprobar:**

```
cargo build --manifest-path ui/src-tauri/Cargo.toml
```

Compila sin errores. Los avisos se leen y se arreglan los que sean del codigo
propio.

**Lo que el agente no puede comprobar:** que la ventana abra, que el prompt de
PowerShell aparezca, que las teclas lleguen y que Ctrl+C interrumpa. Eso lo hace una
persona con `cargo tauri dev`.

Por lo tanto: **el handoff no dice "funciona".** Dice que compila, y enumera lo que
queda por comprobar a mano, en una lista que se pueda ir tachando:

1. La ventana abre y se ve un prompt de PowerShell.
2. `dir` escribe la salida con sus colores.
3. Redimensionar la ventana reajusta el texto y no lo parte.
4. Ctrl+C corta un `ping -t localhost`.
5. Ctrl+Shift+C y Ctrl+Shift+V copian y pegan.
6. `exit` deja la linea `[el proceso termino con codigo 0]` y la ventana sigue
   abierta.
7. Al cerrar la ventana no queda ningun `powershell.exe` vivo en el Administrador
   de tareas.

---

## Aviso sobre los ejemplos de este archivo

Los nombres de simbolos de `portable-pty`, los campos de `tauri.conf.json`, la ruta
`window.__TAURI__.core.invoke`, la firma de `term.write` y los nombres de los
archivos vendorizados **estan verificados** contra la documentacion de las versiones
de la tabla y contra los paquetes reales descargados con `npm pack`.

Los fragmentos de codigo, en cambio, **estan escritos a mano**, porque el codigo
todavia no existe. Son la forma que se pide, no una salida copiada. En cuanto el
codigo exista, lo que mande es el codigo: si algo de aqui no se pudo hacer asi, se
dice en el handoff con el motivo, y este archivo se corrige antes de la tanda
siguiente.
