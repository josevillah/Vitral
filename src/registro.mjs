// Lo que queda escrito en .vitral/ despues de una corrida: logs, handoffs y
// marcas de corte.
//
// Este es el unico modulo que conoce la disposicion de .vitral/. Si manana los
// handoffs cambian de sitio o de nombre, cambia aqui y en ningun otro lado.
//
// No imprime y no decide: recibe resultados ya cerrados y los guarda.

import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';

import { AGENTES } from './agentes.mjs';
import { TIMEOUT_MINUTOS } from './proceso.mjs';
import { formatearCosto, formatearDuracion } from './salida.mjs';

const dirLogs = (raiz) => path.join(raiz, '.vitral', 'logs');
const dirHandoffs = (raiz) => path.join(raiz, '.vitral', 'handoffs');
const rutaHandoff = (raiz, id) => path.join(dirHandoffs(raiz), `${id}.md`);
const rutaMarca = (raiz, id) => path.join(dirHandoffs(raiz), `${id}.INCOMPLETO.md`);
const rutaHistorial = (raiz) => path.join(raiz, '.vitral', 'historial.jsonl');

// El sello de tanda. Los handoffs se guardan por id de tarea y los ids se
// repiten entre tandas, asi que sin esto nada en el disco dice de que tanda es
// un handoff: un --solo puede saltarse una dependencia que nunca corrio en esta
// tanda e inyectar su handoff viejo en el prompt del dependiente, con voz de
// trabajo recien hecho.
//
// Lo mas barato que ya existe para identificar una tanda es el `nombre` del
// boceto, que boceto.mjs garantiza que siempre esta. El sello es un archivo de
// una linea dentro de handoffs/, que ya esta ignorado por git.
const rutaTanda = (raiz) => path.join(dirHandoffs(raiz), '.tanda');

export function prepararRegistro(raiz, tanda) {
  mkdirSync(dirLogs(raiz), { recursive: true });
  mkdirSync(dirHandoffs(raiz), { recursive: true });
  // Se escribe al preparar el registro, o sea despues de que cargarHandoffs ya
  // leyo el anterior. Si se escribiera antes de leerlo, siempre coincidiria y
  // esto no serviria de nada.
  if (typeof tanda === 'string' && tanda.trim() !== '') {
    writeFileSync(rutaTanda(raiz), `${tanda}\n`);
  }
}

// El nombre de la tanda que dejo estos handoffs, o null si no hay sello. Se
// compara recortando los espacios de los extremos.
function leerSello(raiz) {
  const archivo = rutaTanda(raiz);
  if (!existsSync(archivo)) return null;
  return readFileSync(archivo, 'utf8').trim();
}

// Lo que dejaron corridas anteriores. Se separan los dos mapas: un handoff de
// verdad no es lo mismo que la marca de una tarea que se corto, y confundirlos
// borraria marcas que todavia hacen falta.
//
// `tanda` es el `nombre` del boceto de esta corrida. Tres reglas, y las tres
// importan:
//
//   - el sello dice lo mismo: los handoffs valen, todo como siempre;
//   - el sello dice otra cosa: los handoffs y las marcas son de otra tanda y se
//     tratan como ausentes;
//   - no hay sello: los handoffs valen. Es un proyecto que ya venia funcionando
//     antes de que el sello existiera, y descartarle el trabajo bueno seria
//     peor que el fallo que esto arregla.
//
// Lo que se ignora no se borra: borrar es del cierre de tanda, no de una corrida
// que solo queria leer.
export function cargarHandoffs(raiz, tareas, tanda) {
  const handoffs = new Map();
  const incompletos = new Map();
  const fechas = new Map();

  const sello = leerSello(raiz);
  const ajena = sello !== null && sello !== String(tanda ?? '').trim();
  let ignorados = 0;

  for (const tarea of tareas) {
    const bueno = rutaHandoff(raiz, tarea.id);
    const marca = rutaMarca(raiz, tarea.id);
    if (existsSync(bueno)) {
      if (ajena) { ignorados++; continue; }
      handoffs.set(tarea.id, readFileSync(bueno, 'utf8').trim());
      fechas.set(tarea.id, statSync(bueno).mtime);
    } else if (existsSync(marca)) {
      // Una marca de otra tanda miente lo mismo que un handoff de otra tanda.
      if (ajena) { ignorados++; continue; }
      incompletos.set(tarea.id, readFileSync(marca, 'utf8').trim());
    }
  }

  // Solo cuentan los ids de esta corrida: un handoff de un id que esta corrida
  // no usa no la afecta y no hay nada que decir de el. Si no quedo ninguno,
  // tampoco hay nada que decir y `otraTanda` es null.
  const otraTanda = ajena && ignorados > 0 ? { nombre: sello, cuantos: ignorados } : null;

  return { handoffs, incompletos, fechas, otraTanda };
}

export function guardarLog(raiz, tarea, prompt, resultado) {
  writeFileSync(path.join(dirLogs(raiz), `${tarea.id}.json`), JSON.stringify({
    id: tarea.id,
    agente: tarea.agente,
    ok: Boolean(resultado.ok),
    ms: resultado.ms,
    sesion: resultado.sesion || null,
    costo: resultado.costo || 0,
    turnos: resultado.turnos ?? null,
    denegaciones: resultado.denegaciones || [],
    motivo: resultado.motivo || null,
    error: resultado.error || null,
    prompt,
    crudo: resultado.crudo ?? resultado.salida ?? null,
    stderr: resultado.errores || '',
  }, null, 2));
}

export function guardarHandoff(raiz, id, texto) {
  writeFileSync(rutaHandoff(raiz, id), texto + '\n');
}

export function borrarMarcaIncompleta(raiz, id) {
  const marca = rutaMarca(raiz, id);
  if (existsSync(marca)) unlinkSync(marca);
}

// Una tarea puede morir a medias por dos razones muy distintas: se le acabo el
// dinero, o se le acabo el tiempo. La primera es un corte limpio entre turnos; la
// segunda es un proceso matado a la fuerza, que ademas puede haber estado colgado
// sin hacer nada. Son dos diagnosticos y la marca los separa.
export function escribirMarcaIncompleta(raiz, tarea, resultado) {
  const archivo = rutaMarca(raiz, tarea.id);
  const porTiempo = resultado.motivo === 'timeout';
  const minutos = tarea.timeout || TIMEOUT_MINUTOS;

  const titular = porTiempo
    ? 'Esta tarea no termino: **se quedo sin tiempo** y vitral la mato.'
    : 'Esta tarea no termino: **se quedo sin presupuesto** a mitad de camino.';

  const tope = porTiempo
    ? `| timeout declarado | ${minutos} min |`
    : `| presupuesto declarado | ${tarea.presupuesto ? `$${tarea.presupuesto}` : 'sin declarar'} |`;

  const consumido = porTiempo
    ? '| gastado antes de morir | no se sabe: el proceso fue matado y no llego a informar |'
    : `| gastado antes de parar | ${formatearCosto(resultado.costo)} |`;

  const rastro = AGENTES[tarea.agente].salidaEnStreaming
    ? `El log \`.vitral/logs/${tarea.id}.json\` guarda lo que alcanzo a emitir antes de
morir, en \`crudo\`: si hay eventos hasta el final, estaba trabajando; si se queda
mudo desde el principio, estaba colgada.`
    : `El log no te va a ayudar: "${tarea.agente}" escribe su JSON de una sola vez al
terminar, asi que al matarlo no sobrevivio nada y \`crudo\` quedo vacio. La pista
esta en el arbol de trabajo: mira si los archivos que fue dejando avanzaban hacia
algo, o si en todo ese rato no toco nada.`;

  const diagnostico = porTiempo
    ? `**Ojo: un timeout no dice si la tarea iba bien o mal.** Solo dice que a los
${minutos} minutos seguia sin terminar. Puede que estuviera trabajando bien y
necesitara mas tiempo —entonces sube su \`timeout\`— o puede que estuviera colgada
esperando algo que nunca llega, como un agente mal configurado que pide una
confirmacion que nadie va a darle. Desde fuera las dos cosas se ven igual.

${rastro}`
    : `El corte fue limpio, entre dos turnos. Dio ${resultado.turnos ?? '?'} turno(s)
antes de quedarse sin dinero.`;

  writeFileSync(archivo,
`# Handoff INCOMPLETO · "${tarea.id}"

${titular}

| | |
|---|---|
| tarea | ${tarea.id} |
| agente | ${tarea.agente} |
| causa | ${porTiempo ? 'timeout' : 'presupuesto agotado'} |
| motivo tecnico | ${resultado.motivo || 'desconocido'} |
| turnos alcanzados | ${resultado.turnos ?? 'no se sabe'} |
${tope}
${consumido}
| duracion | ${formatearDuracion(resultado.ms)} |
| sesion | ${resultado.sesion || 'sin sesion'} |
| cortado el | ${new Date().toISOString()} |

**No hay handoff.** El agente se corto antes de escribirlo, asi que no dejo dicho
que hizo, que decidio ni donde se desvio del plomo.

${diagnostico}

**Puede haber trabajo a medias en el disco.** Si el corte lo pillo despues de
empezar a escribir, hay archivos creados o modificados que no constan en ningun
sitio.

Antes de relanzar con \`--solo ${tarea.id}\`:

1. Mira \`git status\` y \`git diff\` para ver que quedo a medias.
2. Revisa \`.vitral/logs/${tarea.id}.json\`, con lo de arriba en mente.
3. Decide si partes de lo que hay o si lo descartas y empiezas limpio.

Este archivo se borra solo cuando "${tarea.id}" termine bien y deje handoff de verdad.
`);
  return archivo;
}

// ---------------------------------------------------------------------------
// El historial de corridas.
//
// Los logs de arriba son por tarea y se pisan en cada corrida: sirven para
// depurar *una* tarea. El historial es lo contrario: acumula un resumen por
// corrida y no borra nada, para poder responder que costo esto, que tarea se
// desboca y que cambio entre ayer y hoy.
//
// Es JSONL —un objeto por linea— porque se escribe anadiendo al final: una
// corrida interrumpida a la mitad deja una linea rota, pero no puede llevarse
// las anteriores. Ese es el trato, y el precio es que al leer hay que saltarse
// en silencio las lineas que no parseen.

const dosDigitos = (n) => String(n).padStart(2, '0');

// AAAAMMDD-HHMMSS en hora local: el id se lee de un vistazo y ordena solo.
const sellarId = (fecha) =>
  `${fecha.getFullYear()}${dosDigitos(fecha.getMonth() + 1)}${dosDigitos(fecha.getDate())}`
  + `-${dosDigitos(fecha.getHours())}${dosDigitos(fecha.getMinutes())}${dosDigitos(fecha.getSeconds())}`;

// Las lineas del archivo ya parseadas, de la mas antigua a la mas reciente. Lo
// que no parsee se cae aqui y no molesta a nadie mas.
function leerLineas(raiz) {
  const archivo = rutaHistorial(raiz);
  if (!existsSync(archivo)) return [];

  const corridas = [];
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    if (!linea.trim()) continue;
    try {
      const corrida = JSON.parse(linea);
      if (corrida && typeof corrida === 'object') corridas.push(corrida);
    } catch {
      // Linea a medias de una corrida que se corto mientras escribia.
    }
  }
  return corridas;
}

// El sello lo pone el registro, no quien llama: la corrida llega sin `id` ni
// `fecha`. Se fecha en el arranque, no en el cierre, porque es lo que identifica
// a la corrida para quien la busque despues; se reconstruye restando lo que
// duro, que es el unico dato del arranque que llega hasta aqui.
export function guardarCorrida(raiz, corrida) {
  const arranque = Number.isFinite(corrida?.duracionMs)
    ? new Date(Date.now() - corrida.duracionMs)
    : new Date();
  const id = sellarId(arranque);

  const entrada = { id, fecha: arranque.toISOString(), ...corrida };
  entrada.id = id;
  entrada.fecha = arranque.toISOString();

  const archivo = rutaHistorial(raiz);
  mkdirSync(path.dirname(archivo), { recursive: true });
  appendFileSync(archivo, `${saltoPendiente(archivo)}${JSON.stringify(entrada)}\n`);
  return id;
}

// Si la corrida anterior murio a media linea, el archivo se quedo sin su salto
// final. Anadir sin mas pegaria las dos lineas y perderia tambien la vieja, que
// si estaba entera. Un salto de mas no rompe nada: al leer, las lineas vacias se
// ignoran igual que las rotas.
function saltoPendiente(archivo) {
  if (!existsSync(archivo)) return '';
  const bytes = statSync(archivo).size;
  if (bytes === 0) return '';
  const ultimo = readFileSync(archivo, 'utf8').slice(-1);
  return ultimo === '\n' ? '' : '\n';
}

// Las ultimas `limite` corridas, la mas reciente primero.
export function leerHistorial(raiz, limite = 10) {
  if (!(limite > 0)) return [];
  return leerLineas(raiz).slice(-limite).reverse();
}

// La corrida con ese id, o null. Dos corridas del mismo segundo comparten id: se
// devuelve la mas reciente, que es la ultima escrita.
export function leerCorrida(raiz, id) {
  const corridas = leerLineas(raiz);
  for (let i = corridas.length - 1; i >= 0; i--) {
    if (corridas[i].id === id) return corridas[i];
  }
  return null;
}
