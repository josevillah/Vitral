# Contrato · cambio de estado de pedido

## Maquina de estados

Un pedido esta siempre en uno de estos cinco estados:

`borrador` · `confirmado` · `en_preparacion` · `enviado` · `entregado`

Y uno terminal: `cancelado`.

Transiciones permitidas, y ninguna otra:

| Desde | Hacia |
|---|---|
| `borrador` | `confirmado`, `cancelado` |
| `confirmado` | `en_preparacion`, `cancelado` |
| `en_preparacion` | `enviado`, `cancelado` |
| `enviado` | `entregado` |
| `entregado` | (ninguna) |
| `cancelado` | (ninguna) |

Un pedido `enviado` no se puede cancelar. Es deliberado.

## Endpoint

```
POST /pedidos/{id}/estado
Content-Type: application/json
```

Cuerpo de la peticion:

```json
{
  "estado_nuevo": "en_preparacion",
  "nota": "opcional, texto libre, maximo 280 caracteres"
}
```

`estado_nuevo` es obligatorio. `nota` es opcional y puede venir como `null`.

## Respuestas

Exito, HTTP 200:

```json
{
  "ok": true,
  "pedido": {
    "id": 4821,
    "estado": "en_preparacion",
    "estado_anterior": "confirmado",
    "cambiado_en": "2026-08-19T14:03:11-04:00"
  }
}
```

Error, HTTP 422:

```json
{
  "ok": false,
  "error": "TRANSICION_INVALIDA",
  "mensaje": "Un pedido enviado no puede volver a preparacion."
}
```

## Codigos de error

| Codigo | HTTP | Cuando |
|---|---|---|
| `TRANSICION_INVALIDA` | 422 | La transicion no esta en la tabla de arriba |
| `ESTADO_DESCONOCIDO` | 422 | `estado_nuevo` no es uno de los seis estados |
| `PEDIDO_NO_ENCONTRADO` | 404 | No existe un pedido con ese id |
| `NOTA_MUY_LARGA` | 422 | `nota` pasa de 280 caracteres |

El campo `mensaje` siempre viene, siempre en espanol, y es el texto que la interfaz
muestra al usuario tal cual. La interfaz no arma mensajes propios a partir de
`error`: solo los distingue para decidir donde pintarlos.

## Fuera de contrato

Autenticacion, permisos por rol y bitacora de auditoria no entran en este modulo.
No los implementes; si el codigo existente ya los tiene, no los toques.
