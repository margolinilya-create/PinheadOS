/**
 * Слайс материалов: добавление/правка, подтверждение склада, авто-закрытие закупки.
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 * maybeCloseSupply/confirmStockMaterial зовут действия других слайсов через get().
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpError, erpQuery, erpWrite } from '../shared';
import { toast } from '../../../store/useToastStore';
import type { ErpMaterial, ErpMaterialSupplier } from '../../types';
import type { ErpStore, MaterialsSlice } from '../types';
import { factoryToday } from '../../../utils/date';
import { findSupplyDept, openSupplyStages, supplyMaterialSummary } from '../../utils/supply';
import { autoOrderedStatus } from '../../utils/materialStatus';

/** Точечный патч массива вариантов поставщика у материала (не трогая остальные заказы) */
function patchSuppliersIn(
  orders: ErpStore['orders'],
  materialId: string,
  apply: (list: ErpMaterialSupplier[]) => ErpMaterialSupplier[],
): ErpStore['orders'] {
  return orders.map((o) => {
    if (!o.materials.some((m) => m.id === materialId)) return o;
    return {
      ...o,
      materials: o.materials.map((m) =>
        m.id === materialId ? { ...m, suppliers: apply(m.suppliers ?? []) } : m),
    };
  });
}

export const materialsSlice: StateCreator<ErpStore, [], [], MaterialsSlice> = (set, get) => ({
  preliminary: [],
  preliminaryLoaded: false,

  /**
   * Предварительные закупки: строки без заказа. Отдельный запрос обязателен —
   * обычные материалы приезжают вложенным select-ом к заказу, и строка,
   * у которой заказа нет, туда не попадёт никогда.
   */
  loadPreliminary: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_materials')
      .select('*')
      .is('order_id', null)
      .order('created_at', { ascending: false }));
    if (error) {
      erpError('Не удалось загрузить предварительные закупки', error);
      return;
    }
    set({ preliminary: (data ?? []) as ErpMaterial[], preliminaryLoaded: true });
  },

  addPreliminaryMaterial: async (material) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_materials')
      .insert({ ...material, order_id: null, source: material.source ?? 'purchase' })
      .select());
    const row = data?.[0] as ErpMaterial | undefined;
    if (error || !row) {
      erpError('Предварительная закупка не создана', error);
      return null;
    }
    set((s) => ({ preliminary: [row, ...s.preliminary] }));
    return row;
  },

  /**
   * Привязка к заказу — UPDATE, а не копия: «система не должна создавать вторую
   * дублирующую закупку» (п. 17.1). После привязки строка уходит из списка
   * предварительных и появляется в заказе, поэтому заказ перечитывается.
   */
  attachPreliminaryToOrder: async (materialId, orderId) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_materials')
      .update({ order_id: orderId })
      .eq('id', materialId)
      .is('order_id', null)
      .select());
    /**
     * Пустой ответ — не успех. RLS на UPDATE запрещает через `USING`, то есть
     * отдаёт «0 строк», а не ошибку; и то же самое вернёт `.is('order_id', null)`,
     * если строку уже привязали в соседней вкладке. Молча показать зелёное
     * здесь означало бы «привязал» там, где ничего не произошло.
     */
    if (error || (data ?? []).length === 0) {
      erpError('Закупка не привязана к заказу', error);
      return false;
    }
    set((s) => ({ preliminary: s.preliminary.filter((m) => m.id !== materialId) }));
    await get().loadOne(orderId);
    return true;
  },

  addMaterial: async (orderId, material) => {
    /**
     * «Заказано» ставится ПО ФАКТУ и здесь тоже (правка 24.08, п. 1): заводя
     * строку, закупщик часто уже разговаривал с поставщиком и заполняет
     * количество и дату сразу. Оба писателя статуса — вставка и правка —
     * зовут одну функцию: вторая копия правила разошлась бы с первой молча,
     * и «Заказано» значило бы разное в зависимости от того, каким путём
     * строка появилась.
     */
    const withStatus = {
      ...material,
      ...(autoOrderedStatus({
        source: material.source ?? 'purchase',
        status: material.status ?? 'pending',
        qty_ordered: material.qty_ordered ?? null,
        ordered_on: material.ordered_on ?? null,
      }) ? { status: 'ordered' as const } : {}),
    };
    const { data, error } = await erpQuery(() => supabase
      .from('erp_materials')
      .insert({ ...withStatus, order_id: orderId })
      .select());
    const row = data?.[0] as ErpMaterial | undefined;
    if (error || !row) {
      erpError('Материал не добавлен', error);
      return null;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId ? { ...o, materials: [...o.materials, row] } : o),
    }));
    // Правка 4: добавление сразу-готового материала тоже должно закрывать этап «Закупка»
    await get().maybeCloseSupply(orderId);
    return row;
  },

  updateMaterial: async (id, rawPatch) => {
    const prev = get().orders;
    /**
     * Статус «Заказано» — производная от «Количество к заказу» и «Дата заказа»
     * (правка 24.08, п. 1), и считается она ЗДЕСЬ, в единственном писателе
     * закупочных полей. В компоненте её держать нельзя: инлайн-правку рисуют
     * две раскладки (таблица и карточка планшета), и вторая копия правила —
     * ровно тот случай, на котором проект уже ловился.
     */
    const current = prev
      .flatMap((o) => o.materials)
      .find((m) => m.id === id);
    const patch = { ...rawPatch };
    if (current) {
      const next = { ...current, ...patch };
      if (autoOrderedStatus(next)) patch.status = 'ordered';
    }
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        materials: o.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    }));
    /**
     * `.select()` и проверка длины: RLS на UPDATE запрещает через `USING`,
     * то есть отдаёт «0 строк» без ошибки. Закупочные поля правом не гейтятся,
     * а вот `accept_*` держит страж `erp_material_guard` — и без этой проверки
     * правка приёмки без права оставалась бы на экране как сохранённая.
     */
    const ok = await erpWrite('Материал не обновлён', () => supabase
      .from('erp_materials').update(patch).eq('id', id).select());
    if (!ok) {
      set({ orders: prev });
      return false;
    }
    const order = get().orders.find((o) => o.materials.some((m) => m.id === id));
    if (order) await get().maybeCloseSupply(order.id);
    return true;
  },

  confirmStockMaterial: async (id) => {
    // Материал со склада: подтверждение наличия → «Доступен со склада» (reserved)
    const ok = await get().updateMaterial(id, {
      status: 'reserved',
      received_at: factoryToday(),
    });
    return ok;
  },

  addSupplierOption: async (materialId, option) => {
    const supplier = (option.supplier ?? '').trim();
    if (!supplier) {
      // Молчаливый выход: кнопка нажата, не происходит ничего, объяснения нет
      toast.error('Укажите поставщика');
      return null;
    }
    const { data, error } = await erpQuery(() => supabase
      .from('erp_material_suppliers')
      .insert({ ...option, supplier, material_id: materialId })
      .select());
    const row = data?.[0] as ErpMaterialSupplier | undefined;
    if (error || !row) {
      erpError('Вариант поставщика не добавлен', error);
      return null;
    }
    set((s) => ({ orders: patchSuppliersIn(s.orders, materialId, (list) => [...list, row]) }));
    return row;
  },

  updateSupplierOption: async (materialId, optionId, patch) => {
    const prev = get().orders;
    set((s) => ({
      orders: patchSuppliersIn(s.orders, materialId, (list) =>
        list.map((o) => (o.id === optionId ? { ...o, ...patch } : o))),
    }));
    const ok = await erpWrite('Вариант поставщика не сохранён', () => supabase
      .from('erp_material_suppliers').update(patch).eq('id', optionId).select());
    if (!ok) {
      set({ orders: prev });
      return false;
    }
    return true;
  },

  /**
   * Выбор итогового поставщика: снимаем флаг с прежнего, ставим на новый и дублируем имя
   * в erp_materials.supplier — оттуда его берут закупка, план приёмки и карточка заказа.
   * Частичный уникальный индекс не даёт двум вариантам быть выбранными одновременно,
   * поэтому сначала снимаем старый флаг и только затем ставим новый.
   */
  selectSupplierOption: async (materialId, optionId) => {
    const prev = get().orders;
    const material = prev.flatMap((o) => o.materials).find((m) => m.id === materialId);
    const option = (material?.suppliers ?? []).find((o) => o.id === optionId);
    if (!option) {
      erpError('Поставщик не выбран', { message: 'вариант не найден — обновите страницу' });
      return false;
    }

    const previousSelected = (material?.suppliers ?? []).filter(
      (o) => o.is_selected && o.id !== optionId);

    set((s) => ({
      orders: patchSuppliersIn(s.orders, materialId, (list) =>
        list.map((o) => ({ ...o, is_selected: o.id === optionId }))),
    }));

    /**
     * Действие из нескольких записей, и откатывать интерфейс поверх уже
     * закоммиченных нельзя (правило проекта, на нём ловились с переносом этапа).
     * Здесь это было именно так: снятие флага у прежнего поставщика уходило
     * отдельным запросом, и при сбое ВТОРОГО запроса `set({ orders: prev })`
     * возвращал на экран прежнего выбранного — которого в базе уже не было.
     *
     * `committed` отмечает момент, после которого правды на клиенте нет:
     * дальше состояние берётся с сервера, а не выдумывается.
     */
    let committed = false;
    const orderId = prev.find((o) => o.materials.some((m) => m.id === materialId))?.id ?? null;
    /** Сообщение об отказе одно: экран либо возвращается как был, либо перечитывается */
    const fail = async (): Promise<false> => {
      if (committed && orderId) {
        await get().loadOne(orderId);
        return erpError('Поставщик выбран не полностью',
          { message: 'часть изменений сохранена — состояние перечитано с сервера' });
      }
      set({ orders: prev });
      return erpError('Поставщик не выбран',
        { message: 'нет прав на это действие или запись изменена другим' });
    };
    /** Запись без собственного тоста: о результате говорит `fail` один раз */
    const write = async (id: string, isSelected: boolean): Promise<boolean> => {
      const { data, error } = await erpQuery(() => supabase
        .from('erp_material_suppliers').update({ is_selected: isSelected }).eq('id', id).select());
      return !error && (data ?? []).length > 0;
    };

    for (const old of previousSelected) {
      if (!(await write(old.id, false))) return fail();
      committed = true;
    }
    if (!(await write(optionId, true))) return fail();
    committed = true;
    return get().updateMaterial(materialId, { supplier: option.supplier });
  },

  /**
   * Удаление варианта. Если удаляют выбранного — поставщик у позиции очищается:
   * лучше пустое поле, чем имя, за которым больше нет предложения.
   */
  deleteSupplierOption: async (materialId, optionId) => {
    const prev = get().orders;
    const material = prev.flatMap((o) => o.materials).find((m) => m.id === materialId);
    const option = (material?.suppliers ?? []).find((o) => o.id === optionId);
    // Не optimistic delete (правило репо) — ждём ответ Supabase
    /**
     * DELETE под RLS запрещается через `USING` — «удалено 0 строк», а не 42501.
     * Проверка одного `error` убирала вариант с экрана, а в базе он оставался
     * и возвращался при следующей загрузке. То же самое уже ловили на удалении
     * заказа.
     */
    const ok = await erpWrite('Вариант поставщика не удалён', () => supabase
      .from('erp_material_suppliers').delete().eq('id', optionId).select());
    if (!ok) return false;
    set((s) => ({
      orders: patchSuppliersIn(s.orders, materialId, (list) =>
        list.filter((o) => o.id !== optionId)),
    }));
    if (option?.is_selected) await get().updateMaterial(materialId, { supplier: null });
    return true;
  },

  /*
   * `addMaterialReceipt` удалено 22.08.
   *
   * Это было ОТДЕЛЬНОЕ действие «записать приход» рядом с «принять материал»,
   * и приход в нём был необязательным вторым шагом. На боевой базе за полтора
   * месяца им не воспользовались ни разу: девять материалов приняты, строк
   * журнала — ноль, `qty_received` пуст у всех девятнадцати позиций. Форма,
   * которую можно не заполнить, у величины, на которой построены три
   * показателя экрана, — это не форма, а необязательное поле.
   *
   * Теперь приход и статус пишет один оператор — `acceptMaterial`
   * (RPC `erp_material_accept`, журнал плюс позиция одной транзакцией).
   * Второй писатель здесь снова завёл бы ту же развилку.
   */

  maybeCloseSupply: async (orderId) => {
    const order = get().orders.find((o) => o.id === orderId);
    const supplyDept = findSupplyDept(get().departments);
    if (!order || !supplyDept) return;
    // «Готов» = пришло / зарезервировано со склада / не требуется.
    // Пустой список готовым НЕ считается: заказ без заведённых материалов
    // не должен закрывать закупку сам собой (аудит, LOW). Для него есть
    // явное действие `closeSupply` — с комментарием, от человека.
    const summary = supplyMaterialSummary(order.materials);
    if (!summary.allSettled) return;
    // Правка 4.1.3: плановое кол-во (qty_expected) — обязательная графа закупки. Без него
    // сделка не идёт дальше (иначе на приёмке склад не увидит план). Гейтим только закупаемые.
    if (summary.missingPlan.length > 0) {
      toast.warning(`Укажите плановое кол-во в закупке: ${summary.missingPlan.map((m) => m.name).join(', ')}`);
      return;
    }
    const openSupply = openSupplyStages(order, supplyDept.id);
    for (const st of openSupply) {
      await get().setStageStatus(st.id, 'done', { comment: 'Материалы готовы — закупка закрыта автоматически' });
    }
    if (openSupply.length > 0) toast.success('Материалы готовы — закупка по заказу закрыта');
  },

  takeSupply: async (orderId, plannedEnd = null) => {
    const order = get().orders.find((o) => o.id === orderId);
    const supplyDept = findSupplyDept(get().departments);
    if (!order || !supplyDept) {
      return erpError('Закупка не взята в работу',
        { message: 'данные ещё загружаются — обновите страницу и повторите' });
    }
    // Берём только ещё не начатые: повторный перевод в `in_progress` — лишний
    // запрос, а у заблокированного этапа сначала снимают блокировку
    const toTake = openSupplyStages(order, supplyDept.id)
      .filter((st) => st.status !== 'in_progress' && st.status !== 'blocked');
    // Молча ничего не делать нельзя: кнопка нажата, и «уже в работе»
    // от «заблокировано» человек должен отличить
    if (toTake.length === 0) {
      return erpError('Закупка не взята в работу',
        { message: 'нечего брать: этапы уже в работе или заблокированы' });
    }
    for (const st of toTake) {
      /*
       * ПЛАН — В ТОМ ЖЕ ЗАПРОСЕ, ЧТО СТАТУС (правка 03.09).
       *
       * Прежний комментарий утверждал, что страж пропускает `planned_end`
       * под правом взятия в работу. Пропускает — но ТОЛЬКО когда дата меняется
       * той же строкой, что переводит этап в `in_progress`
       * (`erp_stage_guard`: `new.status = 'in_progress' and old.status is
       * distinct from 'in_progress'`). Отдельный запрос под исключение
       * не подпадает и требует `order.manage`, которого у закупщика нет
       * (проверено на проде: `allowed = false`). То есть дата не записывалась.
       */
      const ok = await get().setStageStatus(st.id, 'in_progress', {
        comment: 'Закупка взята в работу',
        ...(plannedEnd ? { planned_end: plannedEnd } : {}),
      });
      // Первый же отказ (нет права, чужой цех) — дальше не идём: остальные
      // этапы упрутся в то же самое, а серия тостов ничего не добавит
      if (!ok) return false;
    }
    return true;
  },

  /**
   * Явное закрытие закупки по заказу.
   *
   * Комментарий обязателен и уходит в ленту событий КАЖДОГО закрытого этапа:
   * закупку закрывают и тогда, когда материалы не заводили вовсе (давальческое
   * сырьё, закупка вне системы, позиция без материалов), и через неделю
   * «почему этап закрыт пустым» должно отвечать не расследование, а история.
   */
  closeSupply: async (orderId, comment) => {
    const text = (comment ?? '').trim();
    if (!text) {
      toast.error('Объясните, почему закупка завершена');
      return false;
    }
    const order = get().orders.find((o) => o.id === orderId);
    const supplyDept = findSupplyDept(get().departments);
    /**
     * Молчаливые выходы: кнопка нажата, подтверждение введено — и не происходит
     * ничего. Справочник цехов мог не догрузиться, а этап — закрыться в соседней
     * вкладке; и то и другое человеку надо СКАЗАТЬ, иначе он жмёт снова.
     */
    if (!order || !supplyDept) {
      return erpError('Закупка не закрыта',
        { message: 'данные ещё загружаются — обновите страницу и повторите' });
    }
    const openSupply = openSupplyStages(order, supplyDept.id);
    if (openSupply.length === 0) {
      return erpError('Закупка не закрыта',
        { message: 'открытых этапов закупки у заказа нет — возможно, её уже закрыли' });
    }
    for (const st of openSupply) {
      const ok = await get().setStageStatus(st.id, 'done', { comment: text });
      if (!ok) return false;
    }
    toast.success('Закупка по заказу закрыта');
    return true;
  },
});
