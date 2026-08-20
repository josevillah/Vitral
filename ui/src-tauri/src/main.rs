// En release no se abre la consola detras de la ventana.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Mutex, MutexGuard};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

/// El shell del panel, escrito en un solo sitio a proposito.
/// En esta maquina existe `powershell.exe` (Windows PowerShell 5.1) y no `pwsh.exe`.
const SHELL: &str = "powershell.exe";

/// Cuanto se lee del PTY de una vez.
const TROZO: usize = 4096;

struct Panel {
    escritor: Box<dyn Write + Send>,
    maestro: Box<dyn MasterPty + Send>,
    verdugo: Box<dyn ChildKiller + Send + Sync>,
}

/// Los paneles direccionados por id. Hoy nunca hay mas de uno; la firma es la que
/// va a seguir valiendo cuando haya nueve.
struct Paneles(Mutex<HashMap<String, Panel>>);

#[derive(Clone, Serialize)]
struct Salida {
    id: String,
    /// base64 de los bytes crudos del PTY, no texto.
    datos: String,
}

#[derive(Clone, Serialize)]
struct Fin {
    id: String,
    codigo: u32,
}

/// Un mutex envenenado se convierte en `Err`, nunca en panic.
fn abrir_mapa(estado: &Paneles) -> Result<MutexGuard<'_, HashMap<String, Panel>>, String> {
    estado
        .0
        .lock()
        .map_err(|_| "el estado de los paneles quedo envenenado".to_string())
}

/// Un `PtySize` con ceros no es valido: se manda un minimo de 1.
fn medida(filas: u16, columnas: u16) -> PtySize {
    PtySize {
        rows: filas.max(1),
        cols: columnas.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[tauri::command(async)]
fn abrir_panel(
    app: AppHandle,
    estado: State<'_, Paneles>,
    id: String,
    filas: u16,
    columnas: u16,
) -> Result<(), String> {
    let mut mapa = abrir_mapa(&estado)?;
    if mapa.contains_key(&id) {
        return Err(format!("ya existe un panel con id \"{id}\""));
    }

    let sistema = native_pty_system();
    let par = sistema
        .openpty(medida(filas, columnas))
        .map_err(|e| format!("no se pudo abrir el pty del panel \"{id}\": {e}"))?;

    // No se le fija cwd: hereda el del proceso de la aplicacion.
    let orden = CommandBuilder::new(SHELL);
    let mut hijo = par
        .slave
        .spawn_command(orden)
        .map_err(|e| format!("no se pudo lanzar \"{SHELL}\": {e}"))?;

    // Soltar el esclavo aqui es inofensivo, pero en Windows no provoca ningun EOF:
    // maestro y esclavo comparten el mismo `Arc<Mutex<Inner>>`, y el extremo de
    // escritura de la tuberia solo se cierra al soltar el MAESTRO. Quien desbloquea
    // al lector es el vigia al quitar la entrada del mapa, nadie mas.
    drop(par.slave);

    let escritor = par
        .master
        .take_writer()
        .map_err(|e| format!("no se pudo tomar el escritor del panel \"{id}\": {e}"))?;
    let mut lector = par
        .master
        .try_clone_reader()
        .map_err(|e| format!("no se pudo tomar el lector del panel \"{id}\": {e}"))?;

    // El `Child` se lo lleva el hilo vigia para poder esperarlo; esta copia es lo
    // unico que permite matarlo desde fuera.
    let verdugo = hijo.clone_killer();

    // Hilo lector: lee del PTY en trozos y emite `panel:salida`. Sale del bucle con
    // `Ok(0)` o con `Err`, indistintamente, y al salir no emite nada mas: la linea de
    // cierre la pone el vigia, que es quien sabe que ya no queda salida por delante.
    let app_lector = app.clone();
    let id_lector = id.clone();
    let hilo_lector = std::thread::spawn(move || {
        let mut buf = [0u8; TROZO];
        loop {
            match lector.read(&mut buf) {
                // Se solto el maestro y se acabo el PTY. No es un error.
                Ok(0) => break,
                Ok(n) => {
                    let carga = Salida {
                        id: id_lector.clone(),
                        datos: BASE64.encode(&buf[..n]),
                    };
                    if app_lector.emit("panel:salida", carga).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let id_vigia = id.clone();
    mapa.insert(
        id,
        Panel {
            escritor,
            maestro: par.master,
            verdugo,
        },
    );

    // El bloqueo se suelta antes de arrancar el vigia: si el proceso muriera al
    // instante, el vigia no puede quitar del mapa una entrada que todavia no esta
    // puesta, porque entonces el maestro quedaria guardado ahi para siempre.
    drop(mapa);

    // Hilo vigia: espera al proceso y hace los cinco pasos del contrato en orden. Es
    // el unico que emite `panel:fin`, y lo emite exactamente una vez, pase lo que pase.
    let app_vigia = app;
    std::thread::spawn(move || {
        // 1. El estado del proceso, con su codigo. Si `wait()` fallara —no deberia—,
        //    se emite igual con codigo 1: vale mas un codigo aproximado que un panel
        //    que se queda mudo, que es justo el fallo que esto arregla.
        let codigo = hijo.wait().map(|estado| estado.exit_code()).unwrap_or(1);

        // 2. Quitar la entrada del mapa, que suelta el maestro, que es lo unico que
        //    desbloquea al lector. Si ya no esta —cerrar_panel gano la carrera, o se
        //    cerro la ventana— no es un error. Ni siquiera un mutex envenenado puede
        //    dejar el maestro dentro: sin soltarlo no hay `Ok(0)` ni `panel:fin`.
        // 3. El bloqueo se suelta al cerrar este bloque, antes de esperar al lector.
        let difunto = {
            let estado: State<'_, Paneles> = app_vigia.state();
            let mut mapa = match estado.0.lock() {
                Ok(mapa) => mapa,
                Err(envenenado) => envenenado.into_inner(),
            };
            mapa.remove(&id_vigia)
        };
        drop(difunto);

        // 4. Esperar al lector. Cerrar el extremo de escritura no descarta lo ya
        //    escrito, asi que el ultimo trozo de salida llega antes del `Ok(0)`.
        let _ = hilo_lector.join();

        // 5. Y solo ahora la linea de cierre, detras de toda la salida y no en medio.
        let _ = app_vigia.emit(
            "panel:fin",
            Fin {
                id: id_vigia,
                codigo,
            },
        );
    });

    Ok(())
}

#[tauri::command(async)]
fn escribir_en_panel(estado: State<'_, Paneles>, id: String, datos: String) -> Result<(), String> {
    let mut mapa = abrir_mapa(&estado)?;
    let panel = mapa
        .get_mut(&id)
        .ok_or_else(|| format!("no hay ningun panel con id \"{id}\""))?;

    panel
        .escritor
        .write_all(datos.as_bytes())
        .and_then(|()| panel.escritor.flush())
        .map_err(|e| format!("no se pudo escribir en el panel \"{id}\": {e}"))
}

#[tauri::command(async)]
fn redimensionar_panel(
    estado: State<'_, Paneles>,
    id: String,
    filas: u16,
    columnas: u16,
) -> Result<(), String> {
    let mapa = abrir_mapa(&estado)?;
    let panel = mapa
        .get(&id)
        .ok_or_else(|| format!("no hay ningun panel con id \"{id}\""))?;

    panel
        .maestro
        .resize(medida(filas, columnas))
        .map_err(|e| format!("no se pudo redimensionar el panel \"{id}\": {e}"))
}

#[tauri::command(async)]
fn cerrar_panel(estado: State<'_, Paneles>, id: String) -> Result<(), String> {
    let mut mapa = abrir_mapa(&estado)?;
    let mut panel = mapa
        .remove(&id)
        .ok_or_else(|| format!("no hay ningun panel con id \"{id}\""))?;

    // Si el proceso ya habia terminado por su cuenta, matarlo falla en Windows.
    // El panel queda cerrado igual, que es lo que se pedia, asi que no es un error.
    let _ = panel.verdugo.kill();
    Ok(())
}

/// Al cerrar la ventana se mata todo lo que quede vivo: un `powershell.exe`
/// huerfano que sobrevive a la ventana es un fallo, no un detalle.
fn matar_todos(app: &AppHandle) {
    let estado: State<'_, Paneles> = app.state();
    // El Result se ata a un local para que se suelte antes que `estado`.
    let bloqueo = estado.0.lock();
    if let Ok(mut mapa) = bloqueo {
        for (_, mut panel) in mapa.drain() {
            let _ = panel.verdugo.kill();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Paneles(Mutex::new(HashMap::new())))
        .on_window_event(|ventana, evento| {
            if let WindowEvent::CloseRequested { .. } = evento {
                matar_todos(ventana.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            abrir_panel,
            escribir_en_panel,
            redimensionar_panel,
            cerrar_panel
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar la aplicacion de tauri");
}
