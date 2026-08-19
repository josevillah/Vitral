// El bucle: que se le manda a cada vidrio y que se hace con lo que devuelve.
//
// Las olas van en serie y las tareas de una ola en paralelo. Si alguna falla, la
// corrida se detiene ahi: las olas siguientes no se lanzan.
//
// ensayar() y ejecutarOlas() comparten el armado del prompt a proposito. Si el
// modo seco tuviera su propio camino, podria mentir sobre lo que se va a
// ejecutar de verdad.
//
// El latido vive aqui y solo aqui: este es el unico modulo que sabe que existe
// una ola y que vidrios siguen en vuelo. proceso.mjs ejecuta uno y no sabe de
// olas; salida.mjs sabe pintar la linea pero no cuando toca.

import { readFileSync } from 'node:fs';

import * as salida from './salida.mjs';
import { construirPrompt, extraerHandoff, handoffsDe } from './prompt.mjs';
import { ejecutarVidrio } from './proceso.mjs';
import {
  borrarMarcaIncompleta, escribirMarcaIncompleta, guardarHandoff, guardarLog,
} from './registro.mjs';

// Cada cuanto decir que las tareas en curso siguen vivas.
const LATIDO_MS = 60_000;

const promptDe = (tarea, plan) =>
  construirPrompt(tarea, plan.plomo.texto, handoffsDe(tarea, plan.handoffs, plan.incompletos));

// Sin esto son minutos de silencio absoluto y no hay forma de saber si los
// agentes siguen vivos. Queda encerrado en una sola pieza para que nadie tenga
// que reinventar el registro de quien esta en vuelo.
function abrirLatido(ancho) {
  const enCurso = new Map();
  const reloj = setInterval(() => {
    const ahora = Date.now();
    for (const [id, desde] of enCurso) salida.lineaLatido(id, ancho, ahora - desde);
  }, LATIDO_MS);

  return {
    empieza: (id) => enCurso.set(id, Date.now()),
    termina: (id) => enCurso.delete(id),
    cerrar: () => clearInterval(reloj),
  };
}

// --seco: los mismos prompts que se enviarian, sin enviar nada.
export function ensayar(plan) {
  for (const [indice, ola] of plan.olas.entries()) {
    for (const tarea of ola) salida.imprimirPrompt(indice, tarea, promptDe(tarea, plan));
  }
  salida.finEnsayo();
}

export async function ejecutarOlas(plan) {
  const { raiz, olas, ejecutan } = plan;
  const ancho = Math.max(...ejecutan.map((t) => t.id.length));
  let costoTotal = 0;

  for (const [indice, ola] of olas.entries()) {
    salida.cabeceraOla(indice, olas.length, ola.length);
    for (const tarea of ola) salida.lineaArranque(tarea, ancho);

    const latido = abrirLatido(ancho);

    const resultados = await Promise.all(ola.map(async (tarea) => {
      const prompt = promptDe(tarea, plan);

      latido.empieza(tarea.id);
      const resultado = await ejecutarVidrio(tarea, prompt, raiz);
      latido.termina(tarea.id);

      guardarLog(raiz, tarea, prompt, resultado);

      const handoff = resultado.resultado ? extraerHandoff(resultado.resultado) : null;
      let dejoHandoff = false;
      if (handoff) {
        guardarHandoff(raiz, tarea.id, handoff);
        plan.handoffs.set(tarea.id, handoff);
        dejoHandoff = true;
      } else if (resultado.ok && resultado.resultado) {
        // Sin bloque Handoff se guarda la respuesta entera: peor, pero no vacio.
        guardarHandoff(raiz, tarea.id, resultado.resultado.trim());
        plan.handoffs.set(tarea.id, resultado.resultado.trim());
        dejoHandoff = true;
      }

      let rutaMarca = null;
      if (resultado.motivo === 'error_max_budget_usd' || resultado.motivo === 'timeout') {
        rutaMarca = escribirMarcaIncompleta(raiz, tarea, resultado);
        plan.incompletos.set(tarea.id, readFileSync(rutaMarca, 'utf8').trim());
      } else if (dejoHandoff) {
        // Esta corrida si dejo handoff: la marca de una anterior ya sobra.
        plan.incompletos.delete(tarea.id);
        borrarMarcaIncompleta(raiz, tarea.id);
      }

      costoTotal += resultado.costo || 0;
      salida.lineaCierre({ tarea, ancho, resultado, huboHandoff: Boolean(handoff), rutaMarca, raiz });

      return { tarea, resultado };
    }));

    latido.cerrar();
    salida.finOla();

    const fallidas = resultados.filter(({ resultado }) => !resultado.ok);
    if (fallidas.length > 0) return { costoTotal, fallidas, ola: indice };
  }

  return { costoTotal, fallidas: [], ola: null };
}
