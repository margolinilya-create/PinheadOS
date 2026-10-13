# Правила сессии 61 (хвосты 14.09): где что лежит


- **Лимит вложения 20 МБ** — миграция `20260915053342` (бакет
  `erp-attachments`) + `ATTACH_MAX_BYTES` (`hooks/useAttachmentUploads`)
  и `TZ_MAX_BYTES` (`erp/types.ts`). Три величины ОБЯЗАНЫ совпадать, сторож —
  `utils/attachmentLimits.test.ts` (серверную сторону берёт из миграции:
  живую базу из CI не прочитать). `sku-photos` живёт своей величиной
- **Разработка без сделки** — миграция `20260915053824`:
  `erp_experimental.order_id` и `erp_order_attachments.order_id` обнуляемы,
  CHECK `erp_order_attachments_anchor_check`, RPC
  `erp_experimental_attach_order`. Сторож — `utils/devWithoutOrder.test.ts`
- **Форма заведения** — `screens/experimental/DevCreateModal.jsx` (кнопка
  «Завести разработку» на экране ЭКС под `experimental.manage`); до 15.09
  входа не было вовсе. **Привязка** — `screens/experimental/DevAttachOrder.jsx`
  на странице разработки, рисуется ТОЛЬКО у разработки без заказа
- **Действие стора** — `attachOrderToDev` в `experimentalSlice`: строка
  перечитывается целиком (у разработки эмбеды `tasks`/`attachments`/`order`,
  и объект из голого ответа потерял бы заголовок сделки — то, ради чего
  привязку и делали)
- **`nullableOf`** — в `types/schema.testutil.ts` рядом с `columnsOf`:
  обнуляемость колонок из снимка схемы, вынесена из `schema.test.ts`

