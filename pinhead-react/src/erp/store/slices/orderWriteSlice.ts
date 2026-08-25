/**
 * ЗАПИСЬ по заказу — доменный слайс, приезжает вместе с первым экраном.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ `ordersSlice`. Оболочку ERP грузят все и всегда, а список
 * заказов ей нужен для бейджей и счётчиков — то есть нужно ЧТЕНИЕ. Запись
 * (создание заказа, отгрузка, удаление, вложения, комментарии) не зовёт
 * ни `ErpApp`, ни `layout/*`, ни один общий компонент: её потребители —
 * ленивые экраны. При этом один только `createOrder` — 13 кБ исходника:
 * он собирает payload из позиций, маршрута, нанесений, бирок, ТЗ и листа
 * закупки, то есть тянет за собой `routeDraft`, `routes` и половину
 * справочников формы.
 *
 * ПОЧЕМУ ЭТО БЕЗОПАСНО. Экран ERP заводится `lazyScreen`, который грузит
 * доменный чанк ПАРАЛЛЕЛЬНО с чанком экрана и подключает слайсы до первой
 * отрисовки. Голый `lazy` дал бы стор без половины действий — ошибку
 * не при сборке и не при переходе, а при нажатии на кнопку, то есть у цеха;
 * поэтому правило «только через `lazyScreen`» и сторожится тестом.
 *
 * Данные остаются в ядре (`domainState.ts`) — здесь только функции.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { formItemRoute, linearize, stepPayload } from '../../utils/routeDraft';
import { invokeFunction } from '../adminUsers';
import { isOrderReadyToShip } from '../../utils/stageUi';
import { isBypassed } from '../../utils/bypass';
import { daysLeft } from '../../utils/time';
import { pluralize } from '../../../utils/i18n';
import { attachmentFilePath } from '../../../utils/storageKey';
import type {
  ErpItemStage, ErpOrder, ErpOrderAttachment, ErpOrderStatus,
} from '../../types';
import { currentActor, erpError, erpQuery, removeOrphanUpload, withPending } from '../shared';
import { invalidate } from '../queryCache';
import { ORDER_SELECT } from '../orderHelpers';
import { orderBundleKey, orderFilePaths } from './ordersSlice';
import type { ErpOrderComment, ErpStore, OrderWriteSlice } from '../types';

export const orderWriteSlice: StateCreator<ErpStore, [], [], OrderWriteSlice> = (set, get) => ({
  setOrderDemo: async (id, value) => {
    const ok = await get().updateOrder(id, { is_demo: value });
    if (!ok) return false;
    // Заказ, помеченный тестовым при выключенном показе, должен исчезнуть
    // из списков сразу — иначе он останется висеть до F5 и разметка
    // будет выглядеть неработающей.
    if (value && !get().showDemoOrders) {
      set((s) => ({
        orders: s.orders.filter((o) => o.id !== id),
        detailIds: s.detailIds.filter((x) => x !== id),
      }));
    }
    return true;
  },


  createOrder: async (input) => {
    const { departments } = get();
    const deptByCode = new Map(departments.map((d) => [d.code, d]));
    const {
      items, tz, materials, attachments, notes_list: orderNotes, ...orderFields
    } = input;

    /**
     * Цеха маршрута, которых нет в справочнике `erp_departments`.
     *
     * Такой этап молча выпадал из маршрута ВМЕСТЕ со ссылками на него в `depends_on`:
     * позиция создавалась короче задуманного, а финальный ОТК, зависевший от
     * выпавшего этапа, оставался вообще без зависимостей и был готов к запуску
     * с первой секунды. Ошибкой это не считается (цех могли отключить осознанно),
     * но и молчать нельзя — иначе о дыре в маршруте узнают на сдаче.
     */
    const droppedDepts = new Set<string>();
    /** `stage:<позиция>:<группа>:<шаг>` → номер этапа внутри позиции */
    const stageKeyIndex = new Map<string, number>();
    /**
     * Ключ нанесения/бирки формы → номер внутри позиции (правка 22.08,
     * пп. 5.2–5.3). Тем же приёмом, что у подрядных шагов: строк на момент
     * выбора файла ещё нет, а номер знает только тот код, который строит
     * секции `prints`/`labels`. Считать его в другом месте значило бы
     * завести второй порядок рядом с настоящим.
     */
    const printKeyIndex = new Map<string, number>();
    const labelKeyIndex = new Map<string, number>();

    // Маршрут (этапы + depends_on) считается на клиенте как раньше (buildRoute),
    // а RPC erp_create_order атомарно вставляет всё в одной транзакции (п.28).
    // depends_on в payload — индексы этапов той же позиции (всегда более ранних).
    const payload = {
      order: { ...orderFields, status: 'active' },
      items: items.map((it, i) => {
        // Правка 4.2.2 (вырезание supply при материале подрядчика) — внутри buildItemRoute,
        // общего с превью маршрута в форме создания заказа.
        /**
         * Маршрут берётся из ЧЕРНОВИКА формы (`formItemRoute`), а не считается
         * здесь заново: конструктор маршрута (правки заказчика 16.08) позволяет
         * менеджеру править предложенный вариант, и второй расчёт означал бы,
         * что заказ создаётся не по тому маршруту, который человек утвердил.
         * Не тронутый маршрут `formItemRoute` отдаёт РОВНО расчётным —
         * инвариант тождества сторожит `routeDraft.test.ts`.
         */
        const linear = linearize(formItemRoute(it, {
          // Отметка «Закупка не требуется» — свойство ЗАКАЗА, и в расчёт
          // маршрута она обязана попасть здесь же: у формы и у стора должно
          // получиться одно и то же
          needsPurchase: (orderFields as { purchase_required?: boolean })
            .purchase_required !== false,
        }));
        for (const l of linear) {
          if (!deptByCode.has(l.step.departmentCode)) droppedDepts.add(l.step.departmentCode);
        }
        /**
         * Этап с неизвестным цехом выпадает, а зависимости пересчитываются
         * по ОСТАВШИМСЯ: индексы в `depends_on` указывают на позиции в массиве,
         * и отфильтровать элементы, не сдвинув ссылки, значит перепутать
         * предшественников — молча и на каждом заказе.
         */
        const kept = linear.filter((l) => deptByCode.has(l.step.departmentCode));
        /**
         * Ключи шагов В ТОМ ЖЕ ПОРЯДКЕ, в каком этапы уедут в секцию `stages`.
         * По ним файл подрядного шага находит свой `stage_index` — считать его
         * отдельным обходом значило бы завести второй порядок этапов рядом
         * с этим, и однажды они разойдутся (ровно как у строк закупки).
         */
        kept.forEach((l, at) => stageKeyIndex.set(`stage:${i}:${l.gi}:${l.si}`, at));
        const newIndex = new Map<number, number>();
        linear.forEach((l, oldIdx) => {
          const at = kept.indexOf(l);
          if (at >= 0) newIndex.set(oldIdx, at);
        });
        return {
          product_type: it.product_type,
          variant: it.variant || null,
          qty: it.qty,
          production_type: it.production_type,
          branding_methods: it.branding_methods,
          branding_on: it.branding_on,
          notes: it.notes || null,
          size_grid: it.size_grid ?? null,
          sort_order: (i + 1) * 10,
          // Подряд (волна 4.2): тип/источник материалов для production_type='outsource'
          subcontract_kind: it.production_type === 'outsource' ? (it.subcontract_kind ?? null) : null,
          material_source: it.production_type === 'outsource' ? (it.material_source ?? null) : null,
          // Технический блок и упаковка позиции (правки заказчика 16.08)
          fit: it.fit || null,
          // Основная ткань — отдельно от отделочной (правка 22.08, п. 5.1)
          main_fabric: it.main_fabric || null,
          trim_material: it.trim_material || null,
          cutting_note: it.cutting_note || null,
          sewing_note: it.sewing_note || null,
          labels_note: it.labels_note || null,
          packaging: it.packaging ?? 'inherit',
          packaging_size: it.packaging_size || null,
          sticker_place: it.sticker_place || null,
          marking_place: it.marking_place || null,
          packaging_note: it.packaging_note || null,
          prints: (it.prints ?? []).map((p, j) => {
            if (p.key) printKeyIndex.set(p.key, j);
            return {
              seq: j + 1,
              method: p.method,
              fabric: p.fabric || null,
              zone: p.zone || null,
              width_mm: p.width_mm ?? null,
              height_mm: p.height_mm ?? null,
              offset_note: p.offset_note || null,
              pantone: p.pantone || null,
              comment: p.comment || null,
            };
          }),
          /** Бирки позиции (правка 22.08, п. 5.3) — повторяемый блок ТЗ */
          labels: (it.labels ?? []).map((l, j) => {
            if (l.key) labelKeyIndex.set(l.key, j);
            return {
              seq: j + 1,
              label_type: l.label_type || null,
              place: l.place || null,
              size: l.size || null,
              comment: l.comment || null,
            };
          }),
          stages: kept.map((l) => ({
            department_id: deptByCode.get(l.step.departmentCode)!.id,
            sort_order: l.sortOrder,
            depends_on: l.dependsOn
              .map((idx) => newIndex.get(idx))
              .filter((x): x is number => x !== undefined),
            // Исполнитель и карточка подрядчика — тем же выражением, что
            // в правке маршрута (`stepPayload`): писателей спутника подряда
            // ровно два, и оба обязаны слать одно и то же
            ...stepPayload(l.step),
          })),
        };
      }),
      /**
       * Лист закупки (правки заказчика 16.08). Раньше здесь стоял жёсткий `[]`,
       * и секция, которую RPC принимал с самого начала, не использовалась вовсе:
       * закупщик заводил те же строки заново на своём экране. Теперь потребность
       * приезжает вместе с заказом одной транзакцией.
       */
      materials: materials ?? [],
      /**
       * Заметки к заказу (правка 22.08, п. 5.8). Секция уезжает той же
       * транзакцией, что и заказ: изображения привязываются к строкам заметок
       * по `note_index`, а строк до вставки не существует.
       */
      notes: orderNotes ?? [],
      // ТЗ в PDF (волна 4): документы и назначения вставляются той же транзакцией
      tz: tz ?? { documents: [], assignments: [] },
      /**
       * Вложения блоков (правки заказчика 16.08). Как и `materials`, секция
       * долго существовала в RPC и не использовалась: `item_id` у вложения
       * появился той же миграцией, а слать было нечего — форм загрузки не было.
       */
      /**
       * Файлы подрядного шага приходят из формы с ключом шага: этапа
       * на момент выбора ещё нет. Номер этапа проставляет ТОТ ЖЕ код, что
       * построил `stages`, — иначе привязка считалась бы дважды и разъехалась.
       * Файл шага, выпавшего из маршрута (неизвестный цех), не едет вовсе:
       * привязывать его не к чему.
       */
      attachments: (attachments ?? [])
        .map((a) => {
          const withKeys = a as typeof a & {
            stage_key?: string; print_key?: string; label_key?: string;
          };
          const {
            stage_key: stageKey, print_key: printKey, label_key: labelKey, ...rest
          } = withKeys;
          if (stageKey) {
            const at = stageKeyIndex.get(stageKey);
            return at === undefined ? null : { ...rest, stage_index: at };
          }
          /**
           * Макет нанесения и файл бирки: ключ формы превращается в номер
           * внутри позиции. Нанесение, которое человек удалил, ключа
           * в карте не имеет — такой файл не едет вовсе, привязывать его
           * не к чему.
           */
          if (printKey) {
            const at = printKeyIndex.get(printKey);
            return at === undefined ? null : { ...rest, print_index: at };
          }
          if (labelKey) {
            const at = labelKeyIndex.get(labelKey);
            return at === undefined ? null : { ...rest, label_index: at };
          }
          return a;
        })
        .filter((a): a is NonNullable<typeof a> => a !== null),
    };

    // Два разных исхода supabase-js: на ОТВЕТ сервера он возвращает `error`,
    // а при отсутствии ответа (нет сети, CORS) — БРОСАЕТ. Первый называет причину
    // через `erpError` (отказ прав и конфликт не должны выглядеть как обрыв),
    // второй ловится catch: заказ не создан, транзакция либо не начиналась,
    // либо откатилась, форма остаётся заполненной и повтор безопасен.
    let newId: string;
    try {
      const { data, error } = await supabase.rpc('erp_create_order', { payload });
      if (error || !data) {
        erpError('Не удалось создать заказ', error);
        return null;
      }
      newId = data as string;
    } catch (e) {
      console.error('[createOrder]', e);
      toast.error('Не удалось создать заказ: нет связи с сервером');
      return null;
    }
    if (droppedDepts.size > 0) {
      toast.warning(
        `Маршрут короче расчётного: нет цехов ${[...droppedDepts].join(', ')} — `
        + 'проверьте справочник участков',
      );
    }
    // Созданный заказ забираем тем же вложенным select
    const created = await get().loadOne(newId);

    /**
     * АВТОСБОРКА PDF СНЯТА (правки заказчика 20.08).
     *
     * Она собирала лист из строк, которые заводил менеджер. Теперь потребность
     * приходит ГОТОВЫМ ФАЙЛОМ, а строки в ERP заводит закупщик — то есть
     * в момент создания заказа собирать нечего: функция ответила бы 409
     * («в заказе нет листа закупки») на каждом заказе, а при уцелевших
     * строках-подсказках собрала бы лист, который потребностью не является
     * и спорил бы с приложенным файлом.
     *
     * Сборка осталась КНОПКОЙ в карточке заказа и означает теперь другое:
     * лист по ФАКТИЧЕСКИМ строкам закупщика.
     */
    // Подряд (волна 4.2): авто-создаём операцию подряда по каждой позиции с типом подряда.
    // Готовое изделие стартует в цикле «Ожидает оплаты», отдельная операция — «Запланировано».
    if (created) {
      // created.items идут в том же порядке, что и input items (sort_order = (k+1)*10),
      // поэтому return_dept (не хранится на позиции) берём из входных items по индексу.
      for (let k = 0; k < created.items.length; k++) {
        const it = created.items[k];
        if (!it.subcontract_kind) continue;
        // Правка 4.2.3: для «отдельной операции» имя операции берём из формы (не хранится
        // на позиции), для готового изделия — вид изделия.
        const operation = it.subcontract_kind === 'operation'
          ? (items[k]?.subcontract_operation?.trim() || it.product_type)
          : it.product_type;
        await get().createSubcontractOp({
          order_id: created.id,
          item_id: it.id,
          operation,
          op_type: it.subcontract_kind,
          material_source: it.material_source ?? 'pinhead',
          qty: it.qty,
          status: it.subcontract_kind === 'finished_product' ? 'awaiting_payment' : 'planned',
          return_dept: it.subcontract_kind === 'operation' ? (items[k]?.return_dept ?? null) : null,
        });
      }
      /**
       * Заказ-образец сразу заводит разработку в эксперим. цехе, чтобы
       * проработка не создавалась вручную.
       *
       * Разработка заводится НА КАЖДУЮ позицию-образец, а не одна на заказ:
       * задачи разработки уходят в цеха этапами конкретной позиции, и одна
       * разработка на заказ из двух образцов отправила бы работу не туда.
       *
       * Задача заводится РОВНО ОДНА — «Построение лекал», и той же
       * транзакцией (`erp_experimental_create`): документ 20.08 требует её
       * сразу после запуска разработки. Остальные шаги технолог создаёт
       * по потребности — пятиступенчатый план по умолчанию это ровно то,
       * от чего отказались 12.08.
       */
      for (const it of created.items) {
        if (it.production_type !== 'samples') continue;
        await get().createExperimental(created.id, {
          item_id: it.id,
          tech_name: it.variant ? `${it.product_type} · ${it.variant}` : it.product_type,
        });
      }
    }
    return created;
  },


  updateOrder: async (id, patch) => {
    const prev = get().orders;
    // optimistic с rollback + pending-ключ (защита от «старого» realtime)
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
    const { error } = await erpQuery(() => withPending(`order:${id}`, () =>
      supabase.from('erp_orders').update(patch).eq('id', id)));
    if (error) {
      set({ orders: prev });
      erpError('Не удалось обновить заказ', error);
      return false;
    }
    return true;
  },

  /**
   * PDF листа закупки. Заказ перечитывается после успеха: файл появляется
   * строкой `erp_order_attachments`, и без перечитывания человек увидит его
   * только после F5 — то есть решит, что кнопка не сработала.
   */
  generatePurchaseListPdf: async (orderId) => {
    const { error } = await withPending(`pdf:${orderId}`, () =>
      invokeFunction('purchase-list-pdf', { order_id: orderId }));
    if (error) {
      toast.error(error.message);
      return false;
    }
    await get().loadOne(orderId);
    toast.success('Лист закупки сформирован — файл в документах заказа');
    return true;
  },


  shipOrder: async (orderId) => {
    const prev = get().orders;
    const order = prev.find((o) => o.id === orderId);
    if (!order) return false;
    /**
     * Отгружать можно только готовый заказ (все этапы done/skipped, материалы
     * приняты) — либо когда проверку сняли аварийно (правки 10.08).
     *
     * Снятие применяется ТОЛЬКО здесь и в кнопке, но НЕ в расчёте просрочки:
     * `isOrderOverdue` тоже спрашивает `isOrderReadyToShip`, и если подставить
     * снятие туда, заказ задним числом перестал бы считаться просроченным.
     * Аварийный выход не должен переписывать отчётность.
     */
    if (!isOrderReadyToShip(order) && !isBypassed('ship_gate', orderId, get().bypasses)) {
      toast.error('Заказ ещё не готов к отгрузке');
      return false;
    }
    // архивный статус — по сроку клиента (как в ORDER_STATUS_LABELS)
    const d = daysLeft(order.due_date);
    const status: ErpOrderStatus =
      d === null || d === 0 ? 'done_on_time' : d < 0 ? 'done_late' : 'done_early';
    // dev-режим: user.id 'dev' — не валидный uuid (паттерн useOrdersStore)
    const userId = useAuthStore.getState().user?.id;
    const patch: Partial<ErpOrder> = {
      status,
      shipped_status: 'shipped',
      shipped_at: new Date().toISOString(),
      shipped_by: userId && userId !== 'dev' ? userId : null,
    };

    // optimistic с rollback + pending-ключ (защита от «старого» realtime)
    set((s) => ({
      orders: s.orders.map((o) => (o.id === orderId ? { ...o, ...patch } : o)),
    }));
    const { error } = await erpQuery(() => withPending(`order:${orderId}`, () =>
      supabase.from('erp_orders').update(patch).eq('id', orderId)));
    if (error) {
      set({ orders: prev });
      erpError('Не удалось отгрузить заказ', error);
      return false;
    }
    toast.success('Заказ отгружен и перемещён в архив');
    return true;
  },


  deleteOrder: async (id) => {
    /**
     * Пути файлов собираются ДО удаления: строки `erp_tz_documents`
     * и `erp_order_attachments` уедут каскадом вместе с заказом, и после
     * DELETE спрашивать будет уже нечего. Так в бакете и накопились сироты:
     * заказ удалялся, ТЗ-PDF оставались навсегда — платные, никем не учтённые
     * и, пока бакет публичный, доступные по ссылке.
     */
    const paths = await orderFilePaths(id);

    /**
     * `.select()` обязателен. RLS запрещает DELETE через `USING`, то есть
     * «удалено 0 строк», а НЕ ошибка: проверка только по `error` показывала
     * зелёное «Заказ удалён», убирала заказ из списка — и он возвращался при
     * следующей загрузке. Пустой ответ здесь и есть отказ.
     */
    const { data, error } = await erpQuery(() => supabase
      .from('erp_orders').delete().eq('id', id).select('id'));
    if (error) {
      erpError('Не удалось удалить заказ', error);
      return false;
    }
    if (!data || data.length === 0) {
      toast.error('Заказ не удалён: удаление доступно только администратору');
      return false;
    }
    set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));

    /**
     * Файлы — ПОСЛЕ строки. Обратный порядок означал бы, что упавший DELETE
     * оставляет живой заказ без ТЗ. Неудача уборки заказ не отменяет (он уже
     * удалён), но и молчать нельзя: файл остаётся в хранилище.
     */
    if (paths.length > 0) {
      const { error: rmError } = await erpQuery(() => supabase
        .storage.from('erp-attachments').remove(paths));
      if (rmError) {
        // Число впереди слова: «1 файл осталось» не согласуется, а
        // «осталось файлов: 1» читается верно при любом количестве
        toast.warning(
          'Заказ удалён, но в хранилище осталось '
          + `${pluralize(paths.length, 'файл', 'файла', 'файлов')}: ${paths.length}`
          + ' — уберите их вручную',
        );
      }
    }
    return true;
  },


  uploadOrderPreview: async (orderId, file) => {
    /**
     * Ключ собирает `utils/storageKey`, а не `file.name.split('.').pop()`.
     *
     * У имени БЕЗ точки `split` отдаёт массив из одного элемента, и `pop()`
     * возвращает имя целиком — фолбэк `|| 'png'` не срабатывал никогда.
     * Файл «Скан» превращался в ключ `<orderId>/1699.скан`, а Supabase
     * проверяет ключ регуляркой S3-safe символов, где `\w` без флага `u`,
     * и на кириллицу отвечает `InvalidKey`. Это тот же отказ, на котором
     * когда-то не загружалось НИ ОДНО ТЗ, и ради которого модуль и выделен.
     */
    const path = attachmentFilePath(orderId, 'preview', String(Date.now()), file.name);
    const { error: upErr } = await erpQuery(() => supabase.storage
      .from('erp-attachments')
      .upload(path, file, { contentType: file.type || 'image/png' }));
    if (upErr) {
      erpError('Не удалось загрузить превью', upErr);
      return false;
    }
    const { data, error } = await erpQuery(() => supabase
      .from('erp_order_attachments')
      .insert({
        order_id: orderId,
        file_path: path,
        file_name: file.name,
        kind: 'preview',
        uploaded_by: currentActor(),
      })
      .select());
    const row = data?.[0] as ErpOrderAttachment | undefined;
    if (error || !row) {
      // Файл в бакете есть, строки в БД нет — убираем за собой, иначе он остаётся
      // навсегда: платный, никем не учтённый и доступный по ссылке
      await removeOrphanUpload('erp-attachments', path);
      erpError('Превью загружено, но не привязано к заказу', error);
      return false;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId
          ? { ...o, attachments: [...(o.attachments ?? []), row] }
          : o),
    }));
    return true;
  },


  uploadOrderAttachment: async (orderId, file, note) => {
    // Тот же ключ и та же причина, что у превью строкой выше
    const path = attachmentFilePath(orderId, 'attachment', String(Date.now()), file.name);
    const { error: upErr } = await erpQuery(() => supabase.storage
      .from('erp-attachments')
      .upload(path, file, { contentType: file.type || 'image/jpeg' }));
    if (upErr) {
      erpError('Не удалось загрузить фото', upErr);
      return false;
    }
    const { data, error } = await erpQuery(() => supabase
      .from('erp_order_attachments')
      .insert({
        order_id: orderId,
        file_path: path,
        file_name: note ? `${note} — ${file.name}` : file.name,
        kind: 'attachment',
        uploaded_by: currentActor(),
      })
      .select());
    const row = data?.[0] as ErpOrderAttachment | undefined;
    if (error || !row) {
      await removeOrphanUpload('erp-attachments', path);
      erpError('Фото загружено, но не привязано к заказу', error);
      return false;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId
          ? { ...o, attachments: [...(o.attachments ?? []), row] }
          : o),
    }));
    return true;
  },


  addComment: async (orderId, text) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_order_comments')
      .insert({ order_id: orderId, author: currentActor(), text })
      .select());
    const row = data?.[0] as ErpOrderComment | undefined;
    if (error || !row) {
      erpError('Не удалось отправить комментарий', error);
      return null;
    }
    // Пакет заказа теперь устарел: без сброса возврат на карточку в течение
    // TTL показал бы ленту без только что отправленного комментария.
    invalidate(orderBundleKey(orderId));
    return row;
  },
});
