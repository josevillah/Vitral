# Cierre de la tanda "El motor habla en eventos"

Este archivo es la lista de cierre de **esta** tanda, con los nombres ya
rellenados. No es plomo: vive fuera de `.vitral/plomo/`, asi que no viaja en
ningun prompt y no se paga en ningun vidrio.

**Se borra al cerrar la tanda, junto con el boceto.**

---

## Cuando

Solo despues de que `feat/eventos` este verificada y mergeada a `main`. Antes no:
retirar el plomo de una tanda que todavia puede necesitar otra corrida deja al
siguiente vidrio sin contrato.

## En la rama `chore/retirar-eventos`

La crea la persona, antes de que se toque nada.

1. **Mover** `.vitral/plomo/eventos.md` a `.vitral/plomo/retirados/`, tal cual,
   sin tocar una letra. Con un movimiento de archivo normal, no con `git mv`.
2. **Borrar** `.vitral/boceto.json`.
3. **Borrar** los handoffs de los seis ids de la tanda:
   `emisor`, `veredictos`, `entrada`, `checks`, `documentacion`, `revision`.
   O sea `.vitral/handoffs/<id>.md` y, si quedo alguno,
   `.vitral/handoffs/<id>.INCOMPLETO.md`. **Los logs no se borran.**
4. **Borrar este archivo.**

No hay maquetas: esta tanda no tuvo fase visual.

`.vitral/plomo/motor.md` **no se retira nunca.** Para entonces ya tendra dentro el
catalogo de eventos, y ese es su sitio definitivo.

---

## Lo que hay que decidir en esa sesion, no antes

### 1. El catalogo de eventos y `.vitral/ui/plomo/`

Cuando la tanda cierre, el origen unico del catalogo de eventos sera
`.vitral/plomo/motor.md`. Pero **su unico consumidor es la interfaz, y las tandas
de la interfaz leen su plomo de `.vitral/ui/plomo/`, que no ve `motor.md` jamas**
—el directorio del plomo sale de `path.dirname(rutaBoceto)`.

No se arregla duplicando el catalogo: un catalogo en dos sitios diverge, y esa es
una regla, no una preferencia.

Queda anotado para **quien planifique la tanda de la interfaz**, que es cuando
habra un caso concreto delante con el que decidirlo.

### 2. Dos candidatos para la tanda siguiente del motor

Salieron de esta tanda, los dos son cambios del motor y por eso no entraron aqui.

**La corrida que mas necesita el resumen es justo la que falla, y es la unica que
no lo imprime.** `vitral.mjs` hace `if (fallidas.length > 0) { avisoFallo(); return 1; }`
y se salta `salida.resumen()`. El dato de "fuera de ruta" **si se calcula y si se
guarda** —el historial de la corrida `20260820-230341` tiene
`["pruebas/.bloques.txt","pruebas/.chunks.js"]`— pero no se enseña. Solo aparece
haciendo `--historial <id>`, que es justo lo que nadie hace despues de un fallo.

**`motor.md` paso de 27,4 KB a 40,7 KB** al entrar el catalogo de eventos. Es
contrato permanente: esos 13 KB los paga cada vidrio de cada tanda futura, en cada
turno, como cache leida. Vale la pena mirar si esas 243 lineas se pueden apretar
sin perder contrato.

### 3. La lista de cierre de `planificador.md`

**Es la tercera vez que el paso de borrar los handoffs del cierre se olvida.** Los
huerfanos de la tanda de la interfaz —`cuadricula.md`, `final.md`, `panel.md`,
`texto.md`— seguian en `.vitral/handoffs/` al planificar esta tanda, sin sello
`.tanda` que dijera de quien eran.

Tres veces no es descuido: es una lista que se puede saltar sin que se note.
En la sesion de cierre, **pensar si el paso 5 de "La sesion de cierre" en
`.vitral/planificar/plomo/planificador.md` necesita ser mas dificil de saltarse**,
y arreglarlo ahi si la respuesta es que si.

Un dato para esa decision: el cierre no deja rastro comprobable. Un plomo sin
retirar lo canta la cabecera de `--seco`; un boceto sin borrar se puede relanzar y
se nota; **un handoff huerfano no lo dice nadie**, y el sello solo lo caza si la
tanda siguiente usa el mismo id.
