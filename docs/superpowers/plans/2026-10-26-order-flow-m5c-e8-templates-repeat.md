# Веха 5в, этап Э8 «Мои раскладки и повтор заказа» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** менеджер сохраняет раскладку позиции («грудь 250 + спина 300 + рукав 70») под своим именем и одним нажатием раскладывает по ней логотип в другом заказе; «Повторить заказ» создаёт новый черновик с теми же изделиями, нанесениями, бирками и файлами.

**Architecture:** раскладка — строка `order_templates` (RLS «свои» уже есть, миграции нет) с данными `{ kind: 'layout', v: 1, flat_id, prints: [...] }`: на каждое нанесение — вид, зона (`area_id` + `zone_id`), техника, ширина и отступы от опоры и оси (как у «Стандартов Pinhead» и копии на вид), **без файлов и без абсолютных координат** — поэтому она переносится на другой силуэт по зоне. Применение — чистая функция над нанесениями позиции (`ui/panel/templateOps.ts`, только `import()` из панели), запись — `commitPrints` → `useDesignStore.commit` → `useSalesStore.edit`. Повтор заказа — чистая модель `model/repeatOrder.ts` (шапка, тело с новыми ключами, карта путей) + серверная копия файлов в папку нового заказа (`api/artworks.copyArtwork`, `storage.copy`) + `createNew` → `edit` → `flush`; модуль повтора грузится `import()` по кнопке.

**Tech Stack:** TypeScript, React 19, Zustand, supabase-js (таблица и Storage `copy`), Vitest.

**Spec:** `docs/superpowers/plans/2026-10-26-order-flow-m5c-design-studio.md` («Э8»).

## Global Constraints

- Миграции нет: `order_templates` — политики `select/insert/delete` «свои» (`20260727230000`); `orders.parent_id` пишет `order_v4_save_full`, страж требует видимого родителя; Storage `copy` проходит политики `order_artworks_select` (источник) и `order_artworks_insert` (`order_artwork_path_ok` нового заказа, черновик, автор).
- `order_templates` читает и пишет ОДИН модуль — `orderstudio/api/layoutTemplates.ts` (сторож `layoutTemplatesWrites.test.ts`); `order-artworks` — по-прежнему только `api/artworks.ts` (сторож `artworkWrites.test.ts` уже ловит `.copy(`).
- Чужие и старые строки `order_templates` (шаблоны визарда v3) не показываются: фильтр `data->>kind = 'layout'` и строгий разбор на клиенте (`parseLayoutTemplate`), битая строка пропускается.
- Пределы: имя 1…60 знаков; до 20 нанесений в раскладке; до 50 раскладок в списке; данные ≤ 16 КБ.
- Применение раскладки — только черновик, флаг «Дизайн» 2.0, не на чужом силуэте (правило Э1, `addBlocked`) — иначе `aria-disabled` с причиной.
- Повтор — только `canCreateOrders` (продавец или руководство); источник — любой статус; новый заказ: `draft`, `parent_id` = источник, автор и менеджер — текущий пользователь; срок, оплата, отметки, номер, PDF ТЗ, сделка Bitrix — не копируются.
- Файл, видимый в новом заказе, обязан быть в бакете: путь, который не скопировался, обнуляется (из массивов — убирается), итог — одним предупреждением «N файлов не скопировались — загрузите заново».
- Бюджеты: холст не растёт (всё в ленивых частях панели и по `import()`); рабочее место ≤ 95 700; панель ≤ 13 500.
- Тексты — по-русски, кнопки — глаголом; блок — `aria-disabled` + причина, `disabled` — только на время запроса.

## Review Focus

1. Раскладка с силуэта футболки на худи: зона с тем же `zone_id` есть — нанесение встаёт по отступам; зоны нет — пропуск с числом пропущенных в тосте, а не молчание.
2. Логотип вытянутый (300 × 60) и квадратный: ширина из раскладки, высота — по пропорции файла; не влезло в зону — ужимается в зону (`clampedToZone`).
3. Повтор заказа с PDF/AI-логотипом: копируется исходник И `.preview.png` (иначе холст нового заказа без картинки); превью не скопировалось — исходник остаётся, превью пересоберётся.
4. Повтор, пока в источнике несохранённая правка: сначала `flush`, копия — с сохранённого состояния.
5. Двойной клик «Повторить заказ» — один новый заказ (кнопка занята до конца, повторный вызов возвращает тот же промис).

---

### Task 1: Модель раскладки — снять, разобрать, применить

**Files:** Create `design/ui/panel/templateOps.ts` + `templateOps.test.ts`.

**Interfaces:**
- `TemplatePrint = { view: DesignView; area_id: string; zone_id: string | null; method: SalesPrintMethod; width_mm: number; down_mm: number; dx_mm: number; rotation_deg: number; colors: number; pantone: string[]; effects: string[] }`
- `LayoutTemplateData = { kind: 'layout'; v: 1; flat_id: string; prints: TemplatePrint[] }`
- `templateFromPrints(prints: SalesPrint[], ctx: PlaceCtx): LayoutTemplateData | null` — размещённые нанесения силуэта, по порядку; нет ни одного — `null`.
- `parseLayoutTemplate(raw: unknown): LayoutTemplateData | null` — строго: `kind`, `v`, 1…20 нанесений, числа конечные (ширина 1…1000, отступы ±1000, поворот 0…359), строки ≤ 64, вид из `FLAT_VIEW_KINDS`, техника из `SALES_PRINT_METHODS`.
- `applyTemplate(prints, sourceKey, tpl, ctx): { prints: SalesPrint[]; key: string; placed: number; skipped: number } | null` — первое нанесение раскладки двигает и меняет исходное (тот же ключ и файл), остальные — новые строки с тем же файлом сразу после него; зона: тот же `area_id`, иначе тот же `zone_id` на виде, иначе пропуск; размер — `scaledTo` по ширине, отступы — `withVerticalOffset`/`withHorizontalOffset`, затем `clampedToZone`.

- [ ] Step 1: тесты — снять → разобрать → применить на том же силуэте даёт те же Ш×В и отступы ±0,1 мм; на другом силуэте по `zone_id`; зоны нет — `skipped`; битые данные (`v: 2`, 21 нанесение, `NaN`, неизвестный вид) — `null`; исходная строка не теряет `artwork_path`, `layout.asset`.
- [ ] Step 2: FAIL → реализация → PASS (`npx vitest run src/orderstudio/design/ui/panel/templateOps.test.ts`).

### Task 2: API раскладок и сторож записи

**Files:** Create `api/layoutTemplates.ts` + test, `layoutTemplatesWrites.test.ts` (сторож: `.from('order_templates')` — только в писателе).

**Interfaces:** `listLayoutTemplates(uid): Promise<{ id: string; name: string; data: LayoutTemplateData }[] | null>` (`created_by = uid`, `data->>kind = 'layout'`, новые сверху, `limit 50`, битые строки отбрасываются); `saveLayoutTemplate(uid, name, data): Promise<{ id; name; data } | null>`; `deleteLayoutTemplate(id): Promise<boolean>`. Ошибка — `toast.error` + `null`/`false`; имя обрезается, пустое или > 60 — отказ словами; данные > 16 КБ — отказ.

- [ ] Step 1: тесты с моком supabase (фильтры запроса, отбрасывание битой строки, отказы, тосты) и сторож (мутация: `.from('order_templates')` в другом файле — красный).
- [ ] Step 2: FAIL → реализация → PASS.

### Task 3: «Мои раскладки» в панели «Дизайн»

**Files:** Create `design/ui/panel/MyLayouts.jsx` (ленивый, `React.lazy` в `DesignSide` рядом с `CopyToView`) + test.

Поведение: секция `role="group"` «Мои раскладки»: `<select>` своих раскладок (подпись — имя и «3 нанесения»), «Разложить нанесение N» (применение к выбранному), «Удалить» (подтверждение), поле «Название» + «Сохранить раскладку позиции» (снимок размещённых нанесений позиции). Список грузится при первом показе секции; пустой — «Сохраните раскладку позиции, чтобы повторять её в других заказах». После применения — выбор исходного, тост «Разложено: N; пропущено: M — на этом силуэте нет зоны». Не черновик — секции нет; чужой силуэт — «Разложить» `aria-disabled` с причиной Э1.

- [ ] Step 1: тесты RTL — сохранение зовёт API с данными `templateFromPrints`; применение пишет через `commitPrints`; пустой список; блок Э1; удаление после подтверждения; открытие ничего не пишет.
- [ ] Step 2: FAIL → реализация → PASS; `npm run build && npm run bundle:budget` — холст не вырос, панель ≤ 13 500.

### Task 4: Модель повтора заказа и копия файлов

**Files:** Create `model/repeatOrder.ts` + test; Modify `api/artworks.ts` (`copyArtwork`) + test.

**Interfaces:**
- `repeatHeader(src: SalesOrder): Partial<SalesOrder>` — `kind`, `title`, `customer`, `contact`, упаковка и стикеры (без файла), `no_chestny_znak`, доставка, срочность, скидка, `notes`, `parent_id = src.id`; без срока, оплат, сделки, служебных.
- `orderFilePaths(src): string[]` — уникальные: макеты нанесений, превью и схемы бирок, картинки карточек, превью стикера; PDF ТЗ — нет.
- `repointPath(path, toOrderId): string | null` — `orders/<старый>/…` → `orders/<новый>/…` (тот же хвост), чужой формат — `null`.
- `repeatBody(src, map: Record<string, string>): { items; notes_cards; sticker_preview_path; dropped: number }` — новые ключи позиций, нанесений, бирок, карточек (`item_key` карточки — по новой позиции), `tz_pdf_path = ''`, `applied_at = null`, пути — по карте, нет в карте — пусто и `dropped + 1`; раскладка нанесения (`layout`) — как была (путей в ней нет).
- `copyArtwork(fromPath, toOrderId): Promise<string | null>` в `api/artworks.ts` — новый путь `repointPath`, проверка `isArtworkPath` обоих концов, `storage.copy`; ошибка — `console.error` и `null` (итог показывает вызывающий одним тостом).

- [ ] Step 1: тесты — заказ из фикстуры 67108: ключи все новые, ссылки карточек на позиции верны, служебные пусты; не скопированный путь обнулён и посчитан; превью-путь нового = `artworkPreviewPath(нового исходника)`; `copyArtwork` — чужой путь — отказ без запроса.
- [ ] Step 2: FAIL → реализация → PASS.

### Task 5: Кнопка «Повторить заказ»

**Files:** Create `workplace/repeatFlow.ts` (только `import()` из `HeadActions`) + test; Modify `workplace/HeadActions.jsx` (+ test).

**Interfaces:** `repeatOrder(user): Promise<string | null>` — `flush` источника → подтверждение «Повторить заказ PH-…?» («Будет новый черновик с теми же изделиями, нанесениями и файлами. Срок и оплату задайте заново») → `createNew({ ...repeatHeader, manager, created_by })` → копии файлов (по 4 одновременно; превью — для `layout.asset.has_preview`, необязательно) → `edit(тело)` → `flush`; повторный вызов во время работы — тот же промис. Итог: «Создан черновик PH-… — повтор PH-…», плюс предупреждение о не скопированных файлах. `HeadActions`: кнопка «Повторить заказ» (`btn-ghost`) у `canCreateOrders(user)` и заказа с позициями; занята — «Повторяю…»; успех — переход `/sales/<новый>?tab=item`.

- [ ] Step 1: тесты — порядок вызовов (flush → confirm → createNew → copy → edit → flush), отказ подтверждения ничего не пишет, `createNew` вернул `null` — копий нет, частичный сбой копий — предупреждение с числом, двойной вызов — один заказ; кнопка видна продавцу, скрыта МС без `is_sales`.
- [ ] Step 2: FAIL → реализация → PASS.

### Task 6: Проверка ветки и документы

- [ ] `npm run lint && npm run typecheck && npx vitest run --maxWorkers=3 && npm run build && npm run bundle:budget`; документы (мастер-план «Сделано», правило вехи 5в — раздел Э8, журнал, `SESSION-STATE.md`, `CLAUDE.md` — новые модули); commit + push.

---

## Ход выполнения (26.10)

**Ревью плана** (отдельный агент, архитектура и права) — внесено:
- блокирующее: правка тела повтора могла уйти в чужой заказ (`edit` пишет в открытый) → тело без файлов кладётся
  сразу в `createNew`, привязка путей — по новым ключам и только если открыт тот же заказ (проверка и `edit`
  синхронны); повтор — только из сохранённого (`clean`/`locked`);
- превью PDF/AI не пересобирается само → исходник и `.preview.png` копируются парой, нет превью — файл не скопирован;
  не скопированный макет — без раскладки («Не размещено»);
- в раскладке только место, ширина и техника (цвета, Pantone, эффект — свойства логотипа); зона — правило
  `targetArea` (служебная — по id на том же силуэте), техника вне зоны — пропуск с причиной; у новых строк
  без заметок исходного;
- сторож `artworkWrites` — второй писатель `api/artworkCopy.ts` ровно с одной `copy`.

**Сделано:** `design/model/layoutTemplate.ts` (данные и строгий разбор), `ui/panel/templateOps.ts` (снять / применить),
`api/layoutTemplates.ts` (+ сторож `layoutTemplatesWrites`), `ui/panel/MyLayouts.jsx` (ленивый, в `DesignSide`);
`model/orderPaths.ts`, `model/repeatOrder.ts` (`repeatHeader`, `repeatDraft`, `attachFiles`, `previewSources`),
`api/artworkCopy.ts`, `workplace/repeatFlow.ts`, `tz/ui/RepeatPanel.jsx`. e2e — «Повторить заказ» в
`order-design-studio.spec.ts`.

**Отступления от плана:**
- кнопка «Повторить заказ» — на вкладке «ТЗ и цена» (панель «Повтор заказа»), а не в шапке: в шапке она
  стоила ~200 Б оболочки Order сверх потолка 288 653 (решение К11 вехи 8 — потолок не поднимается);
- копия — отдельный модуль `api/artworkCopy.ts`: в `artworks.ts` она раздувала чанки «Кэши картинок» и оболочки;
- права `order_templates` на сервере — политики «свои» без `active/approved` и без пределов имени и размера —
  миграция P (защита раскладок) готовится отдельным этапом, на бой — файлом владельцем;
- смоук Storage `copy` на бою (своё → свой черновик проходит; в чужой и не черновик — отказ) — за владельцем.
