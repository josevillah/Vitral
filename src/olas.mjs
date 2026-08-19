// Grafo de dependencias: en que orden pueden correr las tareas.
//
// Logica pura. Este modulo no sabe que es un agente, no toca el disco y no
// imprime. Solo mira "necesita" y agrupa.

import { ErrorVitral } from './errores.mjs';

// Orden topologico por niveles: cada nivel es una ola que corre en paralelo.
// `yaListas` son ids que cuentan como terminados sin estar en `tareas`, porque
// se van a saltar: su handoff ya esta en disco.
export function calcularOlas(tareas, yaListas = new Set()) {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const pendientes = new Set(porId.keys());
  const listas = new Set(yaListas);
  const olas = [];

  while (pendientes.size > 0) {
    const ola = [...pendientes].filter((id) =>
      (porId.get(id).necesita || []).every((dep) => listas.has(dep)));

    if (ola.length === 0) {
      throw new ErrorVitral(
        `dependencia circular entre: ${[...pendientes].sort().join(', ')}.`,
        'ninguna de esas tareas puede empezar porque todas esperan a otra del grupo');
    }

    for (const id of ola) pendientes.delete(id);
    for (const id of ola) listas.add(id);
    olas.push(ola.map((id) => porId.get(id)));
  }

  return olas;
}

// --solo <id>: esa tarea mas todo aquello de lo que depende, en cadena.
export function cerrarDependencias(tareas, id) {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  if (!porId.has(id)) {
    throw new ErrorVitral(`--solo "${id}": no hay ninguna tarea con ese id.`,
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
