#!/usr/bin/env node
// vitral · orquestador de agentes de IA en paralelo sobre un mismo repositorio.
//
// Varios agentes trabajan a la vez sobre el mismo codigo, cada uno en sus rutas,
// coordinados por un contrato escrito antes de empezar (el plomo). No hablan
// entre ellos mientras trabajan: ya se pusieron de acuerdo.
//
// Node 18+, ESM, cero dependencias.
//
// Este archivo es solo la entrada: lee las banderas, arma el plan y delega. Es
// tambien el unico sitio del programa que llama a process.exit. El motor vive en
// src/, y su contrato esta en .vitral/plomo/motor.md.

import path from 'node:path';

import { leerBoceto, leerPlomo } from './src/boceto.mjs';
import * as corrida from './src/corrida.mjs';
import { ErrorVitral } from './src/errores.mjs';
import * as git from './src/git.mjs';
import * as guardarrailes from './src/guardarrailes.mjs';
import { calcularOlas, cerrarDependencias } from './src/olas.mjs';
import { cargarHandoffs, prepararRegistro } from './src/registro.mjs';
import { dentroDe, rutasDeclaradas } from './src/rutas.mjs';
import * as salida from './src/salida.mjs';

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
    else {
      throw new ErrorVitral(`no conozco la bandera "${arg}".`,
        'banderas: --seco  --solo <id>  --rehacer  --boceto <archivo>  --sin-git');
    }
  }
  if (banderas.solo === undefined) throw new ErrorVitral('--solo necesita un id de tarea.');
  if (banderas.boceto === undefined) throw new ErrorVitral('--boceto necesita una ruta de archivo.');
  return banderas;
}

// Imprime lo que dijeron las comprobaciones y responde si alguna impide lanzar.
function resolver(veredictos) {
  for (const veredicto of veredictos) {
    if (veredicto.nivel === 'aborta') salida.imprimirError(veredicto.mensaje, veredicto.sugerencia);
    else salida.imprimirAviso(veredicto.mensaje);
  }
  return veredictos.some((veredicto) => veredicto.nivel === 'aborta');
}

async function principal() {
  const banderas = parsearBanderas(process.argv.slice(2));
  if (banderas.ayuda) { salida.imprimirAyuda(); return 0; }

  const raiz = process.cwd();
  const rutaBoceto = banderas.boceto || path.join('.vitral', 'boceto.json');

  const repo = git.hayGit(raiz);
  const rama = repo ? git.ramaActual(raiz) : null;
  if (resolver(guardarrailes.revisarRama({ repo, rama, banderas, rutaBoceto }))) return 1;

  const boceto = leerBoceto(rutaBoceto);
  const plomo = leerPlomo(path.join(path.dirname(rutaBoceto), 'plomo'));

  let tareas = boceto.tareas;
  if (banderas.solo) tareas = cerrarDependencias(tareas, banderas.solo);

  const { handoffs, incompletos, fechas } = cargarHandoffs(raiz, tareas);

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
  if (resolver(guardarrailes.revisarSolapamientos(olas, raiz))) return 1;

  salida.cabecera({
    nombre: boceto.nombre,
    rutaBoceto,
    rama,
    plomo,
    olas,
    solo: banderas.solo
      ? { id: banderas.solo, ejecutan: ejecutan.length,
          saltadas: saltadas.length, rehacer: banderas.rehacer }
      : null,
  });

  resolver(guardarrailes.revisarPresupuestos(ejecutan));
  resolver(guardarrailes.revisarSobrescritura(
    { ejecutan, raiz, repo, banderas, handoffs, incompletos }));

  salida.lineasSaltadas(saltadas, Math.max(...tareas.map((t) => t.id.length)), fechas);

  const plan = { raiz, olas, ejecutan, plomo, handoffs, incompletos };

  if (banderas.seco) { corrida.ensayar(plan); return 0; }

  prepararRegistro(raiz);
  const estadoAntes = repo ? git.estadoGit(raiz) : new Set();
  const arranque = Date.now();

  const { costoTotal, fallidas, ola } = await corrida.ejecutarOlas(plan);
  if (fallidas.length > 0) {
    salida.avisoFallo(fallidas, ola);
    return 1;
  }

  const cambios = repo ? git.cambiosDesde(raiz, estadoAntes) : { tocados: [], sinRastrear: [] };
  const declaradas = rutasDeclaradas(ejecutan, raiz);
  salida.resumen({
    costoTotal,
    ms: Date.now() - arranque,
    repo,
    diff: repo ? git.diffStat(raiz) : null,
    sinRastrear: cambios.sinRastrear,
    fuera: cambios.tocados.filter((archivo) => !dentroDe(archivo, declaradas)),
  });
  return 0;
}

principal()
  .then((codigo) => { if (codigo !== 0) process.exit(codigo); })
  .catch((error) => {
    if (error instanceof ErrorVitral) {
      salida.imprimirError(error.message, error.sugerencia);
    } else {
      salida.imprimirError(error.message, error.stack ? error.stack.split('\n')[1].trim() : null);
    }
    process.exit(1);
  });
