#!/usr/bin/env node
// vitral · orquestador de agentes de IA en paralelo sobre un mismo repositorio.
//
// Varios agentes trabajan a la vez sobre el mismo codigo, cada uno en sus rutas,
// coordinados por un contrato escrito antes de empezar (el plomo). No hablan
// entre ellos mientras trabajan: ya se pusieron de acuerdo.
//
// Node 18+, ESM, cero dependencias.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync,
         statSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Colores
// ---------------------------------------------------------------------------

const conColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const C = conColor
  ? { fin: '\x1b[0m', fuerte: '\x1b[1m', tenue: '\x1b[2m', rojo: '\x1b[31m',
      verde: '\x1b[32m', amarillo: '\x1b[33m', cian: '\x1b[36m' }
  : { fin: '', fuerte: '', tenue: '', rojo: '', verde: '', amarillo: '', cian: '' };

const imprimir = (texto = '') => process.stdout.write(texto + '\n');

function morir(mensaje, sugerencia) {
  process.stderr.write(`${C.rojo}vitral: ${mensaje}${C.fin}\n`);
  if (sugerencia) process.stderr.write(`        ${C.tenue}${sugerencia}${C.fin}\n`);
  process.exit(1);
}

function advertir(mensaje) {
  imprimir(`${C.amarillo}aviso: ${mensaje}${C.fin}`);
}

function formatearDuracion(ms) {
  const segundos = Math.round(ms / 1000);
  if (segundos < 60) return `${segundos}s`;
  return `${Math.floor(segundos / 60)}m ${String(segundos % 60).padStart(2, '0')}s`;
}

const formatearCosto = (usd) => `$${(usd || 0).toFixed(4)}`;

// Fecha corta y local, para decir de cuando es un handoff sin llenar la linea.
function fechaCorta(fecha) {
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  return `${dd}-${mm} ${hh}:${mi}`;
}

// ---------------------------------------------------------------------------
// Adaptadores de agente
//
// Cada entrada define como se lanza el agente y como se lee lo que devolvio.
// Anadir un agente nuevo es anadir una entrada aqui, nada mas.
// El prompt siempre entra por stdin, nunca como argumento.
// ---------------------------------------------------------------------------

// Por debajo de esto, un presupuesto es enganoso: el tope se comprueba entre
// turnos y un solo turno de opus ya cuesta cerca de esa cifra.
const PISO_PRESUPUESTO = 0.25;

// Un agente que no termina se lleva por delante la ola y la corrida entera, y
// desde fuera no se distingue de uno que esta trabajando bien. Quince minutos es
// holgado para una tarea normal y corta en seco a uno colgado.
const TIMEOUT_MINUTOS = 15;

// Cada cuanto decir que las tareas en curso siguen vivas.
const LATIDO_MS = 60_000;

// Por que un agente dejo de trabajar, en cristiano. Los subtype vienen del JSON
// de Claude Code; se traducen aqui para que el fallo se entienda en pantalla.
const MOTIVOS_CLAUDE = {
  error_max_budget_usd:
    'se acabo el presupuesto a mitad de camino: dejo trabajo escrito y no dejo handoff',
  error_during_execution: 'el agente se rompio durante la ejecucion',
  error_max_turns: 'el agente agoto el tope de turnos',
};

const AGENTES = {
  // Verificado contra Claude Code 2.1.232.
  // Ojo: esta version NO tiene --max-turns. El unico tope disponible es
  // --max-budget-usd, por eso el boceto usa "presupuesto" (en dolares).
  claude: {
    cmd: 'claude',
    presupuestoSoportado: true,
    salidaEnStreaming: false,   // escribe su JSON de una sola vez, al terminar
    args(tarea) {
      const args = [
        '-p',
        '--output-format', 'json',
        '--permission-mode', 'bypassPermissions',
      ];
      if (tarea.modelo) args.push('--model', String(tarea.modelo));
      if (tarea.presupuesto) args.push('--max-budget-usd', String(tarea.presupuesto));
      return args;
    },
    parse(salida, codigo) {
      const json = JSON.parse(salida);
      return {
        ok: json.is_error !== true && json.subtype === 'success',
        resultado: typeof json.result === 'string' ? json.result : '',
        sesion: json.session_id || null,
        costo: typeof json.total_cost_usd === 'number' ? json.total_cost_usd : 0,
        turnos: typeof json.num_turns === 'number' ? json.num_turns : null,
        denegaciones: Array.isArray(json.permission_denials) ? json.permission_denials : [],
        motivo: json.subtype || json.stop_reason || null,
        explicacion: MOTIVOS_CLAUDE[json.subtype] || null,
        crudo: json,
      };
    },
  },

  // Verificado contra opencode 1.18.18.
  //
  //   opencode run --format json --auto [--model proveedor/modelo]
  //
  // Lee el prompt por stdin y sale con codigo 0. --auto aprueba los permisos sin
  // preguntar, que es el equivalente de bypassPermissions.
  //
  // Ojo: no hay tope de gasto. opencode no tiene nada parecido a --max-budget-usd,
  // asi que "presupuesto" no le aplica y su unico freno es el timeout.
  opencode: {
    cmd: 'opencode',
    presupuestoSoportado: false,
    salidaEnStreaming: true,    // emite un evento JSON por linea, segun trabaja
    args(tarea) {
      const args = ['run', '--format', 'json', '--auto'];
      // El modelo va como proveedor/modelo, p.ej. anthropic/claude-sonnet-4-5.
      if (tarea.modelo) args.push('--model', String(tarea.modelo));
      return args;
    },
    parse(salida, codigo) {
      // --format json emite JSONL: un evento por linea, no un objeto unico.
      const eventos = salida.split('\n')
        .map((linea) => linea.trim())
        .filter(Boolean)
        .map((linea) => { try { return JSON.parse(linea); } catch { return null; } })
        .filter(Boolean);

      if (eventos.length === 0) throw new Error('no emitio ningun evento JSON');

      const texto = eventos
        .filter((evento) => evento.type === 'text')
        .map((evento) => (evento.part && evento.part.text) || '')
        .join('');
      // El costo llega troceado: un step_finish por cada paso del agente.
      const costo = eventos
        .filter((evento) => evento.type === 'step_finish')
        .reduce((suma, evento) => suma + (Number(evento.part && evento.part.cost) || 0), 0);
      const fallos = eventos.filter((evento) => evento.type === 'error');

      return {
        ok: codigo === 0 && fallos.length === 0 && texto.trim() !== '',
        resultado: texto,
        sesion: eventos[0].sessionID || null,
        costo,
        turnos: eventos.filter((evento) => evento.type === 'step_start').length,
        denegaciones: [],   // con --auto no hay permisos que denegar, y no los reporta
        motivo: fallos.length > 0 ? 'error' : (codigo === 0 ? 'success' : `codigo ${codigo}`),
        explicacion: fallos.length > 0
          ? `opencode emitio un evento de error: ${JSON.stringify(fallos[0].part || fallos[0]).slice(0, 200)}`
          : null,
        crudo: eventos,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.replace(/\s+$/, '');
}

const hayGit = (raiz) => git(['rev-parse', '--is-inside-work-tree'], raiz) === 'true';

function ramaActual(raiz) {
  const rama = git(['branch', '--show-current'], raiz);
  if (rama === null) return null;
  return rama === '' ? 'HEAD desprendido' : rama;
}

// Lineas de `git status --porcelain`, tal cual. Se compara el conjunto de antes
// con el de despues para saber que toco esta corrida y no lo que ya estaba sucio.
function estadoGit(raiz) {
  // -uall es obligatorio: sin el, git colapsa un directorio nuevo entero en una
  // sola linea ("app/") y no se sabria que archivo se creo ni en que ruta cayo.
  const salida = git(['status', '--porcelain', '-uall'], raiz);
  if (salida === null) return new Set();
  return new Set(salida.split('\n').filter(Boolean));
}

function archivoDeLinea(linea) {
  let ruta = linea.slice(3).trim();
  const flecha = ruta.indexOf(' -> ');           // renombrados: "viejo -> nuevo"
  if (flecha !== -1) ruta = ruta.slice(flecha + 4);
  return ruta.replace(/^"|"$/g, '');
}

// ---------------------------------------------------------------------------
// Boceto
// ---------------------------------------------------------------------------

function leerBoceto(rutaBoceto) {
  if (!existsSync(rutaBoceto)) {
    morir(`no encuentro el boceto en "${rutaBoceto}".`,
      'crea .vitral/boceto.json o pasa otro con --boceto <archivo>');
  }

  let boceto;
  try {
    boceto = JSON.parse(readFileSync(rutaBoceto, 'utf8'));
  } catch (error) {
    morir(`el boceto "${rutaBoceto}" no es JSON valido: ${error.message}`);
  }

  if (!Array.isArray(boceto.tareas) || boceto.tareas.length === 0) {
    morir(`el boceto "${rutaBoceto}" no tiene tareas.`);
  }

  const vistos = new Set();
  for (const tarea of boceto.tareas) {
    if (!tarea.id) morir('hay una tarea sin "id" en el boceto.');
    if (vistos.has(tarea.id)) morir(`el id "${tarea.id}" esta repetido en el boceto.`);
    vistos.add(tarea.id);
    if (!tarea.prompt) morir(`la tarea "${tarea.id}" no tiene "prompt".`);
    if (!Array.isArray(tarea.rutas) || tarea.rutas.length === 0) {
      morir(`la tarea "${tarea.id}" no declara "rutas". Sin rutas no hay reparto de terreno.`);
    }
    if (tarea.timeout !== undefined &&
        (typeof tarea.timeout !== 'number' || !(tarea.timeout > 0))) {
      morir(`la tarea "${tarea.id}" tiene un "timeout" invalido: ${JSON.stringify(tarea.timeout)}.`,
        'debe ser un numero de minutos mayor que cero');
    }
    if (!tarea.agente) tarea.agente = 'claude';
    if (!AGENTES[tarea.agente]) {
      morir(`la tarea "${tarea.id}" pide el agente "${tarea.agente}", que no existe.`,
        `agentes disponibles: ${Object.keys(AGENTES).join(', ')}`);
    }
  }

  for (const tarea of boceto.tareas) {
    for (const dep of tarea.necesita || []) {
      if (!vistos.has(dep)) {
        morir(`la tarea "${tarea.id}" necesita "${dep}", que no existe en el boceto.`);
      }
    }
  }

  boceto.nombre = boceto.nombre || path.basename(rutaBoceto);
  return boceto;
}

// Orden topologico por niveles: cada nivel es una ola que corre en paralelo.
function calcularOlas(tareas, yaListas = new Set()) {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const pendientes = new Set(porId.keys());
  // Las tareas saltadas cuentan como terminadas: su handoff ya esta en disco.
  const listas = new Set(yaListas);
  const olas = [];

  while (pendientes.size > 0) {
    const ola = [...pendientes].filter((id) =>
      (porId.get(id).necesita || []).every((dep) => listas.has(dep)));

    if (ola.length === 0) {
      morir(`dependencia circular entre: ${[...pendientes].sort().join(', ')}.`,
        'ninguna de esas tareas puede empezar porque todas esperan a otra del grupo');
    }

    for (const id of ola) pendientes.delete(id);
    for (const id of ola) listas.add(id);
    olas.push(ola.map((id) => porId.get(id)));
  }

  return olas;
}

// --solo <id>: esa tarea mas todo aquello de lo que depende, en cadena.
function cerrarDependencias(tareas, id) {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  if (!porId.has(id)) {
    morir(`--solo "${id}": no hay ninguna tarea con ese id.`,
      `ids del boceto: ${tareas.map((t) => t.id).join(', ')}`);
  }
  const elegidos = new Set();
  const pila = [id];
  while (pila.length > 0) {
    const actual = pila.pop();
    if (elegidos.has(actual)) continue;
    elegidos.add(actual);
    for (const dep of porId.get(actual).necesita || []) pila.push(dep);
  }
  return tareas.filter((t) => elegidos.has(t.id));
}

// ---------------------------------------------------------------------------
// Plomo
//
// Los contratos viven junto al boceto: <dir del boceto>/plomo/*.md.
// Se concatenan en orden alfabetico y entran enteros en el prompt de todos.
// ---------------------------------------------------------------------------

function leerPlomo(dirPlomo) {
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

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

// Un handoff que falta no es un handoff vacio: es una tarea que fallo, que se
// corto o que nunca corrio. Se dice con voz de sistema y con encabezado propio,
// para que el agente no lo lea como algo que otro agente dejo escrito.
const ENCABEZADO_HANDOFF = {
  ok: (id) => `--- handoff de "${id}" ---`,
  incompleto: (id) => `--- "${id}" se corto a medias y no dejo handoff ---`,
  ausente: (id) => `--- "${id}" no dejo handoff ---`,
};

const AVISO_SIN_HANDOFF = (id) =>
`[vitral] La tarea "${id}" no dejo handoff. Puede haber fallado o no haberse
ejecutado. No asumas que su trabajo esta hecho: verifica en el codigo que existe
realmente antes de dar nada por sentado.`;

const AVISO_INCOMPLETO = (id, marca) =>
`[vitral] La tarea "${id}" se corto a medias y no llego a escribir su handoff.
Abajo esta lo que vitral registro del corte, incluida la causa. Puede haber
archivos a medio escribir que no constan en ninguna parte: verifica en el codigo
que existe realmente antes de construir encima.

${marca}`;

function construirPrompt(tarea, plomo, handoffs) {
  const bloques = [];

  bloques.push(
`# Vitral · tarea "${tarea.id}"

Estas trabajando dentro de un vitral: varios agentes editan este mismo repositorio
en paralelo, ahora mismo, cada uno en su propia tarea. No hay a quien preguntarle.
No puedes hablar con los otros agentes ni esperar respuesta de nadie: el codigo que
tienes al lado puede estar cambiando mientras trabajas.

Todo lo que necesitas para encajar con ellos ya esta escrito abajo, en el plomo.
Si algo no esta en el plomo, decidelo tu por la via mas conservadora y anotalo en
tu handoff. Nunca esperes, nunca preguntes, nunca te quedes a medias.`);

  bloques.push(
`## El plomo · contrato compartido · fuente de verdad obligatoria

Esto se acordo antes de que nadie tocara codigo, y es obligatorio. Nombres de
campos, forma de los JSON, rutas y metodos de los endpoints se respetan al pie de
la letra, aunque te parezcan mejorables. Si tu codigo y el plomo no coinciden, el
que esta mal es tu codigo.

Programa contra el plomo aunque la otra mitad todavia no exista.

${plomo || '(no hay contratos declarados: no existe el directorio plomo/ o esta vacio)'}`);

  bloques.push(
`## Tu tarea

${tarea.prompt}`);

  bloques.push(
`## Tus rutas

Solo puedes crear o modificar archivos dentro de:

${tarea.rutas.map((ruta) => `- ${ruta}`).join('\n')}

Fuera de ahi puedes leer todo lo que quieras, pero no escribir nada. Esos archivos
son de otro agente y tus cambios chocarian con los suyos. Si crees que hace falta
tocar algo fuera de tus rutas, no lo toques: anotalo en tu handoff, en "Necesito de
otros". Al final de la corrida se revisa si algo quedo fuera de lo declarado.`);

  if (handoffs.length > 0) {
    const texto = handoffs
      .map(({ id, contenido, estado }) => `${ENCABEZADO_HANDOFF[estado](id)}\n\n${contenido}`)
      .join('\n\n');
    bloques.push(
`## Handoffs de las tareas de las que dependes

Esto es lo que dejaron escrito al salir las tareas que van antes que la tuya: que
hicieron, que decidieron por su cuenta y donde se desviaron del plomo. Leelo antes
de tocar nada.

Si alguno se desvio del plomo, el plomo sigue mandando: corrige el codigo para que
encaje. Solo si la desviacion es deliberada y claramente mejor, actualiza el
archivo del plomo y dilo en tu handoff.

${texto}`);
  }

  bloques.push(
`## Como terminar

Cierra tu respuesta con este bloque, con estos cuatro campos y ningun otro. Es lo
unico que van a leer los agentes que vengan despues de ti, asi que se concreto:
nombres de archivos, nombres de campos, rutas reales.

## Handoff

**Hice:** que archivos tocaste y que quedo funcionando.
**Decidi:** lo que el plomo no decia y tuviste que resolver tu.
**Me desvie:** donde te apartaste del plomo y por que. Escribe "en nada" si no paso.
**Necesito de otros:** lo que queda pendiente en manos ajenas, o "nada".`);

  return bloques.join('\n\n');
}

// Una tarea puede morir a medias por dos razones muy distintas: se le acabo el
// dinero, o se le acabo el tiempo. La primera es un corte limpio entre turnos; la
// segunda es un proceso matado a la fuerza, que ademas puede haber estado colgado
// sin hacer nada. Son dos diagnosticos y la marca los separa.
function escribirMarcaIncompleta(dirHandoffs, tarea, resultado) {
  const archivo = path.join(dirHandoffs, `${tarea.id}.INCOMPLETO.md`);
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

// El agente puede repetir la plantilla del prompt, asi que vale el ultimo bloque.
function extraerHandoff(texto) {
  const encabezados = [...texto.matchAll(/^#{1,6}[ \t]*handoff[ \t]*$/gim)];
  if (encabezados.length === 0) return null;
  const ultimo = encabezados[encabezados.length - 1];
  return texto.slice(ultimo.index).trim();
}

// ---------------------------------------------------------------------------
// Ejecucion de un vidrio
// ---------------------------------------------------------------------------

// En Windows el hijo directo es cmd.exe, y matarlo deja vivo al agente que lanzo.
// taskkill /T se lleva el arbol entero. En POSIX basta con SIGKILL al proceso.
function matarArbol(hijo) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    hijo.kill('SIGKILL');
  }
}

function ejecutarVidrio(tarea, prompt, raiz) {
  const adaptador = AGENTES[tarea.agente];
  const cwd = path.resolve(raiz, tarea.cwd || '.');
  const arranque = Date.now();

  // En Windows `claude` es un .cmd: spawn no lo encuentra a secas. En vez de
  // shell:true (que concatena los argumentos sin escaparlos, y Node lo avisa
  // en cada corrida) se llama a cmd.exe, que si resuelve el .cmd por PATHEXT.
  const enWindows = process.platform === 'win32';
  const orden = enWindows ? process.env.COMSPEC || 'cmd.exe' : adaptador.cmd;
  const argumentos = enWindows
    ? ['/d', '/s', '/c', adaptador.cmd, ...adaptador.args(tarea)]
    : adaptador.args(tarea);

  return new Promise((resolve) => {
    let hijo;
    try {
      hijo = spawn(orden, argumentos, { cwd });
    } catch (error) {
      resolve({ ok: false, ms: Date.now() - arranque,
                error: `no se pudo lanzar "${adaptador.cmd}": ${error.message}` });
      return;
    }

    let salida = '';
    let errores = '';
    let matadoPorTiempo = false;
    hijo.stdout.on('data', (trozo) => { salida += trozo; });
    hijo.stderr.on('data', (trozo) => { errores += trozo; });

    // Un agente colgado no se distingue de uno trabajando: solo el reloj lo dice.
    const minutos = tarea.timeout || TIMEOUT_MINUTOS;
    const reloj = setTimeout(() => {
      matadoPorTiempo = true;
      matarArbol(hijo);
    }, minutos * 60_000);

    hijo.on('error', (error) => {
      clearTimeout(reloj);
      resolve({ ok: false, ms: Date.now() - arranque, salida, errores,
                error: `no se pudo lanzar "${adaptador.cmd}": ${error.message}` });
    });

    hijo.on('close', (codigo) => {
      clearTimeout(reloj);
      const ms = Date.now() - arranque;

      if (matadoPorTiempo) {
        resolve({ ok: false, ms, salida, errores, codigo, motivo: 'timeout', costo: 0,
                  turnos: null, denegaciones: [], resultado: '', sesion: null,
                  error: `supero su timeout de ${minutos} min y fue matada` });
        return;
      }

      if (!salida.trim()) {
        resolve({ ok: false, ms, salida, errores,
                  error: `"${adaptador.cmd}" salio con codigo ${codigo} y no escribio nada` });
        return;
      }
      let leido;
      try {
        leido = adaptador.parse(salida, codigo);
      } catch (error) {
        resolve({ ok: false, ms, salida, errores,
                  error: `no pude leer la salida de "${adaptador.cmd}": ${error.message}` });
        return;
      }
      resolve({ ...leido, ms, salida, errores, codigo,
                error: leido.ok
                  ? null
                  : leido.explicacion || `el agente termino en "${leido.motivo || codigo}"` });
    });

    hijo.stdin.on('error', () => {}); // el hijo puede cerrar stdin antes de tiempo
    hijo.stdin.write(prompt);
    hijo.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Rutas declaradas
// ---------------------------------------------------------------------------

// Una ruta del boceto, resuelta contra el cwd de su tarea y expresada desde la
// raiz del repositorio, sin barra final. La raiz misma se representa con ".".
function normalizarRuta(raiz, tarea, ruta) {
  const absoluta = path.resolve(raiz, tarea.cwd || '.', ruta);
  const relativa = path.relative(raiz, absoluta).split(path.sep).join('/').replace(/\/+$/, '');
  return relativa === '' ? '.' : relativa;
}

function rutasDeclaradas(tareas, raiz) {
  const rutas = [];
  for (const tarea of tareas) {
    for (const ruta of tarea.rutas) rutas.push(normalizarRuta(raiz, tarea, ruta));
  }
  return rutas;
}

// Se solapan si son la misma ruta o si una contiene a la otra. La comparacion es
// por segmento: "app/Models" contiene a "app/Models/Pedido", pero no a
// "app/ModelsViejos", que solo comparte un prefijo de texto.
function seSolapan(a, b) {
  if (a === '.' || b === '.') return true;
  if (a === b) return true;
  return a.startsWith(b + '/') || b.startsWith(a + '/');
}

// Dos vidrios de la misma ola escribiendo en el mismo terreno no producen un
// error: producen perdida silenciosa de trabajo, porque el ultimo en guardar
// pisa al otro y nadie se entera. Se aborta antes de lanzar nada.
//
// Solo importa dentro de una ola. Entre olas distintas el solapamiento es normal
// y a menudo deliberado: una tarea de revision mira "app/" entera despues de que
// otras dos hayan escrito en "app/Models/" y "app/Views/".
function revisarSolapamientos(olas, raiz) {
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

  if (choques.length === 0) return;

  morir('hay tareas de la misma ola escribiendo en el mismo terreno:' +
        choques.map((choque) => `\n        ${choque}`).join(''),
    'corren en paralelo, asi que el ultimo en guardar borra el trabajo del otro\n' +
    '        sin avisar. Separa las rutas, o manda una de las dos a otra ola con "necesita".');
}

function dentroDe(archivo, rutas) {
  return rutas.some((ruta) => {
    if (ruta === '.') return true;
    const limpia = ruta.replace(/\/+$/, '');
    return archivo === limpia || archivo.startsWith(limpia + '/');
  });
}

// ---------------------------------------------------------------------------
// Banderas
// ---------------------------------------------------------------------------

function parsearBanderas(argv) {
  const banderas = { seco: false, solo: null, boceto: null, sinGit: false,
                     rehacer: false, ayuda: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seco') banderas.seco = true;
    else if (arg === '--sin-git') banderas.sinGit = true;
    else if (arg === '--rehacer') banderas.rehacer = true;
    else if (arg === '--solo') banderas.solo = argv[++i];
    else if (arg === '--boceto') banderas.boceto = argv[++i];
    else if (arg === '--ayuda' || arg === '-h' || arg === '--help') banderas.ayuda = true;
    else morir(`no conozco la bandera "${arg}".`,
      'banderas: --seco  --solo <id>  --rehacer  --boceto <archivo>  --sin-git');
  }
  if (banderas.solo === undefined) morir('--solo necesita un id de tarea.');
  if (banderas.boceto === undefined) morir('--boceto necesita una ruta de archivo.');
  return banderas;
}

const AYUDA = `vitral · orquestador de agentes en paralelo

  node vitral.mjs                    corre .vitral/boceto.json
  node vitral.mjs --seco             imprime los prompts sin ejecutar nada
  node vitral.mjs --solo <id>        corre una tarea, saltando las dependencias
                                     que ya tienen handoff en disco
  node vitral.mjs --solo <id> --rehacer   reejecuta tambien las dependencias
  node vitral.mjs --boceto <archivo> usa otro boceto
  node vitral.mjs --sin-git          corre sin repositorio git (peligroso)

el plomo se lee de <directorio del boceto>/plomo/*.md
la salida cruda queda en .vitral/logs/ y los handoffs en .vitral/handoffs/`;

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

async function principal() {
  const banderas = parsearBanderas(process.argv.slice(2));
  if (banderas.ayuda) { imprimir(AYUDA); return; }

  const raiz = process.cwd();
  const rutaBoceto = banderas.boceto || path.join('.vitral', 'boceto.json');

  // --- guardarrail: los agentes escriben sin pedir permiso ---
  const repo = hayGit(raiz);
  const rama = repo ? ramaActual(raiz) : null;

  if (!banderas.seco) {
    if (!repo) {
      if (!banderas.sinGit) {
        morir('esto no es un repositorio git, asi que no puedo saber en que rama estas.',
          'los agentes van a escribir archivos sin pedir permiso y no habria como deshacerlo.\n        ' +
          'corre `git init` y crea una rama de trabajo, o pasa --sin-git si sabes lo que haces');
      }
      advertir('corriendo con --sin-git: no hay repositorio, no hay red de seguridad, no hay vuelta atras');
    } else if (rama === 'main' || rama === 'master') {
      morir(`estas en la rama "${rama}".`,
        'los agentes escriben archivos sin pedir permiso y no quieres eso en tu rama principal.\n        ' +
        `crea una rama antes: git checkout -b trabajo/${path.basename(rutaBoceto, '.json')}`);
    }
  } else if (repo && (rama === 'main' || rama === 'master')) {
    advertir(`estas en la rama "${rama}"; sin --seco esto abortaria`);
  } else if (!repo) {
    advertir('esto no es un repositorio git; sin --seco esto abortaria, o exigiria --sin-git');
  }

  // --- boceto, plomo, olas ---
  const boceto = leerBoceto(rutaBoceto);
  const plomo = leerPlomo(path.join(path.dirname(rutaBoceto), 'plomo'));

  let tareas = boceto.tareas;
  if (banderas.solo) tareas = cerrarDependencias(tareas, banderas.solo);

  const dirLogs = path.join(raiz, '.vitral', 'logs');
  const dirHandoffs = path.join(raiz, '.vitral', 'handoffs');

  // --- lo que dejaron corridas anteriores ---
  // Se separan los dos mapas: un handoff de verdad no es lo mismo que la marca de
  // una tarea que se corto, y confundirlos borraria marcas que todavia hacen falta.
  const handoffs = new Map();
  const incompletos = new Map();
  const fechaHandoff = new Map();
  for (const tarea of tareas) {
    const bueno = path.join(dirHandoffs, `${tarea.id}.md`);
    const marca = path.join(dirHandoffs, `${tarea.id}.INCOMPLETO.md`);
    if (existsSync(bueno)) {
      handoffs.set(tarea.id, readFileSync(bueno, 'utf8').trim());
      fechaHandoff.set(tarea.id, statSync(bueno).mtime);
    } else if (existsSync(marca)) {
      incompletos.set(tarea.id, readFileSync(marca, 'utf8').trim());
    }
  }

  // --- que se ejecuta y que se salta ---
  // El caso normal de --solo es "esta tarea fallo, relanzala", no "reconstruye
  // todo desde cero". Una dependencia que ya dejo handoff esta hecha: repetirla
  // cuesta dinero y sobrescribe trabajo que estaba bien. Se salta y se reusa su
  // handoff. Una marca INCOMPLETO no cuenta: esa tarea quedo a medias.
  const saltadas = banderas.solo && !banderas.rehacer
    ? tareas.filter((t) => t.id !== banderas.solo && handoffs.has(t.id))
    : [];
  const saltadasIds = new Set(saltadas.map((t) => t.id));
  const ejecutan = tareas.filter((t) => !saltadasIds.has(t.id));

  const olas = calcularOlas(ejecutan, saltadasIds);
  revisarSolapamientos(olas, raiz);

  // --- cabecera ---
  const pesoPlomo = Buffer.byteLength(plomo.texto, 'utf8');
  const cuentaPlomo = plomo.archivos.length === 1 ? '1 archivo' : `${plomo.archivos.length} archivos`;
  imprimir('');
  imprimir(`${C.fuerte}vitral${C.fin} · ${boceto.nombre}`);
  imprimir(`${C.tenue}boceto ${rutaBoceto} · rama ${rama || 'sin git'} · ` +
           `plomo ${cuentaPlomo} (${(pesoPlomo / 1024).toFixed(1)} KB) · ` +
           `olas ${olas.map((ola) => ola.length).join(' -> ')}${C.fin}`);
  if (banderas.solo) {
    const cuenta = [`${ejecutan.length} ${ejecutan.length === 1 ? 'tarea' : 'tareas'}`];
    if (saltadas.length > 0) {
      cuenta.push(`${saltadas.length} ${saltadas.length === 1 ? 'saltada' : 'saltadas'} ` +
                  '(handoff en disco)');
    }
    if (banderas.rehacer) cuenta.push('--rehacer: no se salta nada');
    imprimir(`${C.tenue}--solo ${banderas.solo}: ${cuenta.join(', ')}${C.fin}`);
  }

  // El tope se comprueba entre turnos, asi que se rebasa por lo que cueste el
  // turno en curso. Medido: con tope de $0.01 el agente paro, pero gasto $0.09.
  // Declarar presupuesto para un agente que no sabe respetarlo es creerse
  // protegido sin estarlo. Ahi el unico freno es el timeout.
  const sinTope = ejecutan.filter((t) => t.presupuesto && !AGENTES[t.agente].presupuestoSoportado);
  if (sinTope.length > 0) {
    advertir(`${sinTope.map((t) => `"${t.id}"`).join(', ')} declara presupuesto, pero el ` +
      `agente "${sinTope[0].agente}" no tiene tope de gasto: se ignora.\n` +
      `       Su unico freno es el timeout (${sinTope[0].timeout || TIMEOUT_MINUTOS} min).`);
  }

  const apretadas = ejecutan.filter((t) =>
    t.presupuesto && t.presupuesto < PISO_PRESUPUESTO && AGENTES[t.agente].presupuestoSoportado);
  if (apretadas.length > 0) {
    advertir(`presupuesto por debajo de $${PISO_PRESUPUESTO} en ` +
      `${apretadas.map((t) => `"${t.id}" ($${t.presupuesto})`).join(', ')}: ` +
      'el tope se comprueba entre turnos, no durante,\n' +
      '       asi que el gasto real puede ser varias veces el declarado. ' +
      'Sirve de techo de seguridad, no de control fino.');
  }

  // Relanzar una tarea que ya corrio es escribir encima de lo que dejo. Pasa con
  // --rehacer, que se escribe a proposito, y pasa sobre todo al repetir
  // "node vitral.mjs" a secas despues de un fallo parcial, que se lanza por
  // costumbre y sin pensarlo. El segundo caso es el peligroso.
  if (repo && !banderas.seco) {
    const sucio = [...estadoGit(raiz)].filter((linea) => !archivoDeLinea(linea).startsWith('.vitral/'));
    const pisadas = ejecutan.filter((tarea) => {
      if (!handoffs.has(tarea.id) && !incompletos.has(tarea.id)) return false;
      const suyas = rutasDeclaradas([tarea], raiz);
      return sucio.some((linea) => dentroDe(archivoDeLinea(linea), suyas));
    });
    if (pisadas.length > 0) {
      const quien = banderas.rehacer ? '--rehacer va a relanzar' : 'esta corrida va a relanzar';
      const cola = pisadas.length === 1
        ? 'que ya corrio antes y tiene archivos suyos en el arbol de trabajo.\n' +
          '       El agente va a escribir encima de ellos.'
        : 'que ya corrieron antes y tienen archivos suyos en el arbol de trabajo.\n' +
          '       Los agentes van a escribir encima de ellos.';
      advertir(`${quien} ${pisadas.map((t) => `"${t.id}"`).join(', ')}, ${cola} ` +
        'Conviene tener un commit antes.');
    }
  }
  imprimir('');

  const anchoTodas = Math.max(...tareas.map((t) => t.id.length));
  for (const tarea of saltadas) {
    const fecha = fechaHandoff.get(tarea.id);
    imprimir(`  ${C.tenue}~${C.fin} ${tarea.id.padEnd(anchoTodas)}  ${C.cian}saltada${C.fin}  ` +
             `${C.tenue}handoff del ${fechaCorta(fecha)}${C.fin}`);
  }
  if (saltadas.length > 0) imprimir('');

  const handoffsDe = (tarea) => (tarea.necesita || []).map((id) => {
    if (handoffs.has(id)) return { id, estado: 'ok', contenido: handoffs.get(id) };
    if (incompletos.has(id)) {
      return { id, estado: 'incompleto', contenido: AVISO_INCOMPLETO(id, incompletos.get(id)) };
    }
    return { id, estado: 'ausente', contenido: AVISO_SIN_HANDOFF(id) };
  });

  // --- modo seco ---
  if (banderas.seco) {
    for (const [indice, ola] of olas.entries()) {
      for (const tarea of ola) {
        const prompt = construirPrompt(tarea, plomo.texto, handoffsDe(tarea));
        imprimir(`${C.cian}${'='.repeat(78)}${C.fin}`);
        imprimir(`${C.cian}prompt · ola ${indice + 1} · ${tarea.id} · agente ${tarea.agente}` +
                 ` · ${Buffer.byteLength(prompt, 'utf8')} bytes${C.fin}`);
        imprimir(`${C.cian}${'='.repeat(78)}${C.fin}`);
        imprimir('');
        imprimir(prompt);
        imprimir('');
      }
    }
    imprimir(`${C.tenue}modo seco: no se ejecuto nada.${C.fin}`);
    imprimir('');
    return;
  }

  // --- ejecucion ---
  mkdirSync(dirLogs, { recursive: true });
  mkdirSync(dirHandoffs, { recursive: true });

  const estadoAntes = repo ? estadoGit(raiz) : new Set();
  const ancho = Math.max(...ejecutan.map((t) => t.id.length));
  let costoTotal = 0;
  const arranque = Date.now();

  for (const [indice, ola] of olas.entries()) {
    imprimir(`${C.fuerte}ola ${indice + 1}/${olas.length}${C.fin}${C.tenue} · ` +
             `${ola.length === 1 ? '1 vidrio' : `${ola.length} vidrios en paralelo`}${C.fin}`);

    for (const tarea of ola) {
      imprimir(`  ${C.tenue}->${C.fin} ${tarea.id.padEnd(ancho)}  ` +
               `${C.tenue}${tarea.agente}  ${tarea.rutas.join(', ')}${C.fin}`);
    }

    // Sin esto son minutos de silencio absoluto y no hay forma de saber si los
    // agentes siguen vivos. Una linea por tarea en curso, una vez por minuto.
    const enCurso = new Map();
    const latido = setInterval(() => {
      const ahora = Date.now();
      for (const [id, desde] of enCurso) {
        imprimir(`  ${C.tenue}·  ${id.padEnd(ancho)}  en curso  ` +
                 `${formatearDuracion(ahora - desde)}${C.fin}`);
      }
    }, LATIDO_MS);

    const resultados = await Promise.all(ola.map(async (tarea) => {
      const prompt = construirPrompt(tarea, plomo.texto, handoffsDe(tarea));
      enCurso.set(tarea.id, Date.now());
      const resultado = await ejecutarVidrio(tarea, prompt, raiz);
      enCurso.delete(tarea.id);

      writeFileSync(path.join(dirLogs, `${tarea.id}.json`), JSON.stringify({
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

      const marcaIncompleta = path.join(dirHandoffs, `${tarea.id}.INCOMPLETO.md`);
      const handoff = resultado.resultado ? extraerHandoff(resultado.resultado) : null;
      let dejoHandoff = false;
      if (handoff) {
        writeFileSync(path.join(dirHandoffs, `${tarea.id}.md`), handoff + '\n');
        handoffs.set(tarea.id, handoff);
        dejoHandoff = true;
      } else if (resultado.ok && resultado.resultado) {
        // Sin bloque Handoff se guarda la respuesta entera: peor, pero no vacio.
        writeFileSync(path.join(dirHandoffs, `${tarea.id}.md`), resultado.resultado.trim() + '\n');
        handoffs.set(tarea.id, resultado.resultado.trim());
        dejoHandoff = true;
      }

      let rutaMarca = null;
      if (resultado.motivo === 'error_max_budget_usd' || resultado.motivo === 'timeout') {
        rutaMarca = escribirMarcaIncompleta(dirHandoffs, tarea, resultado);
        incompletos.set(tarea.id, readFileSync(rutaMarca, 'utf8').trim());
      } else if (dejoHandoff) {
        // Esta corrida si dejo handoff: la marca de una anterior ya sobra.
        incompletos.delete(tarea.id);
        if (existsSync(marcaIncompleta)) unlinkSync(marcaIncompleta);
      }

      costoTotal += resultado.costo || 0;

      const etiqueta = resultado.ok ? `${C.verde}ok${C.fin}` : `${C.rojo}FALLO${C.fin}`;
      const extras = [formatearDuracion(resultado.ms), formatearCosto(resultado.costo)];
      if (resultado.turnos != null) extras.push(`${resultado.turnos} turnos`);
      if (resultado.denegaciones && resultado.denegaciones.length > 0) {
        extras.push(`${C.amarillo}${resultado.denegaciones.length} permisos denegados${C.fin}`);
      }
      if (resultado.ok && !handoff) extras.push(`${C.amarillo}sin bloque Handoff${C.fin}`);
      imprimir(`  ${C.tenue}<-${C.fin} ${tarea.id.padEnd(ancho)}  ${etiqueta}  ` +
               `${C.tenue}${extras.join('  ')}${C.fin}`);
      if (!resultado.ok) imprimir(`     ${C.rojo}${resultado.error}${C.fin}`);
      if (rutaMarca) {
        imprimir(`     ${C.tenue}rastro en ` +
                 `${path.relative(raiz, rutaMarca).split(path.sep).join('/')}${C.fin}`);
      }

      return { tarea, resultado };
    }));

    clearInterval(latido);
    imprimir('');

    const fallidas = resultados.filter(({ resultado }) => !resultado.ok);
    if (fallidas.length > 0) {
      const ids = fallidas.map(({ tarea }) => `"${tarea.id}"`).join(', ');
      const logs = fallidas.map(({ tarea }) => path.join('.vitral', 'logs', `${tarea.id}.json`)).join(', ');
      process.stderr.write(`${C.rojo}vitral: fallo ${ids} en la ola ${indice + 1}. ` +
        `Me detengo aqui: las olas siguientes no se ejecutan.${C.fin}\n`);
      process.stderr.write(`        ${C.tenue}el detalle esta en ${logs}${C.fin}\n`);
      process.stderr.write(`        ${C.tenue}lo que ya escribieron los otros vidrios sigue ` +
        `en el arbol de trabajo${C.fin}\n`);
      process.exit(1);
    }
  }

  // --- resumen ---
  imprimir(`${C.fuerte}resumen${C.fin}`);
  imprimir(`  ${'costo total'.padEnd(14)}${formatearCosto(costoTotal)}` +
           `${C.tenue}  en ${formatearDuracion(Date.now() - arranque)}${C.fin}`);

  if (!repo) {
    imprimir(`  ${'cambios'.padEnd(14)}${C.tenue}sin git: no puedo decirte que cambio${C.fin}`);
    imprimir('');
    return;
  }

  const diff = git(['diff', '--stat'], raiz);
  if (diff) {
    imprimir(`  ${'cambios'.padEnd(14)}`);
    for (const linea of diff.split('\n')) imprimir(`    ${C.tenue}${linea.trim()}${C.fin}`);
  } else {
    imprimir(`  ${'cambios'.padEnd(14)}${C.tenue}ningun archivo rastreado modificado${C.fin}`);
  }

  // Lo que cambio esta corrida: se descuenta lo que ya estaba sucio al empezar.
  const nuevasLineas = [...estadoGit(raiz)]
    .filter((linea) => !estadoAntes.has(linea))
    .filter((linea) => !archivoDeLinea(linea).startsWith('.vitral/'));

  // `git diff --stat` no ve los archivos nuevos, y los agentes crean archivos.
  const sinRastrear = nuevasLineas
    .filter((linea) => linea.startsWith('??'))
    .map(archivoDeLinea);
  if (sinRastrear.length > 0) {
    imprimir(`  ${'nuevos'.padEnd(14)}${C.tenue}${sinRastrear.length} archivo(s) sin rastrear${C.fin}`);
    for (const archivo of sinRastrear.slice(0, 10)) imprimir(`    ${C.tenue}${archivo}${C.fin}`);
    if (sinRastrear.length > 10) {
      imprimir(`    ${C.tenue}y ${sinRastrear.length - 10} mas${C.fin}`);
    }
  }

  const declaradas = rutasDeclaradas(ejecutan, raiz);
  const tocados = nuevasLineas.map(archivoDeLinea);
  const fuera = tocados.filter((archivo) => !dentroDe(archivo, declaradas));

  if (fuera.length === 0) {
    imprimir(`  ${'fuera de ruta'.padEnd(14)}${C.tenue}nada${C.fin}`);
  } else {
    imprimir(`  ${'fuera de ruta'.padEnd(14)}${C.amarillo}${fuera.length} archivo(s) ` +
             `fuera de lo declarado${C.fin}`);
    for (const archivo of fuera) imprimir(`    ${C.amarillo}${archivo}${C.fin}`);
  }
  imprimir('');
}

principal().catch((error) => {
  morir(error.message, error.stack ? error.stack.split('\n')[1].trim() : null);
});
