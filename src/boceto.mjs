// El plan y el contrato, tal como estan escritos en disco.
//
// Este modulo lee y valida la forma: que los campos obligatorios esten, que los
// tipos cuadren, que las dependencias apunten a tareas que existen. No decide el
// orden de ejecucion (eso es olas.mjs), no juzga si el plan es sensato (eso es
// guardarrailes.mjs) y no imprime nada.
//
// Un boceto mal formado no tiene arreglo posible, asi que se lanza ErrorVitral.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { AGENTES } from './agentes.mjs';
import { ErrorVitral } from './errores.mjs';

export function leerBoceto(rutaBoceto) {
  if (!existsSync(rutaBoceto)) {
    throw new ErrorVitral(`no encuentro el boceto en "${rutaBoceto}".`,
      'crea .vitral/boceto.json o pasa otro con --boceto <archivo>');
  }

  let boceto;
  try {
    boceto = JSON.parse(readFileSync(rutaBoceto, 'utf8'));
  } catch (error) {
    throw new ErrorVitral(`el boceto "${rutaBoceto}" no es JSON valido: ${error.message}`);
  }

  if (!Array.isArray(boceto.tareas) || boceto.tareas.length === 0) {
    throw new ErrorVitral(`el boceto "${rutaBoceto}" no tiene tareas.`);
  }

  const vistos = new Set();
  for (const tarea of boceto.tareas) {
    if (!tarea.id) throw new ErrorVitral('hay una tarea sin "id" en el boceto.');
    if (vistos.has(tarea.id)) {
      throw new ErrorVitral(`el id "${tarea.id}" esta repetido en el boceto.`);
    }
    vistos.add(tarea.id);
    if (!tarea.prompt) throw new ErrorVitral(`la tarea "${tarea.id}" no tiene "prompt".`);
    if (!Array.isArray(tarea.rutas) || tarea.rutas.length === 0) {
      throw new ErrorVitral(
        `la tarea "${tarea.id}" no declara "rutas". Sin rutas no hay reparto de terreno.`);
    }
    if (tarea.timeout !== undefined &&
        (typeof tarea.timeout !== 'number' || !(tarea.timeout > 0))) {
      throw new ErrorVitral(
        `la tarea "${tarea.id}" tiene un "timeout" invalido: ${JSON.stringify(tarea.timeout)}.`,
        'debe ser un numero de minutos mayor que cero');
    }
    // Los tres campos siguientes son opcionales, pero un valor mal escrito no se
    // nota hasta que el CLI lo rechaza, ya con la ola pagada. Ojo con null: no es
    // lo mismo que omitido, y aqui es invalido.
    if (tarea.presupuesto !== undefined &&
        (typeof tarea.presupuesto !== 'number' ||
         !Number.isFinite(tarea.presupuesto) || !(tarea.presupuesto > 0))) {
      throw new ErrorVitral(
        `la tarea "${tarea.id}" tiene un "presupuesto" invalido: ${JSON.stringify(tarea.presupuesto)}.`,
        'debe ser un numero de dolares mayor que cero; omite el campo para correr sin tope');
    }
    if (tarea.modelo !== undefined &&
        (typeof tarea.modelo !== 'string' || tarea.modelo === '' || /\s/.test(tarea.modelo))) {
      throw new ErrorVitral(
        `la tarea "${tarea.id}" tiene un "modelo" invalido: ${JSON.stringify(tarea.modelo)}.`,
        'debe ser una cadena sin espacios; omite el campo para usar el modelo por defecto');
    }
    // La ruta absoluta se rechaza aunque apunte dentro del repositorio: un boceto
    // con rutas absolutas solo funciona en un ordenador. Se miran las dos formas
    // de absoluta, la del sistema y la de Windows, para que "C:/algo" tambien
    // aborte donde path.isAbsolute no lo reconoce.
    if (tarea.cwd !== undefined &&
        (typeof tarea.cwd !== 'string' || tarea.cwd.trim() === '' ||
         path.isAbsolute(tarea.cwd) || path.win32.isAbsolute(tarea.cwd))) {
      throw new ErrorVitral(
        `la tarea "${tarea.id}" tiene un "cwd" invalido: ${JSON.stringify(tarea.cwd)}.`,
        'debe ser una ruta relativa no vacia, como "sub/modulo"');
    }
    if (!tarea.agente) tarea.agente = 'claude';
    if (!AGENTES[tarea.agente]) {
      throw new ErrorVitral(
        `la tarea "${tarea.id}" pide el agente "${tarea.agente}", que no existe.`,
        `agentes disponibles: ${Object.keys(AGENTES).join(', ')}`);
    }
  }

  for (const tarea of boceto.tareas) {
    for (const dep of tarea.necesita || []) {
      if (!vistos.has(dep)) {
        throw new ErrorVitral(
          `la tarea "${tarea.id}" necesita "${dep}", que no existe en el boceto.`);
      }
    }
  }

  boceto.nombre = boceto.nombre || path.basename(rutaBoceto);
  return boceto;
}

// Los contratos viven junto al boceto: <dir del boceto>/plomo/*.md.
// Se concatenan en orden alfabetico y entran enteros en el prompt de todos.
export function leerPlomo(dirPlomo) {
  if (!existsSync(dirPlomo)) return { texto: '', archivos: [] };

  const archivos = readdirSync(dirPlomo)
    .filter((nombre) => nombre.endsWith('.md'))
    .sort();

  const trozos = archivos.map((nombre) => {
    const contenido = readFileSync(path.join(dirPlomo, nombre), 'utf8').trim();
    return `--- plomo: ${nombre} ---\n\n${contenido}`;
  });

  return { texto: trozos.join('\n\n'), archivos };
}
