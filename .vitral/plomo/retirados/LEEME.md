# Plomos retirados

Contratos de tandas que ya se entregaron. Se guardan porque cuentan por que el
codigo quedo como quedo, pero ya no gobiernan nada.

Estan en un subdirectorio a proposito: `leerPlomo`, en `src/boceto.mjs`, hace un
`readdirSync` sin recursion y se queda solo con lo que acaba en `.md` en el primer
nivel. Un directorio no acaba en `.md`, asi que nada de aqui llega a los prompts.

No los devuelvas a `.vitral/plomo/`. Cada KB que hay ahi viaja en el prompt de
cada vidrio de cada tanda, y se paga en cada uno.
