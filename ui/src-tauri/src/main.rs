// En release no se abre la consola detras de la ventana.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows_sys::Win32::System::Threading::GetSystemTimes;

/// El shell del panel, escrito en un solo sitio a proposito.
/// En esta maquina existe `powershell.exe` (Windows PowerShell 5.1) y no `pwsh.exe`.
const SHELL: &str = "powershell.exe";

/// Cuanto se lee del PTY de una vez.
const TROZO: usize = 4096;

/// El archivo de la lista de proyectos, dentro de `app_config_dir()`, que en esta
/// maquina es `%APPDATA%\com.vitral.ui\`.
const ARCHIVO: &str = "estado.json";

/// El periodo del unico hilo temporizador: una muestra por segundo, para las dos
/// metricas y para la senal de actividad.
const LATIDO: Duration = Duration::from_secs(1);

/// La ventana de la mitad 2 de la senal: "ha escrito en el PTY en el ultimo
/// segundo". Es exactamente el periodo del latido, asi que cualquier escritura
/// entre dos latidos la caza el siguiente y no queda hueco.
const RECIENTE: u64 = 1_000;

/// Los nombres del host de consola, que no cuenta como hijo.
///
/// Medido en esta maquina y **dentro de ConPTY**, que es como corren los paneles:
/// el `conhost.exe` de la pseudoconsola cuelga del proceso de la aplicacion, no
/// del `powershell.exe` del panel, asi que este filtro no llega a dispararse. Se
/// deja porque el contrato lo pide y porque no cuesta nada, no porque haga falta.
const HOSTS: [&str; 2] = ["conhost.exe", "openconsole.exe"];

/// El motor de una corrida, lanzado **con una tuberia normal, sin PTY y sin
/// shell**. Un PTY es un emulador de terminal: renderiza los bytes en un buffer de
/// N columnas y parte las lineas al ancho. Medido contra el boceto de la interfaz,
/// la linea mas larga del flujo son 86.690 caracteres, asi que por un PTY llegaria
/// troceada y con secuencias de escape dentro.
const NODE: &str = "node";
const MOTOR: &str = "vitral.mjs";

struct Panel {
    escritor: Box<dyn Write + Send>,
    maestro: Box<dyn MasterPty + Send>,
    verdugo: Box<dyn ChildKiller + Send + Sync>,
    /// El pid del proceso del panel. Es la mitad 1 de la senal de actividad: si
    /// alguien tiene este pid por padre, el panel esta ejecutando algo.
    pid: Option<u32>,
    /// Cuando llego el ultimo byte del PTY, en milisegundos desde `ARRANQUE`. Es
    /// la mitad 2 de la senal, y sale gratis: el hilo lector ya sabe cuando fue.
    /// Lo escribe el lector sin tocar el mapa, por eso es un atomico compartido.
    ultimo_byte: Arc<AtomicU64>,
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

/// `maquina:uso`: CPU y memoria de **la maquina entera**, nunca por panel.
/// `cpu` en tanto por ciento; `usada` y `total` en bytes.
#[derive(Clone, Serialize)]
struct Uso {
    cpu: f32,
    usada: u64,
    total: u64,
}

/// `paneles:ocupados`: **la lista completa** de los que estan ejecutando algo, en
/// cada latido. No son altas y bajas: el frontend sustituye su lista entera y asi
/// no hay transicion que se pueda perder.
#[derive(Clone, Serialize)]
struct Ocupados {
    ids: Vec<String>,
}

/// `corrida:linea`: una linea completa de la salida del motor, **texto plano y tal
/// cual**. No es base64 —el base64 de `panel:salida` existe porque un caracter
/// UTF-8 puede partirse entre dos lecturas del PTY, y aqui el lector ya entrega
/// lineas enteras— y no lleva ningun campo del JSON desmenuzado: quien conoce el
/// catalogo de eventos del motor es `ui/web/corrida.js`, y nadie mas.
#[derive(Clone, Serialize)]
struct Linea {
    proyecto: String,
    linea: String,
}

/// `corrida:fin`: una vez por corrida, pase lo que pase, como `panel:fin`.
#[derive(Clone, Serialize)]
struct FinCorrida {
    proyecto: String,
    codigo: i32,
}

/// `corridas:activas`: **la lista completa** en cada latido, no las altas y bajas.
/// Es la hermana de `paneles:ocupados`, y el frontend enciende el indicador de un
/// proyecto si aparece en cualquiera de las dos.
#[derive(Clone, Serialize)]
struct Activas {
    proyectos: Vec<String>,
}

/// Las corridas en marcha, direccionadas por su proyecto: una corrida se direcciona
/// por su proyecto como un panel por su `id`. **No hay ningun "proyecto de la
/// corrida" global**, ni aqui ni en JavaScript.
///
/// La clave es la ruta normalizada en minuscula, porque esto es Windows; el valor es
/// la ruta normalizada tal cual se emite, que es la forma que el frontend tiene en
/// su lista.
struct Corridas(Mutex<HashMap<String, String>>);

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

fn abrir_corridas(estado: &Corridas) -> Result<MutexGuard<'_, HashMap<String, String>>, String> {
    estado
        .0
        .lock()
        .map_err(|_| "el estado de las corridas quedo envenenado".to_string())
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

    // El pid es la mitad 1 de la senal de actividad, y hay que tomarlo aqui: el
    // vigia se lleva el `Child` y despues ya no hay a quien preguntarle.
    let pid = hijo.process_id();

    // La mitad 2 sale gratis: el lector ya sabe cuando llego el ultimo byte, solo
    // hay que guardar la marca. Nace sellada porque el shell esta arrancando y va a
    // escribir su prompt en seguida: un panel recien abierto si esta ejecutando algo.
    let ultimo_byte = Arc::new(AtomicU64::new(ahora_ms()));
    let sello = Arc::clone(&ultimo_byte);

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
                    // La marca se pone antes de emitir: es cuando llego el byte, no
                    // cuando termino de repartirse.
                    sello.store(ahora_ms(), Ordering::Relaxed);
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
            pid,
            ultimo_byte,
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
///
/// **Los paneles, y solo los paneles.** El proceso del motor de una corrida no se
/// mata, y no es un descuido: un panel huerfano no deja nada y nadie lo ve, mientras
/// que una corrida huerfana termina su trabajo y lo deja escrito en `.vitral/`
/// —handoffs, logs e historial—, porque el motor esta hecho para correr headless
/// desde una terminal. Matarlo tampoco serviria de mucho sin `taskkill /T`: en
/// Windows el hijo directo de cada agente es `cmd.exe`, asi que matar `node` dejaria
/// vivos a los agentes. El precio esta escrito en el contrato: al reabrir la
/// ventana, esa corrida es invisible.
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

// --- El modo corrida -------------------------------------------------------
//
// Las dos mitades ya existian: el motor emite eventos JSON con `--json`, y la
// ventana abre paneles con `cwd`. Esto las une, y **nada mas**: el motor decide y
// la ventana mira. No se reimplementa la orquestacion, no se lanza el planificador,
// y no se puede intervenir una corrida en marcha —ni abortar, ni pausar, ni
// reanudar—, porque el motor no ofrece nada de eso hoy y aqui no se inventa.
//
// **Rust no interpreta.** Reenvia la linea tal cual y no parsea ni un campo. Es el
// mismo reparto que ya existe con el PTY: alli Rust emite bytes y xterm interpreta;
// aqui Rust emite lineas y `ui/web/corrida.js` interpreta. Con eso el catalogo IPC
// gana dos eventos y no quince, y el catalogo de eventos del motor vive en un solo
// archivo. Si alguien se encuentra mirando dentro de una linea desde aqui, se salio
// del contrato.

/// La ruta absoluta del motor.
///
/// El plomo pide "la ruta absoluta a `vitral.mjs`" y no dice de donde sale, asi que
/// sale de aqui: `CARGO_MANIFEST_DIR` es `ui/src-tauri`, y dos niveles mas arriba
/// esta la raiz del repositorio con `vitral.mjs` al lado. Se fija en tiempo de
/// compilacion a proposito, que es la via que no anade ni una dependencia, ni un
/// archivo de configuracion, ni un argumento mas al comando —`lanzar_corrida`
/// recibe `proyecto` y `seco`, y nada mas—, y que vale para lo unico que hay hoy:
/// `cargo tauri dev` y `cargo build` sobre este checkout, que no se empaqueta en
/// ningun instalador (`bundle.active` es `false`).
///
/// Si el binario acabara sin el repositorio al lado, esto devuelve `Err` con la
/// ruta que busco, que se pinta como cualquier otro error y no deja la ventana en
/// blanco.
fn ruta_del_motor() -> Result<PathBuf, String> {
    let raiz = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| format!("no se encontro la raiz del motor \"{MOTOR}\""))?;
    let motor = raiz.join(MOTOR);
    if !motor.is_file() {
        return Err(format!("no se encontro el motor en \"{}\"", motor.display()));
    }
    Ok(motor)
}

/// Lanza una tanda en el proyecto activo y vuelve en cuanto el proceso arranca.
///
/// `proyecto` es la ruta **absoluta** del proyecto, igual que el `cwd` de un panel:
/// la raiz sale del cwd, que es la primitiva del motor, y el boceto es siempre
/// `.vitral/boceto.json` de ahi dentro. No se elige, no se busca y no se enumera
/// nada del proyecto; si no existe, el motor devuelve su propio error por el flujo
/// y se pinta como cualquier otro.
#[tauri::command(async)]
fn lanzar_corrida(
    app: AppHandle,
    corridas: State<'_, Corridas>,
    proyecto: String,
    seco: bool,
) -> Result<(), String> {
    let destino = normalizar(&proyecto);
    let clave = destino.to_lowercase();
    let motor = ruta_del_motor()?;

    // El mapa se toma **antes** de lanzar nada: entre comprobar y lanzar no puede
    // colarse una segunda corrida del mismo proyecto. Es lo mismo que hace
    // `abrir_panel` con un id repetido, y aqui tampoco se lanza un segundo proceso.
    let mut mapa = abrir_corridas(&corridas)?;
    if mapa.contains_key(&clave) {
        return Err(format!("ya hay una corrida en marcha en \"{destino}\""));
    }

    // Una tuberia normal, sin PTY y sin shell. `--seco` va delante de `--json` si
    // toca: el boton de lanzar corre el ensayo antes que la corrida real, que no
    // gasta un centimo y es donde saltan los guardarrailes. La persona ve el
    // resultado y decide, asi que aqui **no se encadena la corrida real sola**.
    let mut orden = Command::new(NODE);
    orden.arg(&motor);
    if seco {
        orden.arg("--seco");
    }
    orden
        .arg("--json")
        .current_dir(&destino)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Un `proyecto` que no existe tambien cae aqui, con el texto del sistema: a
    // diferencia de `portable-pty`, `Command` no descarta en silencio un directorio
    // malo para arrancar en el home del usuario.
    let mut hijo = orden
        .spawn()
        .map_err(|e| format!("no se pudo lanzar \"{NODE}\": {e}"))?;

    // Recien lanzado y con las dos tuberias pedidas, esto no puede ser `None`. Si
    // alguna vez lo fuera, el comando devuelve `Err` en vez de entrar en panic, y el
    // proceso queda como una corrida huerfana, que es lo que el contrato ya acepta.
    let (Some(salida), Some(mut error)) = (hijo.stdout.take(), hijo.stderr.take()) else {
        return Err("no se pudieron tomar las tuberias del motor".to_string());
    };

    // stderr va por tuberia porque lo pide el plomo, y **hay que vaciarlo**: una
    // tuberia que se llena bloquea al que escribe, y un motor bloqueado a mitad de
    // una linea de stderr no volveria nunca. El catalogo no tiene ningun evento de
    // stderr y aqui no se inventa, asi que se lee y se descarta.
    std::thread::spawn(move || {
        let mut vertedero = Vec::new();
        let _ = error.read_to_end(&mut vertedero);
    });

    // Hilo lector: **un trozo de la tuberia no es una linea**. Medido contra el
    // boceto de la interfaz, llegaron 7 trozos para 5 lineas y 3 de esos trozos no
    // contenian ni un salto de linea. Asi que se acumula en un buffer, se corta por
    // `\n` y se emiten **solo lineas completas**; lo que quede sin `\n` se guarda
    // para el trozo siguiente. `read_until` es exactamente eso, hecho por std.
    let app_lector = app.clone();
    let proyecto_lector = destino.clone();
    let hilo_lector = std::thread::spawn(move || {
        let mut tuberia = BufReader::new(salida);
        let mut cruda: Vec<u8> = Vec::new();
        loop {
            cruda.clear();
            match tuberia.read_until(b'\n', &mut cruda) {
                Ok(0) => break,
                Ok(_) => {
                    // Al cerrarse la tuberia, un resto sin salto de linea **se
                    // descarta**: es un flujo truncado, no un evento.
                    if cruda.last() != Some(&b'\n') {
                        break;
                    }
                    cruda.pop();
                    if cruda.last() == Some(&b'\r') {
                        cruda.pop();
                    }
                    // Una linea vacia no es un evento, y tampoco es una de esas
                    // lineas que no parsean que la corrida cuenta y ensena en su
                    // detalle: emitirla inflaria esa cuenta con ruido. Verlo es
                    // enmarcado, no lectura; no hace falta saber nada del JSON.
                    if cruda.is_empty() {
                        continue;
                    }
                    let carga = Linea {
                        proyecto: proyecto_lector.clone(),
                        // Lineas enteras, asi que no hay ningun caracter UTF-8
                        // partido que arrastrar de una lectura a la siguiente. Por
                        // eso esto es texto y no base64.
                        linea: String::from_utf8_lossy(&cruda).into_owned(),
                    };
                    if app_lector.emit("corrida:linea", carga).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    mapa.insert(clave.clone(), destino.clone());
    // El bloqueo se suelta antes de arrancar el vigia, que va a querer tomarlo.
    drop(mapa);

    // Hilo vigia, con el mismo reparto que el de un panel y por la misma razon: es
    // el unico que emite la linea de cierre, y la emite **exactamente una vez**,
    // pase lo que pase.
    let app_vigia = app;
    std::thread::spawn(move || {
        // 1. El codigo de salida. Si `wait()` fallara —no deberia—, se emite igual
        //    con codigo 1: el contrato promete que `corrida:fin` siempre sale, y
        //    vale mas un codigo aproximado que una corrida que se queda muda.
        let codigo = hijo
            .wait()
            .ok()
            .and_then(|estado| estado.code())
            .unwrap_or(1);

        // 2. Esperar al lector. Cerrar el extremo de escritura no descarta lo ya
        //    escrito, asi que las ultimas lineas siguen en la tuberia: sin este
        //    `join`, `corrida:fin` saldria por delante de ellas.
        let _ = hilo_lector.join();

        // 3. Y solo ahora se libera el proyecto. Soltarlo antes del `join` dejaria
        //    arrancar una corrida nueva mientras la vieja todavia emite lineas con
        //    ese mismo `proyecto`, y las dos se mezclarian en el frontend.
        {
            let estado: State<'_, Corridas> = app_vigia.state();
            let mut mapa = match estado.0.lock() {
                Ok(mapa) => mapa,
                Err(envenenado) => envenenado.into_inner(),
            };
            mapa.remove(&clave);
        }

        // 4. La linea de cierre, detras de toda la salida y no en medio.
        let _ = app_vigia.emit(
            "corrida:fin",
            FinCorrida {
                proyecto: destino,
                codigo,
            },
        );
    });

    Ok(())
}

/// Los proyectos con una corrida en marcha: la lista entera, para el latido.
fn activas(app: &AppHandle) -> Vec<String> {
    let estado: State<'_, Corridas> = app.state();
    let mut proyectos: Vec<String> = match estado.0.lock() {
        Ok(mapa) => mapa.values().cloned().collect(),
        Err(_) => return Vec::new(),
    };
    // El orden de un `HashMap` cambia entre latidos. El frontend usa esto como
    // conjunto, asi que da igual, pero ordenarlo no cuesta nada y evita que alguien
    // acabe apoyandose en un orden que no existe.
    proyectos.sort();
    proyectos
}

// --- El uso de la maquina y la senal de actividad ---------------------------
//
// Las dos cosas las emite **un solo hilo temporizador**, no uno por metrica, y las
// dos son de Rust entero: el frontend recibe cifras y una lista ya resuelta, y no
// calcula nada. No es reparto de comodidad: es lo que hace que medir no pueda
// bloquear al frontend.

/// El origen del reloj de la senal. Se usa un `Instant` y no la hora del sistema
/// porque lo unico que interesan son diferencias, y un cambio de hora no puede
/// mover el pasado.
static ARRANQUE: LazyLock<Instant> = LazyLock::new(Instant::now);

fn ahora_ms() -> u64 {
    ARRANQUE.elapsed().as_millis() as u64
}

/// Los tiempos acumulados de la maquina. La CPU no es un valor instantaneo: es la
/// diferencia entre dos muestras, y por eso hay que guardar la anterior.
#[derive(Clone, Copy)]
struct Tiempos {
    ocioso: u64,
    total: u64,
}

fn de_filetime(f: &FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}

/// `GetSystemTimes`: los tres tiempos de **la maquina entera**, nunca por panel.
/// Medido aqui junto con `GlobalMemoryStatusEx`: `0,01 ms` por muestra, mas barato
/// aun que el `1 ms` que el contrato midio con los contadores de rendimiento, y sin
/// ningun manejador que abrir ni que se pueda quedar a medias.
fn tiempos() -> Option<Tiempos> {
    // SEGURIDAD: tres `FILETIME` de la pila que la llamada solo escribe.
    unsafe {
        let mut ocioso: FILETIME = std::mem::zeroed();
        let mut nucleo: FILETIME = std::mem::zeroed();
        let mut usuario: FILETIME = std::mem::zeroed();
        if GetSystemTimes(&mut ocioso, &mut nucleo, &mut usuario) == 0 {
            return None;
        }
        // `nucleo` ya lleva dentro el tiempo ocioso, asi que el total del intervalo
        // es nucleo + usuario y lo parado es `ocioso` a secas.
        Some(Tiempos {
            ocioso: de_filetime(&ocioso),
            total: de_filetime(&nucleo) + de_filetime(&usuario),
        })
    }
}

/// Memoria fisica de la maquina, en bytes, que es la unidad que pide el evento.
fn memoria() -> Option<(u64, u64)> {
    // SEGURIDAD: una estructura de la pila con su `dwLength` puesto, como exige la
    // llamada, que solo la escribe.
    unsafe {
        let mut m: MEMORYSTATUSEX = std::mem::zeroed();
        m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut m) == 0 {
            return None;
        }
        Some((m.ullTotalPhys.saturating_sub(m.ullAvailPhys), m.ullTotalPhys))
    }
}

/// El host de consola no cuenta como hijo. Ver el comentario de `HOSTS`: medido
/// dentro de ConPTY, esto no llega a dispararse.
fn es_host(nombre: &[u16]) -> bool {
    let fin = nombre.iter().position(|&c| c == 0).unwrap_or(nombre.len());
    let texto = String::from_utf16_lossy(&nombre[..fin]).to_lowercase();
    HOSTS.contains(&texto.as_str())
}

/// **Un unico snapshot del sistema**, que da todos los padres de una pasada y vale
/// para los cuatro paneles a la vez.
///
/// Esta es la puerta que el contrato manda medir antes de escribir la mitad 1, y la
/// cifra de esta maquina es `8,1 ms` de media y `9,4 ms` el peor de doce muestras,
/// con 256 procesos vivos. Por debajo del umbral de `20 ms`, asi que la mitad 1
/// entra. A 1 Hz eso es un `0,8 %` de un nucleo.
///
/// Lo que **no** se hace es preguntar por los hijos de cada pid por separado: eso
/// son 48 ms por panel via WMI, 190 ms con cuatro paneles, y es inaceptable.
fn pids_con_hijo(interesan: &HashSet<u32>) -> HashSet<u32> {
    let mut con_hijo = HashSet::new();
    // SEGURIDAD: el manejador se cierra en todos los caminos, y la entrada lleva su
    // `dwSize` puesto, que es lo que exige `Process32FirstW`.
    unsafe {
        let foto = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if foto == INVALID_HANDLE_VALUE {
            // Sin snapshot no hay mitad 1 en este latido. No es un error que aborte
            // nada: la senal se queda con la mitad 2 y el evento se emite igual.
            return con_hijo;
        }
        let mut entrada: PROCESSENTRY32W = std::mem::zeroed();
        entrada.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(foto, &mut entrada) != 0 {
            loop {
                let padre = entrada.th32ParentProcessID;
                if interesan.contains(&padre) && !es_host(&entrada.szExeFile) {
                    con_hijo.insert(padre);
                }
                if Process32NextW(foto, &mut entrada) == 0 {
                    break;
                }
            }
        }
        CloseHandle(foto);
    }
    con_hijo
}

/// La senal entera, ya resuelta: el frontend no calcula ninguna de las dos mitades.
///
/// Un panel esta ejecutando algo si se cumple **cualquiera** de las dos:
///
/// 1. tiene un proceso hijo que no sea el host de consola;
/// 2. ha escrito en el PTY en el ultimo segundo.
///
/// Cada mitad tapa el agujero de la otra: la 1 no ve los cmdlets que PowerShell
/// ejecuta en proceso, y la 2 no ve el trabajo silencioso.
fn ocupados(app: &AppHandle) -> Vec<String> {
    let estado: State<'_, Paneles> = app.state();

    // El mapa se suelta **antes** del snapshot. Ocho milisegundos con el mutex en la
    // mano bloquearian a los ocho comandos sin ninguna necesidad, que es la misma
    // razon por la que el vigia suelta el bloqueo antes de esperar al lector.
    let vivos: Vec<(String, Option<u32>, u64)> = {
        let mapa = match estado.0.lock() {
            Ok(mapa) => mapa,
            Err(_) => return Vec::new(),
        };
        mapa.iter()
            .map(|(id, panel)| {
                (
                    id.clone(),
                    panel.pid,
                    panel.ultimo_byte.load(Ordering::Relaxed),
                )
            })
            .collect()
    };

    let ahora = ahora_ms();
    let reciente = |ultimo: u64| ahora.saturating_sub(ultimo) <= RECIENTE;

    // El snapshot solo se pide si queda alguno sin resolver: los 8 ms no se pagan
    // para confirmar lo que la mitad 2 ya dijo, ni cuando no hay ningun panel.
    let pendientes: HashSet<u32> = vivos
        .iter()
        .filter(|(_, _, ultimo)| !reciente(*ultimo))
        .filter_map(|(_, pid, _)| *pid)
        .collect();
    let con_hijo = if pendientes.is_empty() {
        HashSet::new()
    } else {
        pids_con_hijo(&pendientes)
    };

    vivos
        .into_iter()
        .filter(|(_, pid, ultimo)| reciente(*ultimo) || pid.is_some_and(|p| con_hijo.contains(&p)))
        .map(|(id, _, _)| id)
        .collect()
}

/// El **unico** hilo temporizador, que emite los dos eventos nuevos. Una muestra por
/// segundo, y no se pausa al perder el foco: mientras un agente corre la persona
/// esta en otra ventana, y pausar justo ahi vaciaria de sentido la funcion.
///
/// La GPU no se muestrea. Esta medida —`1,544 ms` por muestra, y Windows no expone
/// ningun contador agregado— y el contrato la deja fuera.
fn latido(app: AppHandle, minimizada: Arc<AtomicBool>) {
    let mut previo = tiempos();
    loop {
        std::thread::sleep(LATIDO);

        // Solo se pausa con la ventana minimizada, que es cuando no hay nada que
        // pintar. `previo` se queda como estaba, asi que al restaurar, el primer
        // valor de CPU es el del intervalo entero que estuvo minimizada: es lo que
        // dice el contrato, no un descuido.
        if minimizada.load(Ordering::Relaxed) {
            continue;
        }

        // Si los tiempos o la memoria no se pueden leer, `maquina:uso` **no se
        // emite** y la franja muestra guiones. No es un error que aborte nada.
        let ahora = tiempos();
        if let (Some(ahora), Some(antes), Some((usada, total))) = (ahora, previo, memoria()) {
            let intervalo = ahora.total.saturating_sub(antes.total);
            if intervalo > 0 {
                let parado = ahora.ocioso.saturating_sub(antes.ocioso);
                let cpu = 100.0 * (1.0 - parado as f64 / intervalo as f64);
                let _ = app.emit(
                    "maquina:uso",
                    Uso {
                        cpu: cpu.clamp(0.0, 100.0) as f32,
                        usada,
                        total,
                    },
                );
            }
        }
        if ahora.is_some() {
            previo = ahora;
        }

        // La lista completa en cada latido, tambien cuando esta vacia: el frontend
        // sustituye la suya entera y no lleva contabilidad propia, asi que una lista
        // vacia es justo lo que apaga los indicadores.
        let _ = app.emit("paneles:ocupados", Ocupados { ids: ocupados(&app) });

        // Y la hermana de la anterior, en **este mismo hilo**: el contrato pide un
        // solo temporizador, no uno por metrica. Tambien la lista completa, y
        // tambien cuando esta vacia, que es justo lo que apaga los indicadores.
        let _ = app.emit(
            "corridas:activas",
            Activas {
                proyectos: activas(&app),
            },
        );
    }
}

fn main() {
    // Tauri v2 no tiene ningun `WindowEvent::Minimized`, pero en Windows minimizar
    // manda un `WM_SIZE` con el area de cliente a cero, y tao lo reenvia tal cual
    // como `Resized(0, 0)`. Se apunta aqui y el hilo del latido solo lee un
    // booleano: preguntarle a la ventana desde otro hilo obligaria a cruzar el bucle
    // de eventos una vez por segundo, y eso si se puede quedar colgado al cerrar.
    let minimizada = Arc::new(AtomicBool::new(false));
    let minimizada_latido = Arc::clone(&minimizada);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Paneles(Mutex::new(HashMap::new())))
        .manage(Persistido(Mutex::new(Almacen::default())))
        .manage(Corridas(Mutex::new(HashMap::new())))
        .setup(move |app| {
            // Se lee una vez al arrancar, y solo aqui.
            let cargado = cargar(app.handle());
            let estado: State<'_, Persistido> = app.state();
            if let Ok(mut almacen) = estado.0.lock() {
                *almacen = cargado;
            }

            // El unico hilo temporizador, que emite `maquina:uso`,
            // `paneles:ocupados` y `corridas:activas`. Uno, no uno por metrica.
            let app_latido = app.handle().clone();
            std::thread::spawn(move || latido(app_latido, minimizada_latido));
            Ok(())
        })
        .on_window_event(move |ventana, evento| match evento {
            WindowEvent::CloseRequested { .. } => matar_todos(ventana.app_handle()),
            WindowEvent::Resized(tamano) => {
                minimizada.store(tamano.width == 0 || tamano.height == 0, Ordering::Relaxed);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            abrir_panel,
            escribir_en_panel,
            redimensionar_panel,
            cerrar_panel,
            leer_estado,
            anadir_proyecto,
            quitar_proyecto,
            guardar_preferencias,
            lanzar_corrida
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar la aplicacion de tauri");
}
