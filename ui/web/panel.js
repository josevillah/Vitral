import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';

// Con `withGlobalTauri` la API vive en `window.__TAURI__`. Ojo al `.core`: en
// Tauri v1 era `window.__TAURI__.invoke` y en v2 ahi ya no hay nada.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

// El tope cuenta celdas, no procesos vivos: un panel muerto sigue ocupando la
// suya. Cuatro sale de una cuenta de caracteres, no de gusto: a 14px un 3x3 en
// esta ventana dejaria unas 39 columnas por panel, que no llegan para un prompt
// de PowerShell con la ruta entera mas el comando.
const TOPE = 4;

// Es contrato, no gusto personal.
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

/// Un terminal y su PTY, y nada mas: `Panel` no sabe que existe la rejilla. Los
/// atajos que no son suyos salen por `alNuevo` y `alCerrar`, que la cuadricula
/// rellena desde fuera. Esa frontera es lo que hara que el modo corrida pueda
/// crear paneles con otro comando sin tocar la disposicion.
class Panel {
  constructor(id, celda) {
    this.id = id;
    this.muerto = false;
    // Mientras `abrir_panel` no haya devuelto no se llama a ningun otro comando
    // con este id: en Rust todavia no hay entrada en el mapa.
    this.abierto = false;
    // El terminal ya esta desechado: no se le vuelve a tocar.
    this.cerrado = false;

    this.alNuevo = () => {};
    this.alCerrar = () => {};

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
    this.observador = new ResizeObserver(() => this.reajustar());
    this.observador.observe(celda);
  }

  async arrancar() {
    try {
      await invoke('abrir_panel', {
        id: this.id,
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

  /// Lo que llega por `panel:salida`, ya repartido por la cuadricula.
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

  reajustar() {
    if (this.cerrado) return;
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
  /// Los atajos se capturan aqui y no en un `keydown` de `window`: el terminal
  /// enfocado se come las teclas antes de que lleguen ahi.
  tecla(evento) {
    if (!evento.ctrlKey || !evento.shiftKey) return true;

    const letra = evento.key.toLowerCase();
    if (letra !== 'c' && letra !== 'v' && letra !== 'n' && letra !== 'w') return true;

    if (evento.type !== 'keydown') return false;

    if (letra === 'n') {
      this.alNuevo();
    } else if (letra === 'w') {
      this.alCerrar();
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

/// El registro: quien hay, quien manda, como se colocan. No sabe que hay dentro
/// de un panel.
const cuadricula = {
  contenedor: document.getElementById('cuadricula'),
  /// id -> Panel. Es tambien la guia de reparto de los dos escuchadores.
  paneles: new Map(),
  /// id -> el div de su celda. La celda la crea la cuadricula, asi que la guarda
  /// la cuadricula.
  celdas: new Map(),
  /// Los ids en el orden en que se colocan, que es el orden del DOM.
  orden: [],
  enfocado: null,
  /// Un contador que solo sube: un id no se reutiliza nunca, aunque su panel se
  /// haya cerrado. Es lo que garantiza que `abrir_panel` no pueda chocar con una
  /// entrada que todavia no se ha limpiado en Rust.
  siguiente: 1,

  abrir() {
    // Al llegar al tope no hace nada y no muestra ningun aviso: el unico sitio
    // donde se podria escribir es dentro de un terminal, y eso seria ensuciar
    // contenido con mensajes de la aplicacion.
    if (this.orden.length >= TOPE) return;

    const id = String(this.siguiente);
    this.siguiente += 1;

    const celda = document.createElement('div');
    celda.className = 'celda';
    // En captura: xterm maneja el `mousedown` dentro de su propio elemento para
    // la seleccion, y asi el foco se decide antes y no depende de que lo deje
    // burbujear.
    celda.addEventListener('mousedown', () => this.enfocar(id), true);
    this.contenedor.appendChild(celda);

    const panel = new Panel(id, celda);
    panel.alNuevo = () => this.abrir();
    panel.alCerrar = () => this.cerrar(id);

    // Se registra antes de abrir el PTY: si se registrase despues, lo primero que
    // escribiera el shell llegaria sin nadie a quien repartirselo.
    this.paneles.set(id, panel);
    this.celdas.set(id, celda);
    this.orden.push(id);

    // Primero la disposicion nueva, para que el `fit()` de `arrancar` mida la
    // celda con el tamano que va a tener de verdad.
    this.redistribuir();
    this.enfocar(id);
    panel.arrancar();
  },

  cerrar(id) {
    const indice = this.orden.indexOf(id);
    if (indice === -1) return;

    // Con un solo panel se cierra la ventana: cerrar la ventana ya mata todos los
    // paneles vivos, asi que el camino de salida es el que ya existe.
    if (this.orden.length === 1) {
      this.cerrarVentana();
      return;
    }

    this.paneles.get(id).cerrar();
    this.celdas.get(id).remove();
    this.paneles.delete(id);
    this.celdas.delete(id);
    this.orden.splice(indice, 1);

    this.redistribuir();
    // El foco pasa al anterior en orden, o al primero si era el primero.
    this.enfocar(this.orden[indice === 0 ? 0 : indice - 1]);
  },

  enfocar(id) {
    this.enfocado = id;
    for (const [otro, celda] of this.celdas) {
      celda.classList.toggle('enfocada', otro === id);
    }
    const panel = this.paneles.get(id);
    if (panel) panel.enfocar();
  },

  /// La forma la decide el numero de paneles, y la clase la lee el CSS. Al anadir
  /// o quitar un panel se reajustan todos, no solo el que entra o sale.
  redistribuir() {
    this.contenedor.className = `paneles-${this.orden.length}`;
    for (const panel of this.paneles.values()) panel.reajustar();
  },

  cerrarVentana() {
    getCurrentWindow()
      .close()
      .catch((error) => {
        const panel = this.paneles.get(this.enfocado);
        if (panel) panel.aviso(`no se pudo cerrar la ventana: ${error}`);
      });
  },
};

// Un `listen('panel:salida')` y un `listen('panel:fin')`, montados al arrancar y
// nunca desmontados: por eso no se guarda lo que devuelve `listen`. Uno por panel
// dejaria un escuchador vivo para siempre por cada panel cerrado, escribiendo en
// un xterm que ya no esta en la pagina, y ademas cada trozo de salida se
// evaluaria N veces, porque los eventos de Tauri llegan a todos los escuchadores.
//
// Hasta que los dos esten puestos no se abre ningun PTY: `listen` viaja por IPC y
// lo primero que escribe el shell llega enseguida.
Promise.all([
  listen('panel:salida', ({ payload }) => {
    // Un evento cuyo id no esta en el registro se ignora sin ruido. Es lo normal
    // entre que un panel se cierra y su PTY se entera.
    const panel = cuadricula.paneles.get(payload.id);
    if (panel) panel.escribir(payload.datos);
  }),
  listen('panel:fin', ({ payload }) => {
    const panel = cuadricula.paneles.get(payload.id);
    if (panel) panel.morir(payload.codigo);
  }),
]).then(() => cuadricula.abrir());
