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

// La ultima linea de los dos errores de "plomos". Con el directorio vacio o
// inexistente la lista quedaria colgando, asi que se dice la verdad entera.
// La ruta se pinta tal como llego, sin normalizar barras, igual que rutaBoceto.
function disponibles(plomo) {
  return plomo.archivos.length > 0
    ? `plomos disponibles: ${plomo.archivos.join(', ')}`
    : `no hay ningun .md en "${plomo.dir}"`;
}

export function leerBoceto(rutaBoceto, plomo) {
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
    // "plomos" declara que contratos lee esta tarea. Omitirlo significa "todos",
    // y por eso la comprobacion es === undefined y no !tarea.plomos: con [], que
    // significa "ninguno", daria lo contrario. null es invalido, como en los tres
    // campos de arriba.
    if (tarea.plomos !== undefined) {
      if (!Array.isArray(tarea.plomos) ||
          tarea.plomos.some((nombre) => typeof nombre !== 'string' || nombre.trim() === '')) {
        throw new ErrorVitral(
          `la tarea "${tarea.id}" tiene un "plomos" invalido: ${JSON.stringify(tarea.plomos)}.`,
          'debe ser un array de nombres de archivos del directorio del plomo;'
          + ' omite el campo para recibirlos todos, o ponlo vacio para no recibir ninguno');
      }
      const pedidos = new Set();
      for (const nombre of tarea.plomos) {
        if (pedidos.has(nombre)) {
          throw new ErrorVitral(
            `la tarea "${tarea.id}" repite el plomo "${nombre}" en "plomos".`,
            'cada plomo se declara una sola vez');
        }
        pedidos.add(nombre);
        // Primero el separador y despues la lista, y el orden no es de estilo:
        // al reves, una ruta a un subdirectorio saldria por el error de "no
        // existe", que es verdad y no explica nada. El problema no es que falte,
        // es que no se puede pedir aunque el archivo este ahi.
        if (nombre.includes('/') || nombre.includes('\\')) {
          throw new ErrorVitral(
            `la tarea "${tarea.id}" pide el plomo "${nombre}", y "plomos" no baja a subdirectorios.`,
            `solo entran en el prompt los .md que hay sueltos en "${plomo.dir}".\n`
            + 'Un subdirectorio es donde se deja un contrato para que deje de gobernar:\n'
            + 'lo que cuelga de uno no lo lee ningun agente, y por eso no se puede pedir.\n'
            + disponibles(plomo));
        }
        if (!plomo.archivos.includes(nombre)) {
          throw new ErrorVitral(
            `la tarea "${tarea.id}" pide el plomo "${nombre}", que no existe en "${plomo.dir}".`,
            disponibles(plomo));
        }
      }
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
// Se concatenan en orden alfabetico; quien no declare "plomos" los recibe todos.
//
// El readdirSync no baja a subdirectorios, y eso es lo que hace que un contrato
// guardado en una carpeta de dentro deje de gobernar. De ahi que "plomos" no
// pueda pedir una ruta con separador.
export function leerPlomo(dirPlomo) {
  if (!existsSync(dirPlomo)) {
    return { texto: '', archivos: [], porArchivo: new Map(), dir: dirPlomo };
  }

  const archivos = readdirSync(dirPlomo)
    .filter((nombre) => nombre.endsWith('.md'))
    .sort();

  const porArchivo = new Map(archivos.map((nombre) => {
    const contenido = readFileSync(path.join(dirPlomo, nombre), 'utf8').trim();
    return [nombre, `--- plomo: ${nombre} ---\n\n${contenido}`];
  }));

  // texto se monta DESDE porArchivo, y no aparte, para que no existan dos
  // maneras de montar lo mismo que puedan divergir. El Map conserva el orden de
  // insercion, que es el alfabetico de `archivos`.
  return { texto: [...porArchivo.values()].join('\n\n'), archivos, porArchivo, dir: dirPlomo };
}

// El plomo que le toca a una tarea. Omitir "plomos" devuelve el texto entero tal
// cual, el mismo objeto que ya se construia: esa identidad es lo que garantiza
// que un boceto sin el campo reciba byte a byte el prompt de siempre.
// Con el campo declarado manda el orden del array, no el alfabetico.
//
// No valida nada: cuando esto corre, leerBoceto ya garantizo que cada nombre es
// pedible y existe, igual que nadie revalida "id" ni "rutas".
export function plomoDe(tarea, plomo) {
  if (tarea.plomos === undefined) return plomo.texto;
  return tarea.plomos.map((nombre) => plomo.porArchivo.get(nombre)).join('\n\n');
}
