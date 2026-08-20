import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';

// Con `withGlobalTauri` la API vive en `window.__TAURI__`. Ojo al `.core`: en
// Tauri v1 era `window.__TAURI__.invoke` y en v2 ahi ya no hay nada.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

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

class Panel {
  constructor(id, contenedor) {
    this.id = id;
    this.muerto = false;

    this.term = new Terminal(OPCIONES);
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(contenedor);
    this.fit.fit();

    this.term.attachCustomKeyEventHandler((evento) => this.tecla(evento));

    window.addEventListener('resize', () => this.reajustar());

    this.arrancar();
  }

  async arrancar() {
    // Los escuchadores se enganchan antes de abrir el PTY: si se enganchasen
    // despues, lo primero que escribiera el shell podria llegar sin nadie oyendo.
    await listen('panel:salida', ({ payload }) => {
      // Los eventos de Tauri llegan a todos los escuchadores: se comprueba el id.
      if (payload.id !== this.id) return;
      this.term.write(bytesDesdeBase64(payload.datos));
    });

    await listen('panel:fin', ({ payload }) => {
      if (payload.id !== this.id) return;
      this.muerto = true;
      this.term.write(`\r\n[el proceso termino con codigo ${payload.codigo}]\r\n`);
    });

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

    // El teclado se engancha despues de que `abrir_panel` haya devuelto: asi no
    // se puede teclear antes de que el PTY este listo.
    this.term.onData((datos) => {
      // En un panel muerto las teclas simplemente no hacen nada.
      if (this.muerto) return;
      invoke('escribir_en_panel', { id: this.id, datos }).catch(() => {});
    });
  }

  /// Un `PtySize` con ceros no es valido: minimo 1.
  filas() {
    return Math.max(1, this.term.rows);
  }

  columnas() {
    return Math.max(1, this.term.cols);
  }

  reajustar() {
    this.fit.fit();
    if (this.muerto) return;
    invoke('redimensionar_panel', {
      id: this.id,
      filas: this.filas(),
      columnas: this.columnas(),
    }).catch(() => {});
  }

  /// `false` para lo que maneja el frontend, `true` para todo lo demas. Ctrl+C se
  /// deja pasar al PTY —interrumpe, no copia— como en Windows Terminal y VS Code.
  tecla(evento) {
    if (!evento.ctrlKey || !evento.shiftKey) return true;

    const letra = evento.key.toLowerCase();
    if (letra !== 'c' && letra !== 'v') return true;

    if (evento.type !== 'keydown') return false;

    if (letra === 'c') {
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

new Panel('1', document.getElementById('panel'));
