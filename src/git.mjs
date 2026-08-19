// Consultas a git. Este modulo solo lee: nunca hace commit, ni add, ni checkout,
// ni toca el indice. Vitral observa el repositorio, no lo modifica.
//
// No imprime y no aborta: devuelve datos, o null cuando git no puede responder.

import { spawnSync } from 'node:child_process';

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.replace(/\s+$/, '');
}

export const hayGit = (raiz) => git(['rev-parse', '--is-inside-work-tree'], raiz) === 'true';

export function ramaActual(raiz) {
  const rama = git(['branch', '--show-current'], raiz);
  if (rama === null) return null;
  return rama === '' ? 'HEAD desprendido' : rama;
}

// Lineas de `git status --porcelain`, tal cual. Se compara el conjunto de antes
// con el de despues para saber que toco esta corrida y no lo que ya estaba sucio.
export function estadoGit(raiz) {
  // -uall es obligatorio: sin el, git colapsa un directorio nuevo entero en una
  // sola linea ("app/") y no se sabria que archivo se creo ni en que ruta cayo.
  const salida = git(['status', '--porcelain', '-uall'], raiz);
  if (salida === null) return new Set();
  return new Set(salida.split('\n').filter(Boolean));
}

export function archivoDeLinea(linea) {
  let ruta = linea.slice(3).trim();
  const flecha = ruta.indexOf(' -> ');           // renombrados: "viejo -> nuevo"
  if (flecha !== -1) ruta = ruta.slice(flecha + 4);
  return ruta.replace(/^"|"$/g, '');
}

export const diffStat = (raiz) => git(['diff', '--stat'], raiz);

// Lo que cambio desde un estado anterior, descontando lo que ya estaba sucio al
// empezar y lo que escribe el propio vitral en .vitral/.
export function cambiosDesde(raiz, estadoAntes) {
  const nuevas = [...estadoGit(raiz)]
    .filter((linea) => !estadoAntes.has(linea))
    .filter((linea) => !archivoDeLinea(linea).startsWith('.vitral/'));

  return {
    tocados: nuevas.map(archivoDeLinea),
    // `git diff --stat` no ve los archivos nuevos, y los agentes crean archivos.
    sinRastrear: nuevas.filter((linea) => linea.startsWith('??')).map(archivoDeLinea),
  };
}
