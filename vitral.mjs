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
import {
  cargarHandoffs, guardarCorrida, leerCorrida, leerHistorial, prepararRegistro,
} from './src/registro.mjs';
import { dentroDe, rutasDeclaradas } from './src/rutas.mjs';
import * as salida from './src/salida.mjs';

function parsearBanderas(argv) {
  const banderas = { seco: false, solo: null, boceto: null, sinGit: false,
                     rehacer: false, ayuda: false,
                     historial: false, historialArg: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seco') banderas.seco = true;
    // --historial lleva argumento opcional: si lo siguiente es otra bandera, o
    // no hay nada, se pide la lista por defecto.
    else if (arg === '--historial') {
      banderas.historial = true;
      const siguiente = argv[i + 1];
      if (siguiente !== undefined && !siguiente.startsWith('--')) banderas.historialArg = argv[++i];
    }
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

// --historial es una consulta, no una corrida: no lee el boceto, no comprueba la
// rama y no escribe nada. Un argumento de solo digitos es "cuantas corridas
// quiero"; cualquier otra cosa es un id, que siempre lleva guion.
function consultarHistorial(raiz, arg) {
  if (arg !== null && !/^\d+$/.test(arg)) {
    // "encontrada" y no "corrida": aqui arriba `corrida` es el modulo del motor.
    const encontrada = leerCorrida(raiz, arg);
    if (!encontrada) {
      throw new ErrorVitral(`no hay ninguna corrida con id "${arg}".`,
        'listalas con --historial');
    }
    salida.detalleCorrida(encontrada);
    return 0;
  }

  const corridas = leerHistorial(raiz, arg === null ? 10 : Number(arg));
  if (corridas.length === 0) salida.historialVacio();
  else salida.listaHistorial(corridas);
  return 0;
}

// Lo que queda escrito de una corrida que ya termino, bien o mal. Se arma aqui
// porque es el unico sitio que ve las dos mitades: lo que devolvio el motor y lo
// que dice git del arbol de trabajo. El id y la fecha los sella el registro.
function registroDeCorrida(
  { rutaBoceto, boceto, rama, banderas, olas, saltadas },
  { costoTotal, fallidas, resultados, duracionMs, cambios, fuera },
) {
  return {
    boceto: rutaBoceto,
    nombre: boceto.nombre,
    rama,
    banderas: { solo: banderas.solo, rehacer: banderas.rehacer, sinGit: banderas.sinGit },
    ok: fallidas.length === 0,
    duracionMs,
    costo: costoTotal,
    olas: olas.map((ola) => ola.length),
    tareas: resultados.map(({ tarea, resultado }) => ({
      id: tarea.id,
      agente: tarea.agente,
      modelo: tarea.modelo || null,
      ok: Boolean(resultado.ok),
      ms: resultado.ms,
      costo: resultado.costo || 0,
      turnos: resultado.turnos ?? null,
      motivo: resultado.motivo || null,
      error: resultado.error || null,
      // Cuantas hubo basta: el detalle ya esta en el log de la tarea.
      denegaciones: (resultado.denegaciones || []).length,
      sesion: resultado.sesion || null,
    })),
    saltadas: saltadas.map((tarea) => tarea.id),
    cambios: {
      archivos: cambios.tocados,
      sinRastrear: cambios.sinRastrear.length,
      fueraDeRuta: fuera,
    },
  };
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
  if (banderas.historial) return consultarHistorial(raiz, banderas.historialArg);

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

  const { costoTotal, fallidas, ola, resultados } = await corrida.ejecutarOlas(plan);
  const duracionMs = Date.now() - arranque;

  // Se le pregunta a git antes de decidir nada, tambien cuando la corrida fallo:
  // esa es justo la que mas interesa consultar despues, y sin esto el historial
  // no sabria que archivos quedaron tocados a medias. La corrida fallida no
  // imprime resumen, solo lo guarda.
  const cambios = repo ? git.cambiosDesde(raiz, estadoAntes) : { tocados: [], sinRastrear: [] };
  const declaradas = rutasDeclaradas(ejecutan, raiz);
  const fuera = cambios.tocados.filter((archivo) => !dentroDe(archivo, declaradas));
  const diff = repo ? git.diffStat(raiz) : null;

  guardarCorrida(raiz, registroDeCorrida(
    { rutaBoceto, boceto, rama, banderas, olas, saltadas },
    { costoTotal, fallidas, resultados, duracionMs, cambios, fuera },
  ));

  if (fallidas.length > 0) {
    salida.avisoFallo(fallidas, ola);
    return 1;
  }

  salida.resumen({
    costoTotal,
    ms: duracionMs,
    repo,
    diff,
    sinRastrear: cambios.sinRastrear,
    fuera,
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
