---
id: "objetos-eqipables-2026-09-29"
status: "backlog"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-09-28T23:22:03.579Z"
modified: "2026-09-29T10:10:47.452Z"
completedAt: null
labels: []
order: "a1"
---
# Objetos eqipables

Agregar un sistema de objetos equipables en mano.\
Por ejemplo, una pistola. Tanto si la grabeamos con la mano (no con el laser/puntero), como si la tenemos equipada, ese objeto (o sus childrends) pueden desde el scriptblock definir acciones, por ejemplo al pulsar el gatillo superior (del mando que sostiene ese objeto) que cancele la accion original del gatillo, que spawne una bala, que la mande en la direccion que toca desde el punto que toca y la elimine a los x segundos, ademas de hacer sonar el sonido de disparo, etc etc. Una pistola basicamente.\
Los objetos si se agarran con el puntero laser (o incluso con la mano), en el menu radial deberia salir la opcion equipar, si tiene el componente de equipable), al equipar, el objeto se posicionara en la posicion correcta en la mano. deberiamos poder definir de alguna manera eso para ajustar que quede perfecto el objeto en la mano) y aunque suelte el gatillo, el objeto se mantedra donde toca en la mano, y podre seguir usando sus acciones y cosas. igual si abrimos el menu radial, si tenemos equipado algo, debe salir el boton de desequipar\
\
\
Cómo debería funcionar

1. Un objeto con componentes `grabbable` y `equippable` puede cogerse con la mano o con el láser. El agarre sigue siendo temporal.
2. En el menú radial del objeto aparece «Equip». Al seleccionarlo, queda asociado a esa mano, se ajusta a una postura definida en `equippable` y permanece ahí al soltar el grip.
3. Con algo equipado, el radial de esa mano puede abrirse sin mantener el grip y muestra «Unequip», además de las acciones del objeto.
4. El gatillo superior se entrega primero al objeto equipado. Si su script consume la pulsación, no se ejecuta su acción habitual de láser o selección. Si no hay acción que la consuma, conserva el comportamiento normal.
5. Los `codeBlock` del objeto y de sus hijos pueden declarar acciones. Así, una pistola puede poner el script de disparo en su raíz y el punto de salida en un hijo llamado, por ejemplo, `Muzzle`.

### Cambios de arquitectura

- **Estado por mano.** Añadir un `EquipmentSystem` con la relación `jugador + mano → objeto equipado`, separada del estado de `GrabSystem`. Soltar el grip deja de equivaler a desequipar. Una mano solo tendrá un objeto equipado; equipar otro requiere desequipar o sustituir el anterior de forma explícita.
- **Postura ajustable.** `equippable` guardaría posición y rotación de agarre para izquierda y derecha, en coordenadas locales del mando. Conviene ofrecer un modo de ajuste visual en el inspector: mover y girar el objeto mientras se ve en la mano, y guardar esos valores en el componente. La escala del objeto sigue siendo la del propio objeto.
- **Entrada centralizada.** El controlador del gatillo necesita un despachador con prioridad clara: acción equipada → interfaz interactiva → acción normal del puntero. La cancelación debe hacerse antes de que Babylon entregue también el clic a una interfaz, para evitar dobles acciones. Los scripts recibirían eventos de pulsación, liberación y, cuando el mando lo permita, valor analógico; el evento indicaría jugador y mano.
- **Scripts de hijos.** El despachador recorrería la raíz equipada y sus descendientes en un orden definido. Cada acción declararía qué entrada escucha y si la consume. Añadiría al contexto funciones para obtener la pose mundial de cualquier hijo y generar un proyectil desde ella; calcular la salida sumando posiciones locales fallaría al rotar o escalar el arma.
- **Red.** Equipar, desequipar y activar una acción serían solicitudes fiables al host. El host comprobaría que el jugador controla esa mano y ese objeto, y ejecutaría una sola vez los efectos que cambian el mundo. Los demás clientes recibirían el estado equipado y los objetos generados. La asociación con la mano sería estado de sesión, sin cambiar el `parentId` serializado: así el objeto continúa siendo clonable y guardable con sus hijos.
- **Ciclo de vida.** Al desconectarse el jugador, desaparecer el mando, borrarse el objeto o cambiar de mundo, se libera la asociación y se restaura una pose mundial válida. También hay que impedir agarres simultáneos de un objeto equipado por otro jugador.

La pistola sería la prueba de extremo a extremo: raíz equipable, modelo y `Muzzle` hijo; al pulsar el gatillo, su acción genera una bala en la pose mundial de `Muzzle`, le asigna velocidad en su dirección, añade `expires` para eliminarla y reproduce el sonido allí. La colisión y el daño serían acciones adicionales del proyectil, no requisitos del sistema de equipamiento.

### Orden de implementación

1. Componente `equippable`, estado por mano y transición agarrado → equipado → desequipado.
2. Ajuste visual de postura y menú radial disponible con el objeto equipado.
3. Despachador de entradas con consumo real del gatillo y acciones en hijos.
4. Mensajes de red, validación del host y sincronización de la pose equipada.
5. Pistola de ejemplo y pruebas en solitario y multijugador: agarre cercano y con láser, ambas manos, soltar grip, disparo, radial, desconexión y clonación.