// Todo el texto que lee un agente, y el bloque que devuelve.
//
// Este modulo es texto puro: no lee ni escribe archivos, no imprime, no ejecuta
// nada. Recibe la tarea, el plomo ya leido y los handoffs ya cargados, y arma
// una cadena.
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

export function construirPrompt(tarea, plomo, handoffs) {
  const bloques = [];

  bloques.push(
`# Vitral · tarea "${tarea.id}"

Estas trabajando dentro de un vitral: varios agentes editan este mismo repositorio
en paralelo, ahora mismo, cada uno en su propia tarea. No hay a quien preguntarle.
No puedes hablar con los otros agentes ni esperar respuesta de nadie: el codigo que
tienes al lado puede estar cambiando mientras trabajas.

Todo lo que necesitas para encajar con ellos ya esta escrito abajo, en el plomo.
Si algo no esta en el plomo, decidelo tu por la via mas conservadora y anotalo en
tu handoff. Nunca esperes, nunca preguntes, nunca te quedes a medias.`);

  bloques.push(
`## El plomo · contrato compartido · fuente de verdad obligatoria

Esto se acordo antes de que nadie tocara codigo, y es obligatorio. Nombres de
campos, forma de los JSON, rutas y metodos de los endpoints se respetan al pie de
la letra, aunque te parezcan mejorables. Si tu codigo y el plomo no coinciden, el
que esta mal es tu codigo.

Programa contra el plomo aunque la otra mitad todavia no exista.

${plomo || '(no hay contratos declarados: no existe el directorio plomo/ o esta vacio)'}`);

  bloques.push(
`## Tu tarea

${tarea.prompt}`);

  bloques.push(
`## Tus rutas

Solo puedes crear o modificar archivos dentro de:

${tarea.rutas.map((ruta) => `- ${ruta}`).join('\n')}

Fuera de ahi puedes leer todo lo que quieras, pero no escribir nada. Esos archivos
son de otro agente y tus cambios chocarian con los suyos. Si crees que hace falta
tocar algo fuera de tus rutas, no lo toques: anotalo en tu handoff, en "Necesito de
otros". Al final de la corrida se revisa si algo quedo fuera de lo declarado.`);

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

Cierra tu respuesta con este bloque, con estos cuatro campos y ningun otro. Es lo
unico que van a leer los agentes que vengan despues de ti, asi que se concreto:
nombres de archivos, nombres de campos, rutas reales.

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
