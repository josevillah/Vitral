// Lanzar un agente y traerse lo que devuelva.
//
// Este modulo sabe de procesos del sistema operativo: como se arranca un CLI en
// Windows y en POSIX, como se le pasa el prompt, y como se le mata si no
// termina. No interpreta la salida —eso es parse() del adaptador— y no sabe que
// existan las olas ni el latido: ejecuta un vidrio y se acaba su trabajo.

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

import { AGENTES } from './agentes.mjs';

// Un agente que no termina se lleva por delante la ola y la corrida entera, y
// desde fuera no se distingue de uno que esta trabajando bien. Quince minutos es
// holgado para una tarea normal y corta en seco a uno colgado.
export const TIMEOUT_MINUTOS = 15;

// En Windows el hijo directo es cmd.exe, y matarlo deja vivo al agente que lanzo.
// taskkill /T se lleva el arbol entero. En POSIX basta con SIGKILL al proceso.
function matarArbol(hijo) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    hijo.kill('SIGKILL');
  }
}

export function ejecutarVidrio(tarea, prompt, raiz) {
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
