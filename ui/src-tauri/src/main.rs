// En release no se abre la consola detras de la ventana.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

/// El shell del panel, escrito en un solo sitio a proposito.
/// En esta maquina existe `powershell.exe` (Windows PowerShell 5.1) y no `pwsh.exe`.
const SHELL: &str = "powershell.exe";

/// Cuanto se lee del PTY de una vez.
const TROZO: usize = 4096;

/// El archivo de la lista de proyectos, dentro de `app_config_dir()`, que en esta
/// maquina es `%APPDATA%\com.vitral.ui\`.
const ARCHIVO: &str = "estado.json";

struct Panel {
    escritor: Box<dyn Write + Send>,
    maestro: Box<dyn MasterPty + Send>,
    verdugo: Box<dyn ChildKiller + Send + Sync>,
    /// El directorio con el que arranco, normalizado. Es lo unico que hace falta
    /// para que `quitar_proyecto` sepa cuales son sus paneles. No es un "proyecto
    /// actual": es del panel, como el id.
    cwd: String,
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

/// Lo que hay dentro de `estado.json`: rutas y preferencias, nada calculado.
/// Ningun campo lleva `#[serde(default)]` a proposito: si en el archivo falta uno,
/// o tiene el tipo equivocado, esto falla al parsear y se arranca con la lista
/// vacia sin tocar el archivo.
#[derive(Clone, Default, Serialize, Deserialize)]
struct Guardado {
    proyectos: Vec<String>,
    activo: Option<String>,
    plegada: bool,
}

/// Lo que ve el frontend. **No** es lo que hay en el archivo: lleva el nombre y la
/// disponibilidad ya calculados, que el archivo no guarda.
#[derive(Serialize)]
struct Proyecto {
    ruta: String,
    nombre: String,
    disponible: bool,
}

#[derive(Serialize)]
struct Estado {
    proyectos: Vec<Proyecto>,
    activo: Option<String>,
    plegada: bool,
}

/// El estado persistido, leido una sola vez al arrancar.
///
/// `fallo_al_leer` guarda el motivo de que el archivo no se pudiera leer o no
/// parseara. Mientras este puesto, `leer_estado` devuelve `Err` y la lista en
/// memoria esta vacia; el archivo no se toca hasta que el usuario haga un cambio.
#[derive(Default)]
struct Almacen {
    datos: Guardado,
    fallo_al_leer: Option<String>,
}

struct Persistido(Mutex<Almacen>);

/// Un mutex envenenado se convierte en `Err`, nunca en panic.
fn abrir_mapa(estado: &Paneles) -> Result<MutexGuard<'_, HashMap<String, Panel>>, String> {
    estado
        .0
        .lock()
        .map_err(|_| "el estado de los paneles quedo envenenado".to_string())
}

fn abrir_almacen(estado: &Persistido) -> Result<MutexGuard<'_, Almacen>, String> {
    estado
        .0
        .lock()
        .map_err(|_| "la lista de proyectos quedo envenenada".to_string())
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

// --- Rutas -----------------------------------------------------------------
//
// Esto es Windows: `C:\Proy\Vitral` y `c:/proy/vitral` son el mismo proyecto y no
// entran dos veces. Se normaliza la forma —barras, separadores repetidos, barra
// final— y se compara sin distinguir mayusculas. No se usa `canonicalize()`: en
// Windows devuelve rutas con prefijo `\\?\`, que es justo lo que no se quiere ni
// guardar ni ensenar.

fn normalizar(ruta: &str) -> String {
    let cruda = ruta.trim().replace('/', "\\");
    // El prefijo UNC son dos barras y se respeta tal cual; del cuerpo en adelante
    // los separadores repetidos se colapsan en uno.
    let unc = cruda.starts_with("\\\\");
    let cuerpo = if unc { &cruda[2..] } else { &cruda[..] };

    let mut salida = String::with_capacity(cruda.len());
    if unc {
        salida.push_str("\\\\");
    }
    let mut anterior_separador = false;
    for c in cuerpo.chars() {
        if c == '\\' {
            if anterior_separador {
                continue;
            }
            anterior_separador = true;
        } else {
            anterior_separador = false;
        }
        salida.push(c);
    }

    // Una barra final sobra, salvo que sea la raiz de una unidad ("C:\").
    while salida.len() > 1 && salida.ends_with('\\') && !salida.ends_with(":\\") {
        salida.pop();
    }
    salida
}

fn misma_ruta(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// El nombre de un proyecto no se guarda: es el ultimo segmento de su ruta,
/// calculado cada vez. La raiz de una unidad no tiene ultimo segmento y se
/// muestra entera.
fn nombre_de(ruta: &str) -> String {
    Path::new(ruta)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| ruta.to_string())
}

/// Disponible es que exista y sea un directorio. Se comprueba contra el disco, y
/// tampoco se guarda.
fn disponible(ruta: &str) -> bool {
    Path::new(ruta).is_dir()
}

/// El archivo guarda rutas; el comando devuelve la vista.
fn vista(datos: &Guardado) -> Estado {
    Estado {
        proyectos: datos
            .proyectos
            .iter()
            .map(|ruta| Proyecto {
                ruta: ruta.clone(),
                nombre: nombre_de(ruta),
                disponible: disponible(ruta),
            })
            .collect(),
        activo: datos.activo.clone(),
        plegada: datos.plegada,
    }
}

// --- El archivo de estado --------------------------------------------------

fn ruta_del_archivo(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(ARCHIVO))
        .map_err(|e| e.to_string())
}

/// Se lee una vez al arrancar. Si no existe, lista vacia y **el archivo no se crea
/// hasta el primer cambio**. Si no parsea, o le falta un campo, o un campo tiene el
/// tipo equivocado: lista vacia, se apunta el motivo, y **el archivo no se borra ni
/// se sobrescribe**. Borrar la lista de alguien por un fallo nuestro no es una opcion.
fn cargar(app: &AppHandle) -> Almacen {
    let fallo = |causa: String| Almacen {
        datos: Guardado::default(),
        fallo_al_leer: Some(format!("no se pudo leer la lista de proyectos: {causa}")),
    };

    let ruta = match ruta_del_archivo(app) {
        Ok(ruta) => ruta,
        Err(causa) => return fallo(causa),
    };
    if !ruta.exists() {
        return Almacen::default();
    }
    let texto = match std::fs::read_to_string(&ruta) {
        Ok(texto) => texto,
        Err(e) => return fallo(e.to_string()),
    };
    match serde_json::from_str::<Guardado>(&texto) {
        Ok(mut datos) => {
            // Las rutas del archivo se normalizan al leerlas para que las
            // comparaciones valgan aunque alguien lo haya editado a mano. Esto no
            // toca el archivo: solo la copia en memoria.
            for proyecto in datos.proyectos.iter_mut() {
                *proyecto = normalizar(proyecto);
            }
            // `activo` es **una de las de `proyectos`, o `null`**, y esa invariante
            // se hace cumplir aqui: se le da la forma exacta que tiene la entrada de
            // la lista, y si no esta en ella se queda en `null`. Un archivo editado a
            // mano con otra caja —`c:\proy\vitral` contra `C:\Proy\Vitral`— dejaria si
            // no un `activo` que el frontend no puede casar con ninguna fila, y se
            // veria "Elige un proyecto de la lista" con el proyecto ahi delante.
            let elegido = datos
                .activo
                .as_deref()
                .map(normalizar)
                .and_then(|a| datos.proyectos.iter().find(|p| misma_ruta(p, &a)).cloned());
            datos.activo = elegido;
            Almacen {
                datos,
                fallo_al_leer: None,
            }
        }
        Err(e) => fallo(e.to_string()),
    }
}

/// Se escribe entero —no se parchea— despues de cada cambio que lo afecte.
fn guardar(app: &AppHandle, datos: &Guardado) -> Result<(), String> {
    let culpa = |causa: String| format!("no se pudo guardar la lista de proyectos: {causa}");

    let ruta = ruta_del_archivo(app).map_err(culpa)?;
    if let Some(padre) = ruta.parent() {
        std::fs::create_dir_all(padre).map_err(|e| culpa(e.to_string()))?;
    }
    let texto = serde_json::to_string_pretty(datos).map_err(|e| culpa(e.to_string()))?;
    std::fs::write(&ruta, texto).map_err(|e| culpa(e.to_string()))
}

// --- Los comandos de proyecto ----------------------------------------------
//
// Los tres que devuelven `Estado` devuelven el estado entero ya recalculado, no un
// parche. Y ninguno guarda cual es el proyecto activo como estado propio: Rust
// persiste el campo `activo` en el archivo y nada mas. Quien sabe cual esta activo
// es el frontend.

#[tauri::command(async)]
fn leer_estado(persistido: State<'_, Persistido>) -> Result<Estado, String> {
    let almacen = abrir_almacen(&persistido)?;
    if let Some(causa) = &almacen.fallo_al_leer {
        return Err(causa.clone());
    }
    Ok(vista(&almacen.datos))
}

#[tauri::command(async)]
fn anadir_proyecto(
    app: AppHandle,
    persistido: State<'_, Persistido>,
    ruta: String,
) -> Result<Estado, String> {
    // El frontend no valida rutas: no sabe de discos. Se valida aqui.
    let limpia = normalizar(&ruta);
    if !Path::new(&limpia).is_absolute() {
        return Err(format!(
            "la ruta del proyecto tiene que ser absoluta: \"{ruta}\""
        ));
    }
    // Un archivo tambien cae aqui: para esto, un archivo es "no hay directorio".
    if !disponible(&limpia) {
        return Err(format!("no hay ningun directorio en \"{ruta}\""));
    }

    let mut almacen = abrir_almacen(&persistido)?;

    // Ya esta en la lista: no se duplica, no es un error, y el estado vuelve sin
    // cambios. Tampoco se reescribe el archivo, porque nada cambio.
    if almacen
        .datos
        .proyectos
        .iter()
        .any(|p| misma_ruta(p, &limpia))
    {
        return Ok(vista(&almacen.datos));
    }

    almacen.datos.proyectos.push(limpia);

    // Si la escritura falla el comando devuelve `Err`, pero el estado en memoria
    // **no se revierte**: lo que el usuario ve ya cambio, y deshacerlo por detras
    // es peor que avisar.
    let copia = almacen.datos.clone();
    guardar(&app, &copia)?;
    almacen.fallo_al_leer = None;

    Ok(vista(&almacen.datos))
}

#[tauri::command(async)]
fn quitar_proyecto(
    app: AppHandle,
    paneles: State<'_, Paneles>,
    persistido: State<'_, Persistido>,
    ruta: String,
) -> Result<Estado, String> {
    let limpia = normalizar(&ruta);
    let mut almacen = abrir_almacen(&persistido)?;

    if !almacen
        .datos
        .proyectos
        .iter()
        .any(|p| misma_ruta(p, &limpia))
    {
        // No estaba en la lista: no hay nada que quitar y no es un error.
        return Ok(vista(&almacen.datos));
    }

    // Quitar mata sus paneles: mismo camino que `cerrar_panel`, sin atajos.
    matar_los_de(&paneles, &limpia)?;

    almacen.datos.proyectos.retain(|p| !misma_ruta(p, &limpia));
    // Si el que se va era el activo, `activo` pasa a `null` aunque queden otros en
    // la lista. No se elige uno por el usuario.
    if almacen
        .datos
        .activo
        .as_deref()
        .is_some_and(|a| misma_ruta(a, &limpia))
    {
        almacen.datos.activo = None;
    }

    let copia = almacen.datos.clone();
    guardar(&app, &copia)?;
    almacen.fallo_al_leer = None;

    Ok(vista(&almacen.datos))
}

#[tauri::command(async)]
fn guardar_preferencias(
    app: AppHandle,
    persistido: State<'_, Persistido>,
    activo: Option<String>,
    plegada: bool,
) -> Result<(), String> {
    let mut almacen = abrir_almacen(&persistido)?;

    // `activo` es una de las de `proyectos`, o `null`. Se guarda la forma que ya
    // esta en la lista, no la que llegue escrita de otra manera.
    let elegido = match activo {
        None => None,
        Some(pedida) => {
            let limpia = normalizar(&pedida);
            match almacen
                .datos
                .proyectos
                .iter()
                .find(|p| misma_ruta(p, &limpia))
            {
                Some(p) => Some(p.clone()),
                None => {
                    return Err(format!(
                        "no hay ningun proyecto en la lista con la ruta \"{pedida}\""
                    ))
                }
            }
        }
    };

    almacen.datos.activo = elegido;
    almacen.datos.plegada = plegada;

    let copia = almacen.datos.clone();
    guardar(&app, &copia)?;
    almacen.fallo_al_leer = None;

    Ok(())
}

// --- Los comandos de panel -------------------------------------------------

#[tauri::command(async)]
fn abrir_panel(
    app: AppHandle,
    estado: State<'_, Paneles>,
    id: String,
    cwd: String,
    filas: u16,
    columnas: u16,
) -> Result<(), String> {
    // El cwd se comprueba **antes** de abrir el PTY, y no es opcional.
    // `CommandBuilder::current_directory()` de portable-pty 0.9.0 filtra el cwd con
    // `.filter(|path| Path::new(path).is_dir())` y, si no pasa, cae a USERPROFILE en
    // silencio: el panel abriria, el prompt apareceria, y estaria en el home del
    // usuario. No hay error que capturar porque no hay error.
    let destino = normalizar(&cwd);
    if !disponible(&destino) {
        return Err(format!("el directorio del panel \"{id}\" no existe: {cwd}"));
    }

    let mut mapa = abrir_mapa(&estado)?;
    if mapa.contains_key(&id) {
        return Err(format!("ya existe un panel con id \"{id}\""));
    }

    let sistema = native_pty_system();
    let par = sistema
        .openpty(medida(filas, columnas))
        .map_err(|e| format!("no se pudo abrir el pty del panel \"{id}\": {e}"))?;

    // El cwd es del panel, como el id: entra por parametro y se le fija aqui. No hay
    // ningun "directorio actual" global, ni en Rust ni en JavaScript.
    let mut orden = CommandBuilder::new(SHELL);
    orden.cwd(&destino);
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
            cwd: destino,
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

/// Los paneles de un proyecto que se quita. Es el mismo camino que `cerrar_panel`:
/// quitar la entrada del mapa —que suelta el maestro y desbloquea al lector— y
/// llamar al verdugo. El vigia de cada uno emitira su `panel:fin` como siempre.
fn matar_los_de(estado: &State<'_, Paneles>, cwd: &str) -> Result<(), String> {
    let mut mapa = abrir_mapa(estado)?;
    let suyos: Vec<String> = mapa
        .iter()
        .filter(|(_, panel)| misma_ruta(&panel.cwd, cwd))
        .map(|(id, _)| id.clone())
        .collect();
    for id in suyos {
        if let Some(mut panel) = mapa.remove(&id) {
            let _ = panel.verdugo.kill();
        }
    }
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
        .plugin(tauri_plugin_dialog::init())
        .manage(Paneles(Mutex::new(HashMap::new())))
        .manage(Persistido(Mutex::new(Almacen::default())))
        .setup(|app| {
            // Se lee una vez al arrancar, y solo aqui.
            let cargado = cargar(app.handle());
            let estado: State<'_, Persistido> = app.state();
            if let Ok(mut almacen) = estado.0.lock() {
                *almacen = cargado;
            }
            Ok(())
        })
        .on_window_event(|ventana, evento| {
            if let WindowEvent::CloseRequested { .. } = evento {
                matar_todos(ventana.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            abrir_panel,
            escribir_en_panel,
            redimensionar_panel,
            cerrar_panel,
            leer_estado,
            anadir_proyecto,
            quitar_proyecto,
            guardar_preferencias
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar la aplicacion de tauri");
}
