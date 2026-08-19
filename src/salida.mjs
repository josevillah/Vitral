// Todo lo que ve el usuario se escribe aqui, y solo aqui.
//
// INVARIANTE: este es el unico modulo que toca process.stdout o process.stderr.
// Ningun otro modulo del motor imprime, ni usa console. Los demas calculan y
// devuelven datos; esta capa decide como se ven. Ver .vitral/plomo/motor.md.
//
// Este modulo no decide nada: no aborta, no llama a process.exit, no mira el
// disco. Recibe datos ya calculados y los pinta.

import path from 'node:path';

const conColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const C = conColor
  ? { fin: '\x1b[0m', fuerte: '\x1b[1m', tenue: '\x1b[2m', rojo: '\x1b[31m',
      verde: '\x1b[32m', amarillo: '\x1b[33m', cian: '\x1b[36m' }
  : { fin: '', fuerte: '', tenue: '', rojo: '', verde: '', amarillo: '', cian: '' };

const imprimir = (texto = '') => process.stdout.write(texto + '\n');

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

export function imprimirError(mensaje, sugerencia) {
  process.stderr.write(`${C.rojo}vitral: ${mensaje}${C.fin}\n`);
  if (sugerencia) process.stderr.write(`        ${C.tenue}${sugerencia}${C.fin}\n`);
}

export function imprimirAviso(mensaje) {
  imprimir(`${C.amarillo}aviso: ${mensaje}${C.fin}`);
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
  imprimir(AYUDA);
}

// ---------------------------------------------------------------------------
// Cabecera de la corrida
// ---------------------------------------------------------------------------

export function cabecera({ nombre, rutaBoceto, rama, plomo, olas, solo }) {
  const pesoPlomo = Buffer.byteLength(plomo.texto, 'utf8');
  const cuentaPlomo = plomo.archivos.length === 1
    ? '1 archivo'
    : `${plomo.archivos.length} archivos`;

  imprimir('');
  imprimir(`${C.fuerte}vitral${C.fin} · ${nombre}`);
  imprimir(`${C.tenue}boceto ${rutaBoceto} · rama ${rama || 'sin git'} · ` +
           `plomo ${cuentaPlomo} (${(pesoPlomo / 1024).toFixed(1)} KB) · ` +
           `olas ${olas.map((ola) => ola.length).join(' -> ')}${C.fin}`);

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
  imprimir(`${C.cian}${'='.repeat(78)}${C.fin}`);
  imprimir(`${C.cian}prompt · ola ${indice + 1} · ${tarea.id} · agente ${tarea.agente}` +
           ` · ${Buffer.byteLength(prompt, 'utf8')} bytes${C.fin}`);
  imprimir(`${C.cian}${'='.repeat(78)}${C.fin}`);
  imprimir('');
  imprimir(prompt);
  imprimir('');
}

export function finEnsayo() {
  imprimir(`${C.tenue}modo seco: no se ejecuto nada.${C.fin}`);
  imprimir('');
}

// ---------------------------------------------------------------------------
// Corrida
// ---------------------------------------------------------------------------

export function cabeceraOla(indice, total, cuantos) {
  imprimir(`${C.fuerte}ola ${indice + 1}/${total}${C.fin}${C.tenue} · ` +
           `${cuantos === 1 ? '1 vidrio' : `${cuantos} vidrios en paralelo`}${C.fin}`);
}

export function lineaArranque(tarea, ancho) {
  imprimir(`  ${C.tenue}->${C.fin} ${tarea.id.padEnd(ancho)}  ` +
           `${C.tenue}${tarea.agente}  ${tarea.rutas.join(', ')}${C.fin}`);
}

export function lineaLatido(id, ancho, ms) {
  imprimir(`  ${C.tenue}·  ${id.padEnd(ancho)}  en curso  ${formatearDuracion(ms)}${C.fin}`);
}

export function lineaCierre({ tarea, ancho, resultado, huboHandoff, rutaMarca, raiz }) {
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

export function finOla() {
  imprimir('');
}

export function avisoFallo(fallidas, indice) {
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
  imprimir('');
  imprimir(`${C.fuerte}historial${C.fin} · todavia no hay ninguna corrida guardada`);
  imprimir(`${C.tenue}se guarda una entrada cada vez que termina una corrida real, ` +
           `no en --seco${C.fin}`);
  imprimir('');
}
