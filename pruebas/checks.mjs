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
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Corre vitral y devuelve lo que dijo. stdout y stderr van juntos porque los
// checks miran el mensaje, no por donde salio.
function vitral(cwd, ...args) {
  const r = spawnSync(process.execPath, [path.join(raiz, 'vitral.mjs'), ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { codigo: r.status, texto: (r.stdout || '') + (r.stderr || '') };
}

const cuenta = (texto, patron) => (texto.match(patron) || []).length;

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
];

// ---------------------------------------------------------------------------
// Correr
// ---------------------------------------------------------------------------

function limpiar() {
  try {
    rmSync(taller, { recursive: true, force: true, maxRetries: 5 });
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
