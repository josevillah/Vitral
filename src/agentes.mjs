// Adaptadores de agente.
//
// Este es el unico modulo que conoce los flags y el formato de salida de cada
// CLI. Anadir un agente nuevo es anadir una entrada aqui, nada mas.
//
// Cada entrada declara:
//   cmd                   el ejecutable
//   presupuestoSoportado  si el CLI sabe cortarse solo al llegar a un tope
//   salidaEnStreaming     si escribe segun trabaja o de una sola vez al final
//   args(tarea)           los argumentos, sin el prompt: eso va por stdin
//   parse(salida, codigo) lo que devolvio, en la forma comun de abajo
//
// parse() devuelve siempre:
//   { ok, resultado, sesion, costo, turnos, denegaciones, motivo, explicacion, crudo }
//
// Este modulo no lanza procesos ni imprime: solo describe y traduce.

// Por que un agente dejo de trabajar, en cristiano. Los subtype vienen del JSON
// de Claude Code; se traducen aqui para que el fallo se entienda en pantalla.
const MOTIVOS_CLAUDE = {
  error_max_budget_usd:
    'se acabo el presupuesto a mitad de camino: dejo trabajo escrito y no dejo handoff',
  error_during_execution: 'el agente se rompio durante la ejecucion',
  error_max_turns: 'el agente agoto el tope de turnos',
};

export const AGENTES = {
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
