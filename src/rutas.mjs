// Rutas declaradas por las tareas: normalizarlas y compararlas entre si.
//
// Todo aqui es logica pura sobre cadenas. Este modulo no toca el disco, no
// pregunta a git y no decide nada: no sabe si un solapamiento es grave. Quien
// juzga es guardarrailes.mjs.

import path from 'node:path';

// Una ruta del boceto, resuelta contra el cwd de su tarea y expresada desde la
// raiz del repositorio, sin barra final. La raiz misma se representa con ".".
export function normalizarRuta(raiz, tarea, ruta) {
  const absoluta = path.resolve(raiz, tarea.cwd || '.', ruta);
  const relativa = path.relative(raiz, absoluta).split(path.sep).join('/').replace(/\/+$/, '');
  return relativa === '' ? '.' : relativa;
}

export function rutasDeclaradas(tareas, raiz) {
  const rutas = [];
  for (const tarea of tareas) {
    for (const ruta of tarea.rutas) rutas.push(normalizarRuta(raiz, tarea, ruta));
  }
  return rutas;
}

// Se solapan si son la misma ruta o si una contiene a la otra. La comparacion es
// por segmento: "app/Models" contiene a "app/Models/Pedido", pero no a
// "app/ModelsViejos", que solo comparte un prefijo de texto.
export function seSolapan(a, b) {
  if (a === '.' || b === '.') return true;
  if (a === b) return true;
  return a.startsWith(b + '/') || b.startsWith(a + '/');
}

export function dentroDe(archivo, rutas) {
  return rutas.some((ruta) => {
    if (ruta === '.') return true;
    const limpia = ruta.replace(/\/+$/, '');
    return archivo === limpia || archivo.startsWith(limpia + '/');
  });
}
