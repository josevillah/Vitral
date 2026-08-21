#!/usr/bin/env node
// Los checks de regresion de Vitral.
//
//   node pruebas/checks.mjs
//
// Sale con 0 si pasan todos y con 1 si falla alguno. Cero dependencias.
//
// Cada check monta su propio escenario en un directorio temporal y lo borra al
// acabar: no depende del estado de pruebas/, ni de la rama en la que estes, ni
// de que haya quedado nada de una corrida anterior. Ninguno lanza agentes de
// verdad; los que invocan una corrida real abortan antes de llegar a lanzarla.
//
// Este script si escribe en pantalla. La invariante de motor.md es del motor:
// aqui no hay motor, hay un banco de pruebas.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');
const taller = path.join(aqui, '.tmp-checks');

const conColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const C = conColor
  ? { fin: '\x1b[0m', fuerte: '\x1b[1m', tenue: '\x1b[2m',
      rojo: '\x1b[31m', verde: '\x1b[32m' }
  : { fin: '', fuerte: '', tenue: '', rojo: '', verde: '' };

const imprimir = (texto = '') => process.stdout.write(texto + '\n');

// ---------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
}

// Un repositorio con el boceto de ejemplo dentro, en la rama que se pida.
function montarRepo(nombre, rama) {
  const dir = path.join(taller, nombre);
  mkdirSync(path.join(dir, '.vitral', 'plomo'), { recursive: true });
  cpSync(path.join(raiz, 'ejemplo', 'boceto.json'), path.join(dir, '.vitral', 'boceto.json'));
  cpSync(path.join(raiz, 'ejemplo', 'plomo'), path.join(dir, '.vitral', 'plomo'), { recursive: true });
  git(['init', '-q', '-b', rama], dir);
  return dir;
}

function bocetoSuelto(dir, nombre, contenido) {
  const ruta = path.join(dir, '.vitral', nombre);
  writeFileSync(ruta, JSON.stringify(contenido, null, 2));
  return path.join('.vitral', nombre);
}

// El escenario del sello de tanda. Los handoffs se guardan por id de tarea y
// nada en el disco dice de que tanda son, salvo `.vitral/handoffs/.tanda`. Para
// montar esto sin correr una tanda entera hay que escribir a mano el handoff y
// el sello: es la unica forma.
//
// `sello` a null es el repositorio que ya venia funcionando antes de que el
// sello existiera.
const TANDA_DE_AHORA = 'La tanda de esta corrida';
const TANDA_VIEJA = 'Una tanda de hace dos semanas';
const RASTRO_VIEJO = 'lo que se hizo en una tanda que ya paso';
const HANDOFF_VIEJO = `## Handoff\n\n**Hice:** ${RASTRO_VIEJO}.`;

function repoSellado(nombre, sello) {
  const dir = montarRepo(nombre, 'trabajo/checks');
  const boceto = bocetoSuelto(dir, 'tanda.json', { nombre: TANDA_DE_AHORA, tareas: [
    { id: 'base', rutas: ['app/base/'], prompt: 'x' },
    { id: 'encima', necesita: ['base'], rutas: ['app/encima/'], prompt: 'y' },
  ] });
  const handoffs = path.join(dir, '.vitral', 'handoffs');
  mkdirSync(handoffs, { recursive: true });
  writeFileSync(path.join(handoffs, 'base.md'), `${HANDOFF_VIEJO}\n`);
  if (sello !== null) writeFileSync(path.join(handoffs, '.tanda'), `${sello}\n`);
  return { dir, boceto, sello: path.join(handoffs, '.tanda') };
}

// Corre vitral y devuelve lo que dijo. stdout y stderr van juntos porque los
// checks miran el mensaje, no por donde salio.
function vitral(cwd, ...args) {
  const r = spawnSync(process.execPath, [path.join(raiz, 'vitral.mjs'), ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { codigo: r.status, texto: (r.stdout || '') + (r.stderr || '') };
}

const cuenta = (texto, patron) => (texto.match(patron) || []).length;

// El prompt de una sola tarea, sacado de la salida de --seco. Los prompts van
// separados por lineas de "=" y cada uno lleva su cabecera, asi que se corta por
// ahi: un check que mirara la salida entera veria tambien los prompts de las
// otras tareas de la corrida, que en este asunto dicen justo lo contrario.
const CIERRE_ENSAYO = 'modo seco: no se ejecuto nada.';

function promptDe(texto, id) {
  const trozos = texto.split(/^={10,}\r?$/m);
  const indice = trozos.findIndex((trozo) =>
    trozo.includes('prompt · ola ') && trozo.includes(` · ${id} · agente `));
  if (indice === -1) return null;
  // Al ultimo prompt no lo cierra ningun "=====": su trozo llega hasta el final
  // de la salida y se traga la linea con la que finEnsayo() cierra el ensayo,
  // que es de la corrida y no de la tarea. Se corta ahi.
  //
  // Se corta por el texto literal a proposito. Si esa linea cambia, este check
  // se pone rojo y alguien tiene que mirar: el texto de los mensajes del CLI es
  // contrato con quien lo usa, igual que las banderas y los codigos de salida.
  return trozos[indice + 1].split(CIERRE_ENSAYO)[0];
}

// Los canales por separado. La funcion de arriba los junta a proposito -a un
// check del modo texto le da igual por donde salio un mensaje-, pero el modo
// json contrata justo lo contrario: stdout lleva solo eventos y stderr queda
// vacio, y eso no se puede comprobar sobre los dos pegados.
function vitralCanales(cwd, ...args) {
  const r = spawnSync(process.execPath, [path.join(raiz, 'vitral.mjs'), ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { codigo: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// El unico escenario que no cabe en el taller: pruebas/ vive dentro del
// repositorio de Vitral, asi que un directorio de ahi dentro sigue siendo un
// repositorio para `git rev-parse --is-inside-work-tree`. Los tres bloques de
// "esto no es un repositorio" necesitan uno que de verdad no lo sea.
const tallerFuera = path.join(os.tmpdir(), 'vitral-checks-sin-git');

function montarSinRepo(nombre) {
  const dir = path.join(tallerFuera, nombre);
  mkdirSync(path.join(dir, '.vitral', 'plomo'), { recursive: true });
  cpSync(path.join(raiz, 'ejemplo', 'boceto.json'), path.join(dir, '.vitral', 'boceto.json'));
  cpSync(path.join(raiz, 'ejemplo', 'plomo'), path.join(dir, '.vitral', 'plomo'), { recursive: true });
  return dir;
}

// Dos tareas de la misma ola sobre el mismo terreno. Sirve de freno: cuando hace
// falta ver un aviso de una corrida que no lleva --seco, este boceto la aborta en
// revisarSolapamientos, que juzga despues del aviso y antes de lanzar nada.
const CHOQUE = { nombre: 'choque', tareas: [
  { id: 'modelos', rutas: ['app/Models/'], prompt: 'x' },
  { id: 'pedido', rutas: ['app/Models/Pedido/'], prompt: 'y' },
] };

// Los tres bloques de revisarSobrescritura son los unicos que ningun freno de
// los de arriba alcanza: ese guardarrail se calla con --seco, y los que abortan
// -rutas que chocan, cwd malo- se juzgan antes que el, asi que cuando hablan ya
// no llega a hablar el aviso. El freno tiene que ir despues del aviso.
//
// Va `.vitral/logs` escrito como archivo: el mkdirSync de prepararRegistro
// revienta con EEXIST justo despues de los avisos y justo antes de armar el
// primer vidrio, asi que no se lanza ningun agente. El estropicio sale por
// stderr y no lo mira nadie; el aviso ya salio entero por stdout.
function montarSobrescritura(nombre, ids) {
  const dir = montarRepo(nombre, 'trabajo/checks');
  const boceto = bocetoSuelto(dir, 'sobrescritura.json', { nombre: 'sobrescritura',
    tareas: ids.map((id) => ({ id, rutas: [`app/${id}/`], prompt: 'x' })) });
  mkdirSync(path.join(dir, '.vitral', 'handoffs'), { recursive: true });
  for (const id of ids) {
    // Las dos mitades que busca el guardarrail: el handoff dice que la tarea ya
    // corrio, y el archivo sin rastrear dice que dejo cosas suyas por delante.
    // Sin sello de tanda, que es el caso en el que los handoffs valen.
    writeFileSync(path.join(dir, '.vitral', 'handoffs', `${id}.md`), `${HANDOFF_VIEJO}\n`);
    mkdirSync(path.join(dir, 'app', id), { recursive: true });
    writeFileSync(path.join(dir, 'app', id, 'suyo.txt'), `${RASTRO_VIEJO}\n`);
  }
  writeFileSync(path.join(dir, '.vitral', 'logs'), 'el freno');
  return { dir, boceto };
}

// El escenario de los checks del campo "plomos". El directorio de plomo que
// monta montarRepo viene copiado de ejemplo/plomo/ y tiene un solo .md: escribir
// un segundo dentro de un repositorio compartido cambiaria lo que ven checks que
// hoy pasan, asi que cada check del campo monta el suyo, con nombre propio, y se
// queda exactamente con los archivos que declara aqui y con ninguno mas.
//
// Las claves de `archivos` son rutas dentro del directorio del plomo, asi que
// una con separador crea el subdirectorio de verdad: es lo que necesita el check
// del plomo pedido bajo una carpeta, que sin el archivo escrito pasaria tambien
// con el orden de comprobaciones invertido. Un objeto vacio deja el repositorio
// sin directorio plomo/ ninguno.
function repoConPlomos(nombre, archivos) {
  const dir = montarRepo(nombre, 'trabajo/checks');
  const dirPlomo = path.join(dir, '.vitral', 'plomo');
  rmSync(dirPlomo, { recursive: true, force: true });
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = path.join(dirPlomo, ruta);
    mkdirSync(path.dirname(destino), { recursive: true });
    writeFileSync(destino, contenido);
  }
  return dir;
}

// Dos contratos con una marca propia dentro, para poder afirmar cual entro en un
// prompt y cual no. Los nombres son de una letra porque en este asunto lo unico
// que importa de ellos es en que orden salen.
const MARCAS = {
  'a.md': 'la marca del primer contrato',
  'b.md': 'la marca del segundo contrato',
};

const PLOMOS_AB = {
  'a.md': `# Contrato A\n\n${MARCAS['a.md']}\n`,
  'b.md': `# Contrato B\n\n${MARCAS['b.md']}\n`,
};

// El escenario de los dos errores. Los archivos se llaman como los de este
// repositorio para que la linea de los disponibles salga literal del plomo.
const PLOMOS_DEL_ERROR = {
  'motor.md': '# Contrato del motor\n\nlo que hay que dar por cierto de los demas\n',
  'plomos-en-el-boceto.md': '# Contrato · que cada tarea declare que plomos lee\n\nel de la tanda\n',
};

// Un plomo entro en un prompt cuando estan las dos mitades: la linea que lo
// encabeza y su contenido. Comprobar solo el encabezado no distingue "lo mando
// entero" de "lo mando vacio".
const llevaPlomo = (prompt, nombre) =>
  prompt.includes(`--- plomo: ${nombre} ---`) && prompt.includes(MARCAS[nombre]);

// ---------------------------------------------------------------------------
// Los bloques literales
// ---------------------------------------------------------------------------
//
// La salida de ayer, copiada caracter a caracter de .vitral/plomo/eventos.md,
// donde se genero llamando al motor antes de que la tanda del modo json tocara
// nada. No se regeneran corriendo el motor, ni para comprobarlos: el motor de
// hoy ya lleva los cambios, asi que fotografiarlo congelaria como correcta
// cualquier coma que se hubiera movido. Una red generada a partir de lo que
// vigila no comprueba nada: confirma.
//
// Estan los diecisiete. Los tres de revisarSobrescritura son los unicos que no
// se pueden disparar con --seco -ese guardarrail se calla en seco- ni con un
// choque de rutas, que se juzga antes; salen con el freno de montarSobrescritura.
const BLOQUES = {
  "revisarRama · no es repositorio, sin --sin-git":
    "vitral: esto no es un repositorio git, asi que no puedo saber en que rama estas.\n" +
    "        los agentes van a escribir archivos sin pedir permiso y no habria como deshacerlo.\n" +
    "        corre `git init` y crea una rama de trabajo, o pasa --sin-git si sabes lo que haces",
  "revisarRama · no es repositorio, con --sin-git":
    "aviso: corriendo con --sin-git: no hay repositorio, no hay red de seguridad, no hay vuelta atras",
  "revisarRama · en main":
    "vitral: estas en la rama \"main\".\n" +
    "        los agentes escriben archivos sin pedir permiso y no quieres eso en tu rama principal.\n" +
    "        crea una rama antes: git checkout -b trabajo/boceto",
  "revisarRama · en main, con --seco":
    "aviso: estas en la rama \"main\"; sin --seco esto abortaria",
  "revisarRama · no es repositorio, con --seco":
    "aviso: esto no es un repositorio git; sin --seco esto abortaria, o exigiria --sin-git",
  "revisarBoceto · fuera del repositorio":
    "vitral: el boceto \"C:/otro/.vitral/boceto.json\" cae fuera del repositorio.\n" +
    "        sus rutas se resolverian contra esta raiz y sus handoffs se escribirian aqui.\n" +
    "        corre vitral desde el proyecto al que pertenece el boceto",
  "revisarSolapamientos · un choque":
    "vitral: hay tareas de la misma ola escribiendo en el mismo terreno:\n" +
    "        ola 1: \"modelos\" con app/Models/ y \"pedido\" con app/Models/Pedido/, ambas bajo app/Models\n" +
    "        corren en paralelo, asi que el ultimo en guardar borra el trabajo del otro\n" +
    "        sin avisar. Separa las rutas, o manda una de las dos a otra ola con \"necesita\".",
  "revisarSolapamientos · dos choques":
    "vitral: hay tareas de la misma ola escribiendo en el mismo terreno:\n" +
    "        ola 1: \"modelos\" con app/Models/ y \"pedido\" con app/Models/Pedido/, ambas bajo app/Models\n" +
    "        ola 1: \"modelos\" con app/Otro/ y \"pedido\" con app/Otro/Cosa/, ambas bajo app/Otro\n" +
    "        corren en paralelo, asi que el ultimo en guardar borra el trabajo del otro\n" +
    "        sin avisar. Separa las rutas, o manda una de las dos a otra ola con \"necesita\".",
  "revisarPresupuestos · presupuesto en tarea opencode":
    "aviso: \"suelta\" declara presupuesto, pero el agente \"opencode\" no tiene tope de gasto: se ignora.\n" +
    "       Su unico freno es el timeout (15 min).",
  "revisarPresupuestos · presupuesto por debajo del piso":
    "aviso: presupuesto por debajo de $0.25 en \"tacano\" ($0.1): el tope se comprueba entre turnos, no durante,\n" +
    "       asi que el gasto real puede ser varias veces el declarado. Sirve de techo de seguridad, no de control fino.",
  "revisarCwd · un cwd fuera de la raiz":
    "vitral: el cwd de \"fuera\" cae fuera del repositorio: ../otro\n" +
    "        ahi git no ve nada, asi que no hay forma de revisar ni de deshacer lo que\n" +
    "        escriba el agente. Vitral no tiene otra red de seguridad.",
  "revisarCwd · dos cwd fuera de la raiz":
    "vitral: los cwd de estas tareas caen fuera del repositorio:\n" +
    "        \"fuera\": ../otro\n" +
    "        \"lejos\": ../../mas\n" +
    "        ahi git no ve nada, asi que no hay forma de revisar ni de deshacer lo que\n" +
    "        escriba el agente. Vitral no tiene otra red de seguridad.",
  "revisarCwd · un cwd que no existe":
    "vitral: el cwd de \"perdida\" no existe: no-existe\n" +
    "        creal antes de lanzar. Si no, el agente falla al arrancar con un ENOENT que\n" +
    "        parece culpa del CLI y no del boceto.",
  "revisarCwd · dos cwd que no existen":
    "vitral: los cwd de estas tareas no existen:\n" +
    "        \"perdida\": no-existe\n" +
    "        \"otra\": tampoco\n" +
    "        creal antes de lanzar. Si no, el agente falla al arrancar con un ENOENT que\n" +
    "        parece culpa del CLI y no del boceto.",
  "revisarSobrescritura · una tarea":
    "aviso: esta corrida va a relanzar \"backend\", que ya corrio antes y tiene archivos suyos en el arbol de trabajo.\n" +
    "       El agente va a escribir encima de ellos. Conviene tener un commit antes.",
  "revisarSobrescritura · dos tareas":
    "aviso: esta corrida va a relanzar \"backend\", \"frontend\", que ya corrieron antes y tienen archivos suyos en el arbol de trabajo.\n" +
    "       Los agentes van a escribir encima de ellos. Conviene tener un commit antes.",
  "revisarSobrescritura · una tarea, con --rehacer":
    "aviso: --rehacer va a relanzar \"backend\", que ya corrio antes y tiene archivos suyos en el arbol de trabajo.\n" +
    "       El agente va a escribir encima de ellos. Conviene tener un commit antes.",
};

// El bloque de un mensaje tal como sale por pantalla: la linea del prefijo y las
// de continuacion, que van sangradas hasta donde mide ese prefijo ("vitral: "
// mide 8, "aviso: " mide 7). Se recorta asi y no se compara la salida entera
// porque un aviso sale despues de la cabecera, y la cabecera no es lo que fija
// este check.
function bloqueDe(texto, prefijo) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n');
  const desde = lineas.findIndex((linea) => linea.startsWith(prefijo));
  if (desde === -1) return null;
  const sangria = ' '.repeat(prefijo.length);
  let hasta = desde + 1;
  while (hasta < lineas.length && lineas[hasta].startsWith(sangria)) hasta++;
  return lineas.slice(desde, hasta).join('\n');
}

// La primera linea en que dos bloques se separan. Un diff de cinco lineas no se
// lee en la tabla de resultados; una linea con las dos versiones, si.
function primeraDiferencia(esperado, real) {
  const a = esperado.split('\n');
  const b = real.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `linea ${i + 1}: esperaba ${JSON.stringify(a[i] ?? null)}, ` +
             `salio ${JSON.stringify(b[i] ?? null)}`;
    }
  }
  return null;
}

// El bloque entero, no un includes de un trozo: lo que se vigila aqui es la
// coma, el espacio y el salto de linea, y un includes no los ve.
function comprobarBloque(texto, titulo, esperado = BLOQUES[titulo]) {
  const real = bloqueDe(texto, esperado.slice(0, esperado.indexOf(' ') + 1));
  if (real === null) return `(${titulo}) no salio ningun bloque`;
  const diferencia = primeraDiferencia(esperado, real);
  return diferencia === null ? null : `(${titulo}) ${diferencia}`;
}

// Las lineas de stdout ya parseadas, una por evento. Un evento no se compara
// como cadena: `t` cambia en cada corrida.
function eventos(stdout) {
  return stdout.replace(/\r\n/g, '\n').split('\n').filter((linea) => linea !== '')
    .map((linea, indice) => {
      try {
        return JSON.parse(linea);
      } catch {
        throw new Error(`la linea ${indice + 1} de stdout no es JSON: ${linea.slice(0, 60)}`);
      }
    });
}

const nombresDe = (evs) => evs.map((evento) => evento.evt).join(',');

// Los dos errores del campo "plomos", copiados caracter a caracter de la seccion
// "Los textos, literales" de .vitral/plomo/plomos-en-el-boceto.md. No se generan
// corriendo el motor, por lo mismo que los diecisiete de arriba: el motor de hoy
// ya lleva la tanda, asi que fotografiarlo congelaria como correcta cualquier
// coma que se hubiera movido.
//
// Con una sola sustitucion, y es la unica: el directorio del plomo se pinta tal
// cual lo trae `plomo.dir`, sin normalizar barras, y `plomo.dir` sale de un
// path.join. En el ejemplo del plomo se lee ".vitral/plomo" porque se genero en
// una maquina donde path.join da barras hacia delante; en Windows la misma linea
// dice ".vitral\plomo". Afirmar la barra literal seria afirmar el sistema
// operativo de quien lo escribio, asi que va la cuenta y no la barra.
const DIR_PLOMO = path.join('.vitral', 'plomo');

// Los dos .md del escenario de los dos errores se llaman como los de este
// repositorio para que la ultima linea salga tambien literal del plomo.
const BLOQUE_PLOMO_FANTASMA =
  `vitral: la tarea "barra" pide el plomo "paleta.md", que no existe en "${DIR_PLOMO}".\n` +
  '        plomos disponibles: motor.md, plomos-en-el-boceto.md';

// El del subdirectorio tiene que explicar el motivo entero y no solo que la ruta
// no vale, y por eso mide cuatro lineas de sugerencia en vez de una. El nombre
// pedido cambia con la barra que se escriba; lo demas, no.
const bloqueDeSubdirectorio = (pedido) =>
  `vitral: la tarea "barra" pide el plomo "${pedido}", y "plomos" no baja a subdirectorios.\n` +
  `        solo entran en el prompt los .md que hay sueltos en "${DIR_PLOMO}".\n` +
  '        Un subdirectorio es donde se deja un contrato para que deje de gobernar:\n' +
  '        lo que cuelga de uno no lo lee ningun agente, y por eso no se puede pedir.\n' +
  '        plomos disponibles: motor.md, plomos-en-el-boceto.md';

// Y el del boceto que no existe, que no es de esta tanda: es el de siempre, y
// esta aqui porque leerPlomo pasa a correr antes que leerBoceto y este es el
// mensaje que se perderia si esa inversion rompiera algo.
const BOCETO_QUE_NO_ESTA = path.join('.vitral', 'no-esta.json');

const BLOQUE_BOCETO_QUE_NO_ESTA =
  `vitral: no encuentro el boceto en "${BOCETO_QUE_NO_ESTA}".\n` +
  '        crea .vitral/boceto.json o pasa otro con --boceto <archivo>';

// ---------------------------------------------------------------------------
// Los checks
// ---------------------------------------------------------------------------
//
// Cada uno devuelve null si pasa, o un texto explicando que salio en su lugar.

let trabajo;   // repositorio en una rama de trabajo
let principal; // el mismo, pero en main

const checks = [
  ['--seco imprime un prompt por tarea', () => {
    const { texto } = vitral(trabajo, '--seco');
    const n = cuenta(texto, /^prompt · ola/gm);
    return n === 3 ? null : `esperaba 3 prompts, salieron ${n}`;
  }],

  ['el plomo entra entero en los tres prompts', () => {
    const { texto } = vitral(trabajo, '--seco');
    const n = cuenta(texto, /Contrato · cambio de estado de pedido/g);
    return n === 3 ? null : `el contrato aparece ${n} veces, esperaba 3`;
  }],

  ['revision recibe los handoffs de backend y frontend', () => {
    const { texto } = vitral(trabajo, '--seco');
    const n = cuenta(texto, /^--- "/gm);
    return n === 2 ? null : `esperaba 2 handoffs inyectados, salieron ${n}`;
  }],

  ['en main aborta antes de lanzar nada', () => {
    const { codigo, texto } = vitral(principal);
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    return texto.includes('estas en la rama "main"') ? null : 'no dijo en que rama estaba';
  }],

  ['una dependencia circular da un error legible', () => {
    const boceto = bocetoSuelto(trabajo, 'ciclo.json', { nombre: 'ciclo', tareas: [
      { id: 'a', necesita: ['c'], rutas: ['x/'], prompt: 'a' },
      { id: 'b', necesita: ['a'], rutas: ['y/'], prompt: 'b' },
      { id: 'c', necesita: ['b'], rutas: ['z/'], prompt: 'c' },
    ] });
    const { codigo, texto } = vitral(trabajo, '--boceto', boceto);
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    return texto.includes('dependencia circular entre: a, b, c') ? null : 'el mensaje no nombra el ciclo';
  }],

  ['dos tareas de la misma ola sobre el mismo terreno abortan', () => {
    const boceto = bocetoSuelto(trabajo, 'choque.json', { nombre: 'choque', tareas: [
      { id: 'modelos', rutas: ['app/Models/'], prompt: 'x' },
      { id: 'pedido', rutas: ['app/Models/Pedido/'], prompt: 'y' },
    ] });
    const { codigo, texto } = vitral(trabajo, '--seco', '--boceto', boceto);
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    return texto.includes('mismo terreno') ? null : 'aborto, pero sin decir que se pisaban';
  }],

  ['app/Models y app/ModelsViejos no se pisan', () => {
    const boceto = bocetoSuelto(trabajo, 'vecinas.json', { nombre: 'vecinas', tareas: [
      { id: 'modelos', rutas: ['app/Models/'], prompt: 'x' },
      { id: 'viejos', rutas: ['app/ModelsViejos/'], prompt: 'y' },
    ] });
    const { codigo } = vitral(trabajo, '--seco', '--boceto', boceto);
    return codigo === 0 ? null : `aborto con codigo ${codigo}: comparo por texto y no por segmento`;
  }],

  ['el solape entre olas distintas esta permitido', () => {
    const boceto = bocetoSuelto(trabajo, 'serie.json', { nombre: 'serie', tareas: [
      { id: 'modelos', rutas: ['app/Models/'], prompt: 'x' },
      { id: 'revision', necesita: ['modelos'], rutas: ['app/'], prompt: 'y' },
    ] });
    const { codigo } = vitral(trabajo, '--seco', '--boceto', boceto);
    return codigo === 0 ? null : `aborto con codigo ${codigo}: corren en serie, no pueden pisarse`;
  }],

  ['un presupuesto por debajo del piso avisa', () => {
    const boceto = bocetoSuelto(trabajo, 'barato.json', { nombre: 'barato', tareas: [
      { id: 'tacano', rutas: ['app/Models/'], presupuesto: 0.1, prompt: 'x' },
    ] });
    const { texto } = vitral(trabajo, '--seco', '--boceto', boceto);
    return texto.includes('presupuesto por debajo') ? null : 'no aviso del presupuesto apretado';
  }],

  ['--solo con un id que no existe da error', () => {
    const { codigo, texto } = vitral(trabajo, '--solo', 'fantasma');
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    return texto.includes('no hay ninguna tarea con ese id') ? null : 'el mensaje no explica el problema';
  }],

  ['--solo sin handoffs en disco no salta nada', () => {
    const { texto } = vitral(trabajo, '--seco', '--solo', 'revision');
    return texto.includes('--solo revision: 3 tareas') ? null
      : 'no dijo que iba a ejecutar las tres tareas';
  }],

  ['el historial se consulta sin tocar el boceto ni la rama', () => {
    // a) sin archivo todavia
    const vacio = vitral(trabajo, '--historial');
    if (vacio.codigo !== 0) return `(vacio) esperaba codigo 0, salio ${vacio.codigo}`;
    if (!vacio.texto.includes('todavia no hay ninguna corrida guardada')) {
      return '(vacio) no dijo que el historial estaba vacio';
    }

    // b) con dos corridas guardadas
    const corridas = [
      { id: '20260818-093322', fecha: '2026-08-18T13:33:22.000Z', boceto: '.vitral/boceto.json',
        nombre: 'Una corrida vieja', rama: 'trabajo/checks',
        banderas: { solo: null, rehacer: false, sinGit: false },
        ok: true, duracionMs: 12000, costo: 0.25, olas: [1],
        tareas: [{ id: 'uno', agente: 'claude', modelo: null, ok: true, ms: 12000,
                   costo: 0.25, turnos: 3, motivo: 'success', error: null,
                   denegaciones: 0, sesion: 'ses-1' }],
        saltadas: [], cambios: { archivos: [], sinRastrear: 0, fueraDeRuta: [] } },
      { id: '20260819-143012', fecha: '2026-08-19T18:30:12.482Z', boceto: '.vitral/boceto.json',
        nombre: 'Una corrida reciente', rama: 'trabajo/checks',
        banderas: { solo: 'revision', rehacer: false, sinGit: false },
        ok: false, duracionMs: 84210, costo: 0.6431, olas: [2, 1],
        tareas: [{ id: 'revision', agente: 'claude', modelo: 'sonnet', ok: false, ms: 4310,
                   costo: 0.6431, turnos: 1, motivo: 'error_max_budget_usd',
                   error: 'se quedo sin presupuesto', denegaciones: 0, sesion: 'ses-2' }],
        saltadas: ['backend'], cambios: { archivos: ['app/x.php'], sinRastrear: 1, fueraDeRuta: [] } },
    ];
    writeFileSync(path.join(trabajo, '.vitral', 'historial.jsonl'),
      corridas.map((c) => JSON.stringify(c)).join('\n') + '\n');

    const lista = vitral(trabajo, '--historial');
    if (lista.codigo !== 0) return `(lista) esperaba codigo 0, salio ${lista.codigo}`;
    for (const c of corridas) {
      if (!lista.texto.includes(c.id)) return `(lista) falta la corrida ${c.id}`;
    }
    // La mas reciente va primero, aunque en el archivo sea la ultima linea.
    if (lista.texto.indexOf('20260819-143012') > lista.texto.indexOf('20260818-093322')) {
      return '(lista) las corridas no salen de la mas reciente a la mas antigua';
    }

    // c) el detalle de una
    const detalle = vitral(trabajo, '--historial', '20260819-143012');
    if (detalle.codigo !== 0) return `(detalle) esperaba codigo 0, salio ${detalle.codigo}`;
    if (!detalle.texto.includes('corrida 20260819-143012')) return '(detalle) no encabeza con el id';
    if (!detalle.texto.includes('se quedo sin presupuesto')) return '(detalle) no muestra el error de la tarea';

    // d) un id que no existe
    const perdida = vitral(trabajo, '--historial', 'no-existe');
    if (perdida.codigo !== 1) return `(id inexistente) esperaba codigo 1, salio ${perdida.codigo}`;

    // e) es una consulta: funciona en main, donde una corrida abortaria
    writeFileSync(path.join(principal, '.vitral', 'historial.jsonl'),
      JSON.stringify(corridas[0]) + '\n');
    const enMain = vitral(principal, '--historial');
    if (enMain.codigo !== 0) return `(en main) esperaba codigo 0, salio ${enMain.codigo}`;
    if (!enMain.texto.includes('20260818-093322')) return '(en main) no listo la corrida';

    return null;
  }],

  // Los cuatro que siguen cubren la validacion de "presupuesto", "modelo" y
  // "cwd". Todos con --seco: son errores de forma o de entorno, se cazan sin
  // lanzar ningun agente y sin gastar una ola.

  ['un presupuesto que no es un numero mayor que cero aborta', () => {
    for (const [indice, valor] of [0, -5, 'tres', '3'].entries()) {
      const boceto = bocetoSuelto(trabajo, `presupuesto-${indice}.json`, {
        nombre: 'presupuesto', tareas: [
          { id: 'backend', rutas: ['app/'], presupuesto: valor, prompt: 'x' },
        ] });
      const { codigo, texto } = vitral(trabajo, '--seco', '--boceto', boceto);
      const visto = JSON.stringify(valor);
      if (codigo !== 1) return `(${visto}) esperaba codigo 1, salio ${codigo}`;
      if (!texto.includes(`la tarea "backend" tiene un "presupuesto" invalido: ${visto}.`)) {
        return `(${visto}) aborto, pero sin nombrar el campo y el valor`;
      }
    }
    return null;
  }],

  ['un modelo que no es una cadena util aborta', () => {
    for (const [indice, valor] of [123, '', 'con espacio'].entries()) {
      const boceto = bocetoSuelto(trabajo, `modelo-${indice}.json`, {
        nombre: 'modelo', tareas: [
          { id: 'backend', rutas: ['app/'], modelo: valor, prompt: 'x' },
        ] });
      const { codigo, texto } = vitral(trabajo, '--seco', '--boceto', boceto);
      const visto = JSON.stringify(valor);
      if (codigo !== 1) return `(${visto}) esperaba codigo 1, salio ${codigo}`;
      if (!texto.includes(`la tarea "backend" tiene un "modelo" invalido: ${visto}.`)) {
        return `(${visto}) aborto, pero sin nombrar el campo y el valor`;
      }
    }
    return null;
  }],

  ['un cwd fuera del repositorio o inexistente aborta', () => {
    // Cada caso muere en un sitio distinto y por eso dice otra cosa: la ruta
    // absoluta la caza boceto.mjs por la forma, las otras dos revisarCwd, que
    // necesita el disco y la raiz.
    const casos = [
      ['..', 'el cwd de "backend" cae fuera del repositorio: ..'],
      ['sub/que-no-esta', 'el cwd de "backend" no existe: sub/que-no-esta'],
      ['C:/algo', 'la tarea "backend" tiene un "cwd" invalido: "C:/algo".'],
    ];
    for (const [indice, [valor, esperado]] of casos.entries()) {
      const boceto = bocetoSuelto(trabajo, `cwd-${indice}.json`, {
        nombre: 'cwd', tareas: [
          { id: 'backend', rutas: ['app/'], cwd: valor, prompt: 'x' },
        ] });
      const { codigo, texto } = vitral(trabajo, '--seco', '--boceto', boceto);
      if (codigo !== 1) return `(${valor}) esperaba codigo 1, salio ${codigo}`;
      if (!texto.includes(esperado)) return `(${valor}) aborto, pero no dijo: ${esperado}`;
    }
    return null;
  }],

  ['los tres campos bien escritos siguen pasando', () => {
    // El cwd tiene que existir de verdad en disco: revisarCwd lo comprueba.
    mkdirSync(path.join(trabajo, 'sub'), { recursive: true });
    const boceto = bocetoSuelto(trabajo, 'buenos.json', { nombre: 'buenos', tareas: [
      { id: 'backend', rutas: ['app/'], presupuesto: 3, modelo: 'sonnet', cwd: 'sub', prompt: 'x' },
    ] });
    const { codigo, texto } = vitral(trabajo, '--seco', '--boceto', boceto);
    if (codigo !== 0) return `esperaba codigo 0, salio ${codigo}: la validacion nueva rechaza lo que antes funcionaba`;
    return cuenta(texto, /^prompt · ola/gm) === 1 ? null : 'no llego a armar el prompt de la tarea';
  }],

  // Los cuatro que siguen fijan que el preambulo no miente sobre el paralelismo.
  // Un vidrio solo en su ola al que el prompt le afirma que hay otros agentes
  // escribiendo se explica sus propias reescrituras buscando un segundo autor que
  // no existe, y eso ya paso una vez. Todos van con --seco: el prompt se arma por
  // el mismo camino que en la corrida real, que para eso ensayar y ejecutarOlas
  // comparten promptDe.

  ['un vidrio solo en su ola no lee que haya otros agentes', () => {
    const { texto } = vitral(trabajo, '--seco');
    const prompt = promptDe(texto, 'revision');
    if (prompt === null) return 'no salio el prompt de revision';
    if (!prompt.includes('eres el unico agente de esta ola')) {
      return 'revision va sola en la ola 2 y su prompt no lo dice';
    }
    return prompt.includes('en paralelo ahora mismo') ? 'le afirma que hay otros editando a la vez' : null;
  }],

  ['un vidrio acompanado nombra a sus companeros', () => {
    // a) dos en la ola: singular, y con el id del otro.
    const dos = vitral(trabajo, '--seco');
    const backend = promptDe(dos.texto, 'backend');
    if (backend === null) return '(dos) no salio el prompt de backend';
    if (!backend.includes('con otro agente, "frontend",')) {
      return '(dos) no nombra a frontend en singular';
    }

    // b) tres independientes caen en una sola ola: plural, y con los otros dos.
    const boceto = bocetoSuelto(trabajo, 'trio.json', { nombre: 'trio', tareas: [
      { id: 'uno', rutas: ['a/'], prompt: 'x' },
      { id: 'dos', rutas: ['b/'], prompt: 'y' },
      { id: 'tres', rutas: ['c/'], prompt: 'z' },
    ] });
    const tres = vitral(trabajo, '--seco', '--boceto', boceto);
    const companeros = { uno: ['dos', 'tres'], dos: ['uno', 'tres'], tres: ['uno', 'dos'] };
    for (const [id, otros] of Object.entries(companeros)) {
      const prompt = promptDe(tres.texto, id);
      if (prompt === null) return `(tres) no salio el prompt de ${id}`;
      if (!prompt.includes('con otros 2 agentes,')) {
        return `(tres) el prompt de ${id} no dice que son tres en la ola`;
      }
      for (const otro of otros) {
        if (!prompt.includes(`"${otro}"`)) return `(tres) el prompt de ${id} no nombra a "${otro}"`;
      }
    }
    return null;
  }],

  ['--solo deja la ola en un vidrio y el texto lo refleja', () => {
    // El boceto tiene tres tareas, pero backend no depende de nadie: la ola que
    // se ejecuta es de una sola, y el prompt tiene que contarlo asi.
    const { texto } = vitral(trabajo, '--seco', '--solo', 'backend');
    const prompt = promptDe(texto, 'backend');
    if (prompt === null) return 'no salio el prompt de backend';
    return prompt.includes('eres el unico agente de esta ola') ? null
      : 'corre solo, pero su prompt sigue hablando de companeros';
  }],

  ['las frases comunes siguen saliendo en los dos casos', () => {
    // Bifurcar un texto es la forma clasica de perder por el camino una frase que
    // valia para todos.
    const { texto } = vitral(trabajo, '--seco');
    const comunes = ['No hay a quien preguntarle',
                     'Nunca esperes, nunca preguntes, nunca te quedes a medias'];
    for (const id of ['backend', 'revision']) {
      const prompt = promptDe(texto, id);
      if (prompt === null) return `no salio el prompt de ${id}`;
      for (const frase of comunes) {
        if (!prompt.includes(frase)) return `el prompt de ${id} perdio: ${frase}`;
      }
    }
    return null;
  }],

  // Los cuatro que siguen cubren lo que el motor daba por sentado del disco: que
  // el boceto que le pasan es de este proyecto, y que los handoffs que encuentra
  // son de esta tanda. Todos con --seco: los dos defectos se cazan antes de
  // lanzar nada.

  ['un boceto de otro proyecto aborta, tambien en seco', () => {
    // La raiz sale del cwd, asi que un boceto de fuera se ejecutaria contra el
    // directorio actual: rutas resueltas contra la raiz equivocada y handoffs
    // escritos en el proyecto equivocado. La ruta sale en el mensaje tal como se
    // escribio, sin normalizar.
    const fuera = [
      path.join('..', 'principal', '.vitral', 'boceto.json'), // sube por encima de la raiz
      path.join(raiz, 'ejemplo', 'boceto.json'),              // absoluta, y de otro repositorio
    ];
    for (const ruta of fuera) {
      for (const banderas of [['--seco'], []]) {
        const { codigo, texto } = vitral(trabajo, ...banderas, '--boceto', ruta);
        const como = banderas.length ? '--seco' : 'sin --seco';
        if (codigo !== 1) return `(${como}) esperaba codigo 1, salio ${codigo}`;
        if (!texto.includes(`el boceto "${ruta}" cae fuera del repositorio.`)) {
          return `(${como}) aborto, pero sin nombrar el boceto de fuera: ${ruta}`;
        }
      }
    }
    // Y el caso normal sigue pasando: un boceto de dentro no dice nada de esto.
    const dentro = vitral(trabajo, '--seco');
    if (dentro.codigo !== 0) return `un boceto de dentro aborto con codigo ${dentro.codigo}`;
    return dentro.texto.includes('cae fuera del repositorio')
      ? 'un boceto de dentro de la raiz tambien se rechaza' : null;
  }],

  ['con un sello de otra tanda los handoffs en disco se ignoran', () => {
    const { dir, boceto, sello } = repoSellado('sello-ajeno', TANDA_VIEJA);
    const { codigo, texto } = vitral(dir, '--seco', '--boceto', boceto);
    if (codigo !== 0) return `esperaba codigo 0, salio ${codigo}`;
    if (!texto.includes(`1 handoff en disco es de la tanda "${TANDA_VIEJA}": se ignora`)) {
      return 'la cabecera no dice que el handoff de disco es de otra tanda';
    }

    const prompt = promptDe(texto, 'encima');
    if (prompt === null) return 'no salio el prompt de encima';
    if (prompt.includes(RASTRO_VIEJO)) {
      return 'el handoff de la tanda vieja se colo en el prompt del dependiente';
    }
    if (!prompt.includes('--- "base" no dejo handoff ---')) {
      return 'el handoff ignorado no se cuenta como ausencia';
    }

    // El seco lee el sello pero no lo escribe, y nada se borra: ignorar no es
    // limpiar, que eso es del cierre de tanda.
    if (readFileSync(sello, 'utf8').trim() !== TANDA_VIEJA) {
      return '--seco reescribio el sello';
    }
    return existsSync(path.join(dir, '.vitral', 'handoffs', 'base.md')) ? null
      : '--seco borro el handoff que solo tenia que ignorar';
  }],

  ['sin sello los handoffs en disco se siguen usando', () => {
    // El caso de migracion: un proyecto que ya venia funcionando antes de que el
    // sello existiera. Descartarle el trabajo bueno seria peor que el fallo que
    // el sello arregla, asi que sin sello los handoffs valen.
    const { dir, boceto } = repoSellado('sin-sello', null);
    const { codigo, texto } = vitral(dir, '--seco', '--boceto', boceto);
    if (codigo !== 0) return `esperaba codigo 0, salio ${codigo}`;
    if (texto.includes('de la tanda "')) {
      return 'sin sello no hay nada que ignorar, y la cabecera dice que si';
    }

    const prompt = promptDe(texto, 'encima');
    if (prompt === null) return 'no salio el prompt de encima';
    if (!prompt.includes('--- handoff de "base" ---')) {
      return 'el handoff de disco no entro en el prompt del dependiente';
    }
    return prompt.includes(RASTRO_VIEJO) ? null
      : 'el encabezado del handoff entro, pero no su contenido';
  }],

  ['con un sello de otra tanda, --solo ejecuta la dependencia en vez de saltarsela', () => {
    // Este es el dano grave del defecto: saltarse una dependencia que nunca corrio
    // en esta tanda e inyectar su handoff viejo con voz de trabajo recien hecho.
    const ajeno = repoSellado('sello-y-solo', TANDA_VIEJA);
    const conSello = vitral(ajeno.dir, '--seco', '--solo', 'encima', '--boceto', ajeno.boceto);
    if (conSello.codigo !== 0) return `(sello ajeno) esperaba codigo 0, salio ${conSello.codigo}`;
    if (!conSello.texto.includes('--solo encima: 2 tareas')) {
      return '(sello ajeno) no dijo que iba a ejecutar las dos tareas';
    }
    if (conSello.texto.includes('saltada')) {
      return '(sello ajeno) se salto una dependencia con un handoff que no es de esta tanda';
    }
    if (promptDe(conSello.texto, 'base') === null) {
      return '(sello ajeno) la dependencia no llego a armar su prompt: no se ejecuta';
    }

    // Y el contraste, que es lo que da valor a lo de arriba: sin sello, el mismo
    // --solo si se salta la dependencia. Si esto dejara de saltarse, el check de
    // arriba pasaria por el motivo equivocado.
    const migrado = repoSellado('solo-sin-sello', null);
    const sinSello = vitral(migrado.dir, '--seco', '--solo', 'encima', '--boceto', migrado.boceto);
    if (!sinSello.texto.includes('--solo encima: 1 tarea, 1 saltada (handoff en disco)')) {
      return '(sin sello) el mismo --solo tendria que saltarse la dependencia y no lo hizo';
    }
    return promptDe(sinSello.texto, 'base') === null ? null
      : '(sin sello) la dio por saltada y aun asi armo su prompt';
  }],

  // Los diecisiete bloques del plomo son la red fina del modo texto: los 24 de
  // arriba vigilan que el motor siga diciendo lo mismo, y estos que lo diga con
  // las mismas comas. Cada uno dispara su bloque desde un escenario y lo compara
  // entero. Ninguno lanza agentes: todos abortan antes, o van con --seco.

  ['los cinco bloques de revisarRama salen palabra por palabra', () => {
    // a) en main y sin --seco: aborta antes de leer nada. Va sin --boceto porque
    // la sugerencia nombra el boceto por defecto.
    const enMain = vitralCanales(principal);
    if (enMain.codigo !== 1) return `(en main) esperaba codigo 1, salio ${enMain.codigo}`;
    let queja = comprobarBloque(enMain.stderr, 'revisarRama · en main');
    if (queja) return queja;

    // b) en main con --seco: avisa y sigue. El boceto que se pisa la detiene
    // despues, que es lo que deja el aviso solo en stdout.
    const choque = bocetoSuelto(principal, 'choque-rama.json', CHOQUE);
    const seco = vitralCanales(principal, '--seco', '--boceto', choque);
    queja = comprobarBloque(seco.stdout, 'revisarRama · en main, con --seco');
    if (queja) return queja;

    // c, d, e) los tres de "esto no es un repositorio", en un directorio que de
    // verdad no lo es.
    const fuera = montarSinRepo('rama');
    const suelto = vitralCanales(fuera);
    if (suelto.codigo !== 1) return `(sin repo) esperaba codigo 1, salio ${suelto.codigo}`;
    queja = comprobarBloque(suelto.stderr, 'revisarRama · no es repositorio, sin --sin-git');
    if (queja) return queja;

    const choqueFuera = bocetoSuelto(fuera, 'choque.json', CHOQUE);
    const sinGit = vitralCanales(fuera, '--sin-git', '--boceto', choqueFuera);
    queja = comprobarBloque(sinGit.stdout, 'revisarRama · no es repositorio, con --sin-git');
    if (queja) return queja;

    const secoFuera = vitralCanales(fuera, '--seco', '--boceto', choqueFuera);
    return comprobarBloque(secoFuera.stdout, 'revisarRama · no es repositorio, con --seco');
  }],

  ['el bloque de revisarBoceto sale palabra por palabra', () => {
    // El bloque del plomo lleva una ruta absoluta de Windows que no se puede
    // reproducir en cualquier maquina. Se sustituye la ruta y solo la ruta: lo
    // que la rodea se compara letra por letra. La ruta sale en el mensaje tal
    // como se escribio, sin normalizar.
    const ruta = '../otro/.vitral/boceto.json';
    const esperado = BLOQUES['revisarBoceto · fuera del repositorio']
      .replace('C:/otro/.vitral/boceto.json', ruta);
    const { codigo, stderr } = vitralCanales(trabajo, '--seco', '--boceto', ruta);
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    return comprobarBloque(stderr, 'revisarBoceto · fuera del repositorio', esperado);
  }],

  ['los dos bloques de revisarSolapamientos salen palabra por palabra', () => {
    const uno = bocetoSuelto(trabajo, 'choque-uno.json', CHOQUE);
    const primero = vitralCanales(trabajo, '--seco', '--boceto', uno);
    if (primero.codigo !== 1) return `(un choque) esperaba codigo 1, salio ${primero.codigo}`;
    const queja = comprobarBloque(primero.stderr, 'revisarSolapamientos · un choque');
    if (queja) return queja;

    const dos = bocetoSuelto(trabajo, 'choque-dos.json', { nombre: 'choque', tareas: [
      { id: 'modelos', rutas: ['app/Models/', 'app/Otro/'], prompt: 'x' },
      { id: 'pedido', rutas: ['app/Models/Pedido/', 'app/Otro/Cosa/'], prompt: 'y' },
    ] });
    const segundo = vitralCanales(trabajo, '--seco', '--boceto', dos);
    if (segundo.codigo !== 1) return `(dos choques) esperaba codigo 1, salio ${segundo.codigo}`;
    return comprobarBloque(segundo.stderr, 'revisarSolapamientos · dos choques');
  }],

  ['los dos bloques de revisarPresupuestos salen palabra por palabra', () => {
    const suelta = bocetoSuelto(trabajo, 'suelta.json', { nombre: 'suelta', tareas: [
      { id: 'suelta', agente: 'opencode', rutas: ['app/'], presupuesto: 3, prompt: 'x' },
    ] });
    const sinTope = vitralCanales(trabajo, '--seco', '--boceto', suelta);
    const queja = comprobarBloque(sinTope.stdout,
      'revisarPresupuestos · presupuesto en tarea opencode');
    if (queja) return queja;

    const tacano = bocetoSuelto(trabajo, 'tacano.json', { nombre: 'tacano', tareas: [
      { id: 'tacano', rutas: ['app/Models/'], presupuesto: 0.1, prompt: 'x' },
    ] });
    const apretado = vitralCanales(trabajo, '--seco', '--boceto', tacano);
    return comprobarBloque(apretado.stdout,
      'revisarPresupuestos · presupuesto por debajo del piso');
  }],

  ['los cuatro bloques de revisarCwd salen palabra por palabra', () => {
    // El singular y el plural son redacciones distintas, no maquetacion: los dos
    // se fijan. Con una sola tarea el nombre cabe en la frase; con varias, la
    // lista baja a detalles.
    const casos = [
      ['cwd-fuera-uno.json', 'revisarCwd · un cwd fuera de la raiz',
        [{ id: 'fuera', rutas: ['a/'], cwd: '../otro', prompt: 'x' }]],
      ['cwd-fuera-dos.json', 'revisarCwd · dos cwd fuera de la raiz',
        [{ id: 'fuera', rutas: ['a/'], cwd: '../otro', prompt: 'x' },
         { id: 'lejos', rutas: ['b/'], cwd: '../../mas', prompt: 'y' }]],
      ['cwd-falta-uno.json', 'revisarCwd · un cwd que no existe',
        [{ id: 'perdida', rutas: ['a/'], cwd: 'no-existe', prompt: 'x' }]],
      ['cwd-falta-dos.json', 'revisarCwd · dos cwd que no existen',
        [{ id: 'perdida', rutas: ['a/'], cwd: 'no-existe', prompt: 'x' },
         { id: 'otra', rutas: ['b/'], cwd: 'tampoco', prompt: 'y' }]],
    ];
    for (const [archivo, titulo, tareas] of casos) {
      const boceto = bocetoSuelto(trabajo, archivo, { nombre: 'cwd', tareas });
      const { codigo, stderr } = vitralCanales(trabajo, '--seco', '--boceto', boceto);
      if (codigo !== 1) return `(${titulo}) esperaba codigo 1, salio ${codigo}`;
      const queja = comprobarBloque(stderr, titulo);
      if (queja) return queja;
    }
    return null;
  }],

  ['los tres bloques de revisarSobrescritura salen palabra por palabra', () => {
    const una = montarSobrescritura('sobre-una', ['backend']);
    const primera = vitralCanales(una.dir, '--boceto', una.boceto);
    let queja = comprobarBloque(primera.stdout, 'revisarSobrescritura · una tarea');
    if (queja) return queja;

    // Que el freno haya saltado no es un detalle del escenario: es lo unico que
    // separa a este check de lanzar agentes de verdad. Si prepararRegistro deja
    // de reventar aqui, esto tiene que ponerse rojo y no gastar un centimo.
    if (!primera.stderr.includes('EEXIST')) {
      return 'el freno no salto: la corrida siguio y pudo llegar a lanzar agentes de verdad';
    }

    const rehacer = vitralCanales(una.dir, '--rehacer', '--boceto', una.boceto);
    queja = comprobarBloque(rehacer.stdout, 'revisarSobrescritura · una tarea, con --rehacer');
    if (queja) return queja;

    const dos = montarSobrescritura('sobre-dos', ['backend', 'frontend']);
    const segunda = vitralCanales(dos.dir, '--boceto', dos.boceto);
    return comprobarBloque(segunda.stdout, 'revisarSobrescritura · dos tareas');
  }],

  // ---------------------------------------------------------------------------
  // El modo json
  // ---------------------------------------------------------------------------
  //
  // Se parsea el JSON y se comparan campos, nunca lineas enteras: `t` cambia en
  // cada corrida. Ninguno lanza agentes: todos son consultas, abortos o --seco.

  ['--json emite JSONL por stdout y deja stderr vacio', () => {
    // Las cinco maneras de terminar, no solo la que sale bien: los caminos de
    // error son justo donde se cuela una linea que no es un evento, porque en
    // modo texto ahi se escribe por otro canal y con otra funcion.
    const choque = bocetoSuelto(trabajo, 'choque-jsonl.json', CHOQUE);
    const corridas = [
      ['bien', 0, ['--seco', '--json']],
      ['guardarrail', 1, ['--seco', '--json', '--boceto', choque]],
      ['bandera mala', 1, ['--json', '--bandera-mala']],
      ['ayuda', 0, ['--json', '--ayuda']],
      ['historial', 0, ['--json', '--historial']],
    ];
    for (const [como, esperado, args] of corridas) {
      const { codigo, stdout, stderr } = vitralCanales(trabajo, ...args);
      if (codigo !== esperado) return `(${como}) esperaba codigo ${esperado}, salio ${codigo}`;
      // stderr es la catastrofe, y en una corrida prevista queda vacio: tambien
      // en las que terminan mal, que es lo que mueve de canal la bandera.
      if (stderr !== '') return `(${como}) stderr tendria que quedar vacio: ${stderr.slice(0, 60)}`;
      if (!stdout.endsWith('\n')) return `(${como}) la ultima linea no termina en salto de linea`;
      const lineas = stdout.replace(/\r\n/g, '\n').split('\n');
      lineas.pop();
      if (lineas.length === 0) return `(${como}) no salio ninguna linea`;
      for (const [indice, linea] of lineas.entries()) {
        if (linea === '') return `(${como}) la linea ${indice + 1} esta vacia: una linea, un evento`;
        try {
          JSON.parse(linea);
        } catch (error) {
          return `(${como}) la linea ${indice + 1} no parsea sola: ${error.message}`;
        }
      }
    }
    return null;
  }],

  ['todo evento lleva evt y t delante, y un unico fin lo cierra', () => {
    // Cuatro invocaciones que terminan de cuatro maneras: bien, por guardarrail,
    // por ErrorVitral y por consulta. Las cuatro cierran igual.
    const choque = bocetoSuelto(trabajo, 'choque-flujo.json', CHOQUE);
    const corridas = [
      ['seco', ['--seco', '--json']],
      ['guardarrail', ['--seco', '--json', '--boceto', choque]],
      ['bandera mala', ['--json', '--bandera-mala']],
      ['ayuda', ['--json', '--ayuda']],
    ];
    for (const [como, args] of corridas) {
      const evs = eventos(vitralCanales(trabajo, ...args).stdout);
      if (evs.length === 0) return `(${como}) no salio ningun evento`;
      for (const [indice, evento] of evs.entries()) {
        const campos = Object.keys(evento);
        if (campos[0] !== 'evt' || campos[1] !== 't') {
          return `(${como}) el evento ${indice + 1} empieza por ${campos.slice(0, 2).join(', ')}`;
        }
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(evento.t)) {
          return `(${como}) el evento ${indice + 1} lleva una t rara: ${evento.t}`;
        }
      }
      const fines = evs.filter((evento) => evento.evt === 'fin').length;
      if (fines !== 1) return `(${como}) esperaba exactamente un fin, salieron ${fines}`;
      if (evs[evs.length - 1].evt !== 'fin') {
        return `(${como}) el ultimo evento es ${evs[evs.length - 1].evt} y no fin`;
      }
    }
    return null;
  }],

  ['el evento corrida lleva el catalogo entero, con ids en las olas', () => {
    const { stdout } = vitralCanales(trabajo, '--seco', '--json');
    const corridas = eventos(stdout).filter((evento) => evento.evt === 'corrida');
    if (corridas.length !== 1) return `esperaba 1 evento corrida, salieron ${corridas.length}`;
    const [corrida] = corridas;
    const campos = 'evt,t,nombre,boceto,rama,plomo,olas,solo,otraTanda';
    if (Object.keys(corrida).join(',') !== campos) {
      return `los campos son ${Object.keys(corrida).join(',')} y el catalogo dice ${campos}`;
    }
    if (corrida.nombre !== 'Modulo de estados de pedido') return `el nombre salio "${corrida.nombre}"`;
    // Barras hacia delante tambien en Windows: en el evento la ruta es un dato,
    // no la ruta del sistema de quien corrio el motor.
    if (corrida.boceto !== '.vitral/boceto.json') return `el boceto salio "${corrida.boceto}"`;
    if (corrida.rama !== 'trabajo/checks') return `la rama salio ${JSON.stringify(corrida.rama)}`;
    // Los nombres del plomo, no su cuenta; los bytes crudos, no "33.1 KB".
    if (JSON.stringify(corrida.plomo.archivos) !== '["estados-pedido.md"]') {
      return `el plomo dice ${JSON.stringify(corrida.plomo.archivos)}`;
    }
    if (typeof corrida.plomo.bytes !== 'number') return 'los bytes del plomo no son un numero';
    // Los ids de cada ola, no las cuentas: de ahi sale el "2 -> 1" del texto.
    if (JSON.stringify(corrida.olas) !== '[["backend","frontend"],["revision"]]') {
      return `las olas salieron ${JSON.stringify(corrida.olas)}`;
    }
    // Un dato ausente es null, nunca un campo que falta.
    if (corrida.solo !== null) return `solo salio ${JSON.stringify(corrida.solo)}`;
    return corrida.otraTanda === null ? null
      : `otraTanda salio ${JSON.stringify(corrida.otraTanda)}`;
  }],

  ['el evento prompt lleva el mismo prompt que pinta --seco', () => {
    const flujo = vitralCanales(trabajo, '--seco', '--json');
    const pintado = vitral(trabajo, '--seco');
    const prompts = eventos(flujo.stdout).filter((evento) => evento.evt === 'prompt');
    if (prompts.length !== 3) return `esperaba 3 eventos prompt, salieron ${prompts.length}`;
    const olas = { backend: 1, frontend: 1, revision: 2 };
    for (const prompt of prompts) {
      const campos = 'evt,t,ola,id,agente,bytes,texto';
      if (Object.keys(prompt).join(',') !== campos) {
        return `(${prompt.id}) los campos son ${Object.keys(prompt).join(',')}`;
      }
      // Base 1, como en pantalla: dos numeraciones para la misma cosa es la
      // trampa de catalogo de siempre.
      if (prompt.ola !== olas[prompt.id]) {
        return `(${prompt.id}) esperaba ola ${olas[prompt.id]}, salio ${prompt.ola}`;
      }
      if (prompt.agente !== 'claude') return `(${prompt.id}) el agente salio "${prompt.agente}"`;
      if (prompt.bytes !== Buffer.byteLength(prompt.texto, 'utf8')) {
        return `(${prompt.id}) los bytes no son los del texto que viaja`;
      }
      const suyo = promptDe(pintado.texto, prompt.id);
      if (suyo === null) return `(${prompt.id}) el modo texto no saco su prompt`;
      if (suyo.trim() !== prompt.texto.trim()) {
        return `(${prompt.id}) el prompt del evento no es el que pinta el modo texto`;
      }
    }
    return null;
  }],

  ['--json --ayuda: un ayuda y un fin, y nada mas', () => {
    const { codigo, stdout, stderr } = vitralCanales(trabajo, '--json', '--ayuda');
    if (codigo !== 0) return `esperaba codigo 0, salio ${codigo}`;
    if (stderr !== '') return `stderr tendria que quedar vacio y salio: ${stderr.slice(0, 60)}`;
    const evs = eventos(stdout);
    if (nombresDe(evs) !== 'ayuda,fin') return `salieron ${nombresDe(evs)}`;
    // El texto entero de AYUDA, con sus saltos de linea, no un catalogo de banderas.
    if (evs[0].texto.trim() !== vitral(trabajo, '--ayuda').texto.trim()) {
      return 'el texto del evento no es el que pinta --ayuda';
    }
    const fin = evs[1];
    if (fin.ok !== true || fin.codigo !== 0 || fin.seco !== false) {
      return `el fin salio ${JSON.stringify({ ok: fin.ok, codigo: fin.codigo, seco: fin.seco })}`;
    }
    return null;
  }],

  ['--json con una bandera desconocida: el prescan la salva', () => {
    // La bandera mala va delante a proposito: sin el prescan, parsearBanderas
    // lanzaria el ErrorVitral antes de haber leido --json y la interfaz recibiria
    // texto pintado justo en el caso de error, que es el peor sitio donde puede
    // pasar.
    const { codigo, stdout, stderr } = vitralCanales(trabajo, '--bandera-mala', '--json');
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    if (stderr !== '') return `el error salio por stderr en vez de por stdout: ${stderr.slice(0, 60)}`;
    const evs = eventos(stdout);
    if (nombresDe(evs) !== 'error,fin') return `salieron ${nombresDe(evs)}`;
    // detalles no viaja en un error: nada que llame a imprimirError fuera de un
    // veredicto las produce.
    if (Object.keys(evs[0]).join(',') !== 'evt,t,mensaje,sugerencia') {
      return `los campos del error son ${Object.keys(evs[0]).join(',')}`;
    }
    if (evs[0].mensaje !== 'no conozco la bandera "--bandera-mala".') {
      return `el mensaje salio ${JSON.stringify(evs[0].mensaje)}`;
    }
    if (!String(evs[0].sugerencia).includes('--json')) {
      return 'la sugerencia no nombra --json entre las banderas';
    }
    return evs[1].codigo === 1 ? null : `el fin salio con codigo ${evs[1].codigo}`;
  }],

  ['--json y un boceto que no existe: error y fin', () => {
    const { codigo, stdout, stderr } =
      vitralCanales(trabajo, '--json', '--boceto', path.join('.vitral', 'no-esta.json'));
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    if (stderr !== '') return `el error salio por stderr: ${stderr.slice(0, 60)}`;
    const evs = eventos(stdout);
    if (nombresDe(evs) !== 'error,fin') return `salieron ${nombresDe(evs)}`;
    if (!evs[0].mensaje.includes('no encuentro el boceto')) {
      return `el mensaje salio ${JSON.stringify(evs[0].mensaje)}`;
    }
    return evs[1].codigo === 1 ? null : `el fin salio con codigo ${evs[1].codigo}`;
  }],

  ['--json --historial: un solo evento con el array dentro', () => {
    // Un repositorio recien montado: los otros escenarios ya tienen historial
    // escrito por los checks de arriba.
    const limpio = montarRepo('json-historial', 'trabajo/checks');

    // a) vacio: un historial con corridas [], y ningun otro evento.
    const vacio = vitralCanales(limpio, '--json', '--historial');
    if (vacio.codigo !== 0) return `(vacio) esperaba codigo 0, salio ${vacio.codigo}`;
    if (vacio.stderr !== '') return `(vacio) stderr no quedo vacio: ${vacio.stderr.slice(0, 60)}`;
    const sinNada = eventos(vacio.stdout);
    if (nombresDe(sinNada) !== 'historial,fin') return `(vacio) salieron ${nombresDe(sinNada)}`;
    if (JSON.stringify(sinNada[0].corridas) !== '[]') {
      return `(vacio) corridas salio ${JSON.stringify(sinNada[0].corridas)}`;
    }

    // b) con dos corridas: siguen siendo un solo evento, y llegan tal como salen
    // de leerHistorial, sin tocar.
    const guardadas = [
      { id: '20260818-093322', nombre: 'Una vieja', ok: true, costo: 0.25, comoSea: 'intacto' },
      { id: '20260819-143012', nombre: 'Una reciente', ok: false, costo: 0.6431 },
    ];
    writeFileSync(path.join(limpio, '.vitral', 'historial.jsonl'),
      guardadas.map((c) => JSON.stringify(c)).join('\n') + '\n');
    const lleno = eventos(vitralCanales(limpio, '--json', '--historial').stdout);
    if (nombresDe(lleno) !== 'historial,fin') return `(lleno) salieron ${nombresDe(lleno)}`;
    const corridas = lleno[0].corridas;
    if (corridas.length !== 2) return `(lleno) esperaba 2 corridas, salieron ${corridas.length}`;
    if (corridas[0].id !== '20260819-143012') {
      return '(lleno) las corridas no salen de la mas reciente a la mas antigua';
    }
    if (corridas[1].comoSea !== 'intacto') return '(lleno) la corrida no llego tal cual estaba';

    // c) un id que no existe: error y fin, codigo 1.
    const perdida = vitralCanales(limpio, '--json', '--historial', 'no-existe');
    if (perdida.codigo !== 1) return `(id inexistente) esperaba codigo 1, salio ${perdida.codigo}`;
    const evs = eventos(perdida.stdout);
    if (nombresDe(evs) !== 'error,fin') return `(id inexistente) salieron ${nombresDe(evs)}`;
    return evs[1].codigo === 1 ? null
      : `(id inexistente) el fin salio con codigo ${evs[1].codigo}`;
  }],

  ['--json y un guardarrail que aborta: veredicto sin maquetacion', () => {
    const choque = bocetoSuelto(trabajo, 'choque-veredicto.json', CHOQUE);
    const { codigo, stdout, stderr } =
      vitralCanales(trabajo, '--seco', '--json', '--boceto', choque);
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    if (stderr !== '') return `el veredicto salio por stderr: ${stderr.slice(0, 60)}`;
    const evs = eventos(stdout);
    // revisarSolapamientos juzga antes de la cabecera: no llega ningun `corrida`.
    if (nombresDe(evs) !== 'veredicto,fin') return `salieron ${nombresDe(evs)}`;
    const [veredicto] = evs;
    const campos = 'evt,t,nivel,mensaje,sugerencia,detalles';
    if (Object.keys(veredicto).join(',') !== campos) {
      return `los campos son ${Object.keys(veredicto).join(',')} y el catalogo dice ${campos}`;
    }
    if (veredicto.nivel !== 'aborta') return `el nivel salio "${veredicto.nivel}"`;
    if (veredicto.mensaje !== 'hay tareas de la misma ola escribiendo en el mismo terreno:') {
      return `el mensaje salio ${JSON.stringify(veredicto.mensaje)}`;
    }
    // La lista va en detalles, uno por elemento, no aplanada en prosa dentro del
    // mensaje ni pegada detras de sus dos puntos.
    if (veredicto.detalles.length !== 1) {
      return `esperaba 1 detalle, salieron ${veredicto.detalles.length}`;
    }
    const choqueEsperado = 'ola 1: "modelos" con app/Models/ y "pedido" con ' +
      'app/Models/Pedido/, ambas bajo app/Models';
    if (veredicto.detalles[0] !== choqueEsperado) {
      return `el detalle salio ${JSON.stringify(veredicto.detalles[0])}`;
    }
    // Ni el mensaje, ni la sugerencia, ni ningun detalle llevan sangria de
    // terminal: eso es maquetacion y la pone quien pinta.
    const sinSangria = [['mensaje', veredicto.mensaje], ['sugerencia', veredicto.sugerencia],
      ...veredicto.detalles.map((detalle, i) => [`detalles[${i}]`, detalle])];
    for (const [campo, valor] of sinSangria) {
      if (/(^|\n) /.test(String(valor))) return `${campo} lleva espacios de sangria dentro del dato`;
    }
    return evs[1].codigo === 1 ? null : `el fin salio con codigo ${evs[1].codigo}`;
  }],

  ['--json: el avisa y el aborta salen los dos por stdout', () => {
    // En modo texto el aviso va por stdout y el error por stderr. Con --json los
    // dos son eventos del mismo canal, y por eso la interfaz nunca tiene que
    // olfatear si una linea es JSON o no.
    const choque = bocetoSuelto(principal, 'choque-canales.json', CHOQUE);
    const { codigo, stdout, stderr } =
      vitralCanales(principal, '--seco', '--json', '--boceto', choque);
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    if (stderr !== '') return `algo salio por stderr: ${stderr.slice(0, 60)}`;
    const evs = eventos(stdout);
    if (nombresDe(evs) !== 'veredicto,veredicto,fin') return `salieron ${nombresDe(evs)}`;
    const [avisa, aborta] = evs;
    if (avisa.nivel !== 'avisa') return `el primero salio con nivel "${avisa.nivel}"`;
    if (avisa.mensaje !== 'estas en la rama "main"; sin --seco esto abortaria') {
      return `el aviso dice ${JSON.stringify(avisa.mensaje)}`;
    }
    // Un avisa deja la sugerencia en null y los detalles en [], nunca sin campo:
    // quien lee no tiene que distinguir "no vino" de "vino vacio".
    if (avisa.sugerencia !== null) return `el avisa trae sugerencia ${JSON.stringify(avisa.sugerencia)}`;
    if (JSON.stringify(avisa.detalles) !== '[]') {
      return `el avisa trae detalles ${JSON.stringify(avisa.detalles)}`;
    }
    return aborta.nivel === 'aborta' ? null : `el segundo salio con nivel "${aborta.nivel}"`;
  }],

  ['los codigos de salida son identicos con y sin --json', () => {
    // La bandera cambia como se dice lo que pasa, no lo que pasa.
    const choque = bocetoSuelto(trabajo, 'choque-codigos.json', CHOQUE);
    const casos = [
      ['--seco'],
      ['--ayuda'],
      ['--historial'],
      ['--historial', 'no-existe'],
      ['--bandera-mala'],
      ['--solo', 'fantasma'],
      ['--seco', '--boceto', choque],
      ['--seco', '--boceto', path.join('.vitral', 'no-esta.json')],
    ];
    for (const args of casos) {
      const texto = vitralCanales(trabajo, ...args);
      const flujo = vitralCanales(trabajo, ...args, '--json');
      if (texto.codigo !== flujo.codigo) {
        return `(${args.join(' ')}) sin --json salio ${texto.codigo} y con --json ${flujo.codigo}`;
      }
    }
    return null;
  }],
  // Los nueve que siguen son del campo "plomos", con el que una tarea declara
  // que contratos del directorio lee. Todos con --seco, como los de arriba: el
  // reparto del plomo se ve entero en el prompt que imprime el ensayo, sin
  // lanzar ningun agente.
  //
  // Cada uno monta su repositorio con repoConPlomos, que le deja el directorio
  // de plomo con los archivos que declara y con ninguno mas.

  ['omitir "plomos" da el prompt de siempre', () => {
    // La regla que sostiene todo lo demas: un boceto que no conoce el campo
    // recibe lo que recibia antes de que el campo existiera.
    const dir = repoConPlomos('plomos-todos', PLOMOS_AB);
    const boceto = bocetoSuelto(dir, 'todos.json', { nombre: 'plomos todos', tareas: [
      { id: 'una', rutas: ['app/una/'], prompt: 'x' },
      { id: 'otra', rutas: ['app/otra/'], prompt: 'y' },
    ] });
    const { codigo, texto } = vitral(dir, '--seco', '--boceto', boceto);
    if (codigo !== 0) return `esperaba codigo 0, salio ${codigo}`;
    for (const id of ['una', 'otra']) {
      const prompt = promptDe(texto, id);
      if (prompt === null) return `no salio el prompt de ${id}`;
      for (const nombre of ['a.md', 'b.md']) {
        if (!llevaPlomo(prompt, nombre)) return `el prompt de ${id} no lleva ${nombre}`;
      }
    }
    return null;
  }],

  ['declarar un plomo manda ese y no el otro', () => {
    const dir = repoConPlomos('plomos-uno', PLOMOS_AB);
    const boceto = bocetoSuelto(dir, 'uno.json', { nombre: 'plomos uno', tareas: [
      { id: 'declara', rutas: ['app/declara/'], plomos: ['a.md'], prompt: 'x' },
      { id: 'omite', rutas: ['app/omite/'], prompt: 'y' },
    ] });
    const { codigo, texto } = vitral(dir, '--seco', '--boceto', boceto);
    if (codigo !== 0) return `esperaba codigo 0, salio ${codigo}`;

    const declara = promptDe(texto, 'declara');
    if (declara === null) return 'no salio el prompt de declara';
    if (!llevaPlomo(declara, 'a.md')) return 'declara pidio a.md y no lo recibio';
    if (declara.includes('b.md') || declara.includes(MARCAS['b.md'])) {
      return 'declara no pidio b.md y le llego igual';
    }

    // Y la de al lado, sin el campo, sigue recibiendolos todos: el reparto es por
    // tarea, no por corrida.
    const omite = promptDe(texto, 'omite');
    if (omite === null) return 'no salio el prompt de omite';
    for (const nombre of ['a.md', 'b.md']) {
      if (!llevaPlomo(omite, nombre)) return `omite no declara nada y no lleva ${nombre}`;
    }
    return null;
  }],

  ['el orden de los plomos es el declarado, no el alfabetico', () => {
    const dir = repoConPlomos('plomos-orden', PLOMOS_AB);
    const boceto = bocetoSuelto(dir, 'orden.json', { nombre: 'plomos orden', tareas: [
      { id: 'alreves', rutas: ['app/alreves/'], plomos: ['b.md', 'a.md'], prompt: 'x' },
      { id: 'omite', rutas: ['app/omite/'], prompt: 'y' },
    ] });
    const { codigo, texto } = vitral(dir, '--seco', '--boceto', boceto);
    if (codigo !== 0) return `esperaba codigo 0, salio ${codigo}`;

    const alreves = promptDe(texto, 'alreves');
    if (alreves === null) return 'no salio el prompt de alreves';
    const b = alreves.indexOf('--- plomo: b.md ---');
    const a = alreves.indexOf('--- plomo: a.md ---');
    if (b === -1 || a === -1) return 'alreves no recibio los dos plomos';
    if (b > a) return 'declaro ["b.md","a.md"] y le llegaron en orden alfabetico';

    // Sin el campo no hay mas orden que el del directorio, y ese sigue siendo el
    // alfabetico: las dos formas se leen distinto a proposito.
    const omite = promptDe(texto, 'omite');
    if (omite === null) return 'no salio el prompt de omite';
    if (omite.indexOf('--- plomo: a.md ---') > omite.indexOf('--- plomo: b.md ---')) {
      return 'sin declarar nada, los plomos dejaron de venir en orden alfabetico';
    }
    return null;
  }],

  ['"plomos": [] no manda ninguno, y el prompt lo dice con su frase', () => {
    // El array vacio y el campo ausente son distinguibles y significan cosas
    // distintas: "no leo ninguno" es una decision de quien planifico, y el
    // respaldo de siempre -"no hay contratos declarados"- diria otra cosa.
    const dir = repoConPlomos('plomos-vacio', PLOMOS_AB);
    const boceto = bocetoSuelto(dir, 'vacio.json', { nombre: 'plomos vacio', tareas: [
      { id: 'ninguno', rutas: ['app/'], plomos: [], prompt: 'x' },
    ] });
    const { codigo, texto } = vitral(dir, '--seco', '--boceto', boceto);
    if (codigo !== 0) return `esperaba codigo 0, salio ${codigo}`;
    const prompt = promptDe(texto, 'ninguno');
    if (prompt === null) return 'no salio el prompt de ninguno';
    if (!prompt.includes('(esta tarea declara que no lee ningun contrato)')) {
      return 'declaro [] y su prompt no lo dice con la frase del plomo';
    }
    if (prompt.includes('(no hay contratos declarados')) {
      return 'declaro [] y le salio el respaldo de "no habia nada que dar"';
    }
    for (const nombre of ['a.md', 'b.md']) {
      if (prompt.includes(nombre) || prompt.includes(MARCAS[nombre])) {
        return `declaro [] y le llego ${nombre} igual`;
      }
    }
    return null;
  }],

  ['un plomo que no existe aborta, y el mensaje sale palabra por palabra', () => {
    const dir = repoConPlomos('plomos-fantasma', PLOMOS_DEL_ERROR);
    const boceto = bocetoSuelto(dir, 'fantasma.json', { nombre: 'plomos fantasma', tareas: [
      { id: 'barra', rutas: ['app/'], plomos: ['paleta.md'], prompt: 'x' },
    ] });
    const { codigo, texto } = vitral(dir, '--seco', '--boceto', boceto);
    if (codigo !== 1) return `esperaba codigo 1, salio ${codigo}`;
    return comprobarBloque(texto, 'plomos · no existe', BLOQUE_PLOMO_FANTASMA);
  }],

  ['un plomo bajo un subdirectorio aborta con SU mensaje, no con el de "no existe"', () => {
    // El archivo se crea de verdad dentro del subdirectorio, y ese es el check
    // entero: si no estuviera, este escenario pasaria tambien con las dos
    // comprobaciones invertidas, que es justo el fallo que tiene que cazar. Lo
    // que se afirma no es que la ruta no valga -no vale de las dos maneras-, es
    // que no se puede pedir aunque el archivo este ahi.
    const dir = repoConPlomos('plomos-subdirectorio', {
      ...PLOMOS_DEL_ERROR,
      'retirados/historial.md': '# Un contrato retirado\n\nya no gobierna nada\n',
    });
    const puesto = path.join(dir, '.vitral', 'plomo', 'retirados', 'historial.md');
    if (!existsSync(puesto)) return 'el escenario no llego a escribir el archivo del subdirectorio';

    // Las dos barras: la de siempre y la que escribiria alguien en Windows.
    const pedidos = ['retirados/historial.md', 'retirados\\historial.md'];
    for (const [indice, pedido] of pedidos.entries()) {
      const boceto = bocetoSuelto(dir, `subdirectorio-${indice}.json`, {
        nombre: 'plomos subdirectorio', tareas: [
          { id: 'barra', rutas: ['app/'], plomos: [pedido], prompt: 'x' },
        ] });
      const { codigo, texto } = vitral(dir, '--seco', '--boceto', boceto);
      const visto = JSON.stringify(pedido);
      if (codigo !== 1) return `(${visto}) esperaba codigo 1, salio ${codigo}`;
      const queja = comprobarBloque(texto, `plomos · subdirectorio ${visto}`,
        bloqueDeSubdirectorio(pedido));
      if (queja !== null) return queja;
    }
    return null;
  }],

  ['un "plomos" mal escrito aborta', () => {
    // La forma se juzga mirando el valor: null no es lo mismo que omitido, una
    // cadena suelta no se itera letra a letra, y un nombre repetido es el mismo
    // criterio que un id repetido.
    const dir = repoConPlomos('plomos-forma', PLOMOS_AB);
    const casos = [null, 'a.md', [123], [''], ['a.md', 'a.md']];
    for (const [indice, valor] of casos.entries()) {
      const boceto = bocetoSuelto(dir, `forma-${indice}.json`, { nombre: 'plomos forma', tareas: [
        { id: 'barra', rutas: ['app/'], plomos: valor, prompt: 'x' },
      ] });
      const { codigo, texto } = vitral(dir, '--seco', '--boceto', boceto);
      const visto = JSON.stringify(valor);
      if (codigo !== 1) return `(${visto}) esperaba codigo 1, salio ${codigo}`;
      // El texto de estos cinco no lo fija el plomo, asi que no se congela aqui:
      // lo que se exige es que nombre la tarea y el campo, como los demas errores
      // de forma del boceto.
      if (!texto.includes('la tarea "barra"') || !texto.includes('"plomos"')) {
        return `(${visto}) aborto, pero sin nombrar la tarea y el campo`;
      }
    }
    return null;
  }],

  ['la cabecera no se movio: dice lo mismo con y sin "plomos" declarado', () => {
    // La linea del plomo describe el DIRECTORIO, no lo que recibe un vidrio.
    // Anadir ahi una cifra por tarea seria tocar la superficie de texto del CLI,
    // y esta tanda no la toca. Los dos bocetos se escriben con el mismo nombre
    // para que la linea entera sea comparable, no solo el trozo del plomo.
    const dir = repoConPlomos('plomos-cabecera', PLOMOS_AB);
    const lineaBoceto = (texto) => texto.replace(/\r\n/g, '\n').split('\n')
      .find((linea) => linea.startsWith('boceto ')) ?? null;

    const tarea = { id: 'una', rutas: ['app/una/'], prompt: 'x' };
    const boceto = bocetoSuelto(dir, 'cabecera.json', { nombre: 'cabecera', tareas: [tarea] });
    const antes = vitral(dir, '--seco', '--boceto', boceto);
    if (antes.codigo !== 0) return `(sin plomos) esperaba codigo 0, salio ${antes.codigo}`;

    bocetoSuelto(dir, 'cabecera.json', { nombre: 'cabecera',
      tareas: [{ ...tarea, plomos: ['a.md'] }] });
    const despues = vitral(dir, '--seco', '--boceto', boceto);
    if (despues.codigo !== 0) return `(con plomos) esperaba codigo 0, salio ${despues.codigo}`;

    const uno = lineaBoceto(antes.texto);
    const otro = lineaBoceto(despues.texto);
    if (uno === null || otro === null) return 'no salio la linea del boceto en la cabecera';
    if (!/plomo 2 archivos \(/.test(uno)) return `la cabecera no cuenta el directorio: ${uno}`;
    return uno === otro ? null : primeraDiferencia(uno, otro);
  }],

  ['un boceto que no existe sigue fallando igual, con leerPlomo corriendo antes', () => {
    // leerPlomo ya no corre despues de leerBoceto sino antes, porque leerBoceto
    // necesita la lista para juzgar los "plomos". Un directorio de plomo que no
    // existe tampoco es un error, asi que el que manda sigue siendo el del
    // boceto, con su texto y su codigo de siempre.
    const escenarios = [
      ['con plomo', repoConPlomos('plomos-sin-boceto', PLOMOS_AB)],
      ['sin directorio plomo', repoConPlomos('plomos-sin-boceto-ni-plomo', {})],
    ];
    for (const [caso, dir] of escenarios) {
      const { codigo, texto } = vitral(dir, '--seco', '--boceto', BOCETO_QUE_NO_ESTA);
      if (codigo !== 1) return `(${caso}) esperaba codigo 1, salio ${codigo}`;
      const queja = comprobarBloque(texto, `boceto que no existe · ${caso}`,
        BLOQUE_BOCETO_QUE_NO_ESTA);
      if (queja !== null) return queja;
    }
    return null;
  }],

];

// ---------------------------------------------------------------------------
// Correr
// ---------------------------------------------------------------------------

function limpiar() {
  try {
    rmSync(taller, { recursive: true, force: true, maxRetries: 5 });
    rmSync(tallerFuera, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // En Windows los objetos de git quedan de solo lectura y a veces no se
    // dejan borrar. No es motivo para fallar: el directorio esta ignorado.
  }
}

limpiar();
trabajo = montarRepo('trabajo', 'trabajo/checks');
principal = montarRepo('principal', 'main');

imprimir('');
imprimir(`${C.fuerte}checks de vitral${C.fin}${C.tenue} · ${checks.length} comprobaciones${C.fin}`);
imprimir('');

const ancho = String(checks.length).length;
let fallos = 0;

for (const [indice, [nombre, correr]] of checks.entries()) {
  let queja;
  try {
    queja = correr();
  } catch (error) {
    queja = `reviento el check: ${error.message}`;
  }
  const numero = String(indice + 1).padStart(ancho);
  if (queja === null || queja === undefined) {
    imprimir(`  ${C.verde}ok   ${C.fin} ${numero}  ${nombre}`);
  } else {
    fallos++;
    imprimir(`  ${C.rojo}FALLO${C.fin} ${numero}  ${nombre}`);
    imprimir(`         ${' '.repeat(ancho)}${C.rojo}${queja}${C.fin}`);
  }
}

limpiar();

imprimir('');
const pasados = checks.length - fallos;
if (fallos === 0) {
  imprimir(`${C.fuerte}resumen${C.fin}  ${C.verde}${pasados} de ${checks.length} pasan${C.fin}`);
  imprimir('');
  process.exit(0);
}
imprimir(`${C.fuerte}resumen${C.fin}  ${pasados} pasan · ` +
         `${C.rojo}${fallos} ${fallos === 1 ? 'falla' : 'fallan'}${C.fin}`);
imprimir('');
process.exit(1);
