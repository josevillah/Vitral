// Lo que se comprueba antes de lanzar nada.
//
// Ninguna comprobacion imprime ni mata el proceso: cada una devuelve una lista de
// veredictos y quien las llama decide que hacer. Asi se puede preguntar "¿esto es
// seguro?" sin morirse en el intento, que es lo que va a necesitar la interfaz
// grafica cuando exista.
//
// Un veredicto es:
//   { nivel: 'aborta' | 'avisa', mensaje, sugerencia, detalles }
//
// 'aborta' significa "no se puede lanzar esto". 'avisa' significa "se puede, pero
// que conste". Una lista vacia significa que no hay nada que decir.
//
// Ni el mensaje, ni la sugerencia, ni ningun elemento de detalles llevan espacios
// de sangria: la maquetacion es de salida.mjs, que es quien sabe cuanto mide el
// prefijo que va a escribir delante. Los saltos de linea que quedan aqui son
// deliberados. 'detalles' es siempre un array —la lista de cosas que antes se
// aplanaba en prosa dentro del mensaje—, vacio cuando no hay lista.

import fs from 'node:fs';
import path from 'node:path';

import { AGENTES } from './agentes.mjs';
import { archivoDeLinea, estadoGit } from './git.mjs';
import { TIMEOUT_MINUTOS } from './proceso.mjs';
import { dentroDe, normalizarRuta, rutasDeclaradas, seSolapan } from './rutas.mjs';

// Por debajo de esto, un presupuesto es enganoso: el tope se comprueba entre
// turnos y un solo turno de opus ya cuesta cerca de esa cifra.
const PISO_PRESUPUESTO = 0.25;

const aborta = (mensaje, sugerencia, detalles = []) =>
  ({ nivel: 'aborta', mensaje, sugerencia, detalles });
const avisa = (mensaje) => ({ nivel: 'avisa', mensaje, sugerencia: null, detalles: [] });

// Los agentes escriben archivos sin pedir permiso. Sin git no hay forma de saber
// donde estamos ni de deshacerlo.
export function revisarRama({ repo, rama, banderas, rutaBoceto }) {
  if (!banderas.seco) {
    if (!repo) {
      if (!banderas.sinGit) {
        return [aborta('esto no es un repositorio git, asi que no puedo saber en que rama estas.',
          'los agentes van a escribir archivos sin pedir permiso y no habria como deshacerlo.\n' +
          'corre `git init` y crea una rama de trabajo, o pasa --sin-git si sabes lo que haces')];
      }
      return [avisa('corriendo con --sin-git: no hay repositorio, no hay red de seguridad, no hay vuelta atras')];
    }
    if (rama === 'main' || rama === 'master') {
      return [aborta(`estas en la rama "${rama}".`,
        'los agentes escriben archivos sin pedir permiso y no quieres eso en tu rama principal.\n' +
        `crea una rama antes: git checkout -b trabajo/${path.basename(rutaBoceto, '.json')}`)];
    }
    return [];
  }

  if (repo && (rama === 'main' || rama === 'master')) {
    return [avisa(`estas en la rama "${rama}"; sin --seco esto abortaria`)];
  }
  if (!repo) {
    return [avisa('esto no es un repositorio git; sin --seco esto abortaria, o exigiria --sin-git')];
  }
  return [];
}

// La raiz sale de process.cwd() y de ella salen git, las rutas de las tareas y
// donde se escribe .vitral/. Un boceto de otro proyecto se ejecutaria contra el
// directorio actual sin que nadie diga nada: contratos de un proyecto, raiz de
// otro. Las rutas se resolverian contra la raiz equivocada y los handoffs se
// escribirian en el proyecto equivocado.
//
// Que la raiz sea el cwd es lo correcto y no se cambia: quien lanza un proceso
// decide su directorio de trabajo, y la aplicacion lanzara el motor con el cwd
// puesto en el proyecto. Con esa primitiva, un boceto fuera de la raiz no es un
// uso avanzado: es siempre un error.
//
// No mira si el archivo existe: de eso ya se encarga leerBoceto con su error.
export function revisarBoceto({ rutaBoceto, raiz }) {
  // La misma cuenta que revisarCwd: resolver contra la raiz y mirar si lo
  // relativo empieza por "..". Sigue siendo absoluto solo si apunta a otra
  // unidad de Windows, que tambien es estar fuera.
  const absoluto = path.resolve(raiz, rutaBoceto);
  const relativo = path.relative(raiz, absoluto).split(path.sep).join('/');
  if (!(relativo === '..' || relativo.startsWith('../') || path.isAbsolute(relativo))) return [];

  // La ruta se muestra tal como la escribio la persona, sin normalizar, que es
  // como la va a reconocer.
  return [aborta(`el boceto "${rutaBoceto}" cae fuera del repositorio.`,
    'sus rutas se resolverian contra esta raiz y sus handoffs se escribirian aqui.\n' +
    'corre vitral desde el proyecto al que pertenece el boceto')];
}

// Dos vidrios de la misma ola escribiendo en el mismo terreno no producen un
// error: producen perdida silenciosa de trabajo, porque el ultimo en guardar
// pisa al otro y nadie se entera.
//
// Solo importa dentro de una ola. Entre olas distintas el solapamiento es normal
// y a menudo deliberado: una tarea de revision mira "app/" entera despues de que
// otras dos hayan escrito en "app/Models/" y "app/Views/".
export function revisarSolapamientos(olas, raiz) {
  const choques = [];

  for (const [indice, ola] of olas.entries()) {
    for (let i = 0; i < ola.length; i++) {
      for (let j = i + 1; j < ola.length; j++) {
        for (const rutaA of ola[i].rutas) {
          for (const rutaB of ola[j].rutas) {
            const a = normalizarRuta(raiz, ola[i], rutaA);
            const b = normalizarRuta(raiz, ola[j], rutaB);
            if (!seSolapan(a, b)) continue;
            const comun = a.length <= b.length ? a : b;
            choques.push(`ola ${indice + 1}: "${ola[i].id}" con ${rutaA} y ` +
                         `"${ola[j].id}" con ${rutaB}, ambas bajo ${comun}`);
          }
        }
      }
    }
  }

  if (choques.length === 0) return [];

  // Los choques son una lista de cosas, no un parrafo: van en detalles, uno por
  // elemento, y quien pinta decide como se ven.
  return [aborta('hay tareas de la misma ola escribiendo en el mismo terreno:',
    'corren en paralelo, asi que el ultimo en guardar borra el trabajo del otro\n' +
    'sin avisar. Separa las rutas, o manda una de las dos a otra ola con "necesita".',
    choques)];
}

// El tope se comprueba entre turnos, asi que se rebasa por lo que cueste el turno
// en curso. Medido: con tope de $0.01 el agente paro, pero gasto $0.09.
export function revisarPresupuestos(ejecutan) {
  const veredictos = [];

  // Declarar presupuesto para un agente que no sabe respetarlo es creerse
  // protegido sin estarlo. Ahi el unico freno es el timeout.
  const sinTope = ejecutan.filter((t) => t.presupuesto && !AGENTES[t.agente].presupuestoSoportado);
  if (sinTope.length > 0) {
    veredictos.push(avisa(
      `${sinTope.map((t) => `"${t.id}"`).join(', ')} declara presupuesto, pero el ` +
      `agente "${sinTope[0].agente}" no tiene tope de gasto: se ignora.\n` +
      `Su unico freno es el timeout (${sinTope[0].timeout || TIMEOUT_MINUTOS} min).`));
  }

  const apretadas = ejecutan.filter((t) =>
    t.presupuesto && t.presupuesto < PISO_PRESUPUESTO && AGENTES[t.agente].presupuestoSoportado);
  if (apretadas.length > 0) {
    veredictos.push(avisa(
      `presupuesto por debajo de $${PISO_PRESUPUESTO} en ` +
      `${apretadas.map((t) => `"${t.id}" ($${t.presupuesto})`).join(', ')}: ` +
      'el tope se comprueba entre turnos, no durante,\n' +
      'asi que el gasto real puede ser varias veces el declarado. ' +
      'Sirve de techo de seguridad, no de control fino.'));
  }

  return veredictos;
}

// Relanzar una tarea que ya corrio es escribir encima de lo que dejo. Pasa con
// --rehacer, que se escribe a proposito, y pasa sobre todo al repetir
// "node vitral.mjs" a secas despues de un fallo parcial, que se lanza por
// costumbre y sin pensarlo. El segundo caso es el peligroso.
export function revisarSobrescritura({ ejecutan, raiz, repo, banderas, handoffs, incompletos }) {
  if (!repo || banderas.seco) return [];

  const sucio = [...estadoGit(raiz)]
    .filter((linea) => !archivoDeLinea(linea).startsWith('.vitral/'));

  const pisadas = ejecutan.filter((tarea) => {
    if (!handoffs.has(tarea.id) && !incompletos.has(tarea.id)) return false;
    const suyas = rutasDeclaradas([tarea], raiz);
    return sucio.some((linea) => dentroDe(archivoDeLinea(linea), suyas));
  });

  if (pisadas.length === 0) return [];

  const quien = banderas.rehacer ? '--rehacer va a relanzar' : 'esta corrida va a relanzar';
  const cola = pisadas.length === 1
    ? 'que ya corrio antes y tiene archivos suyos en el arbol de trabajo.\n' +
      'El agente va a escribir encima de ellos.'
    : 'que ya corrieron antes y tienen archivos suyos en el arbol de trabajo.\n' +
      'Los agentes van a escribir encima de ellos.';

  return [avisa(`${quien} ${pisadas.map((t) => `"${t.id}"`).join(', ')}, ${cola} ` +
    'Conviene tener un commit antes.')];
}

// El cwd saca al agente de donde Vitral esta mirando. Un cwd fuera de la raiz
// hace que las rutas declaradas se resuelvan fuera del repositorio, y ahi git no
// ve nada: ni el guardarrail de rama, ni la revision de "fuera de ruta", ni el
// aviso de sobrescritura cubren ese terreno. Es el unico de los tres campos con
// consecuencias que no se pueden deshacer, por eso aborta y no avisa.
//
// La forma del campo (cadena no vacia, relativa) la valida boceto.mjs. Aqui solo
// se juzga lo que necesita el disco y la raiz, que boceto.mjs no tiene.
const FUERA_DE_RAIZ =
  'ahi git no ve nada, asi que no hay forma de revisar ni de deshacer lo que\n' +
  'escriba el agente. Vitral no tiene otra red de seguridad.';

const NO_EXISTE =
  'creal antes de lanzar. Si no, el agente falla al arrancar con un ENOENT que\n' +
  'parece culpa del CLI y no del boceto.';

// Un veredicto por problema, no uno por tarea: si varias fallan por lo mismo se
// nombran todas en el mismo veredicto, como en revisarSolapamientos. La lista va
// en detalles, un elemento por tarea; con una sola tarea el nombre cabe en la
// frase y detalles se queda vacio.
const listaCwd = (tareas) => tareas.map((tarea) => `"${tarea.id}": ${tarea.cwd}`);

export function revisarCwd(ejecutan, raiz) {
  const fuera = [];
  const inexistentes = [];

  for (const tarea of ejecutan) {
    // La forma ya la caza boceto.mjs; aqui solo se mira lo que llega bien escrito.
    if (typeof tarea.cwd !== 'string' || tarea.cwd === '') continue;

    // La misma cuenta que normalizarRuta: resolver contra la raiz y mirar si lo
    // relativo empieza por "..". Sigue siendo absoluto solo si apunta a otra
    // unidad de Windows, que tambien es estar fuera.
    const absoluto = path.resolve(raiz, tarea.cwd);
    const relativo = path.relative(raiz, absoluto).split(path.sep).join('/');
    if (relativo === '..' || relativo.startsWith('../') || path.isAbsolute(relativo)) {
      fuera.push(tarea);
      continue;
    }

    // Un archivo no sirve de directorio de trabajo: cuenta como que no esta.
    const estado = fs.statSync(absoluto, { throwIfNoEntry: false });
    if (!estado || !estado.isDirectory()) inexistentes.push(tarea);
  }

  const veredictos = [];

  if (fuera.length === 1) {
    veredictos.push(aborta(
      `el cwd de "${fuera[0].id}" cae fuera del repositorio: ${fuera[0].cwd}`, FUERA_DE_RAIZ));
  } else if (fuera.length > 1) {
    veredictos.push(aborta(
      'los cwd de estas tareas caen fuera del repositorio:', FUERA_DE_RAIZ, listaCwd(fuera)));
  }

  if (inexistentes.length === 1) {
    veredictos.push(aborta(
      `el cwd de "${inexistentes[0].id}" no existe: ${inexistentes[0].cwd}`, NO_EXISTE));
  } else if (inexistentes.length > 1) {
    veredictos.push(aborta(
      'los cwd de estas tareas no existen:', NO_EXISTE, listaCwd(inexistentes)));
  }

  return veredictos;
}
