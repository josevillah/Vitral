// Un fallo de forma: el plan no se puede ni intentar. Boceto invalido, ciclo de
// dependencias, bandera desconocida. Se lanza desde donde se detecta y solo
// vitral.mjs lo captura, lo imprime y decide el codigo de salida.
//
// Se distingue de un Error cualquiera a proposito: un ErrorVitral es una
// situacion prevista y se muestra sin traza; cualquier otro error es un fallo del
// programa y ahi si interesa la traza.
export class ErrorVitral extends Error {
  constructor(mensaje, sugerencia) {
    super(mensaje);
    this.name = 'ErrorVitral';
    this.sugerencia = sugerencia || null;
  }
}
