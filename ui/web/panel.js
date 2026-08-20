import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';

// Con `withGlobalTauri` la API vive en `window.__TAURI__`. Ojo al `.core`: en
// Tauri v1 era `window.__TAURI__.invoke` y en v2 ahi ya no hay nada.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// El tope cuenta celdas, no procesos vivos: un panel muerto sigue ocupando la
// suya. Cuatro sale de una cuenta de caracteres, no de gusto: a 14px un 3x3 en
// esta ventana dejaria unas 39 columnas por panel, que no llegan para un prompt
// de PowerShell con la ruta entera mas el comando.
const TOPE = 4;

// Es contrato, no gusto personal. El terminal no cambia de tipografia porque la
// barra lateral tenga la suya.
const OPCIONES = {
  fontFamily: "'Cascadia Mono', Consolas, monospace",
  fontSize: 14,
  cursorBlink: true,
  theme: {
    background: '#0c0c0c',
    foreground: '#cccccc',
  },
  scrollback: 10000,
};

// Los cinco estados vacios de la zona de rejilla. Son cinco situaciones distintas
// y cada una tiene su texto: caer de la segunda en la primera, en silencio,
// esconderia que algo se rompio. Literales, y se copian tal cual.
const VACIO_SIN_PROYECTOS = 'Todavia no has abierto ningun proyecto.';
const VACIO_SIN_ACTIVO = 'Elige un proyecto de la lista.';
const VACIO_NO_DISPONIBLE = 'El ultimo proyecto abierto ya no esta disponible.';
const VACIO_SIN_PANELES = 'Ctrl+Shift+N para abrir un panel.';
const VACIO_ILEGIBLE = 'No se pudo leer la lista de proyectos. No se ha borrado nada.';

// Los dos rotulos del boton del estado vacio, tambien literales. El boton sale en
// tres de las cinco pantallas y en las otras dos NO, a proposito: en esas la accion
// que toca esta en la lista, que ya se ve al lado, y un boton ahi competiria con
// ella. El reparto lo decide `textoVacio`.
const BOTON_PROYECTO = 'Abrir un proyecto…';
const BOTON_PANEL = 'Abrir un panel';

/// El PTY manda bytes en base64 justo para que un caracter UTF-8 partido entre dos
/// lecturas no se pierda: quien lo junta es xterm, que recibe bytes y no texto.
function bytesDesdeBase64(texto) {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

/// Un terminal y su PTY, y nada mas: `Panel` no sabe que existe la rejilla, ni que
/// existen los proyectos. Los atajos que no son suyos salen por `alNuevo`,
/// `alCerrar` y `alPlegar`, que la rejilla rellena desde fuera. Esa frontera es lo
/// que hara que el modo corrida pueda crear paneles con otro comando sin tocar la
/// disposicion.
///
/// Un panel nace sabiendo su `cwd`, igual que nace sabiendo su `id`, y lo recibe
/// de la rejilla a la que pertenece: no lo va a buscar a ningun sitio, porque no
/// hay ningun sitio donde buscarlo. No existe el proyecto activo global.
class Panel {
  constructor(id, cwd, celda) {
    this.id = id;
    this.cwd = cwd;
    this.celda = celda;
    this.muerto = false;
    // Mientras `abrir_panel` no haya devuelto no se llama a ningun otro comando
    // con este id: en Rust todavia no hay entrada en el mapa.
    this.abierto = false;
    // El terminal ya esta desechado: no se le vuelve a tocar.
    this.cerrado = false;

    this.alNuevo = () => {};
    this.alCerrar = () => {};
    this.alPlegar = () => {};

    this.term = new Terminal(OPCIONES);
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(celda);
    this.fit.fit();

    this.term.attachCustomKeyEventHandler((evento) => this.tecla(evento));

    // Un `ResizeObserver` por celda, y ningun `window.addEventListener('resize')`:
    // el observador cubre los dos casos, y el segundo es el que se escaparia. Al
    // cambiar el numero de paneles cambia el tamano de todas las celdas sin que la
    // ventana se mueva, asi que un `resize` de ventana no se dispara y los PTY se
    // quedarian con las filas y columnas viejas.
    //
    // Lo que este observador NO cubre es la rejilla oculta: un elemento sin caja
    // no avisa. De eso se encarga `rejillas.mostrar`, a mano.
    this.observador = new ResizeObserver(() => this.reajustar());
    this.observador.observe(celda);
  }

  async arrancar() {
    try {
      // `cwd` no es opcional y va siempre absoluto: es el fallo mudo de esta
      // tanda. Omitirlo, o mandarlo relativo, abre el panel igual y en el home
      // del usuario, y nadie lo ve hasta que escribe `pwd`. Quien valida la ruta
      // es Rust; aqui no se sabe de discos.
      await invoke('abrir_panel', {
        id: this.id,
        cwd: this.cwd,
        filas: this.filas(),
        columnas: this.columnas(),
      });
    } catch (error) {
      // Que el fallo se vea en el panel; nunca una ventana en blanco sin motivo.
      this.muerto = true;
      this.term.write(`\r\n[no se pudo abrir el panel: ${error}]\r\n`);
      return;
    }

    // Si cerraron el panel mientras `abrir_panel` estaba en vuelo, su
    // `cerrar_panel` fallo con un id que todavia no existia: el PTY que acaba de
    // abrirse quedaria vivo y sin nadie mirandolo. Se mata aqui.
    if (this.cerrado) {
      invoke('cerrar_panel', { id: this.id }).catch(() => {});
      return;
    }

    this.abierto = true;
    // Si la celda cambio de tamano mientras `abrir_panel` estaba en vuelo, el
    // observador no pudo avisar a Rust todavia: se pone al dia aqui.
    this.reajustar();

    // El teclado se engancha despues de que `abrir_panel` haya devuelto: asi no
    // se puede teclear antes de que el PTY este listo.
    this.term.onData((datos) => {
      // En un panel muerto las teclas simplemente no hacen nada.
      if (this.muerto) return;
      invoke('escribir_en_panel', { id: this.id, datos }).catch(() => {});
    });
  }

  /// Lo que llega por `panel:salida`, ya repartido por el registro.
  escribir(datos) {
    this.term.write(bytesDesdeBase64(datos));
  }

  /// Lo que llega por `panel:fin`. La ventana no se cierra y el scrollback no se
  /// borra: cuando un panel sea un vidrio, lo ultimo que escribio un agente que
  /// murio es justo lo que se quiere leer.
  morir(codigo) {
    this.muerto = true;
    this.abierto = false;
    this.term.write(`\r\n[el proceso termino con codigo ${codigo}]\r\n`);
  }

  /// Una linea de la aplicacion dentro del terminal. Solo para lo que no tiene
  /// otro sitio donde verse: un error que si no se escribe aqui no se ve.
  aviso(texto) {
    this.term.write(`\r\n[${texto}]\r\n`);
  }

  enfocar() {
    this.term.focus();
  }

  /// Deja de observar antes de soltar el terminal: un aviso del observador sobre
  /// un terminal ya desechado no tiene a quien avisar.
  cerrar() {
    this.cerrado = true;
    this.observador.disconnect();
    // Si el panel ya estaba muerto, el vigia quito la entrada y Rust responde
    // `Err` de id desconocido: se ignora, la celda se quita igual.
    invoke('cerrar_panel', { id: this.id }).catch(() => {});
    this.term.dispose();
  }

  /// Un `PtySize` con ceros no es valido: minimo 1.
  filas() {
    return Math.max(1, this.term.rows);
  }

  columnas() {
    return Math.max(1, this.term.cols);
  }

  /// Una celda oculta -la rejilla de un proyecto que no es el activo- mide cero, y
  /// medir cero no es una medida: `fit()` no sabria proponer nada y mandariamos a
  /// Rust unas filas y columnas inventadas. Un panel que no se ve se queda con el
  /// tamano que tenia hasta que `rejillas.mostrar` lo reajuste a mano.
  visible() {
    return this.celda.isConnected && this.celda.clientWidth > 0 && this.celda.clientHeight > 0;
  }

  reajustar() {
    if (this.cerrado || !this.visible()) return;
    this.fit.fit();
    if (!this.abierto || this.muerto) return;
    invoke('redimensionar_panel', {
      id: this.id,
      filas: this.filas(),
      columnas: this.columnas(),
    }).catch(() => {});
  }

  /// `false` para lo que maneja el frontend, `true` para todo lo demas. Ctrl+C se
  /// deja pasar al PTY -interrumpe, no copia- como en Windows Terminal y VS Code.
  /// Los atajos se capturan aqui y no solo en un `keydown` de `window`: el terminal
  /// enfocado se come las teclas antes de que lleguen ahi.
  tecla(evento) {
    if (!evento.ctrlKey || !evento.shiftKey) return true;

    const letra = evento.key.toLowerCase();
    if (letra.length !== 1 || !'cvnwb'.includes(letra)) return true;

    if (evento.type !== 'keydown') return false;

    // Lo que ya se atendio aqui no vuelve a atenderse en el escuchador de
    // `window`, que ademas mira de donde viene el evento antes de tocarlo.
    evento.preventDefault();
    evento.stopPropagation();

    if (letra === 'n') {
      this.alNuevo();
    } else if (letra === 'w') {
      this.alCerrar();
    } else if (letra === 'b') {
      this.alPlegar();
    } else if (letra === 'c') {
      const seleccion = this.term.getSelection();
      if (seleccion) navigator.clipboard.writeText(seleccion).catch(() => {});
    } else if (!this.muerto) {
      navigator.clipboard
        .readText()
        .then((datos) => {
          if (datos) invoke('escribir_en_panel', { id: this.id, datos }).catch(() => {});
        })
        .catch(() => {});
    }

    return false;
  }
}

/// Una rejilla por proyecto: quien hay, quien manda, como se colocan. No sabe que
/// hay dentro de un panel.
///
/// Los paneles viven en un unico mapa por id, que es la guia de reparto de los dos
/// escuchadores; cada rejilla guarda solo el orden y las celdas de los suyos. Al
/// cambiar de proyecto activo la rejilla del anterior se oculta con sus paneles
/// VIVOS: no se cierra nada y sus PTY siguen corriendo.
const rejillas = {
  zona: document.getElementById('zona'),
  /// ruta del proyecto -> { ruta, elemento, orden: [ids], celdas: Map, enfocado }
  porProyecto: new Map(),
  /// id -> Panel, de todos los proyectos a la vez.
  paneles: new Map(),
  /// id -> ruta de su proyecto, para saber a que rejilla pertenece un panel.
  dueno: new Map(),
  /// La ruta de la rejilla que se ve, o `null` si no se ve ninguna.
  visible: null,
  /// Un contador que solo sube, y es de toda la aplicacion, no de cada rejilla: un
  /// id no se reutiliza nunca, aunque su panel se haya cerrado. Es lo que garantiza
  /// que `abrir_panel` no pueda chocar con una entrada que todavia no se ha
  /// limpiado en Rust.
  siguiente: 1,

  para(ruta) {
    const encontrada = this.porProyecto.get(ruta);
    if (encontrada) return encontrada;

    const elemento = document.createElement('div');
    elemento.className = 'rejilla oculta';
    this.zona.appendChild(elemento);

    const rejilla = { ruta, elemento, orden: [], celdas: new Map(), enfocado: null };
    this.porProyecto.set(ruta, rejilla);
    this.forma(rejilla);
    return rejilla;
  },

  /// Muestra la rejilla de un proyecto y oculta las demas. `null` no muestra
  /// ninguna, que es lo que toca sin proyecto activo.
  mostrar(ruta) {
    if (this.visible === ruta) return;

    const rejilla = ruta === null ? null : this.para(ruta);
    for (const [otra, cualquiera] of this.porProyecto) {
      cualquiera.elemento.classList.toggle('oculta', otra !== ruta);
    }
    this.visible = ruta;
    if (rejilla === null) return;

    // La trampa de esta tanda, y donde hay que mirar primero si algo sale en
    // escalera: un elemento oculto NO dispara el `ResizeObserver`. Mientras esta
    // rejilla no se veia, sus celdas pudieron cambiar de tamano -la ventana, la
    // barra plegandose, otro proyecto con otro numero de paneles- y nadie aviso.
    // El reajuste al mostrar se hace a mano y sobre TODOS sus paneles, no solo
    // sobre el enfocado. Leer la caja despues de quitar la clase fuerza el calculo
    // de la disposicion, asi que aqui ya miden lo que van a medir.
    for (const id of rejilla.orden) {
      const panel = this.paneles.get(id);
      if (panel) panel.reajustar();
    }
    this.enfocar(rejilla.enfocado);
  },

  /// Abre un panel mas en la rejilla que se ve, hasta el tope.
  abrir() {
    // Sin proyecto activo no hace nada: un panel necesita un `cwd`, y sin proyecto
    // no hay ninguno. Tampoco lo hay si el activo no esta disponible, y entonces
    // su rejilla no se esta mostrando.
    const ruta = this.visible;
    if (ruta === null) return;

    const rejilla = this.para(ruta);
    // Al llegar al tope no hace nada y no muestra ningun aviso: el unico sitio
    // donde se podria escribir es dentro de un terminal, y eso seria ensuciar
    // contenido con mensajes de la aplicacion.
    if (rejilla.orden.length >= TOPE) return;

    const id = String(this.siguiente);
    this.siguiente += 1;

    const celda = document.createElement('div');
    celda.className = 'celda';
    // En captura: xterm maneja el `mousedown` dentro de su propio elemento para
    // la seleccion, y asi el foco se decide antes y no depende de que lo deje
    // burbujear.
    celda.addEventListener('mousedown', () => this.enfocar(id), true);
    rejilla.elemento.appendChild(celda);

    const panel = new Panel(id, ruta, celda);
    panel.alNuevo = () => this.abrir();
    panel.alCerrar = () => this.cerrar(id);
    panel.alPlegar = () => alternarPlegada();

    // Se registra antes de abrir el PTY: si se registrase despues, lo primero que
    // escribiera el shell llegaria sin nadie a quien repartirselo.
    this.paneles.set(id, panel);
    this.dueno.set(id, ruta);
    rejilla.celdas.set(id, celda);
    rejilla.orden.push(id);

    // Primero la disposicion nueva, para que el `fit()` de `arrancar` mida la
    // celda con el tamano que va a tener de verdad.
    this.forma(rejilla);
    this.enfocar(id);
    panel.arrancar();
    pintarVacio();
  },

  cerrar(id) {
    const rejilla = this.porProyecto.get(this.dueno.get(id));
    if (!rejilla) return;

    const indice = rejilla.orden.indexOf(id);
    if (indice === -1) return;

    this.paneles.get(id).cerrar();
    rejilla.celdas.get(id).remove();
    this.paneles.delete(id);
    this.dueno.delete(id);
    rejilla.celdas.delete(id);
    rejilla.orden.splice(indice, 1);

    this.forma(rejilla);
    // El foco pasa al anterior en orden, o al primero si era el primero. Con la
    // rejilla vacia no hay a quien darselo, y la ventana NO se cierra: la
    // aplicacion existe sin paneles -arranca asi- y cerrar el ultimo terminal no
    // puede llevarse por delante la lista de proyectos.
    rejilla.enfocado = rejilla.orden.length === 0 ? null : rejilla.orden[indice === 0 ? 0 : indice - 1];
    if (rejilla.enfocado !== null) this.enfocar(rejilla.enfocado);
    pintarVacio();
  },

  /// Ctrl+Shift+W: el enfocado de la rejilla que se ve, si hay alguno.
  cerrarEnfocado() {
    const rejilla = this.visible === null ? null : this.porProyecto.get(this.visible);
    if (!rejilla || rejilla.enfocado === null) return;
    this.cerrar(rejilla.enfocado);
  },

  /// Quitar un proyecto mata sus paneles, como si se hubieran cerrado uno a uno:
  /// mismo camino que `cerrar_panel`, sin atajos.
  olvidar(ruta) {
    const rejilla = this.porProyecto.get(ruta);
    if (!rejilla) return;

    for (const id of [...rejilla.orden]) this.cerrar(id);
    rejilla.elemento.remove();
    this.porProyecto.delete(ruta);
    if (this.visible === ruta) this.visible = null;
  },

  enfocar(id) {
    const rejilla = this.porProyecto.get(this.dueno.get(id));
    if (!rejilla) return;
    rejilla.enfocado = id;
    for (const [otro, celda] of rejilla.celdas) {
      celda.classList.toggle('enfocada', otro === id);
    }
    const panel = this.paneles.get(id);
    if (panel) panel.enfocar();
  },

  /// La forma la decide el numero de paneles, y la clase la lee el CSS. Al anadir
  /// o quitar un panel se reajustan todos, no solo el que entra o sale. Se toca
  /// solo la clase de la forma para no llevarse por delante la de `oculta`.
  forma(rejilla) {
    for (let n = 0; n <= TOPE; n += 1) rejilla.elemento.classList.remove(`paneles-${n}`);
    rejilla.elemento.classList.add(`paneles-${rejilla.orden.length}`);
    for (const id of rejilla.orden) this.paneles.get(id).reajustar();
  },
};

// --------------------------------------------------------------------- estado

const barra = document.getElementById('barra');
const lista = document.getElementById('lista');
const error = document.getElementById('error');
const vacio = document.getElementById('vacio');
const vacioTexto = document.getElementById('vacio-texto');
const vacioBoton = document.getElementById('vacio-boton');

/// El ultimo `Estado` que devolvio Rust, tal cual llego. Los tres comandos que lo
/// devuelven mandan el estado ENTERO recalculado, asi que aqui no se mantiene una
/// lista propia en paralelo que luego diverja: se repinta con lo que llega.
///
/// Los dos unicos campos que se tocan por aqui son `activo` y `plegada`, porque
/// `guardar_preferencias` no devuelve `Estado` y alguien tiene que saber que
/// mandarle. `proyectos` no se toca nunca a mano.
const app = {
  estado: { proyectos: [], activo: null, plegada: false },
  /// El archivo no se pudo leer o no parseaba. Se distingue de "la lista esta
  /// vacia" a proposito: caer de uno en otro en silencio esconde que algo se
  /// rompio. Rust no toca el archivo; aqui solo se dice.
  ilegible: false,
};

/// El proyecto activo, buscado en la lista que mando Rust. `null` si no hay
/// ninguno, o si el que hay ya no esta en la lista.
function proyectoActivo() {
  if (app.estado.activo === null) return null;
  return app.estado.proyectos.find((proyecto) => proyecto.ruta === app.estado.activo) || null;
}

function mensaje(texto) {
  error.textContent = texto;
}

/// El estado entero que devolvio un comando, aplicado y pintado.
function aplicar(estado) {
  app.ilegible = false;
  app.estado = estado;
  pintar();
}

function pintar() {
  barra.classList.toggle('plegada', app.estado.plegada === true);
  pintarLista();

  // Solo se muestra la rejilla de un activo que ademas este disponible: si no lo
  // esta, lo que se ve es su estado vacio.
  const activo = proyectoActivo();
  rejillas.mostrar(activo !== null && activo.disponible ? activo.ruta : null);

  pintarVacio();
}

function pintarLista() {
  lista.replaceChildren();

  for (const proyecto of app.estado.proyectos) {
    const fila = document.createElement('li');
    fila.className = 'fila';
    // La ruta completa no ocupa linea: va como `title`, que el sistema muestra al
    // detenerse encima.
    fila.title = proyecto.ruta;
    if (!proyecto.disponible) fila.classList.add('no-disponible');
    if (proyecto.ruta === app.estado.activo) fila.classList.add('activa');

    const nombre = document.createElement('button');
    nombre.type = 'button';
    nombre.className = 'nombre';
    // El nombre no se guarda: es el ultimo segmento de la ruta, y ya viene
    // calculado en el `Estado`.
    nombre.textContent = proyecto.nombre;
    nombre.title = proyecto.ruta;
    // Un proyecto no disponible no se puede activar, y su fila no responde al
    // clic: quien lo impide es `activar`. No se usa `disabled`, que en Windows
    // se come tambien el `title` con la ruta entera.
    if (!proyecto.disponible) nombre.setAttribute('aria-disabled', 'true');
    nombre.addEventListener('click', () => activar(proyecto.ruta));

    // Un proyecto no disponible si se puede quitar: un disco desmontado vuelve,
    // pero la decision de olvidarlo es del usuario y no nuestra.
    const quitarlo = document.createElement('button');
    quitarlo.type = 'button';
    quitarlo.className = 'icono quitar';
    quitarlo.textContent = '×';
    quitarlo.title = `Quitar "${proyecto.nombre}" de la lista`;
    quitarlo.addEventListener('click', () => quitar(proyecto.ruta));

    fila.append(nombre, quitarlo);
    lista.append(fila);
  }
}

/// Cual de los cinco estados vacios toca, o `null` si hay paneles que mostrar.
/// El orden importa: el del archivo ilegible va primero, porque con la lista
/// vacia los dos casos se verian igual y uno de ellos es un fallo.
///
/// `boton` es el rotulo, o `null` si esa pantalla no lleva boton, y `accion` es lo
/// que hace al pulsarlo. Los dos sin boton -"ninguno activo" y "no disponible"- lo
/// estan a proposito: ahi la accion que toca esta en la lista, que ya se ve al lado.
///
/// `error: true` NO pinta con `error-barra`, que es un token de la barra clara y
/// sobre la rejilla da 2.49: pinta con `error-rejilla`. La clase la interpreta el
/// CSS, y son dos tokens distintos justo por esto.
function textoVacio() {
  if (app.ilegible) {
    return { texto: VACIO_ILEGIBLE, error: true, boton: BOTON_PROYECTO, accion: 'proyecto' };
  }
  if (app.estado.proyectos.length === 0) {
    return { texto: VACIO_SIN_PROYECTOS, error: false, boton: BOTON_PROYECTO, accion: 'proyecto' };
  }

  const activo = proyectoActivo();
  if (activo === null) return { texto: VACIO_SIN_ACTIVO, error: false, boton: null, accion: null };
  if (!activo.disponible) {
    return { texto: VACIO_NO_DISPONIBLE, error: true, boton: null, accion: null };
  }

  const rejilla = rejillas.porProyecto.get(activo.ruta);
  if (!rejilla || rejilla.orden.length === 0) {
    return { texto: VACIO_SIN_PANELES, error: false, boton: BOTON_PANEL, accion: 'panel' };
  }
  return null;
}

function pintarVacio() {
  const cual = textoVacio();
  vacio.hidden = cual === null;
  vacioTexto.textContent = cual === null ? '' : cual.texto;
  vacioTexto.classList.toggle('error', cual !== null && cual.error);

  const rotulo = cual === null ? null : cual.boton;
  vacioBoton.hidden = rotulo === null;
  vacioBoton.textContent = rotulo === null ? '' : rotulo;
  // Que hace al pulsarlo viaja en el propio boton: asi el escuchador se engancha
  // una sola vez al arrancar y no uno por repintado.
  vacioBoton.dataset.accion = cual === null || cual.accion === null ? '' : cual.accion;
}

// ------------------------------------------------------------------- acciones

/// El selector nativo de carpeta. Con `withGlobalTauri` el plugin de dialogo se
/// registra en `window.__TAURI__.dialog`, que es el mismo camino que `invoke` y
/// `listen`: aqui no hay `node_modules` de donde importar `@tauri-apps/plugin-dialog`.
async function anadir() {
  mensaje('');

  const dialogo = window.__TAURI__.dialog;
  if (!dialogo) {
    mensaje('no esta disponible el selector de carpetas');
    return;
  }

  let ruta;
  try {
    // `recursive` no se pone nunca: su propia documentacion dice que es para leer
    // la carpeta recursivamente despues, y Vitral no mira dentro de un proyecto
    // por ningun camino.
    ruta = await dialogo.open({ directory: true, multiple: false });
  } catch (fallo) {
    mensaje(String(fallo));
    return;
  }

  // Cancelar devuelve `null`: no es un error y no muestra nada.
  if (ruta === null || ruta === undefined) return;

  try {
    // Quien valida la ruta es Rust, que sabe de discos. Aqui se manda y se muestra
    // el `Err` que vuelva. Si ya estaba en la lista no se duplica, y vuelve el
    // estado sin cambios, que tampoco es un error.
    aplicar(await invoke('anadir_proyecto', { ruta }));
  } catch (fallo) {
    mensaje(String(fallo));
  }
}

async function quitar(ruta) {
  mensaje('');
  try {
    const estado = await invoke('quitar_proyecto', { ruta });
    // Sus paneles mueren, y si era el activo `activo` viene ya en `null`: la
    // rejilla muestra el estado vacio aunque queden otros proyectos.
    rejillas.olvidar(ruta);
    aplicar(estado);
  } catch (fallo) {
    // Si la escritura fallo, Rust ya cambio su estado en memoria y no lo revierte;
    // aqui no se destruye nada y el proximo estado que llegue pone las dos partes
    // de acuerdo.
    mensaje(String(fallo));
  }
}

async function activar(ruta) {
  mensaje('');
  // Activar el que ya lo esta no hace nada, y de paso no toca el disco.
  if (app.estado.activo === ruta) return;

  // La disponibilidad se comprueba en dos momentos y en ninguno mas: al arrancar y
  // **al activar**. Esta es la segunda: `leer_estado` recalcula `disponible` contra
  // el disco cada vez que se llama, asi que preguntarlo aqui es la comprobacion.
  // Con el `disponible` que quedo del ultimo repintado no bastaria: un disco que se
  // desconecto despues sigue marcado como bueno, la fila se activaria, y el fallo no
  // saldria hasta el primer Ctrl+Shift+N, dentro de un panel y en forma de error de
  // ruta. No hay comprobacion periodica ni al recuperar el foco, a proposito.
  let fresco;
  try {
    fresco = await invoke('leer_estado');
  } catch (fallo) {
    mensaje(String(fallo));
    return;
  }

  const proyecto = fresco.proyectos.find((otro) => otro.ruta === ruta);
  if (!proyecto || !proyecto.disponible) {
    // Se repinta con lo fresco, que ya lo marca como no disponible, y no se activa:
    // un proyecto no disponible se queda en la lista, marcado, y su fila no responde.
    aplicar(fresco);
    return;
  }

  // Un solo repintado, ya con el activo nuevo puesto sobre el estado recien leido.
  fresco.activo = ruta;
  aplicar(fresco);
  await guardar();
}

function alternarPlegada() {
  app.estado.plegada = !app.estado.plegada;
  // El foco no se mueve: solo cambia el ancho. Los PTY de la rejilla que se ve se
  // reajustan solos, porque sus celdas cambian de tamano y el observador lo caza.
  barra.classList.toggle('plegada', app.estado.plegada);
  guardar();
}

/// `guardar_preferencias` devuelve `Result<(), String>`, no `Estado`: los dos
/// campos que manda son los dos que esta parte lleva en memoria.
async function guardar() {
  try {
    await invoke('guardar_preferencias', {
      activo: app.estado.activo,
      plegada: app.estado.plegada,
    });
  } catch (fallo) {
    // Lo que el usuario ve en pantalla ya cambio, y deshacerlo por detras es peor
    // que avisar.
    mensaje(String(fallo));
  }
}

// ------------------------------------------------------------------- teclado

/// Un solo cuerpo para los tres atajos que no son del terminal, vengan de donde
/// vengan.
function atajo(letra) {
  if (letra === 'n') rejillas.abrir();
  else if (letra === 'w') rejillas.cerrarEnfocado();
  else if (letra === 'b') alternarPlegada();
}

// Los atajos se capturan tambien aqui, y no solo en `attachCustomKeyEventHandler`,
// porque ahora la aplicacion arranca sin ningun panel: sin este escuchador,
// "Ctrl+Shift+N para abrir un panel" no tendria quien lo oyera cuando no hay
// ningun terminal enfocado. Lo que sale de una celda ya lo atendio el terminal.
window.addEventListener('keydown', (evento) => {
  if (!evento.ctrlKey || !evento.shiftKey) return;
  if (evento.target instanceof Element && evento.target.closest('.celda')) return;

  const letra = evento.key.toLowerCase();
  if (letra !== 'n' && letra !== 'w' && letra !== 'b') return;

  evento.preventDefault();
  atajo(letra);
});

document.getElementById('anadir').addEventListener('click', () => anadir());

// El boton grande del estado vacio. Un solo escuchador para las tres pantallas que
// lo llevan: lo que hace lo dice `data-accion`, que pone `pintarVacio` al repintar.
// No hace nada propio, llama a lo que ya existe: el mismo `anadir` del `+` de la
// barra y el mismo `rejillas.abrir` de Ctrl+Shift+N. Con cuatro paneles abiertos
// esta pantalla no se ve, asi que el tope se sigue respetando solo.
vacioBoton.addEventListener('click', () => {
  const accion = vacioBoton.dataset.accion;
  if (accion === 'proyecto') anadir();
  else if (accion === 'panel') rejillas.abrir();
});

// ------------------------------------------------------------------- arranque

// Un `listen('panel:salida')` y un `listen('panel:fin')`, montados al arrancar y
// nunca desmontados: por eso no se guarda lo que devuelve `listen`. Uno por panel
// -o por proyecto, o por rejilla- dejaria un escuchador vivo para siempre por cada
// panel cerrado, escribiendo en un xterm que ya no esta en la pagina, y ademas
// cada trozo de salida se evaluaria N veces, porque los eventos de Tauri llegan a
// todos los escuchadores. Con proyectos hay mas paneles yendo y viniendo que nunca.
//
// Hasta que los dos esten puestos no se pinta nada: la lista trae el proyecto
// activo, y con el pintado ya se puede pulsar Ctrl+Shift+N.
Promise.all([
  listen('panel:salida', ({ payload }) => {
    // Un evento cuyo id no esta en el registro se ignora sin ruido. Es lo normal
    // entre que un panel se cierra y su PTY se entera.
    const panel = rejillas.paneles.get(payload.id);
    if (panel) panel.escribir(payload.datos);
  }),
  listen('panel:fin', ({ payload }) => {
    const panel = rejillas.paneles.get(payload.id);
    if (panel) panel.morir(payload.codigo);
  }),
]).then(leer_estado);

/// Al cargar no se abre ningun panel: se lee el estado, se pinta la lista y, si hay
/// un proyecto activo disponible, se muestra su rejilla vacia. El primero lo abre
/// la persona con Ctrl+Shift+N, que antes exigiria adivinar en que proyecto.
async function leer_estado() {
  try {
    const estado = await invoke('leer_estado');
    if (!estado || !Array.isArray(estado.proyectos)) throw new Error('estado sin lista de proyectos');
    aplicar(estado);
  } catch (fallo) {
    // El archivo no se pudo leer, o no parseaba, o le faltaba un campo: lista
    // vacia y se dice en pantalla. Rust no lo borra ni lo sobrescribe hasta que el
    // usuario haga un cambio, que es lo que aqui no hay que estropear.
    app.ilegible = true;
    app.estado = { proyectos: [], activo: null, plegada: false };
    pintar();
    mensaje(String(fallo));
  }
}
