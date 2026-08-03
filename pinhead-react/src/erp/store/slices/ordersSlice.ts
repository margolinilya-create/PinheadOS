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
import { daysLeft } from '../../utils/time';
import type {
  ErpDepartment,
  ErpItemStage,
  ErpOrder,
  ErpOrderStatus,
  ErpStageEvent,
} from '../../types';
import { currentActor, withPending } from '../shared';
import { cachedQuery, invalidate } from '../queryCache';
import { ORDER_SELECT, ORDER_LIST_SELECT, sortOrderFull } from '../orderHelpers';

/** Размер страницы архива: заказы грузятся не все разом, а по кнопке «Показать ещё» */
export const ARCHIVE_PAGE_SIZE = 50;

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
        ? supabase.from('erp_departments').select('*').order('sort_order')
        : Promise.resolve({ data: null, error: null }),
      ordersQuery,
    ]);
    if (deps.error || orders.error) {
      toast.error('Не удалось загрузить данные ERP');
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
   */
  loadArchive: async () => {
    if (get().archiveLoading || get().archiveLoaded) return;
    set({ archiveLoading: true });
    let q = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .neq('status', 'active');
    if (!get().showDemoOrders) q = q.eq('is_demo', false);
    const { data, error } = await q
      .order('due_date', { ascending: true, nullsFirst: false })
      .range(0, ARCHIVE_PAGE_SIZE - 1);
    if (error) {
      toast.error('Не удалось загрузить архив');
      set({ archiveLoading: false });
      return;
    }
    const rows = (data ?? []) as ErpOrderFull[];
    set((s) => ({
      orders: [
        ...s.orders.filter((o) => o.status === 'active'),
        ...rows.map(sortOrderFull),
      ],
      archiveLoading: false,
      archiveLoaded: true,
      archiveHasMore: rows.length === ARCHIVE_PAGE_SIZE,
    }));
  },

  loadMoreArchive: async () => {
    if (get().archiveLoading || !get().archiveHasMore) return;
    const loaded = get().orders.filter((o) => o.status !== 'active').length;
    set({ archiveLoading: true });
    let q = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .neq('status', 'active');
    if (!get().showDemoOrders) q = q.eq('is_demo', false);
    const { data, error } = await q
      .order('due_date', { ascending: true, nullsFirst: false })
      .range(loaded, loaded + ARCHIVE_PAGE_SIZE - 1);
    if (error) {
      toast.error('Не удалось догрузить архив');
      set({ archiveLoading: false });
      return;
    }
    const rows = (data ?? []) as ErpOrderFull[];
    // Дедуп по id: страница могла сдвинуться, если заказ ушёл в архив между запросами
    set((s) => {
      const known = new Set(s.orders.map((o) => o.id));
      const fresh = rows.filter((o) => !known.has(o.id)).map(sortOrderFull);
      return {
        orders: [...s.orders, ...fresh],
        archiveLoading: false,
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
    const { data, error } = await supabase
      .from('erp_orders')
      .select('id, title, status, created_at, is_demo')
      .eq('bitrix_id', value)
      .limit(5);
    // Молча: это подсказка, а не действие пользователя. Тост об упавшей
    // фоновой проверке во время заполнения формы только мешает.
    if (error) return [];
    return (data ?? []) as ErpOrderBrief[];
  },

  loadOne: async (orderId) => {
    const { data, error } = await supabase
      .from('erp_orders')
      .select(ORDER_SELECT)
      .eq('id', orderId)
      .maybeSingle();
    if (error) {
      toast.error('Не удалось загрузить заказ');
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
          // ОТК управляется галочкой позиции в форме; по умолчанию контроль есть.
          // В `erp_order_items` не пишется — маршрут уже материализован в этапах.
          needsQc: it.needs_qc ?? true,
        });
        const valid = route.filter((r) => deptByCode.has(r.departmentCode));
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

    let newId: string;
    try {
      const { data, error } = await supabase.rpc('erp_create_order', { payload });
      if (error || !data) {
        toast.error('Не удалось создать заказ');
        return null;
      }
      newId = data as string;
    } catch (e) {
      // Сбой ДО ответа сервера (нет сети, CORS). Заказ не создан — транзакция
      // либо не начиналась, либо откатилась, — поэтому просто сообщаем и
      // возвращаем null: форма остаётся заполненной, повтор безопасен.
      console.error('[createOrder]', e);
      toast.error('Не удалось создать заказ: нет связи с сервером');
      return null;
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
      // Эксперимент (волна 4.3): заказ-образец сразу заводит разработку в эксперим. цехе
      // (фаза «Построение лекал»), чтобы проработка не создавалась вручную.
      if (created.items.some((it) => it.production_type === 'samples')) {
        await get().createExperimental(created.id);
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
    const { error } = await withPending(`order:${id}`, () =>
      supabase.from('erp_orders').update(patch).eq('id', id));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить заказ');
      return false;
    }
    return true;
  },

  shipOrder: async (orderId) => {
    const prev = get().orders;
    const order = prev.find((o) => o.id === orderId);
    if (!order) return false;
    // отгружать можно только готовый заказ (все этапы done/skipped)
    if (!isOrderReadyToShip(order)) {
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
    const { error } = await withPending(`order:${orderId}`, () =>
      supabase.from('erp_orders').update(patch).eq('id', orderId));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось отгрузить заказ');
      return false;
    }
    toast.success('Заказ отгружен и перемещён в архив');
    return true;
  },

  deleteOrder: async (id) => {
    // НЕ optimistic — ждём Supabase
    const { error } = await supabase.from('erp_orders').delete().eq('id', id);
    if (error) {
      toast.error('Не удалось удалить заказ');
      return false;
    }
    set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));
    return true;
  },

  loadOrderEvents: async (orderId) => {
    const { data, error } = await supabase
      .from('erp_stage_events')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      toast.error('Не удалось загрузить историю');
      return null;
    }
    return (data ?? []) as ErpStageEvent[];
  },

  uploadOrderPreview: async (orderId, file) => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${orderId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('erp-attachments')
      .upload(path, file, { contentType: file.type || 'image/png' });
    if (upErr) {
      toast.error('Не удалось загрузить превью');
      return false;
    }
    const { data, error } = await supabase
      .from('erp_order_attachments')
      .insert({
        order_id: orderId,
        file_path: path,
        file_name: file.name,
        kind: 'preview',
        uploaded_by: currentActor(),
      })
      .select();
    const row = data?.[0] as ErpOrderAttachment | undefined;
    if (error || !row) {
      toast.error('Превью загружено, но не привязано к заказу');
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
    const { error: upErr } = await supabase.storage
      .from('erp-attachments')
      .upload(path, file, { contentType: file.type || 'image/jpeg' });
    if (upErr) {
      toast.error('Не удалось загрузить фото');
      return false;
    }
    const { data, error } = await supabase
      .from('erp_order_attachments')
      .insert({
        order_id: orderId,
        file_path: path,
        file_name: note ? `${note} — ${file.name}` : file.name,
        kind: 'attachment',
        uploaded_by: currentActor(),
      })
      .select();
    const row = data?.[0] as ErpOrderAttachment | undefined;
    if (error || !row) {
      toast.error('Фото загружено, но не привязано к заказу');
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
    const { data, error } = await supabase
      .from('erp_order_audit')
      .select('*')
      .eq('order_id', orderId)
      .order('changed_at', { ascending: false })
      .limit(100);
    if (error) {
      toast.error('Не удалось загрузить историю правок');
      return null;
    }
    return (data ?? []) as ErpOrderAuditRow[];
  },

  loadComments: async (orderId) => {
    const { data, error } = await supabase
      .from('erp_order_comments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) {
      toast.error('Не удалось загрузить комментарии');
      return null;
    }
    return (data ?? []) as ErpOrderComment[];
  },

  addComment: async (orderId, text) => {
    const { data, error } = await supabase
      .from('erp_order_comments')
      .insert({ order_id: orderId, author: currentActor(), text })
      .select();
    const row = data?.[0] as ErpOrderComment | undefined;
    if (error || !row) {
      toast.error('Не удалось отправить комментарий');
      return null;
    }
    // Пакет заказа теперь устарел: без сброса возврат на карточку в течение
    // TTL показал бы ленту без только что отправленного комментария.
    invalidate(orderBundleKey(orderId));
    return row;
  },
});
