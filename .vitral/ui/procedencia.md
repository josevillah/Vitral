# Procedencia · como se supo lo que dice `panel-pty.md`

Esto **no es contrato**. Es la evidencia detras del contrato: el experimento con sus
medidas, de donde salen los simbolos y las cadenas de citas a fuente.

**Vive fuera de `plomo/` a proposito.** `leerPlomo` mete en el prompt de cada vidrio
todos los `.md` del primer nivel del directorio del plomo —para `.vitral/ui/boceto.json`
eso es `.vitral/ui/plomo/`, y nada mas—. Un archivo aqui no viaja en ningun prompt, pero
sigue versionado y sin tocar una letra: es un `Read` de distancia cuando haga falta
saber **como** se supo algo. En el contrato se queda lo que hay que cumplir.

Lo de abajo salio de `panel-pty.md` literalmente, sin reescribir. Lo unico anadido son
las notas fechadas, que van marcadas como tales.

---

## Que regla del contrato sostiene cada cosa

Antes de tocar nada de aqui, saber que cuelga de ello:

| Evidencia | Que regla del contrato sostiene |
|---|---|
| Las cuatro filas de "no bloquea" | `#[tauri::command(async)]` en los cuatro comandos |
| "Cerrar el extremo de escritura no descarta lo escrito" | El `join` del paso 4 del vigia |
| "Con el maestro vivo, el lector no ve el final" | El paso 2 del vigia, y toda la seccion del fin del PTY |
| La cadena del inspector | Que Ctrl+Shift+C en depuracion no se arregla en el frontend |

Las reglas ya estan enunciadas y razonadas en `panel-pty.md`. Si alguna vez una de
ellas parece prescindible, la respuesta esta aqui y no en releerla.

---

## Lo que esta medido, no supuesto

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

## La cadena del inspector

Por que Ctrl+Shift+C no llega a la pagina en compilaciones de depuracion, verificado en
la fuente de las cajas en `~/.cargo/registry`:

- `tauri-runtime-wry-2.11.4/src/lib.rs:5209` solo llama a `with_devtools` bajo
  `#[cfg(any(debug_assertions, feature = "devtools"))]`.
- `wry-0.55.1/src/lib.rs:836` deja `devtools: false` fuera de depuracion.
- `wry-0.55.1/src/webview2/mod.rs:573` lo pasa a `SetAreDevToolsEnabled`.
- La feature `devtools` no esta entre las de tauri por defecto ni se pide en
  `Cargo.toml`.

Conclusion: en release el inspector no existe y la tecla queda libre. No es un fallo del
codigo y no se arregla en el frontend.

---

## De donde sale lo que dice el contrato

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

> **Nota, 20-08-2026.** El parrafo de arriba se escribio antes de que existiera el
> vigia y su condicion ya se cumplio: esta implementado en `ui/src-tauri/src/main.rs`,
> con los cinco pasos numerados y en orden, y sobrevivio a la tanda de la cuadricula
> sin tocarse. A partir de aqui manda el codigo, que es lo que aquel parrafo pedia. La
> regla de corregir el contrato cuando el codigo lo desmienta sigue viva y esta en la
> cabecera de `panel-pty.md`; no hace falta repetirla.
