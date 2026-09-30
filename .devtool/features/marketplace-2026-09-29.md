---
id: "marketplace-2026-09-29"
status: "in-progress"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-09-29T01:08:38.901Z"
modified: "2026-09-29T18:55:58.775Z"
completedAt: null
labels: []
order: "a3"
---
# MArketplace

## Propuesta de arquitectura

### 1. Marketplace como publicación independiente

Seguiría el mismo patrón que ya existe para `publishedWorld`:

- `marketplaceItem`

  - `id`
  - `ownerId`
  - `name`
  - `description`
  - `thumbnailUrl`
  - `latestRevision`
  - `status`: publicado/oculto
  - fechas de creación y actualización

- `marketplaceItemRevision`

  - `marketplaceItemId`
  - número de revisión
  - `slotData`
  - fecha de creación

- `marketplacePurchase`

  - `userId`
  - `marketplaceItemId`
  - fecha de adquisición
  - restricción única usuario + item

El item tendría un ID estable. Actualizarlo crearía una nueva revisión, sin sobrescribir las anteriores.

Por defecto, los usuarios que lo hayan adquirido recibirían siempre la última revisión.

### 2. Referencia desde el objeto original

Añadiría un campo opcional:

```
marketplaceItemId
```

en el `InventoryItem` y en las tablas persistentes que lo soporten:

- `cloudInventoryItem`
- `worldInventoryItem`
- IndexedDB para `local`

La referencia debe estar en el registro del inventario, no dentro de cada `Slot`. Así no contaminamos el objeto runtime ni el árbol que se instancia en el mundo.

El flujo sería:

1. El estudio publica el objeto.
2. El servidor crea `marketplaceItem` y la revisión inicial.
3. Devuelve el ID.
4. El objeto origen guarda `marketplaceItemId`.
5. En futuras publicaciones, el estudio detecta esa referencia y muestra “Actualizar publicación”.

Si el objeto local se borra posteriormente, la publicación continúa existiendo.

### 3. Adaptador “Objetos comprados”

Añadiría un cuarto adaptador:

```
purchased
```

Con etiqueta visible:

```
Objetos comprados
```

Características:

- Solo disponible para usuarios autenticados.
- Sin carpetas inicialmente.
- Solo lectura.
- Lista las adquisiciones del usuario.
- Devuelve objetos con el mismo formato `InventoryItem`.
- Usa el `slotData` de la última revisión del marketplace.
- No permite guardar, editar ni borrar desde ese adaptador.

El juego no necesitaría un sistema de spawn nuevo: el objeto comprado entraría por el mismo callback actual `onSpawnItem`, reutilizando `spawnFromInventory`.

Esto mantiene también el comportamiento host/guest actual:

- El host añade el objeto a la escena.
- Un guest solicita el spawn.
- La autoridad del host replica el resultado.

### 4. API prevista

Nuevos endpoints:

```
GET  /api/marketplace/items
POST /api/marketplace/items
GET  /api/marketplace/items/[id]
PUT  /api/marketplace/items/[id]
POST /api/marketplace/items/[id]/purchase
GET  /api/marketplace/purchases
```

Responsabilidades:

- Catálogo público: solo publicaciones visibles.
- Publicar: requiere login.
- Actualizar: solo el propietario.
- Adquirir: operación idempotente.
- Compras: solo las del usuario autenticado.
- Validación del `SlotTree`, tamaño máximo y jerarquía.

### 5. Cambios en el estudio

En el estudio añadiría:

- Estado de publicación en cada asset.
- Botón `Publish to Marketplace`.
- Botón `Update Marketplace Item` cuando exista `marketplaceItemId`.
- Formulario mínimo:
  - nombre
  - descripción
  - thumbnail opcional
- Indicador de revisión publicada.
- Mensajes cuando el objeto local todavía no se ha sincronizado.

Para publicar será necesario estar autenticado. El objeto puede proceder de local, cloud o world inventory, pero:

- Cloud/world: el servidor puede verificar directamente el objeto origen.
- Local: el cliente enviará una copia válida y guardará el ID devuelto en IndexedDB.

### 6. Cambios en el juego

En el menú personal → Inventario:

- Añadir la pestaña/adaptador “Objetos comprados”.
- Mostrar nombre, thumbnail y estado de carga.
- Permitir seleccionar y spawnear.
- Mostrar errores de autenticación o de carga.
- No mostrar controles de carpetas, borrado o actualización para este adaptador.

### 7. Validaciones importantes

Antes de implementarlo conviene aplicar estas reglas:

- Solo publicar objetos de tipo `object`, no mundos.
- Limitar tamaño y número de slots.
- Verificar ciclos y padres inexistentes.
- Verificar que solo el propietario pueda actualizar.
- Hacer la adquisición idempotente.
- No confiar en que el cliente ya posee un objeto.
- Mantener las revisiones anteriores para poder recuperar versiones.

También habrá que revisar el tratamiento de `codeBlock`, porque un objeto publicado puede llevar código que se ejecuta en los clientes que lo instancian.

## Fases de implementación

1. Modelo Prisma y migración.
2. Servicios de marketplace y validación.
3. Endpoints de catálogo, publicación, actualización y adquisiciones.
4. Campo `marketplaceItemId` en inventarios.
5. Adaptador `purchased`.
6. UI del inventario XR.
7. UI del estudio.
8. Pruebas de publicación, actualización, adquisición y spawn multiplayer.
9. Traducciones en inglés/español.

Asumo inicialmente que “comprar” significa adquirir la propiedad del objeto sin integrar todavía pagos reales. Si se quiere monetización, habrá que añadir posteriormente precio, moneda, proveedor de pagos, webhooks y estados de transacción.