/**
 * Слайс заказов: загрузка (активные/архив/один), CRUD, отгрузка, вложения,
 * история этапов/правок, комментарии. Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { buildItemRoute } from '../../utils/routes';
import { isOrderReadyToShip } from '../../utils/stageUi';
import { isBypassed } from '../../utils/bypass';
import { daysLeft } from '../../utils/time';
import { pluralize } from '../../../utils/i18n';
import type {
  ErpDepartment,
  ErpItemStage,
  ErpOrder,
  ErpOrderStatus,
  ErpStageEvent,
} from '../../types';
import { currentActor, erpError, erpQuery, erpRead, removeOrphanUpload, withPending } from '../shared';
import { cachedQuery, invalidate } from '../queryCache';
import { ORDER_SELECT, ORDER_LIST_SELECT, sortOrderFull } from '../orderHelpers';

/** Размер страницы архива: заказы грузятся не все разом, а по кнопке «Показать ещё» */
export const ARCHIVE_PAGE_SIZE = 50;

/**
 * Пути файлов заказа в бакете `erp-attachments`: ТЗ в PDF и вложения
 * (превью макета, фото). Обе таблицы уедут каскадом вместе с заказом,
 * поэтому спрашивать их надо ДО удаления.
 *
 * Отдельным запросом, а не из `order.tz_documents`/`order.attachments`
 * в сторе: в списке заказ приезжает по `ORDER_LIST_SELECT`, где этих связей
 * нет, и уборка работала бы только у заказа, чью карточку успели открыть.
 *
 * Сбой чтения НЕ отменяет удаление: невозможность перечислить файлы — плохая
 * причина запретить удалить заказ. Хуже сироты только заблокированное действие.
 */
async function orderFilePaths(orderId: string): Promise<string[]> {
  const [tz, att] = await Promise.all([
    erpQuery(() => supabase
      .from('erp_tz_documents').select('file_path').eq('order_id', orderId)),
    erpQuery(() => supabase
      .from('erp_order_attachments').select('file_path').eq('order_id', orderId)),
  ]);
  const rows = [
    ...(tz.data ?? []),
    ...(att.data ?? []),
  ] as { file_path: string | null }[];
  return rows.map((r) => r.file_path).filter((p): p is string => Boolean(p));
}

import type {
  ErpStore,
  OrdersSlice,
  ErpOrderBrief,
  ErpOrderBundle,
  ErpOrderAttachment,
  ErpOrderAuditRow,
  ErpOrderComment,
  ErpOrderFull,
} from '../types';

/** Кэш-ключ пакета спутников заказа (история, аудит, комментарии) */
export const orderBundleKey = (orderId: string) => `erp:order-detail:${orderId}`;

/** Ключ localStorage для переключателя показа тестовых заказов */
export const SHOW_DEMO_KEY = 'erp_show_demo';

/** Читаем настройку показа демо; отсутствие ключа = не показывать */
function readShowDemo(): boolean {
  try {
    return localStorage.getItem(SHOW_DEMO_KEY) === '1';
  } catch {
    return false; // приватный режим — ведём себя как по умолчанию
  }
}

export const ordersSlice: StateCreator<ErpStore, [], [], OrdersSlice> = (set, get) => ({
  departments: [],
  orders: [],
  loading: false,
  loaded: false,
  loadError: false,
  archiveLoaded: false,
  archiveLoading: false,
  archiveHasMore: false,
  archiveOffset: 0,
  detailIds: [],
  showDemoOrders: readShowDemo(),

  setShowDemoOrders: async (value) => {
    try {
      localStorage.setItem(SHOW_DEMO_KEY, value ? '1' : '0');
    } catch { /* приватный режим: настройка живёт до перезагрузки */ }
    // Демо отсекается запросом, поэтому переключатель обязан перечитать данные:
    // фильтровать уже загруженный массив нельзя — скрытых строк в нём просто нет.
    set({ showDemoOrders: value, archiveLoaded: false, archiveHasMore: false });
    await get().loadAll();
  },

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

  loadAll: async () => {
    /**
     * Guard'а «уже грузим — выходим» здесь НЕТ, и это проверено, а не забыто.
     *
     * `ErpLayout` зовёт `loadAll()` при монтировании оболочки, каждый экран
     * делает то же самое, и на первом открытии запрос уходит дважды — экономия
     * напрашивается. Но обе её формы ломают очередь цеха (10 e2e-сценариев из 24):
     * и ранний выход, и дедупликация общим промисом. Экраны вызывают `loadAll()`
     * не «на всякий случай», а как загрузку СВОИХ данных и читают стор сразу
     * после — им нужен свой заход, а не чужой результат.
     *
     * Лишний запрос стоит дешевле пустого экрана «Выберите свой цех выше»,
     * который рабочий читает как «заданий нет». Если экономить — то сводить
     * вызывающих к одному месту, а не отбирать у них загрузку на полпути.
     */
    set({ loading: true, loadError: false });
    // Архив лениво (п.26): пока архив не открывали — грузим только активные.
    // Если архив уже загружен, полная перезагрузка обновляет и его.
    let ordersQuery = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .order('due_date', { ascending: true, nullsFirst: false });
    if (!get().archiveLoaded) ordersQuery = ordersQuery.eq('status', 'active');
    if (!get().showDemoOrders) ordersQuery = ordersQuery.eq('is_demo', false);
    /**
     * Цеха запрашиваются, только если их ещё нет.
     *
     * Обычный путь — `loadBootstrap()` в оболочке, он приносит цеха вместе
     * с правами и справочниками одним RPC. Но `loadAll` зовут и экраны
     * («если не загружено — загрузи»), и в тестах он вызывается сам по себе,
     * поэтому остаётся самодостаточным: без этого запаса экран, открытый
     * до бутстрапа, остался бы с пустым списком цехов и нарисовал бы
     * «?» вместо названий участков.
     */
    const needDepartments = get().departments.length === 0;
    const [deps, orders] = await Promise.all([
      needDepartments
        ? erpRead(() => supabase.from('erp_departments').select('*').order('sort_order'))
        : Promise.resolve({ data: null, error: null }),
      erpRead(() => ordersQuery),
    ]);
    if (deps.error || orders.error) {
      erpError('Не удалось загрузить данные ERP', deps.error ?? orders.error);
      set({ loading: false, loadError: true });
      return;
    }
    set({
      ...(deps.data ? { departments: deps.data as ErpDepartment[] } : {}),
      orders: ((orders.data ?? []) as ErpOrderFull[]).map(sortOrderFull),
      loading: false,
      loaded: true,
    });
  },

  /**
   * Архив постранично. Раньше первый заход на вкладку тянул ВЕСЬ архив одним
   * запросом с полным ORDER_SELECT (9 вложенных отношений). Сегодня это 71 заказ
   * и работает, но растёт линейно и однажды упрётся.
   *
   * Страница явная, не «тихий лимит»: сколько загружено и есть ли ещё — видно
   * в интерфейсе кнопкой «Показать ещё».
   *
   * Сортировка ОБЯЗАНА иметь уникальный доводчик (`id`). `due_date` не уникален
   * и бывает NULL: при равных значениях Postgres волен вернуть строки в любом
   * порядке, и между двумя запросами `range` порядок мог перетасоваться — заказ
   * приезжал дважды или не приезжал вовсе. Пропуск при этом молчаливый: дедуп
   * по id гасит дубль, а недостачу заметить нечем.
   */
  loadArchive: async () => {
    if (get().archiveLoading || get().archiveLoaded) return;
    set({ archiveLoading: true });
    let q = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .neq('status', 'active');
    if (!get().showDemoOrders) q = q.eq('is_demo', false);
    const { data, error } = await erpQuery(() => q
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(0, ARCHIVE_PAGE_SIZE - 1));
    if (error) {
      erpError('Не удалось загрузить архив', error);
      set({ archiveLoading: false });
      return;
    }
    const rows = (data ?? []) as ErpOrderFull[];
    // Архивные заказы, уже загруженные мимо пагинации (диплинк `?order=` →
    // `loadOne`), СОХРАНЯЕМ. Прежде здесь стоял `filter(status === 'active')`:
    // открытая по ссылке карточка архивного заказа пропадала из стора в момент
    // захода на вкладку архива и возвращалась, только если попала в первые 50.
    set((s) => {
      const fresh = rows.map(sortOrderFull);
      const paged = new Set(fresh.map((o) => o.id));
      return {
        orders: [...s.orders.filter((o) => !paged.has(o.id)), ...fresh],
        archiveLoading: false,
        archiveLoaded: true,
        archiveOffset: rows.length,
        archiveHasMore: rows.length === ARCHIVE_PAGE_SIZE,
      };
    });
  },

  loadMoreArchive: async () => {
    if (get().archiveLoading || !get().archiveHasMore) return;
    const offset = get().archiveOffset;
    set({ archiveLoading: true });
    let q = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .neq('status', 'active');
    if (!get().showDemoOrders) q = q.eq('is_demo', false);
    const { data, error } = await erpQuery(() => q
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + ARCHIVE_PAGE_SIZE - 1));
    if (error) {
      erpError('Не удалось догрузить архив', error);
      set({ archiveLoading: false });
      return;
    }
    const rows = (data ?? []) as ErpOrderFull[];
    // Дедуп по id: заказ мог приехать сюда раньше по диплинку или из realtime
    set((s) => {
      const known = new Set(s.orders.map((o) => o.id));
      const fresh = rows.filter((o) => !known.has(o.id)).map(sortOrderFull);
      return {
        orders: [...s.orders, ...fresh],
        archiveLoading: false,
        archiveOffset: offset + rows.length,
        archiveHasMore: rows.length === ARCHIVE_PAGE_SIZE,
      };
    });
  },

  loadOrderBundle: async (orderId, { force = false } = {}) => {
    /**
     * История этапов, лог правок и комментарии — одним RPC вместо трёх запросов.
     *
     * Карточка заказа открывалась одиннадцатым–тринадцатым запросом сессии;
     * три из них были эти. Лимиты (100/100/200) перенесены в функцию БД
     * дословно — менять их заодно с числом запросов значило бы тихо
     * поменять поведение экрана.
     *
     * Через кэш: страница и боковой Drawer подключены к одному хуку, а в dev
     * StrictMode вызывает эффекты парой — без дедупликации это два-четыре
     * одинаковых запроса подряд. Возврат на недавно открытый заказ отдаёт
     * данные сразу и обновляет фоном.
     */
    const fetcher = async () => {
      // try/catch наравне с проверкой `error`: supabase-js возвращает `error`
      // на ответ сервера и БРОСАЕТ, когда ответа не было (нет сети, CORS).
      // Без второй ветки карточка остаётся на скелетоне навсегда — экран
      // ждёт данных, которых уже не будет, и ошибку никто не показал.
      try {
        const { data, error } = await supabase.rpc('erp_order_detail', { p_order_id: orderId });
        if (error) {
          toast.error('Не удалось загрузить историю заказа');
          return null;
        }
        return data as ErpOrderBundle;
      } catch (e) {
        console.error('[loadDetail]', e);
        toast.error('Не удалось загрузить историю заказа');
        return null;
      }
    };
    if (force) invalidate(orderBundleKey(orderId));
    return cachedQuery(orderBundleKey(orderId), fetcher);
  },

  findOrdersByBitrixId: async (bitrixId) => {
    const value = bitrixId.trim();
    if (!value) return [];
    // Запрос, а не поиск по стору: дубль может лежать в архиве (он грузится
    // лениво) или быть помечен тестовым (его в сторе нет вовсе). Проверка
    // по памяти нашла бы не всё и была бы хуже отсутствия проверки —
    // «мы посмотрели, дублей нет».
    const { data, error } = await erpQuery(() => supabase
      .from('erp_orders')
      .select('id, title, status, created_at, is_demo')
      .eq('bitrix_id', value)
      .limit(5));
    // Молча: это подсказка, а не действие пользователя. Тост об упавшей
    // фоновой проверке во время заполнения формы только мешает.
    if (error) return [];
    return (data ?? []) as ErpOrderBrief[];
  },

  loadOne: async (orderId) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_orders')
      .select(ORDER_SELECT)
      .eq('id', orderId)
      .maybeSingle());
    if (error) {
      erpError('Не удалось загрузить заказ', error);
      return null;
    }
    if (!data) return null;
    const full = sortOrderFull(data as ErpOrderFull);
    set((s) => ({
      orders: s.orders.some((o) => o.id === full.id)
        ? s.orders.map((o) => (o.id === full.id ? full : o))
        : [full, ...s.orders],
      // Отмечаем, что у этого заказа есть колонки, которых нет в списочном запросе
      detailIds: s.detailIds.includes(full.id) ? s.detailIds : [...s.detailIds, full.id],
    }));
    return full;
  },

  createOrder: async (input) => {
    const { departments } = get();
    const deptByCode = new Map(departments.map((d) => [d.code, d]));
    const { items, tz, ...orderFields } = input;

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

    // Маршрут (этапы + depends_on) считается на клиенте как раньше (buildRoute),
    // а RPC erp_create_order атомарно вставляет всё в одной транзакции (п.28).
    // depends_on в payload — индексы этапов той же позиции (всегда более ранних).
    const payload = {
      order: { ...orderFields, status: 'active' },
      items: items.map((it, i) => {
        // Правка 4.2.2 (вырезание supply при материале подрядчика) — внутри buildItemRoute,
        // общего с превью маршрута в форме создания заказа.
        const route = buildItemRoute({
          productionType: it.production_type,
          brandingMethods: it.branding_methods,
          brandingOn: it.branding_on ?? 'cut',
          materialSource: it.material_source,
        });
        const valid = route.filter((r) => deptByCode.has(r.departmentCode));
        for (const r of route) {
          if (!deptByCode.has(r.departmentCode)) droppedDepts.add(r.departmentCode);
        }
        const codeToIdx = new Map(valid.map((r, idx) => [r.departmentCode, idx]));
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
          prints: (it.prints ?? []).map((p, j) => ({
            seq: j + 1,
            method: p.method,
            fabric: p.fabric || null,
            zone: p.zone || null,
            width_mm: p.width_mm ?? null,
            height_mm: p.height_mm ?? null,
            offset_note: p.offset_note || null,
            pantone: p.pantone || null,
            comment: p.comment || null,
          })),
          stages: valid.map((r) => ({
            department_id: deptByCode.get(r.departmentCode)!.id,
            sort_order: r.sortOrder,
            depends_on: r.dependsOnCodes
              .map((c) => codeToIdx.get(c))
              .filter((x): x is number => x !== undefined),
          })),
        };
      }),
      materials: [],
      // ТЗ в PDF (волна 4): документы и назначения вставляются той же транзакцией
      tz: tz ?? { documents: [], assignments: [] },
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
       * Задач при создании нет — их набор выбирает технолог (ТЗ п.11),
       * и пятиступенчатый план по умолчанию это ровно то, от чего отказались.
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

  loadOrderEvents: async (orderId) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_stage_events')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(100));
    if (error) {
      erpError('Не удалось загрузить историю', error);
      return null;
    }
    return (data ?? []) as ErpStageEvent[];
  },

  uploadOrderPreview: async (orderId, file) => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${orderId}/${Date.now()}.${ext}`;
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
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${orderId}/${Date.now()}.${ext}`;
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

  loadOrderAudit: async (orderId) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_order_audit')
      .select('*')
      .eq('order_id', orderId)
      .order('changed_at', { ascending: false })
      .limit(100));
    if (error) {
      erpError('Не удалось загрузить историю правок', error);
      return null;
    }
    return (data ?? []) as ErpOrderAuditRow[];
  },

  loadComments: async (orderId) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_order_comments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
      .limit(200));
    if (error) {
      erpError('Не удалось загрузить комментарии', error);
      return null;
    }
    return (data ?? []) as ErpOrderComment[];
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
