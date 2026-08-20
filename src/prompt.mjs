// Todo el texto que lee un agente, y el bloque que devuelve.
//
// Este modulo es texto puro: no lee ni escribe archivos, no imprime, no ejecuta
// nada. Recibe la tarea, el plomo ya leido, los handoffs ya cargados y los ids de
// los companeros de ola, y arma una cadena.
//
// extraerHandoff() vive aqui a proposito: el modulo que le dice al agente "cierra
// con ## Handoff" es el que sabe encontrarlo. Si cambia el formato, cambia en un
// solo archivo.

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

// Que se le inyecta a una tarea sobre aquellas de las que depende. Los dos mapas
// vienen de registro.mjs; aqui solo se decide como se cuenta cada caso.
export function handoffsDe(tarea, handoffs, incompletos) {
  return (tarea.necesita || []).map((id) => {
    if (handoffs.has(id)) return { id, estado: 'ok', contenido: handoffs.get(id) };
    if (incompletos.has(id)) {
      return { id, estado: 'incompleto', contenido: AVISO_INCOMPLETO(id, incompletos.get(id)) };
    }
    return { id, estado: 'ausente', contenido: AVISO_SIN_HANDOFF(id) };
  });
}

// `"a"`, `"a" y "b"`, `"a", "b" y "c"`. Sin coma antes de la "y".
const listarIds = (ids) => {
  const entrecomillados = ids.map((id) => `"${id}"`);
  if (entrecomillados.length === 1) return entrecomillados[0];
  return `${entrecomillados.slice(0, -1).join(', ')} y ${entrecomillados[entrecomillados.length - 1]}`;
};

// Afirmar que hay otros agentes cuando no los hay no es inofensivo: un vidrio solo
// en su ola se explica sus propias reescrituras buscando un segundo autor que no
// existe. Por eso el parrafo se bifurca segun cuantos companeros tenga de verdad.
const PARRAFO_COMPANEROS = (companeros) => {
  if (companeros.length === 0) {
    return (
`Estas trabajando dentro de un vitral, pero eres el unico agente de esta ola: nadie
mas esta escribiendo en este repositorio mientras trabajas. Si un archivo cambia
bajo tus pies, has sido tu.`);
  }

  if (companeros.length === 1) {
    return (
`Estas trabajando dentro de un vitral: compartes esta ola con otro agente, ${listarIds(companeros)},
que esta editando este mismo repositorio en paralelo ahora mismo, en su propia tarea.
El codigo que tienes al lado puede estar cambiando mientras trabajas.`);
  }

  return (
`Estas trabajando dentro de un vitral: compartes esta ola con otros ${companeros.length} agentes,
${listarIds(companeros)}, que estan editando este mismo repositorio en paralelo
ahora mismo, cada uno en su propia tarea. El codigo que tienes al lado puede estar
cambiando mientras trabajas.`);
};

// Fuera de sus rutas manda el reparto igual, pero el motivo no es el mismo cuando
// no hay nadie mas escribiendo.
const FRASE_RUTAS = (companeros) => (companeros.length > 0
  ? 'Esos archivos son de otro agente y tus cambios chocarian con los suyos.'
  : `Nadie mas esta escribiendo ahora mismo, pero las rutas no son una sugerencia: son
el reparto que decidio quien planifico la tanda.`);

// `companeros` son los ids de las OTRAS tareas de la misma ola, sin la propia. El
// valor por defecto es el texto verdadero de una llamada suelta: un llamador que
// lo olvide dice "estas solo", que nunca inventa companeros.
export function construirPrompt(tarea, plomo, handoffs, companeros = []) {
  const bloques = [];

  bloques.push(
`# Vitral · tarea "${tarea.id}"

${PARRAFO_COMPANEROS(companeros)}

No hay a quien preguntarle: no puedes hablar con nadie ni esperar respuesta de
nadie.

Todo lo que necesitas para encajar ya esta escrito abajo, en el plomo. Si algo no
esta en el plomo, decidelo tu por la via mas conservadora y anotalo en tu handoff.
Nunca esperes, nunca preguntes, nunca te quedes a medias.`);

  bloques.push(
`## El plomo · contrato compartido · fuente de verdad obligatoria

Esto se acordo antes de que nadie tocara codigo, y es obligatorio. Nombres de
campos, forma de los JSON, rutas y metodos de los endpoints se respetan al pie de
la letra, aunque te parezcan mejorables. Si tu codigo y el plomo no coinciden, el
que esta mal es tu codigo.

Programa contra el plomo aunque la pieza que tiene que encajar con la tuya todavia
no exista.

${plomo || '(no hay contratos declarados: no existe el directorio plomo/ o esta vacio)'}`);

  bloques.push(
`## Tu tarea

${tarea.prompt}`);

  bloques.push(
`## Tus rutas

Solo puedes crear o modificar archivos dentro de:

${tarea.rutas.map((ruta) => `- ${ruta}`).join('\n')}

Fuera de ahi puedes leer todo lo que quieras, pero no escribir nada.
${FRASE_RUTAS(companeros)}
Si crees que hace falta tocar algo fuera de tus rutas, no lo toques: anotalo en tu
handoff, en "Necesito de otros". Al final de la corrida se revisa si algo quedo
fuera de lo declarado.`);

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

Cierra tu respuesta con este bloque, con estos cuatro campos y ningun otro.
Lo van a leer las tareas que vengan despues de ti y la persona que revise la
corrida, asi que se concreto: nombres de archivos, nombres de campos, rutas reales.

## Handoff

**Hice:** que archivos tocaste y que quedo funcionando.
**Decidi:** lo que el plomo no decia y tuviste que resolver tu.
**Me desvie:** donde te apartaste del plomo y por que. Escribe "en nada" si no paso.
**Necesito de otros:** lo que queda pendiente en manos ajenas, o "nada".`);

  return bloques.join('\n\n');
}

// El agente puede repetir la plantilla del prompt, asi que vale el ultimo bloque.
export function extraerHandoff(texto) {
  const encabezados = [...texto.matchAll(/^#{1,6}[ \t]*handoff[ \t]*$/gim)];
  if (encabezados.length === 0) return null;
  const ultimo = encabezados[encabezados.length - 1];
  return texto.slice(ultimo.index).trim();
}
