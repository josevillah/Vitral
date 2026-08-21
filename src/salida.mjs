// Todo lo que ve el usuario se escribe aqui, y solo aqui.
//
// INVARIANTE: este es el unico modulo que toca process.stdout o process.stderr.
// Ningun otro modulo del motor imprime, ni usa console. Los demas calculan y
// devuelven datos; esta capa decide como se ven. Ver .vitral/plomo/motor.md.
//
// Este modulo no decide nada: no aborta, no llama a process.exit, no mira el
// disco. Recibe datos ya calculados y los pinta.

import path from 'node:path';

const PALETA = { fin: '\x1b[0m', fuerte: '\x1b[1m', tenue: '\x1b[2m', rojo: '\x1b[31m',
                 verde: '\x1b[32m', amarillo: '\x1b[33m', cian: '\x1b[36m' };
const SIN_PALETA = { fin: '', fuerte: '', tenue: '', rojo: '', verde: '', amarillo: '', cian: '' };

const conColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
let C = conColor ? PALETA : SIN_PALETA;

const imprimir = (texto = '') => process.stdout.write(texto + '\n');

// ---------------------------------------------------------------------------
// El modo json
// ---------------------------------------------------------------------------
//
// La misma corrida, contada con un evento JSON por linea en vez del texto
// pintado. Ninguna funcion exportada cambia de firma por esto salvo
// imprimirError: cada una decide por dentro si pinta o si emite, y asi
// corrida.mjs no se entera de que este modo existe. Los parametros que solo
// sirven para maquetar -el `ancho` de las lineas de la corrida- se ignoran al
// emitir.
//
// El catalogo de eventos y de campos vive en .vitral/plomo/eventos.md, que es su
// origen unico: los nombres se copian de ahi, no se inventan aqui.

let json = false;

const emitir = (evt, datos) =>
  process.stdout.write(JSON.stringify({ evt, t: new Date().toISOString(), ...datos }) + '\n');

// Las rutas viajan con barras hacia delante tambien en Windows: en el evento son
// un dato, no la ruta del sistema de quien corrio el motor.
const conBarras = (ruta) => ruta.split(path.sep).join('/');

export function modoJson(activo) {
  json = Boolean(activo);
  // Vacia la paleta entera, igual que ya hace la ausencia de TTY. Por tuberia ya
  // salia vacia; esto cierra el caso de correr --json en una terminal de verdad,
  // donde los codigos ANSI se colarian dentro del JSON y lo romperian.
  C = json || !conColor ? SIN_PALETA : PALETA;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

export function formatearDuracion(ms) {
  const segundos = Math.round(ms / 1000);
  if (segundos < 60) return `${segundos}s`;
  return `${Math.floor(segundos / 60)}m ${String(segundos % 60).padStart(2, '0')}s`;
}

export const formatearCosto = (usd) => `$${(usd || 0).toFixed(4)}`;

// Fecha corta y local, para decir de cuando es un handoff sin llenar la linea.
function fechaCorta(fecha) {
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  return `${dd}-${mm} ${hh}:${mi}`;
}

// ---------------------------------------------------------------------------
// Mensajes sueltos
// ---------------------------------------------------------------------------

// La sangria de las lineas de continuacion se pone aqui, no en el dato: su ancho
// es el del prefijo que escribe cada una ("vitral: " mide 8, "aviso: " mide 7), y
// eso es presentacion. Los veredictos llegan sin un solo espacio de maquetacion
// dentro, y con su lista -si la tienen- en `detalles`.
const SANGRIA_ERROR = ' '.repeat('vitral: '.length);
const SANGRIA_AVISO = ' '.repeat('aviso: '.length);

const sangrar = (lineas, sangria) => lineas.join(`\n${sangria}`);

export function imprimirError(mensaje, sugerencia, detalles = []) {
  if (json) return emitir('error', { mensaje, sugerencia: sugerencia || null });

  // El mensaje y los detalles van en rojo y en el mismo bloque; la sugerencia,
  // debajo y en tenue.
  process.stderr.write(
    `${C.rojo}vitral: ${sangrar([...mensaje.split('\n'), ...detalles], SANGRIA_ERROR)}${C.fin}\n`);
  if (sugerencia) {
    process.stderr.write(
      `${SANGRIA_ERROR}${C.tenue}${sangrar(sugerencia.split('\n'), SANGRIA_ERROR)}${C.fin}\n`);
  }
}

// Interna desde que existe veredicto(): su unico llamador era resolver() en
// vitral.mjs, y esa decision -error o aviso- vive ahora aqui.
function imprimirAviso(mensaje, detalles = []) {
  imprimir(`${C.amarillo}aviso: ` +
           `${sangrar([...mensaje.split('\n'), ...detalles], SANGRIA_AVISO)}${C.fin}`);
}

// Lo que dijo una comprobacion, que ya no sabe quien la va a pintar. El orden es
// mensaje, detalles, sugerencia: el mismo que tenia el texto de siempre. Un
// `avisa` no trae sugerencia, y hoy tampoco detalles, pero el pintor los recorre
// igual y asi no hace falta un caso especial.
export function veredicto({ nivel, mensaje, sugerencia = null, detalles = [] }) {
  if (json) {
    return emitir('veredicto',
      { nivel, mensaje, sugerencia: sugerencia || null, detalles: detalles || [] });
  }
  if (nivel === 'aborta') imprimirError(mensaje, sugerencia, detalles || []);
  else imprimirAviso(mensaje, detalles || []);
}

const AYUDA = `vitral · orquestador de agentes en paralelo

  node vitral.mjs                    corre .vitral/boceto.json
  node vitral.mjs --seco             imprime los prompts sin ejecutar nada
  node vitral.mjs --solo <id>        corre una tarea, saltando las dependencias
                                     que ya tienen handoff en disco
  node vitral.mjs --solo <id> --rehacer   reejecuta tambien las dependencias
  node vitral.mjs --boceto <archivo> usa otro boceto
  node vitral.mjs --sin-git          corre sin repositorio git (peligroso)
  node vitral.mjs --historial        las ultimas 10 corridas
  node vitral.mjs --historial <n>    las ultimas <n>
  node vitral.mjs --historial <id>   el detalle de esa corrida

el plomo se lee de <directorio del boceto>/plomo/*.md
la salida cruda queda en .vitral/logs/ y los handoffs en .vitral/handoffs/`;

export function imprimirAyuda() {
  if (json) return emitir('ayuda', { texto: AYUDA });
  imprimir(AYUDA);
}

// Exactamente un `fin` cierra toda invocacion, tambien las que abortan por un
// guardarrail y las de --ayuda: quien lee el flujo no tiene que deducir el final
// de la muerte del proceso. En modo texto no pinta nada, porque ahi el final ya
// se ve.
export function fin({ ok, codigo, seco }) {
  if (json) return emitir('fin', { ok, codigo, seco });
}

// ---------------------------------------------------------------------------
// Cabecera de la corrida
// ---------------------------------------------------------------------------

export function cabecera({ nombre, rutaBoceto, rama, plomo, olas, solo, otraTanda }) {
  // Al emitir van los nombres del plomo y los ids de cada ola, no sus cuentas:
  // el "2 archivos" y el "2 -> 1" del texto salen de ahi y son presentacion.
  if (json) {
    return emitir('corrida', {
      nombre,
      boceto: conBarras(rutaBoceto),
      rama: rama || null,
      plomo: { archivos: plomo.archivos, bytes: Buffer.byteLength(plomo.texto, 'utf8') },
      olas: olas.map((ola) => ola.map((tarea) => tarea.id)),
      solo: solo || null,
      otraTanda: otraTanda || null,
    });
  }

  const pesoPlomo = Buffer.byteLength(plomo.texto, 'utf8');
  const cuentaPlomo = plomo.archivos.length === 1
    ? '1 archivo'
    : `${plomo.archivos.length} archivos`;

  imprimir('');
  imprimir(`${C.fuerte}vitral${C.fin} · ${nombre}`);
  imprimir(`${C.tenue}boceto ${rutaBoceto} · rama ${rama || 'sin git'} · ` +
           `plomo ${cuentaPlomo} (${(pesoPlomo / 1024).toFixed(1)} KB) · ` +
           `olas ${olas.map((ola) => ola.length).join(' -> ')}${C.fin}`);

  // Los handoffs que habia en disco eran de otra tanda y se ignoran. Va justo
  // debajo de la del boceto, con la misma sangria de ocho espacios que las
  // sugerencias, porque es una nota sobre lo que se acaba de leer del disco.
  if (otraTanda) {
    const cuantos = otraTanda.cuantos === 1
      ? '1 handoff en disco es'
      : `${otraTanda.cuantos} handoffs en disco son`;
    const cierre = otraTanda.cuantos === 1 ? 'se ignora' : 'se ignoran';
    imprimir(`        ${C.tenue}${cuantos} de la tanda "${otraTanda.nombre}": ${cierre}${C.fin}`);
  }

  if (!solo) return;
  const cuenta = [`${solo.ejecutan} ${solo.ejecutan === 1 ? 'tarea' : 'tareas'}`];
  if (solo.saltadas > 0) {
    cuenta.push(`${solo.saltadas} ${solo.saltadas === 1 ? 'saltada' : 'saltadas'} ` +
                '(handoff en disco)');
  }
  if (solo.rehacer) cuenta.push('--rehacer: no se salta nada');
  imprimir(`${C.tenue}--solo ${solo.id}: ${cuenta.join(', ')}${C.fin}`);
}

// Cierra la cabecera y lista lo que no se va a ejecutar. La linea en blanco sale
// siempre; la de despues, solo si hubo algo que saltar.
export function lineasSaltadas(saltadas, ancho, fechas) {
  // Un evento por tarea saltada, y ninguno si no hay ninguna: la linea en blanco
  // que el texto imprime siempre es maquetacion.
  if (json) {
    for (const tarea of saltadas) {
      emitir('saltada', { id: tarea.id, handoff: fechas.get(tarea.id).toISOString() });
    }
    return;
  }

  imprimir('');
  for (const tarea of saltadas) {
    imprimir(`  ${C.tenue}~${C.fin} ${tarea.id.padEnd(ancho)}  ${C.cian}saltada${C.fin}  ` +
             `${C.tenue}handoff del ${fechaCorta(fechas.get(tarea.id))}${C.fin}`);
  }
  if (saltadas.length > 0) imprimir('');
}

// ---------------------------------------------------------------------------
// Ensayo en seco
// ---------------------------------------------------------------------------

export function imprimirPrompt(indice, tarea, prompt) {
  // El prompt entero: ensenarlos es lo que es --seco.
  if (json) {
    return emitir('prompt', {
      ola: indice + 1,
      id: tarea.id,
      agente: tarea.agente,
      bytes: Buffer.byteLength(prompt, 'utf8'),
      texto: prompt,
    });
  }

  imprimir(`${C.cian}${'='.repeat(78)}${C.fin}`);
  imprimir(`${C.cian}prompt · ola ${indice + 1} · ${tarea.id} · agente ${tarea.agente}` +
           ` · ${Buffer.byteLength(prompt, 'utf8')} bytes${C.fin}`);
  imprimir(`${C.cian}${'='.repeat(78)}${C.fin}`);
  imprimir('');
  imprimir(prompt);
  imprimir('');
}

// No emite ningun evento, y no es un olvido: el final del ensayo ya lo dice el
// evento `fin` con `seco: true`.
export function finEnsayo() {
  if (json) return;
  imprimir(`${C.tenue}modo seco: no se ejecuto nada.${C.fin}`);
  imprimir('');
}

// ---------------------------------------------------------------------------
// Corrida
// ---------------------------------------------------------------------------

export function cabeceraOla(indice, total, cuantos) {
  // Que tareas lleva cada ola ya viajo entero en `corrida.olas`, asi que aqui
  // basta la cuenta y la firma no tiene que cambiar.
  if (json) return emitir('ola', { ola: indice + 1, total, cuantas: cuantos });

  imprimir(`${C.fuerte}ola ${indice + 1}/${total}${C.fin}${C.tenue} · ` +
           `${cuantos === 1 ? '1 vidrio' : `${cuantos} vidrios en paralelo`}${C.fin}`);
}

export function lineaArranque(tarea, ancho) {
  if (json) {
    return emitir('arranque', { id: tarea.id, agente: tarea.agente, rutas: tarea.rutas });
  }

  imprimir(`  ${C.tenue}->${C.fin} ${tarea.id.padEnd(ancho)}  ` +
           `${C.tenue}${tarea.agente}  ${tarea.rutas.join(', ')}${C.fin}`);
}

export function lineaLatido(id, ancho, ms) {
  // Los milisegundos crudos: formatear es de quien pinta.
  if (json) return emitir('latido', { id, ms });

  imprimir(`  ${C.tenue}·  ${id.padEnd(ancho)}  en curso  ${formatearDuracion(ms)}${C.fin}`);
}

export function lineaCierre({ tarea, ancho, resultado, huboHandoff, rutaMarca, raiz }) {
  // De las denegaciones va la cuenta y no el detalle, y de la salida del agente
  // no va nada: eso ya esta entero en .vitral/logs/<id>.json. `motivo` es el
  // codigo de maquina y `error` la frase en castellano.
  if (json) {
    return emitir('cierre', {
      id: tarea.id,
      ok: Boolean(resultado.ok),
      ms: resultado.ms,
      costo: resultado.costo || 0,
      turnos: resultado.turnos ?? null,
      denegaciones: (resultado.denegaciones || []).length,
      handoff: huboHandoff,
      motivo: resultado.motivo || null,
      error: resultado.error || null,
      marca: rutaMarca ? conBarras(path.relative(raiz, rutaMarca)) : null,
    });
  }

  const etiqueta = resultado.ok ? `${C.verde}ok${C.fin}` : `${C.rojo}FALLO${C.fin}`;
  const extras = [formatearDuracion(resultado.ms), formatearCosto(resultado.costo)];
  if (resultado.turnos != null) extras.push(`${resultado.turnos} turnos`);
  if (resultado.denegaciones && resultado.denegaciones.length > 0) {
    extras.push(`${C.amarillo}${resultado.denegaciones.length} permisos denegados${C.fin}`);
  }
  if (resultado.ok && !huboHandoff) extras.push(`${C.amarillo}sin bloque Handoff${C.fin}`);

  imprimir(`  ${C.tenue}<-${C.fin} ${tarea.id.padEnd(ancho)}  ${etiqueta}  ` +
           `${C.tenue}${extras.join('  ')}${C.fin}`);
  if (!resultado.ok) imprimir(`     ${C.rojo}${resultado.error}${C.fin}`);
  if (rutaMarca) {
    imprimir(`     ${C.tenue}rastro en ` +
             `${path.relative(raiz, rutaMarca).split(path.sep).join('/')}${C.fin}`);
  }
}

// Tampoco emite nada, a proposito: una linea en blanco entre olas es maquetacion
// pura, no un momento de la corrida.
export function finOla() {
  if (json) return;
  imprimir('');
}

export function avisoFallo(fallidas, indice) {
  // Con --json esto sale por stdout como un evento mas, no por stderr: quien lee
  // el flujo mira un solo canal, y stderr queda para la catastrofe de verdad.
  // Los ids van sin las comillas que les pone el texto.
  if (json) {
    return emitir('fallo', {
      ola: indice + 1,
      ids: fallidas.map(({ tarea }) => tarea.id),
      logs: fallidas.map(({ tarea }) =>
        conBarras(path.join('.vitral', 'logs', `${tarea.id}.json`))),
    });
  }

  const ids = fallidas.map(({ tarea }) => `"${tarea.id}"`).join(', ');
  const logs = fallidas
    .map(({ tarea }) => path.join('.vitral', 'logs', `${tarea.id}.json`))
    .join(', ');
  process.stderr.write(`${C.rojo}vitral: fallo ${ids} en la ola ${indice + 1}. ` +
    `Me detengo aqui: las olas siguientes no se ejecutan.${C.fin}\n`);
  process.stderr.write(`        ${C.tenue}el detalle esta en ${logs}${C.fin}\n`);
  process.stderr.write(`        ${C.tenue}lo que ya escribieron los otros vidrios sigue ` +
    `en el arbol de trabajo${C.fin}\n`);
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

export function resumen({ costoTotal, ms, repo, diff, sinRastrear, fuera }) {
  // Los seis tal cual: el diff crudo sin partir, y las dos listas enteras. Partir
  // el diff en lineas y quedarse con diez archivos es lo que hace el texto.
  if (json) return emitir('resumen', { costoTotal, ms, repo, diff, sinRastrear, fuera });

  imprimir(`${C.fuerte}resumen${C.fin}`);
  imprimir(`  ${'costo total'.padEnd(14)}${formatearCosto(costoTotal)}` +
           `${C.tenue}  en ${formatearDuracion(ms)}${C.fin}`);

  if (!repo) {
    imprimir(`  ${'cambios'.padEnd(14)}${C.tenue}sin git: no puedo decirte que cambio${C.fin}`);
    imprimir('');
    return;
  }

  if (diff) {
    imprimir(`  ${'cambios'.padEnd(14)}`);
    for (const linea of diff.split('\n')) imprimir(`    ${C.tenue}${linea.trim()}${C.fin}`);
  } else {
    imprimir(`  ${'cambios'.padEnd(14)}${C.tenue}ningun archivo rastreado modificado${C.fin}`);
  }

  if (sinRastrear.length > 0) {
    imprimir(`  ${'nuevos'.padEnd(14)}${C.tenue}${sinRastrear.length} archivo(s) sin rastrear${C.fin}`);
    for (const archivo of sinRastrear.slice(0, 10)) imprimir(`    ${C.tenue}${archivo}${C.fin}`);
    if (sinRastrear.length > 10) {
      imprimir(`    ${C.tenue}y ${sinRastrear.length - 10} mas${C.fin}`);
    }
  }

  if (fuera.length === 0) {
    imprimir(`  ${'fuera de ruta'.padEnd(14)}${C.tenue}nada${C.fin}`);
  } else {
    imprimir(`  ${'fuera de ruta'.padEnd(14)}${C.amarillo}${fuera.length} archivo(s) ` +
             `fuera de lo declarado${C.fin}`);
    for (const archivo of fuera) imprimir(`    ${C.amarillo}${archivo}${C.fin}`);
  }
  imprimir('');
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------
//
// Las tres funciones de aqui reciben corridas ya leidas de disco: no abren el
// historial ni saben donde vive (eso es de registro.mjs). Lo unico que calculan
// es la suma del costo de lo que se les pasa y el ancho de las columnas.

const ANCHO_ESTADO = 'FALLO'.length;

// El relleno va sobre el texto plano: los codigos de color no ocupan columnas
// en pantalla pero si cuentan en .length, y desalinearian la tabla entera.
function estadoTenido(ok) {
  const texto = (ok ? 'ok' : 'FALLO').padEnd(ANCHO_ESTADO);
  return `${ok ? C.verde : C.rojo}${texto}${C.fin}`;
}

const anchoDe = (textos) => textos.reduce((max, texto) => Math.max(max, texto.length), 0);

const cuenta = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Una fecha que no parsee no tumba la tabla: se queda en blanco y se alinea igual.
function fechaDeCorrida(iso) {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '' : fechaCorta(fecha);
}

export function listaHistorial(corridas) {
  // Un solo evento con el array dentro, no uno por fila: es una consulta con
  // respuesta finita, no un flujo de momentos.
  if (json) return emitir('historial', { corridas });

  const total = corridas.reduce((suma, corrida) => suma + (corrida.costo || 0), 0);

  const filas = corridas.map((corrida) => ({
    id: corrida.id || '',
    fecha: fechaDeCorrida(corrida.fecha),
    nombre: corrida.nombre || '',
    tareas: cuenta((corrida.tareas || []).length, 'tarea', 'tareas'),
    ok: Boolean(corrida.ok),
    duracion: formatearDuracion(corrida.duracionMs || 0),
    costo: formatearCosto(corrida.costo),
  }));

  const anchoId = anchoDe(filas.map((fila) => fila.id));
  const anchoNombre = anchoDe(filas.map((fila) => fila.nombre));
  const anchoTareas = anchoDe(filas.map((fila) => fila.tareas));
  const anchoDuracion = anchoDe(filas.map((fila) => fila.duracion));

  imprimir('');
  imprimir(`${C.fuerte}historial${C.fin} · ` +
           `${cuenta(corridas.length, 'corrida', 'corridas')} · ${formatearCosto(total)}`);
  imprimir('');
  for (const fila of filas) {
    imprimir(`  ${fila.id.padEnd(anchoId)}  ${C.tenue}${fila.fecha}${C.fin}  ` +
             `${fila.nombre.padEnd(anchoNombre)}  ` +
             `${C.tenue}${fila.tareas.padEnd(anchoTareas)}${C.fin}  ` +
             `${estadoTenido(fila.ok)}  ` +
             `${C.tenue}${fila.duracion.padEnd(anchoDuracion)}  ${fila.costo}${C.fin}`);
  }
  imprimir('');
}

export function detalleCorrida(corrida) {
  if (json) return emitir('detalle', { corrida });

  const eti = (texto) => `  ${texto.padEnd(14)}`;
  const tareas = corrida.tareas || [];
  const banderas = corrida.banderas || {};
  const cambios = corrida.cambios || { archivos: [], sinRastrear: 0, fueraDeRuta: [] };
  const saltadas = corrida.saltadas || [];

  const puestas = [];
  if (banderas.solo) puestas.push(`--solo ${banderas.solo}`);
  if (banderas.rehacer) puestas.push('--rehacer');
  if (banderas.sinGit) puestas.push('--sin-git');

  imprimir('');
  imprimir(`${C.fuerte}corrida ${corrida.id}${C.fin}`);
  imprimir(`${eti('fecha')}${C.tenue}${fechaDeCorrida(corrida.fecha)}${C.fin}`);
  imprimir(`${eti('boceto')}${C.tenue}${corrida.boceto} · ${corrida.nombre}${C.fin}`);
  imprimir(`${eti('rama')}${C.tenue}${corrida.rama || 'sin git'}${C.fin}`);
  imprimir(`${eti('banderas')}${C.tenue}${puestas.length > 0 ? puestas.join(' ') : 'ninguna'}${C.fin}`);
  imprimir(`${eti('olas')}${C.tenue}${(corrida.olas || []).join(' -> ')}${C.fin}`);
  imprimir(`${eti('estado')}${estadoTenido(Boolean(corrida.ok))}  ` +
           `${C.tenue}${formatearDuracion(corrida.duracionMs || 0)}  ` +
           `${formatearCosto(corrida.costo)}${C.fin}`);

  imprimir('');
  imprimir(`  ${C.fuerte}tareas${C.fin}`);

  const filas = tareas.map((tarea) => ({
    id: tarea.id || '',
    agente: tarea.agente || '',
    ok: Boolean(tarea.ok),
    duracion: formatearDuracion(tarea.ms || 0),
    costo: formatearCosto(tarea.costo),
    turnos: tarea.turnos == null ? '' : String(tarea.turnos),
    error: tarea.ok ? null : tarea.error,
  }));

  const anchoId = anchoDe(filas.map((fila) => fila.id));
  const anchoAgente = anchoDe(filas.map((fila) => fila.agente));
  const anchoDuracion = anchoDe(filas.map((fila) => fila.duracion));
  const anchoCosto = anchoDe(filas.map((fila) => fila.costo));
  const anchoTurnos = anchoDe(filas.map((fila) => fila.turnos));

  for (const fila of filas) {
    const extras = [fila.duracion.padEnd(anchoDuracion), fila.costo.padEnd(anchoCosto)];
    if (fila.turnos) extras.push(`${fila.turnos.padStart(anchoTurnos)} turnos`);
    imprimir(`    ${fila.id.padEnd(anchoId)}  ${C.tenue}${fila.agente.padEnd(anchoAgente)}${C.fin}  ` +
             `${estadoTenido(fila.ok)}  ${C.tenue}${extras.join('  ')}${C.fin}`);
    // El error se sangra hasta la columna del agente, para que se lea colgando
    // de la tarea a la que pertenece y no de la lista.
    if (fila.error) {
      imprimir(`${' '.repeat(6 + anchoId)}${C.rojo}${fila.error}${C.fin}`);
    }
  }

  imprimir('');
  imprimir(`${eti('saltadas')}${C.tenue}${saltadas.length > 0 ? saltadas.join(', ') : 'ninguna'}${C.fin}`);
  imprimir(`${eti('cambios')}${C.tenue}` +
           `${cuenta((cambios.archivos || []).length, 'archivo', 'archivos')}, ` +
           `${cambios.sinRastrear || 0} sin rastrear${C.fin}`);

  const fuera = cambios.fueraDeRuta || [];
  if (fuera.length === 0) {
    imprimir(`${eti('fuera de ruta')}${C.tenue}nada${C.fin}`);
  } else {
    imprimir(`${eti('fuera de ruta')}${C.amarillo}${fuera.join(', ')}${C.fin}`);
  }
  imprimir('');
}

export function historialVacio() {
  // El historial vacio es un `historial` con `corridas: []`, no un evento propio.
  if (json) return emitir('historial', { corridas: [] });

  imprimir('');
  imprimir(`${C.fuerte}historial${C.fin} · todavia no hay ninguna corrida guardada`);
  imprimir(`${C.tenue}se guarda una entrada cada vez que termina una corrida real, ` +
           `no en --seco${C.fin}`);
  imprimir('');
}
