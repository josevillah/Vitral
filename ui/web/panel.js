import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';
// La forma interna del modo corrida, y LA UNICA PUERTA POR LA QUE ENTRA. Este
// archivo no conoce el catalogo de eventos del motor: quien lo conoce es
// `corrida.js`, y nadie mas. El origen unico de ese catalogo es el plomo del motor,
// que las tandas de interfaz no ven, y copiarlo aqui serian dos catalogos, que
// divergen. Se comprueba con grep -los nombres de evento del motor tienen que
// aparecer en un solo archivo de `ui/`- y por eso aqui no hay ni uno, ni siquiera
// dentro de un comentario.
//
// `alCambiar` entrega LA CORRIDA ENTERA YA RECALCULADA, no un parche: esto repinta
// con lo que recibe y no mantiene su propia copia, que es la misma regla que ya
// siguen los tres comandos que devuelven `Estado`.
//
// Se renombra `olvidar` al importarlo porque `rejillas` tiene un metodo con ese
// nombre y significan cosas distintas: uno olvida una corrida terminada y el otro
// los paneles de un proyecto que se quita.
import { arrancar, alCambiar, olvidar as olvidarCorrida } from './corrida.js';

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

// Lo que muestra la franja de estado mientras no haya llegado ninguna muestra. Un
// guion y no un cero: si los contadores de rendimiento no se pueden abrir,
// `maquina:uso` no se emite nunca y un `0%` seria una cifra falsa. No es un error
// que aborte nada.
const SIN_CIFRA = '—';

// La memoria viene en bytes y se ensena en GB, que es como los cuenta Windows:
// potencias de 1024.
const GIB = 1024 * 1024 * 1024;

// La ruta de la fila se corta POR LA IZQUIERDA con `direction: rtl`, y eso deja el
// texto a merced del algoritmo bidi: una ruta acabada en `\` -`C:\`, por ejemplo-
// tiene esa barra como caracter neutro al final, que en una caja rtl se va al
// principio y se ve `\C:`. Envolver la ruta en un aislamiento LTR (U+2066 … U+2069)
// lo fija sin tocar la direccion de la caja, que es la que pone los puntos
// suspensivos a la izquierda.
const AISLA_IZQUIERDA = '\u2066';
const AISLA_FIN = '\u2069';

// Lo que dice la celda de un vidrio que no dejo handoff. No es un error y por eso
// no va en rojo: va apagado, en `vacio-texto`.
const SIN_HANDOFF = '\u2014 sin handoff \u2014';

// Los siete estados de un vidrio, y LA CLASE CSS DE SU FORMA. La tabla del contrato
// es el origen unico de los estados; esta solo los traduce a una clase.
//
// LA FORMA LLEVA EL ESTADO Y EL COLOR LO REFUERZA, y hay un numero detras: `ok`
// contra `FALLO` esta medido a 1.83 : 1 y es el techo, porque los dos son oscuros y
// se separan por tono, que ademas es el fallo clasico de daltonismo. Por eso la
// marca de visto y el aspa no se parecen en nada. El segundo par -`saltada` contra
// `no llego a correr`, a 1.16- se resuelve igual: guion contra circulo tachado.
const FORMAS = {
  esperando: 'espera',
  'en curso': 'curso',
  ok: 'bien',
  FALLO: 'falla',
  cortada: 'corta',
  saltada: 'salta',
  'no llego a correr': 'nunca',
};

// Un estado que no este en la tabla se pinta como `esperando`, que es la marca de
// "todavia no se sabe". No deberia pasar -la tabla es el origen unico- y dejar la
// caja vacia seria peor: una fila sin marca no se distingue de una fila rota.
const FORMA_POR_DEFECTO = 'espera';

// Los dos rotulos del boton de lanzar. El hueco es el ensayo y el macizo la corrida
// de verdad: la misma disciplina que los siete estados, la forma antes que el color,
// en un boton de 24px donde no cabe texto.
const LANZAR_SECO = '\u25b7';
const LANZAR_REAL = '\u25b6';

const SVG = 'http://www.w3.org/2000/svg';

// El fundido de la marca dura 220ms; la vieja se quita un poco despues. No se espera
// a `transitionend` a proposito: con `prefers-reduced-motion` no hay transicion y por
// tanto no hay evento, y la marca vieja se quedaria en el DOM para siempre.
const FUNDIDO_MS = 220;
const RETIRADA_MS = FUNDIDO_MS + 40;

/// Milisegundos a algo que se lee de un vistazo en una fila de 28px.
function tiempo(ms) {
  const segundos = Math.round(ms / 1000);
  if (segundos < 60) return `${segundos}s`;
  return `${Math.floor(segundos / 60)}m ${String(segundos % 60).padStart(2, '0')}s`;
}

/// El coste de una tarea. Dos decimales: el motor da seis y en una fila de barra
/// las cuatro ultimas son ruido.
function coste(usd) {
  const cifra = usd.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${cifra}`;
}

/// Las tres marcas de trazo: la de visto, el aspa y el circulo tachado. Pintan con
/// `currentColor`, asi que el color lo pone la clase del `.m` y los tokens se quedan
/// todos en el CSS, que es donde estan medidos.
function trazo(forma) {
  const dibujo = document.createElementNS(SVG, 'svg');
  dibujo.setAttribute('viewBox', '0 0 12 12');
  dibujo.setAttribute('width', '12');
  dibujo.setAttribute('height', '12');
  dibujo.setAttribute('aria-hidden', 'true');
  dibujo.setAttribute('fill', 'none');
  dibujo.setAttribute('stroke', 'currentColor');
  dibujo.setAttribute('stroke-linecap', 'round');
  dibujo.setAttribute('stroke-linejoin', 'round');

  const linea = (d, grosor) => {
    const camino = document.createElementNS(SVG, 'path');
    camino.setAttribute('d', d);
    camino.setAttribute('stroke-width', String(grosor));
    dibujo.append(camino);
  };

  if (forma === 'bien') {
    // ok \u00b7 marca de visto, trazo 2px
    linea('M1.6 6.4 L4.6 9.4 L10.4 2.8', 2);
  } else if (forma === 'falla') {
    // FALLO \u00b7 aspa maciza, trazo 2px, 10x10 dentro de la caja de 12
    linea('M1 1 L11 11 M11 1 L1 11', 2);
  } else {
    // no llego a correr \u00b7 circulo hueco TACHADO EN DIAGONAL. Es lo que lo separa de
    // `esperando`, que es el mismo circulo sin tachar: una tarea que nunca va a
    // correr y una que espera su turno se ven igual si no se dibuja esta raya, y son
    // cosas muy distintas.
    const circulo = document.createElementNS(SVG, 'circle');
    circulo.setAttribute('cx', '6');
    circulo.setAttribute('cy', '6');
    circulo.setAttribute('r', '4.25');
    circulo.setAttribute('stroke-width', '1.5');
    dibujo.append(circulo);
    linea('M2.6 9.4 L9.4 2.6', 1.5);
  }

  return dibujo;
}

/// La marca de un estado. Es lo unico que se funde cuando un vidrio cambia: la fila
/// no se mueve, porque mover la fila haria saltar las de abajo y en una lista de
/// proyectos eso es ruido caro.
function marca(estado) {
  const forma = FORMAS[estado] ?? FORMA_POR_DEFECTO;
  const caja = document.createElement('span');
  caja.className = `m ${forma}`;
  caja.setAttribute('aria-hidden', 'true');

  if (forma === 'curso') {
    // Los mismos cuatro cuadros que ya giran en la fila de un proyecto, con sus
    // mismos colores, su mismo ciclo de 1.6s y su mismo recorrido por el anillo. No
    // se inventa otra animacion. Va anidado y no en el propio `.m` porque `.caja .m`
    // fija `display: flex` y `.indicador` necesita el suyo de rejilla.
    caja.append(indicador());
  } else if (forma === 'bien' || forma === 'falla' || forma === 'nunca') {
    caja.append(trazo(forma));
  }
  // `espera`, `salta` y `corta` las dibuja el CSS con un `::before`: son un circulo,
  // un guion y un cuadro medio lleno, y no hace falta un SVG para eso.

  return caja;
}

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

/// La celda de detalle de un vidrio. ES UNA CELDA COMO CUALQUIER OTRA: cuenta para
/// el tope de cuatro y convive con los paneles de shell en la misma rejilla. Una
/// regla, no dos, y asi el tope recupera su sentido original, porque quien abre
/// celdas vuelve a ser la persona y no el boceto.
///
/// Ofrece los mismos cuatro metodos que `Panel` -`reajustar`, `enfocar`, `cerrar` y
/// nada mas- porque la rejilla no distingue entre las dos: guarda piezas, no
/// paneles. Un vidrio no tiene PTY, asi que `reajustar` no tiene nada que hacer.
class Detalle {
  constructor(clave, ruta, id, celda) {
    this.clave = clave;
    this.ruta = ruta;
    this.id = id;
    this.celda = celda;
    this.cerrado = false;
    /// El texto del handoff. `undefined` mientras se lee, `null` si no hay, y la
    /// cadena entera si lo hay. Se lee UNA VEZ, al abrir la celda: el contrato dice
    /// "solo lectura, y solo al pulsar un vidrio", y "se lee al abrir la celda, no
    /// antes". Ni se precarga al terminar una tarea ni se vuelve a mirar en cada
    /// repintado, que serian las dos formas de convertir esto en vigilar `.vitral/`.
    this.handoff = undefined;
    /// Lo ultimo que se pinto, para poder repintar sin que el que llama tenga que
    /// volver a buscarlo.
    this.vidrio = null;

    this.caja = document.createElement('div');
    this.caja.className = 'detalle';
    // Para que el foco de la celda sea de verdad y no solo un borde amarillo: sin
    // esto el borde diria que manda esta celda mientras el teclado sigue yendo al
    // terminal de al lado.
    this.caja.tabIndex = -1;
    celda.append(this.caja);

    this.leerHandoff();
  }

  /// LO UNICO QUE ESTA INTERFAZ LEE DE `.vitral/`, y por un milimetro:
  /// `handoffs/<id>.md` del proyecto activo, solo lectura. Ni logs, ni boceto, ni
  /// historial, ni marcas de incompleto.
  ///
  /// Si no se puede leer, la celda dice "sin handoff" y no es un error: el caso
  /// normal es justo ese, una tarea que no dejo ninguno. La contrapartida, dicha
  /// para que no se lea como un olvido: un fallo de lectura de verdad se ve igual
  /// que un archivo que no existe.
  async leerHandoff() {
    try {
      const contenido = await invoke('leer_handoff', { proyecto: this.ruta, id: this.id });
      this.handoff = typeof contenido === 'string' && contenido.length > 0 ? contenido : null;
    } catch {
      this.handoff = null;
    }
    if (!this.cerrado) this.pintar(this.vidrio);
  }

  /// Repinta con el vidrio que llega, entero. No se guarda una copia propia que
  /// luego diverja: es la misma regla que siguen los tres comandos de `Estado`.
  pintar(vidrio) {
    if (this.cerrado) return;
    this.vidrio = vidrio;

    const titulo = document.createElement('h1');
    // `<id> · <estado>`. La etiqueta por vidrio levanta la prohibicion del contrato
    // permanente SOLO PARA VIDRIOS: los paneles de shell siguen sin ella, porque ahi
    // el prompt ya dice donde estas. Un vidrio la necesita porque no tiene prompt ni
    // nadie que sepa que es.
    titulo.textContent = vidrio === null ? this.id : `${this.id} · ${vidrio.estado}`;

    const datos = document.createElement('dl');
    // Los siete rotulos del contrato, en su orden y con sus nombres. Los campos
    // siempre estan: un dato ausente es `null` o `[]`, nunca un campo que falta, asi
    // que aqui no hace falta preguntar si existe, solo si trae algo.
    const campos = [
      ['agente', vidrio === null ? null : vidrio.agente],
      ['rutas', vidrio === null ? null : vidrio.rutas],
      ['tiempo', vidrio !== null && Number.isFinite(vidrio.ms) ? tiempo(vidrio.ms) : null],
      ['coste', vidrio !== null && Number.isFinite(vidrio.costo) ? coste(vidrio.costo) : null],
      ['turnos', vidrio === null ? null : vidrio.turnos],
      ['motivo', vidrio === null ? null : vidrio.motivo],
      ['marca', vidrio === null ? null : vidrio.marca],
    ];

    for (const [rotulo, valor] of campos) {
      const dt = document.createElement('dt');
      dt.textContent = rotulo;
      const dd = document.createElement('dd');
      dd.textContent = texto(valor);
      datos.append(dt, dd);
    }

    this.caja.replaceChildren(titulo, datos);

    // El error, la frase entera del motor y sin recortar. Solo si lo hay: un vidrio
    // que fue bien no ensena una linea roja vacia.
    if (vidrio !== null && typeof vidrio.error === 'string' && vidrio.error.length > 0) {
      const yerro = document.createElement('p');
      yerro.className = 'yerro';
      yerro.textContent = vidrio.error;
      this.caja.append(yerro);
    }

    // Y el handoff, lo ultimo. Mientras se lee no se escribe nada: poner "sin
    // handoff" para quitarlo medio segundo despues es peor que un hueco.
    if (this.handoff !== undefined) {
      const traspaso = document.createElement('p');
      traspaso.className = this.handoff === null ? 'handoff sin' : 'handoff';
      traspaso.textContent = this.handoff === null ? SIN_HANDOFF : this.handoff;
      this.caja.append(traspaso);
    }
  }

  /// Un vidrio no tiene PTY: no hay filas ni columnas que mandarle a nadie.
  reajustar() {}

  enfocar() {
    this.caja.focus({ preventScroll: true });
  }

  cerrar() {
    this.cerrado = true;
  }
}

/// Un valor del vidrio, listo para pintar. Un dato ausente es un guion y no un
/// hueco: un hueco no se distingue de un fallo de pintado.
function texto(valor) {
  if (Array.isArray(valor)) return valor.length === 0 ? SIN_CIFRA : valor.join(', ');
  if (valor === null || valor === undefined || valor === '') return SIN_CIFRA;
  return String(valor);
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
  /// id -> Panel, de todos los proyectos a la vez. ES LA GUIA DE REPARTO DE LOS DOS
  /// ESCUCHADORES DE PANEL, asi que aqui NO entran las celdas de vidrio: un evento
  /// de PTY no tiene a quien ir en una celda que no tiene PTY. De paso, `vivos`
  /// sigue contando solo paneles sin tener que preguntar de que tipo es cada pieza.
  paneles: new Map(),
  /// clave -> Panel o Detalle. Es lo que la rejilla usa para colocar, reajustar,
  /// enfocar y cerrar: A ESTE NIVEL NO HAY DOS TIPOS DE CELDA, hay piezas con los
  /// mismos cuatro metodos. Una regla, no dos.
  piezas: new Map(),
  /// clave -> ruta de su proyecto, para saber a que rejilla pertenece una pieza.
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
    for (const clave of rejilla.orden) {
      const pieza = this.piezas.get(clave);
      if (pieza) pieza.reajustar();
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
    this.piezas.set(id, panel);
    this.dueno.set(id, ruta);
    rejilla.celdas.set(id, celda);
    rejilla.orden.push(id);

    // Primero la disposicion nueva, para que el `fit()` de `arrancar` mida la
    // celda con el tamano que va a tener de verdad.
    this.forma(rejilla);
    this.enfocar(id);
    panel.arrancar();
    pintarVacio();
    // El contador de su proyecto acaba de subir, y eso no lo dice ningun evento de
    // Rust: la senal de ocupado si llega sola, pero cuantos paneles vivos hay solo
    // se sabe por aqui.
    pintarActividad();
  },

  /// La celda de detalle de un vidrio, abierta al pulsar su fila en la barra. Va por
  /// el mismo camino que un panel: misma rejilla, mismo tope, mismo foco, mismo
  /// Ctrl+Shift+W para cerrarla.
  ///
  /// La clave lleva el proyecto dentro porque `piezas` y `dueno` son de toda la
  /// aplicacion, no de una rejilla, y dos proyectos pueden tener una tarea con el
  /// mismo id. Y empieza por una palabra, asi que nunca puede chocar con el id de un
  /// panel, que es un numero que solo sube.
  abrirDetalle(ruta, id) {
    const clave = `detalle:${ruta}:${id}`;

    // Pulsar dos veces el mismo vidrio no abre una segunda celda: se le da el foco a
    // la que hay. Va antes que el tope, porque con cuatro celdas abiertas una de
    // ellas puede ser justo esta.
    if (this.piezas.has(clave)) {
      this.enfocar(clave);
      return;
    }

    const rejilla = this.para(ruta);
    // El tope cuenta celdas, y una celda de vidrio es una celda: con cuatro abiertas
    // pulsar un quinto vidrio no hace nada, como Ctrl+Shift+N. Y sin aviso, por lo
    // mismo: el unico sitio donde escribirlo seria dentro de una celda.
    if (rejilla.orden.length >= TOPE) return;

    const celda = document.createElement('div');
    celda.className = 'celda';
    celda.addEventListener('mousedown', () => this.enfocar(clave), true);
    rejilla.elemento.appendChild(celda);

    const detalle = new Detalle(clave, ruta, id, celda);
    this.piezas.set(clave, detalle);
    this.dueno.set(clave, ruta);
    rejilla.celdas.set(clave, celda);
    rejilla.orden.push(clave);

    this.forma(rejilla);
    this.enfocar(clave);
    // Se pinta con lo que haya ahora mismo. Un vidrio en `esperando` abre su celda
    // igual, con lo poco que hay, y no es un error.
    detalle.pintar(vidrioDe(ruta, id));
    pintarVacio();
  },

  cerrar(id) {
    const rejilla = this.porProyecto.get(this.dueno.get(id));
    if (!rejilla) return;

    const indice = rejilla.orden.indexOf(id);
    if (indice === -1) return;

    this.piezas.get(id).cerrar();
    rejilla.celdas.get(id).remove();
    this.paneles.delete(id);
    this.piezas.delete(id);
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
    pintarActividad();
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
    const pieza = this.piezas.get(id);
    if (pieza) pieza.enfocar();
  },

  /// Cuantos paneles VIVOS tiene un proyecto, INCLUIDOS LOS OCULTOS: es el numero
  /// que sale en el contador de su fila, y es la razon de esta tanda. Hasta hoy se
  /// podian dejar cuatro terminales corriendo en un proyecto, cambiar a otro, y no
  /// quedaba ni rastro de ellos en la pantalla.
  ///
  /// Vivo quiere decir que su proceso no ha muerto, no que ocupe celda: el tope de
  /// cuatro cuenta celdas, pero un panel muerto ya no ejecuta nada y el contrato
  /// deja sin contador ni indicador al proyecto que no tiene ninguno vivo.
  vivos(ruta) {
    const rejilla = this.porProyecto.get(ruta);
    if (!rejilla) return 0;

    let cuantos = 0;
    for (const id of rejilla.orden) {
      const panel = this.paneles.get(id);
      if (panel && !panel.muerto) cuantos += 1;
    }
    return cuantos;
  },

  /// La forma la decide el numero de paneles, y la clase la lee el CSS. Al anadir
  /// o quitar un panel se reajustan todos, no solo el que entra o sale. Se toca
  /// solo la clase de la forma para no llevarse por delante la de `oculta`.
  forma(rejilla) {
    for (let n = 0; n <= TOPE; n += 1) rejilla.elemento.classList.remove(`paneles-${n}`);
    rejilla.elemento.classList.add(`paneles-${rejilla.orden.length}`);
    for (const clave of rejilla.orden) this.piezas.get(clave).reajustar();
  },
};

// --------------------------------------------------------------------- estado

const barra = document.getElementById('barra');
const lista = document.getElementById('lista');
const error = document.getElementById('error');
const vacio = document.getElementById('vacio');
const vacioTexto = document.getElementById('vacio-texto');
const vacioBoton = document.getElementById('vacio-boton');
const botonLanzar = document.getElementById('lanzar');
const pieCpu = document.getElementById('pie-cpu');
const pieRam = document.getElementById('pie-ram');

/// El hueco del indicador y el contador de cada fila, por ruta. Se guardan al pintar
/// la lista para poder ponerlos al dia SIN VOLVER A CONSTRUIR LA FILA: `pintarLista`
/// rehace la lista entera, y hacer eso una vez por segundo reiniciaria la animacion
/// del indicador en cada aviso. Los cuatro cuadrados no llegarian a dar la vuelta
/// nunca: se quedarian parpadeando en el primero.
const filas = new Map();

/// Los ids que estan ejecutando algo, tal como llegaron en el ultimo aviso de
/// `paneles:ocupados`.
///
/// AQUI NO SE CALCULA NADA. Las dos mitades de la senal -tener un proceso hijo y
/// haber escrito en el ultimo segundo- las resuelve Rust, que es quien sabe cuando
/// llego el ultimo byte y quien puede sacar el snapshot de procesos. Lo unico que se
/// hace por este lado es SUSTITUIR la lista de antes por la que llega, que viene
/// COMPLETA en cada aviso: sin contabilidad propia de altas y bajas no hay
/// transicion que se pueda perder ni estado que se desincronice.
///
/// Y si el evento deja de llegar, los indicadores se quedan como estan. No hay
/// tiempo de caducidad inventado por este lado: el contrato no lo da, y apagarlos
/// solos convertiria una parada del emisor en un proyecto que parece parado.
let ocupados = new Set();

/// Las rutas que tienen una corrida en vuelo, tal como llegaron en el ultimo aviso.
///
/// AQUI TAMPOCO SE CALCULA NADA, y por la misma razon: es una lista COMPLETA en cada
/// aviso, se sustituye entera, y sin contabilidad propia no hay transicion que se
/// pueda perder. Una corrida en vuelo enciende EL INDICADOR QUE YA EXISTE, el mismo
/// que encienden los paneles ocupados: una sola senal de "aqui se esta ejecutando
/// algo", que es exactamente el nombre que el contrato eligio a proposito. Las dos
/// senales las resuelve Rust; esto solo las junta.
let corriendo = new Set();

/// ruta -> la corrida entera, tal como la entrego `corrida.js`. No hay ningun
/// "proyecto de la corrida" global: una corrida se direcciona por su proyecto, como
/// un panel por su `id`, que es la misma leccion que ya dieron el `id` y el `cwd`.
const corridas = new Map();

/// ruta -> { caja, filas: Map<id, fila> } con las filas de vidrio de ese proyecto.
///
/// LA CAJA ES UN NODO PERSISTENTE, y no es un detalle: `pintarLista` rehace la lista
/// entera cada vez que cambia el estado, y si las filas se reconstruyeran ahi la
/// entrada de 220ms se volveria a reproducir en cada repintado y el fundido de una
/// marca se perderia por el camino. Aqui la caja se guarda, se cuelga debajo de la
/// fila del proyecto activo, y al cambiar de proyecto simplemente deja de colgarse:
/// sus filas siguen enteras para cuando se vuelva.
const vidrios = new Map();

/// El vidrio con ese id dentro de la corrida de ese proyecto, o `null`. Es lo que
/// usa una celda de detalle recien abierta para pintarse con lo que ya se sabe.
function vidrioDe(ruta, id) {
  const corrida = corridas.get(ruta);
  if (!corrida || !Array.isArray(corrida.vidrios)) return null;
  return corrida.vidrios.find((vidrio) => vidrio.id === id) ?? null;
}

/// Una corrida esta en vuelo mientras no haya llegado a un final. No se puede
/// intervenir: ni abortar, ni pausar, ni reanudar. El motor no ofrece nada de eso
/// hoy y aqui no se inventa; lo unico que cambia es que el boton de lanzar se apaga.
function enVuelo(corrida) {
  return corrida !== null && (corrida.estado === 'lanzando' || corrida.estado === 'corriendo');
}

/// Si el proximo lanzamiento es la corrida de verdad o el ensayo.
///
/// EL ENSAYO VA SIEMPRE PRIMERO: no gasta un centimo y es donde saltan los
/// guardarrailes. Cuando un `--seco` termina bien, y solo entonces, el boton pasa a
/// ofrecer la corrida real. NO SE LANZA LA REAL SOLA: la persona ve el resultado del
/// ensayo y decide, que es justo lo que este par de estados hace posible.
function seraReal(corrida) {
  return corrida !== null && corrida.seco === true && corrida.estado === 'terminada';
}

/// Los datos de una fila de vidrio: el tiempo y el coste, que son las dos cifras que
/// caben en una fila de 28px de una barra de 260. Un vidrio que aun no ha arrancado
/// no trae ninguna de las dos y su fila se queda con la marca y el id, que es lo
/// honrado: no hay barra de progreso, ni porcentaje, ni tiempo estimado, porque el
/// motor no sabe cuanto va a tardar una tarea y un porcentaje inventado es peor que
/// ningun porcentaje.
function datosDe(vidrio) {
  const trozos = [];
  if (Number.isFinite(vidrio.ms)) trozos.push(tiempo(vidrio.ms));
  if (Number.isFinite(vidrio.costo)) trozos.push(coste(vidrio.costo));
  return trozos.join(' · ');
}

/// Una fila de vidrio, recien construida y todavia fuera: entra cuando alguien le
/// ponga la clase `dentro`.
function construirVidrio(ruta, vidrio) {
  const fila = document.createElement('div');
  fila.className = 'v';

  // Un `button` para que llegue por el tabulador y por Enter sin inventar nada. Sin
  // fondo propio y sin hover: no es un control de navegacion como la fila de un
  // proyecto, se pulsa para abrir su detalle y nada mas.
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'v-fila';

  const caja = document.createElement('span');
  caja.className = 'caja';

  const rotulo = document.createElement('span');
  rotulo.className = 'v-id';
  rotulo.textContent = vidrio.id;

  const datos = document.createElement('span');
  datos.className = 'v-datos';

  boton.append(caja, rotulo, datos);
  boton.addEventListener('click', () => rejillas.abrirDetalle(ruta, vidrio.id));
  fila.append(boton);

  return { fila, boton, caja, datos, estado: null };
}

/// Pone al dia una fila con el vidrio que llega. EL DOM SOLO SE TOCA CUANDO ALGO
/// CAMBIA DE VERDAD, que aqui importa mas que en ningun otro sitio: reescribir la
/// marca en cada cambio reiniciaria el giro de los cuatro cuadros de `en curso`
/// varias veces por segundo.
function refrescarVidrio(pieza, vidrio) {
  const datos = datosDe(vidrio);
  if (pieza.datos.textContent !== datos) pieza.datos.textContent = datos;

  // La marca es la unica que lleva el estado y no tiene texto, asi que el estado
  // viaja tambien por aqui para quien no ve la pantalla.
  const rotulo = `${vidrio.id} · ${vidrio.estado}`;
  if (pieza.boton.getAttribute('aria-label') !== rotulo) {
    pieza.boton.setAttribute('aria-label', rotulo);
    pieza.boton.title = rotulo;
  }

  if (pieza.estado === vidrio.estado) return;
  const primera = pieza.estado === null;
  pieza.estado = vidrio.estado;

  const nueva = marca(vidrio.estado);
  // La primera marca entra con la fila, dentro de su misma entrada: fundirla ademas
  // seria animar dos veces lo mismo.
  if (primera) {
    pieza.caja.append(nueva);
    return;
  }

  // FUNDIDO CRUZADO DE 220ms, Y SOLO LA MARCA: la fila no se mueve. Las dos marcas
  // ocupan el mismo sitio a la vez porque el CSS las apila, asi que nada de lo que
  // hay debajo salta. El cambio ya trae ademas una senal fuerte gratis: `en curso`
  // es lo unico que se mueve continuamente, asi que pasar a `ok` es pasar de moverse
  // a estarse quieto.
  nueva.classList.add('entra');
  pieza.caja.append(nueva);
  requestAnimationFrame(() => {
    nueva.classList.remove('entra');
    nueva.classList.add('entra2');
  });

  for (const vieja of [...pieza.caja.children]) {
    if (vieja === nueva) continue;
    vieja.classList.remove('entra', 'entra2');
    vieja.classList.add('sale');
    setTimeout(() => vieja.remove(), RETIRADA_MS);
  }
}

/// Las filas de vidrio de un proyecto, puestas al dia con la corrida que llega.
///
/// `corrida.vidrios` VA EN ORDEN DE OLA y ese orden no cambia nunca: no es orden de
/// llegada, porque el motor dice los ids de todas las tareas de todas las olas antes
/// de que empiece ninguna. Lo unico que puede pasar es que aparezca uno al final
/// -un id que no estaba, que se anade porque perder un final es peor que ensenar uno
/// de mas-, asi que recorrer la lista y anadir lo que falte conserva el orden solo.
function pintarVidrios(corrida) {
  const ruta = corrida.proyecto;
  const lote = Array.isArray(corrida.vidrios) ? corrida.vidrios : [];

  let grupo = vidrios.get(ruta);
  if (grupo === undefined) {
    const caja = document.createElement('li');
    caja.className = 'vidrios';
    grupo = { caja, filas: new Map() };
    vidrios.set(ruta, grupo);
  }

  const nuevas = [];
  for (const vidrio of lote) {
    let pieza = grupo.filas.get(vidrio.id);
    if (pieza === undefined) {
      pieza = construirVidrio(ruta, vidrio);
      grupo.filas.set(vidrio.id, pieza);
      grupo.caja.append(pieza.fila);
      nuevas.push(pieza);
    }
    refrescarVidrio(pieza, vidrio);
  }

  colgarVidrios(ruta);

  // LAS FILAS ENTRAN COMO UN BLOQUE, con escalonado CERO. No es pereza: escalonar
  // mentiria. Las filas no aparecen cuando arrancan los vidrios, aparecen todas a la
  // vez porque el motor dice de golpe los ids de todas las olas, y un escalonado
  // insinuaria un orden de llegada que no existe. El `requestAnimationFrame` es solo
  // para que el navegador vea el estado de partida antes que el de llegada; si se
  // pusiera la clase en el mismo fotograma no habria transicion, habria un salto.
  if (nuevas.length > 0) {
    requestAnimationFrame(() => {
      for (const pieza of nuevas) pieza.fila.classList.add('dentro');
    });
  }
}

/// Cuelga las filas de vidrio de un proyecto debajo de su fila en la lista, y solo
/// si es el activo: un proyecto que no esta activo no ensena sus vidrios, igual que
/// no ensena sus paneles.
function colgarVidrios(ruta) {
  const grupo = vidrios.get(ruta);
  if (grupo === undefined) return;
  if (ruta !== app.estado.activo) {
    grupo.caja.remove();
    return;
  }
  const fila = filas.get(ruta);
  if (fila === undefined) return;
  if (grupo.caja.previousElementSibling !== fila.li) fila.li.after(grupo.caja);
}

/// Borra las filas de un proyecto. Los vidrios terminados NO SE BORRAN SOLOS -se
/// quedan hasta que la persona los quite de en medio, por la misma razon por la que
/// un panel muerto conserva su scrollback-, asi que esto solo lo llama lanzar otra
/// corrida, que es una accion de la persona.
function soltarVidrios(ruta) {
  const grupo = vidrios.get(ruta);
  if (grupo === undefined) return;
  grupo.caja.remove();
  vidrios.delete(ruta);
}

/// Lo que llega por `alCambiar`: la corrida entera ya recalculada. Se guarda tal
/// cual y se repinta con ella; no se mantiene una copia propia que luego diverja.
function pintarCorrida(corrida) {
  if (!corrida || typeof corrida.proyecto !== 'string') return;
  corridas.set(corrida.proyecto, corrida);

  pintarVidrios(corrida);
  pintarLanzar();

  // Una corrida `rechazada` no tiene ni un vidrio -un guardarrail que aborta, o un
  // proyecto sin boceto, donde el motor devuelve su propio error-, asi que sin esto
  // no se veria absolutamente nada y la ventana se quedaria en blanco sin decir por
  // que. Va al mismo sitio que los demas errores de la barra: debajo de la lista, en
  // `error-barra`, y nunca dentro de una fila.
  //
  // Solo se escribe, no se borra: el mensaje que hubiera es de otra accion de la
  // persona, y quitarselo desde aqui seria taparle un fallo suyo. Lo limpia la
  // proxima accion, como ya hacian las demas.
  if (corrida.proyecto === app.estado.activo && corrida.estado === 'rechazada' && corrida.error) {
    mensaje(corrida.error.mensaje);
  }

  // Y las celdas de detalle que esten abiertas de este proyecto, que son las que
  // ensenan lo que la fila no tiene sitio para decir.
  for (const pieza of rejillas.piezas.values()) {
    if (!(pieza instanceof Detalle) || pieza.ruta !== corrida.proyecto) continue;
    pieza.pintar(vidrioDe(corrida.proyecto, pieza.id));
  }
}

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
  pintarLanzar();
}

/// El boton de lanzar una tanda, que actua sobre el proyecto activo. Solo existe si
/// hay uno disponible: sin proyecto no hay raiz, y la raiz sale del `cwd`, que es la
/// primitiva del motor.
function pintarLanzar() {
  const activo = proyectoActivo();
  const hay = activo !== null && activo.disponible;
  botonLanzar.hidden = !hay;
  if (!hay) return;

  const corrida = corridas.get(activo.ruta) ?? null;
  const enMarcha = enVuelo(corrida);
  const real = seraReal(corrida);

  botonLanzar.disabled = enMarcha;
  botonLanzar.textContent = real ? LANZAR_REAL : LANZAR_SECO;
  botonLanzar.title = rotuloLanzar(activo.nombre, corrida, enMarcha, real);
}

/// Lo que dice el boton al detenerse el raton encima. Es tambien el unico sitio
/// donde se ve en que va la corrida cuando todavia no hay ni un vidrio -mientras
/// lanza, o cuando un guardarrail la rechazo antes de empezar-, y por eso nombra su
/// estado en vez de limitarse a decir que hace al pulsarlo.
function rotuloLanzar(nombre, corrida, enMarcha, real) {
  if (enMarcha) {
    return corrida.estado === 'lanzando'
      ? `lanzando la tanda de "${nombre}"…`
      : `hay una tanda corriendo en "${nombre}"`;
  }
  if (real) return `Lanzar la tanda de verdad en "${nombre}"`;
  // El ensayo va siempre primero, y se dice: el boton no puede parecer que gasta
  // dinero la primera vez que se pulsa.
  //
  // Una linea del flujo que no se pudo leer se ignora y SE CUENTA, y si al final
  // hubo alguna la corrida tiene que decirlo. Se dice aqui porque este rotulo es lo
  // unico de esta interfaz que habla de la corrida entera: la celda de detalle es de
  // un vidrio, y una corrida sin vidrios no tiene ninguna.
  const rotas = corrida !== null && corrida.lineasIlegibles > 0 ? `${corrida.lineasIlegibles} lineas ilegibles · ` : '';
  const antes = corrida === null ? '' : `la anterior quedo ${corrida.estado} · `;
  return `${antes}${rotas}Lanzar el ensayo (--seco) en "${nombre}"`;
}

/// Lanzar. El ensayo primero y la corrida real despues, y nunca las dos seguidas
/// sin que la persona lo pida otra vez.
async function lanzarTanda() {
  const activo = proyectoActivo();
  if (activo === null || !activo.disponible) return;

  const anterior = corridas.get(activo.ruta) ?? null;
  // Sobre un proyecto que ya tiene una corrida en marcha, Rust devolveria `Err` y no
  // lanzaria un segundo proceso. Aqui ni se le pregunta: el boton ya esta apagado.
  if (enVuelo(anterior)) return;

  const seco = !seraReal(anterior);
  mensaje('');

  // La corrida anterior se olvida antes de empezar otra, y sus filas con ella. Esto
  // no contradice que los vidrios terminados no se borren solos: quien lo pide es la
  // persona, pulsando el boton.
  if (anterior !== null) {
    olvidarCorrida(activo.ruta);
    corridas.delete(activo.ruta);
    soltarVidrios(activo.ruta);
  }

  try {
    await arrancar(activo.ruta, { seco });
  } catch (fallo) {
    // Un `node` que no esta en el PATH, o un segundo lanzamiento que se colo: se
    // pinta como cualquier otro error de la barra y no deja la ventana en blanco.
    mensaje(String(fallo));
  }
  pintarLanzar();
}

/// Los cuatro cuadraditos. El ORDEN DEL ANILLO -y con el el reparto de los cuatro
/// retardos- lo pone entero el CSS por `nth-child`, y ahi esta explicado por que el
/// del cuarto hijo va antes que el del tercero. Aqui solo se crean los cuatro hijos
/// en orden de DOM, que es el que la rejilla de 2x2 coloca arriba-izq, arriba-der,
/// abajo-izq, abajo-der.
function indicador() {
  const marca = document.createElement('span');
  marca.className = 'indicador';
  for (let i = 0; i < 4; i += 1) marca.append(document.createElement('i'));
  return marca;
}

function pintarLista() {
  lista.replaceChildren();
  filas.clear();

  for (const proyecto of app.estado.proyectos) {
    const fila = document.createElement('li');
    fila.className = 'fila';
    // La ruta completa ya no vive en el `title`: se ve siempre, en la segunda linea.
    // El `title` se queda solo como respaldo de cuando no cabe y hay que cortarla.
    fila.title = proyecto.ruta;
    if (!proyecto.disponible) fila.classList.add('no-disponible');
    if (proyecto.ruta === app.estado.activo) fila.classList.add('activa');

    // El icono: la inicial del nombre, y SALE DEL NOMBRE, nunca del contenido del
    // proyecto. La mayuscula la pone el CSS con `text-transform`, asi que `vitral`
    // da `V` sin que aqui haya que decidir nada sobre localizaciones.
    const inicial = document.createElement('span');
    inicial.className = 'inicial';
    inicial.setAttribute('aria-hidden', 'true');
    // Por puntos de codigo y no por `slice(0, 1)`: una carpeta cuyo nombre empieza
    // por un caracter fuera del plano basico partiria su par suplente por la mitad
    // y el cuadro ensenaria un simbolo de reemplazo en vez de una inicial.
    inicial.textContent = [...proyecto.nombre][0] ?? '';

    const nombre = document.createElement('button');
    nombre.type = 'button';
    nombre.className = 'nombre';

    // Linea 1: el nombre. No se guarda en el archivo, es el ultimo segmento de la
    // ruta y ya viene calculado en el `Estado`.
    const nombreLinea = document.createElement('span');
    nombreLinea.className = 'nombre-linea';
    nombreLinea.textContent = proyecto.nombre;

    // Linea 2: LA RUTA COMPLETA, que hasta esta tanda solo se veia al detener el
    // raton encima. Va aislada como texto de izquierda a derecha dentro de una caja
    // rtl: la caja es lo que pone los puntos suspensivos a la izquierda.
    const rutaLinea = document.createElement('span');
    rutaLinea.className = 'ruta-linea';
    rutaLinea.textContent = `${AISLA_IZQUIERDA}${proyecto.ruta}${AISLA_FIN}`;

    nombre.append(nombreLinea, rutaLinea);
    // Un proyecto no disponible no se puede activar, y su fila no responde al
    // clic: quien lo impide es `activar`. No se usa `disabled`, que en Windows
    // se come tambien el `title` con la ruta entera.
    if (!proyecto.disponible) nombre.setAttribute('aria-disabled', 'true');
    nombre.addEventListener('click', () => activar(proyecto.ruta));

    // El hueco del indicador se reserva siempre; lo que no se reserva es el
    // indicador, que solo existe mientras el proyecto ejecuta algo. Quien lo pone y
    // lo quita es `pintarActividad`, y lo hace SOLO cuando el estado cambia.
    const actividad = document.createElement('span');
    actividad.className = 'actividad';

    // El contador de paneles vivos. Vacio si no hay ninguno: el CSS lo esconde con
    // `:empty`, asi que un proyecto parado no ensena ni un cero.
    const cuenta = document.createElement('span');
    cuenta.className = 'cuenta';

    // Un proyecto no disponible si se puede quitar: un disco desmontado vuelve,
    // pero la decision de olvidarlo es del usuario y no nuestra.
    const quitarlo = document.createElement('button');
    quitarlo.type = 'button';
    quitarlo.className = 'icono quitar';
    quitarlo.textContent = '×';
    quitarlo.title = `Quitar "${proyecto.nombre}" de la lista`;
    quitarlo.addEventListener('click', () => quitar(proyecto.ruta));

    fila.append(inicial, nombre, actividad, cuenta, quitarlo);
    lista.append(fila);
    filas.set(proyecto.ruta, { li: fila, actividad, cuenta, ocupado: false });

    // Y sus vidrios justo debajo, si es el activo y tiene una corrida. La caja es un
    // nodo que ya existia con sus filas dentro: aqui se vuelve a colgar, no se
    // rehace, que es lo que evita que la entrada de 220ms se repita en cada
    // repintado de la lista.
    colgarVidrios(proyecto.ruta);
  }

  // La lista se acaba de rehacer, asi que los contadores estan vacios y no hay
  // ningun indicador puesto: hay que volver a decir lo que ya se sabia.
  pintarActividad();
}

/// El contador y el indicador de cada fila, puestos al dia. Se llama una vez por
/// segundo -en cada aviso de `paneles:ocupados`- y tambien cada vez que un panel
/// nace, muere o se cierra, que es cuando cambia el contador sin que cambie nada de
/// lo que manda Rust.
///
/// EL DOM SOLO SE TOCA CUANDO ALGO CAMBIA DE VERDAD. Quitar y volver a poner el
/// indicador en cada aviso reiniciaria su animacion cada segundo y los cuatro
/// cuadrados nunca completarian la vuelta de 1.6s.
function pintarActividad() {
  // La senal llega por panel; la fila es por proyecto. Un proyecto esta ejecutando
  // algo si lo esta alguno de sus paneles, incluidos los que ahora mismo no se ven.
  const rutasOcupadas = new Set();
  for (const id of ocupados) {
    const ruta = rejillas.dueno.get(id);
    if (ruta !== undefined) rutasOcupadas.add(ruta);
  }

  for (const [ruta, fila] of filas) {
    const cuantos = rejillas.vivos(ruta);
    const texto = cuantos > 0 ? String(cuantos) : '';
    if (fila.cuenta.textContent !== texto) fila.cuenta.textContent = texto;

    // Sin ningun panel vivo no hay nada que pueda estar ejecutandose, por muy tarde
    // que llegue un aviso con un id suyo dentro.
    //
    // LAS DOS SENALES SE JUNTAN AQUI Y NADA MAS: paneles ocupados O corrida en
    // vuelo. Las dos las resuelve Rust. Y la de la corrida no pide paneles vivos,
    // porque una corrida no es un panel: el proceso del motor es suyo, sobrevive a
    // que se quite el proyecto y no muere al cerrar la ventana.
    const ocupado = (cuantos > 0 && rutasOcupadas.has(ruta)) || corriendo.has(ruta);
    if (ocupado === fila.ocupado) continue;

    fila.ocupado = ocupado;
    // Cuando el proyecto no ejecuta nada el indicador NO ESTA: no se queda en gris
    // ocupando sitio. La mitad de su trabajo es que un proyecto parado se vea parado.
    fila.actividad.replaceChildren();
    if (ocupado) fila.actividad.append(indicador());
  }
}

/// La franja de estado. CPU y memoria DE LA MAQUINA ENTERA, que es lo que se quiere
/// saber: atribuir procesos a un panel miente por debajo en cuanto uno se desprende
/// del arbol.
function pintarUso(uso) {
  // Una cifra que no es una cifra se ensena como el guion de "todavia no hay
  // muestra", no como `NaN%`: la franja es informativa y un numero roto ahi vale
  // menos que un hueco honrado.
  pieCpu.textContent = Number.isFinite(uso.cpu) ? `${Math.round(uso.cpu)}%` : SIN_CIFRA;

  if (!Number.isFinite(uso.usada) || !Number.isFinite(uso.total) || uso.total <= 0) {
    pieRam.textContent = SIN_CIFRA;
    return;
  }

  const usada = (uso.usada / GIB).toLocaleString('es-ES', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  pieRam.textContent = `${usada} / ${Math.round(uso.total / GIB)} GB`;
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
  // Lo que sale de un TERMINAL ya lo atendio `attachCustomKeyEventHandler`. Se mira
  // el terminal y no la celda entera desde que hay celdas que no son terminales: con
  // una celda de vidrio enfocada, mirar `.celda` dejaria los tres atajos sin nadie
  // que los oyera, que es justo el agujero que este escuchador vino a tapar.
  if (evento.target instanceof Element && evento.target.closest('.xterm')) return;

  const letra = evento.key.toLowerCase();
  if (letra !== 'n' && letra !== 'w' && letra !== 'b') return;

  evento.preventDefault();
  atajo(letra);
});

document.getElementById('anadir').addEventListener('click', () => anadir());
botonLanzar.addEventListener('click', () => lanzarTanda());

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

// ------------------------------------------------------------ puesta en marcha

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
    // Un panel menos vivo en su proyecto: baja el contador, y si era el ultimo
    // desaparece con el indicador. `Panel` no sabe que existe la barra, asi que
    // quien lo cuenta es esto, desde fuera.
    pintarActividad();
  }),
  // La senal llega YA RESUELTA y con la lista COMPLETA en cada aviso: se sustituye
  // la de antes por la que llega, sin llevar altas y bajas por este lado. Un panel
  // que muere mientras ejecutaba algo simplemente no viene en el aviso siguiente,
  // y su indicador desaparece sin que haga falta ningun aviso aparte.
  listen('paneles:ocupados', ({ payload }) => {
    ocupados = new Set(payload.ids);
    pintarActividad();
  }),
  // Una muestra por segundo. No se pausa al perder el foco -mientras un agente corre
  // vas a estar en otra ventana- y con la ventana minimizada Rust deja de emitir, asi
  // que la franja se queda con la ultima cifra hasta que vuelva a llegar una.
  listen('maquina:uso', ({ payload }) => pintarUso(payload)),
  // La otra mitad del indicador. Tambien llega ya resuelta y con la lista COMPLETA,
  // asi que se sustituye entera igual que la de los paneles.
  listen('corridas:activas', ({ payload }) => {
    corriendo = new Set(payload.proyectos);
    pintarActividad();
  }),
]).then(leer_estado);

// Un solo escuchador de la forma interna, montado aqui y nunca desmontado, como los
// de panel. Lo que llega es LA CORRIDA ENTERA YA RECALCULADA: esto repinta con lo
// que recibe y no mantiene su propia copia. Quien conoce el catalogo de eventos del
// motor -y quien ignora sin ruido una linea de un proyecto que no esta en su
// registro- es `corrida.js`, no esto.
alCambiar(pintarCorrida);

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
