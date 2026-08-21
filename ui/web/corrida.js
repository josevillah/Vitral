// El flujo de una tanda, traducido a la forma interna de la ventana.
//
// INVARIANTE: este es el UNICO archivo de `ui/` que conoce el catalogo de
// eventos del motor. Su origen unico es .vitral/plomo/motor.md, que las tandas
// de interfaz no leen; la copia con la que se escribio esto vino en el prompt de
// la tarea y no se copia a ningun otro sitio, porque dos catalogos divergen.
// El resto de la interfaz consume lo que expone `alCambiar` y no ve un `evt` en
// su vida.
//
// Este modulo no toca el DOM. Recibe lineas, recalcula la corrida entera y avisa
// a quien pinte. Quien pinta repinta con lo que recibe y no mantiene su propia
// copia, igual que con los tres comandos que devuelven `Estado`.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ---------------------------------------------------------------------------
// El registro
// ---------------------------------------------------------------------------
//
// Una corrida se direcciona por su proyecto, como un panel por su id. No hay
// ningun "proyecto de la corrida" global: es la misma leccion que dieron el `id`
// y el `cwd`.

const registro = new Map();   // proyecto -> corrida
const oyentes = new Set();    // fn(corrida)

// Los dos motivos de cierre que no son un fallo del agente sino un corte nuestro.
const MOTIVOS_DE_CORTE = new Set(['error_max_budget_usd', 'timeout']);

// Los campos siempre estan. Un dato ausente es null o [], nunca un campo que
// falta: es la misma regla que sigue el flujo del motor.
const nuevaCorrida = (proyecto, seco) => ({
  proyecto,
  nombre: null,
  boceto: null,
  rama: null,
  seco: Boolean(seco),
  estado: 'lanzando',
  veredictos: [],
  vidrios: [],
  resumen: null,
  error: null,
  lineasIlegibles: 0,
  codigo: null,
});

const nuevoVidrio = (id) => ({
  id,
  agente: null,
  rutas: [],
  estado: 'esperando',
  ms: null,
  costo: null,
  turnos: null,
  denegaciones: null,
  motivo: null,
  error: null,
  marca: null,
  handoff: null,
});

// Se avisa con una copia, no con la corrida viva: asi "repinta con lo que
// recibe" es literal y quien pinta no puede corromper el registro sin querer.
const copiar = (corrida) => ({
  ...corrida,
  veredictos: corrida.veredictos.map((v) => ({ ...v, detalles: [...v.detalles] })),
  vidrios: corrida.vidrios.map((v) => ({ ...v, rutas: [...v.rutas] })),
  resumen: corrida.resumen ? { ...corrida.resumen } : null,
  error: corrida.error ? { ...corrida.error } : null,
});

function avisar(corrida) {
  const foto = copiar(corrida);
  for (const oyente of oyentes) avisarA(oyente, foto);
}

function avisarA(oyente, foto) {
  try {
    oyente(foto);
  } catch (fallo) {
    // Un pintor que revienta no puede llevarse por delante a los demas ni al
    // escuchador, que es quien lleva el estado de la corrida.
    console.error('corrida: un oyente de alCambiar fallo', fallo);
  }
}

// Busca el vidrio de un id. `crear` lo anade al final si no estaba: perder un
// resultado es peor que ensenar uno de mas.
function buscarVidrio(corrida, id, crear) {
  const vidrio = corrida.vidrios.find((v) => v.id === id);
  if (vidrio) return vidrio;
  if (!crear) return null;
  const nuevo = nuevoVidrio(id);
  corrida.vidrios.push(nuevo);
  return nuevo;
}

// ---------------------------------------------------------------------------
// El catalogo de eventos del motor
// ---------------------------------------------------------------------------
//
// Todo evento es una linea JSON con `evt` y `t` delante. Los indices de ola van
// en base 1. Un evento que no este aqui -`prompt`, `ola`, y los de `ayuda`,
// `historial` y `detalle`, que no son de una corrida- se ignora sin ruido: no
// aporta nada a la forma interna y no es una linea ilegible.

const EVENTOS = {
  // corrida{nombre,boceto,rama,plomo,olas,solo,otraTanda}
  //
  // De aqui salen TODOS los vidrios, antes de que arranque ninguno: `olas` trae
  // los ids de cada ola. Se aplana y ese orden no cambia nunca; no es orden de
  // llegada, y por eso las filas entran juntas y sin escalonar.
  corrida(corrida, evt) {
    corrida.nombre = evt.nombre ?? null;
    corrida.boceto = evt.boceto ?? null;
    corrida.rama = evt.rama ?? null;
    const olas = Array.isArray(evt.olas) ? evt.olas : [];
    corrida.vidrios = olas.flat().map(nuevoVidrio);
    corrida.estado = 'corriendo';
  },

  // veredicto{nivel,mensaje,sugerencia,detalles}
  veredicto(corrida, evt) {
    corrida.veredictos.push({
      nivel: evt.nivel ?? null,
      mensaje: evt.mensaje ?? null,
      sugerencia: evt.sugerencia ?? null,
      detalles: Array.isArray(evt.detalles) ? evt.detalles : [],
    });
    // `rechazada` es un veredicto que aborta SIN corrida. `lanzando` es
    // exactamente eso: el evento `corrida` todavia no ha llegado.
    if (evt.nivel === 'aborta' && corrida.estado === 'lanzando') corrida.estado = 'rechazada';
  },

  // saltada{id,handoff} - una por tarea. `handoff` es su fecha ISO.
  saltada(corrida, evt) {
    if (typeof evt.id !== 'string') return;
    const vidrio = buscarVidrio(corrida, evt.id, true);
    vidrio.estado = 'saltada';
    vidrio.handoff = evt.handoff ?? null;
  },

  // arranque{id,agente,rutas}
  arranque(corrida, evt) {
    if (typeof evt.id !== 'string') return;
    const vidrio = buscarVidrio(corrida, evt.id, true);
    vidrio.estado = 'en curso';
    vidrio.agente = evt.agente ?? null;
    vidrio.rutas = Array.isArray(evt.rutas) ? evt.rutas : [];
  },

  // latido{id,ms} - cada 60 s. Solo actualiza el tiempo; el estado lo puso
  // `arranque`. Un latido de un id desconocido no inventa un vidrio: a
  // diferencia de un cierre, no trae ningun resultado que se pueda perder.
  latido(corrida, evt) {
    if (typeof evt.id !== 'string') return;
    const vidrio = buscarVidrio(corrida, evt.id, false);
    if (vidrio) vidrio.ms = evt.ms ?? null;
  },

  // cierre{id,ok,ms,costo,turnos,denegaciones,handoff,motivo,error,marca}
  //
  // `denegaciones` es la CUENTA, `motivo` el codigo de maquina y `error` la
  // frase en castellano. De aqui salen tres de los siete estados.
  cierre(corrida, evt) {
    if (typeof evt.id !== 'string') return;
    const vidrio = buscarVidrio(corrida, evt.id, true);
    if (evt.ok) vidrio.estado = 'ok';
    else if (MOTIVOS_DE_CORTE.has(evt.motivo)) vidrio.estado = 'cortada';
    else vidrio.estado = 'FALLO';
    vidrio.ms = evt.ms ?? null;
    vidrio.costo = evt.costo ?? null;
    vidrio.turnos = evt.turnos ?? null;
    vidrio.denegaciones = evt.denegaciones ?? null;
    vidrio.motivo = evt.motivo ?? null;
    vidrio.error = evt.error ?? null;
    vidrio.marca = evt.marca ?? null;
    vidrio.handoff = evt.handoff ?? null;
  },

  // fallo{ola,ids,logs}
  //
  // Este es el evento que salva el septimo estado, que es el que se cae si nadie
  // lo escribe: una tarea que nunca va a correr y una que espera su turno se ven
  // igual y son cosas muy distintas. Al llegar el fallo la corrida se detuvo, asi
  // que todo lo que siga en `esperando` ya no va a correr.
  //
  // Las tareas fallidas de esta ola ya tienen su `cierre`, que llega antes.
  fallo(corrida) {
    corrida.estado = 'detenida';
    for (const vidrio of corrida.vidrios) {
      if (vidrio.estado === 'esperando') vidrio.estado = 'no llego a correr';
    }
  },

  // resumen{costoTotal,ms,repo,diff,sinRastrear,fuera}
  resumen(corrida, evt) {
    corrida.resumen = {
      costoTotal: evt.costoTotal ?? null,
      ms: evt.ms ?? null,
      repo: evt.repo ?? null,
      diff: evt.diff ?? null,
      sinRastrear: evt.sinRastrear ?? null,
      fuera: evt.fuera ?? null,
    };
  },

  // error{mensaje,sugerencia}
  error(corrida, evt) {
    corrida.error = { mensaje: evt.mensaje ?? null, sugerencia: evt.sugerencia ?? null };
    if (corrida.estado === 'lanzando') corrida.estado = 'rechazada';
  },

  // fin{ok,codigo,seco}
  fin(corrida, evt) {
    corrida.codigo = evt.codigo ?? null;
    if (typeof evt.seco === 'boolean') corrida.seco = evt.seco;
    // Un `fin` con ok:false detras de un `error` no degrada la corrida: sin
    // boceto, el motor emite `error` y despues `fin` con codigo 1, y eso es una
    // corrida rechazada, no una detenida.
    if (corrida.estado === 'rechazada') return;
    corrida.estado = evt.ok ? 'terminada' : 'detenida';
  },
};

// ---------------------------------------------------------------------------
// Los dos escuchadores
// ---------------------------------------------------------------------------
//
// Uno de `corrida:linea` y uno de `corrida:fin`, montados UNA SOLA VEZ y nunca
// desmontados, como los de panel. Rust reenvia la linea tal cual y no parsea ni
// un campo; interpretar es cosa de aqui.

function llegaLinea(proyecto, linea) {
  const corrida = registro.get(proyecto);
  if (!corrida) return;   // un proyecto que no esta en el registro se ignora sin ruido

  const texto = typeof linea === 'string' ? linea.trim() : '';
  if (texto === '') return;   // una linea vacia no es un evento, pero tampoco es basura

  let evt;
  try {
    evt = JSON.parse(texto);
  } catch {
    return ilegible(corrida);
  }
  if (!evt || typeof evt !== 'object' || Array.isArray(evt) || typeof evt.evt !== 'string') {
    return ilegible(corrida);
  }

  const aplicar = EVENTOS[evt.evt];
  if (typeof aplicar !== 'function') return;
  aplicar(corrida, evt);
  avisar(corrida);
}

// Una linea que no parsea se ignora y se cuenta, y la corrida lo dice en su
// detalle. Nunca revienta el escuchador.
function ilegible(corrida) {
  corrida.lineasIlegibles += 1;
  avisar(corrida);
}

function terminaElProceso(proyecto, codigo) {
  const corrida = registro.get(proyecto);
  if (!corrida) return;
  if (corrida.codigo === null) corrida.codigo = codigo ?? null;
  // El motor deberia haber emitido su `fin`. Si el proceso murio sin decirlo
  // -un cuelgue, un kill, un flujo truncado- la corrida se para aqui en vez de
  // quedarse girando para siempre.
  if (corrida.estado === 'lanzando' || corrida.estado === 'corriendo') {
    corrida.estado = 'detenida';
  }
  avisar(corrida);
}

// Nada de lo que pase dentro de un escuchador puede tumbarlo: si se cae, la
// corrida se queda muda y no hay forma de recuperarla.
const escuchando = Promise.all([
  listen('corrida:linea', (aviso) => {
    try {
      const carga = aviso.payload || {};
      llegaLinea(carga.proyecto, carga.linea);
    } catch (fallo) {
      console.error('corrida: linea no procesada', fallo);
    }
  }),
  listen('corrida:fin', (aviso) => {
    try {
      const carga = aviso.payload || {};
      terminaElProceso(carga.proyecto, carga.codigo);
    } catch (fallo) {
      console.error('corrida: fin no procesado', fallo);
    }
  }),
]);

// ---------------------------------------------------------------------------
// La forma interna
// ---------------------------------------------------------------------------

// Lanza una tanda en `proyecto`, que va absoluto igual que el `cwd` de un panel.
// Devuelve la corrida recien creada; los cambios llegan por `alCambiar`.
export async function arrancar(proyecto, { seco = false } = {}) {
  const previa = registro.get(proyecto);
  if (previa && (previa.estado === 'lanzando' || previa.estado === 'corriendo')) {
    // El mismo error que devuelve Rust, y sin llegar a invocarlo: asi una
    // segunda pulsacion no puede tocar la corrida que ya hay.
    throw new Error(`ya hay una corrida en marcha en "${proyecto}"`);
  }

  // Se espera a que los escuchadores esten montados antes de lanzar. Una corrida
  // que nadie escucha es invisible, y eso ya tiene un precio escrito para el caso
  // en que no hay remedio; provocarlo a proposito, no.
  await escuchando;

  const corrida = nuevaCorrida(proyecto, seco);
  registro.set(proyecto, corrida);
  avisar(corrida);

  try {
    await invoke('lanzar_corrida', { proyecto, seco: corrida.seco });
  } catch (fallo) {
    corrida.estado = 'rechazada';
    corrida.error = { mensaje: String(fallo), sugerencia: null };
    avisar(corrida);
    throw fallo;
  }
  return corrida;
}

// Registra a quien pinta. Recibe la corrida ENTERA ya recalculada, no un parche.
// Al registrarse le llegan de una vez las corridas que ya haya, para que no tenga
// que esperar al proximo evento para saber que existen. Devuelve como darse de
// baja, aunque hoy nadie lo necesita.
export function alCambiar(fn) {
  oyentes.add(fn);
  for (const corrida of registro.values()) avisarA(fn, copiar(corrida));
  return () => oyentes.delete(fn);
}

// Borra una corrida TERMINADA. Una en marcha no se olvida: no se puede intervenir
// una corrida, y hacerla desaparecer de la barra seria justo eso. Devuelve si la
// borro. No avisa a nadie: lo pide quien pinta, que ya sabe repintarse.
export function olvidar(proyecto) {
  const corrida = registro.get(proyecto);
  if (!corrida) return false;
  if (corrida.estado === 'lanzando' || corrida.estado === 'corriendo') return false;
  registro.delete(proyecto);
  return true;
}
