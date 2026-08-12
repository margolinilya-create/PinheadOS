/**
 * Слайс материалов: добавление/правка, подтверждение склада, авто-закрытие закупки.
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 * maybeCloseSupply/confirmStockMaterial зовут действия других слайсов через get().
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { currentActor, erpError, erpQuery } from '../shared';
import { toast } from '../../../store/useToastStore';
import type { ErpMaterial, ErpMaterialSupplier } from '../../types';
import type { ErpStore, MaterialsSlice } from '../types';
import { factoryToday } from '../../../utils/date';
import { restoreOrderIn } from '../orderHelpers';
import { findSupplyDept, openSupplyStages, supplyMaterialSummary } from '../../utils/supply';
import { actorCanDo } from '../../utils/permissions';
import { useAuthStore } from '../../../store/useAuthStore';

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
  addMaterial: async (orderId, material) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_materials')
      .insert({ ...material, order_id: orderId })
      .select());
    const row = data?.[0] as ErpMaterial | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить материал');
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

  updateMaterial: async (id, patch) => {
    const prev = get().orders;
    const matOrderId = prev.find((o) => o.materials.some((m) => m.id === id))?.id;
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        materials: o.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    }));
    const { error } = await erpQuery(() => supabase.from('erp_materials').update(patch).eq('id', id));
    if (error) {
      set((s2) => ({ orders: restoreOrderIn(s2.orders, prev, matOrderId) }));
      toast.error('Не удалось обновить материал');
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
    if (!supplier) return null;
    const { data, error } = await erpQuery(() => supabase
      .from('erp_material_suppliers')
      .insert({ ...option, supplier, material_id: materialId })
      .select());
    const row = data?.[0] as ErpMaterialSupplier | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить вариант поставщика');
      return null;
    }
    set((s) => ({ orders: patchSuppliersIn(s.orders, materialId, (list) => [...list, row]) }));
    return row;
  },

  updateSupplierOption: async (materialId, optionId, patch) => {
    const prev = get().orders;
    const optOrderId = prev.find((o) => o.materials.some((m) => m.id === materialId))?.id;
    set((s) => ({
      orders: patchSuppliersIn(s.orders, materialId, (list) =>
        list.map((o) => (o.id === optionId ? { ...o, ...patch } : o))),
    }));
    const { error } = await erpQuery(() => supabase
      .from('erp_material_suppliers').update(patch).eq('id', optionId));
    if (error) {
      set((s2) => ({ orders: restoreOrderIn(s2.orders, prev, optOrderId) }));
      toast.error('Не удалось сохранить вариант поставщика');
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
    const selOrderId = prev.find((o) => o.materials.some((m) => m.id === materialId))?.id;
    const material = prev.flatMap((o) => o.materials).find((m) => m.id === materialId);
    const option = (material?.suppliers ?? []).find((o) => o.id === optionId);
    if (!option) return false;

    const previousSelected = (material?.suppliers ?? []).filter(
      (o) => o.is_selected && o.id !== optionId);

    set((s) => ({
      orders: patchSuppliersIn(s.orders, materialId, (list) =>
        list.map((o) => ({ ...o, is_selected: o.id === optionId }))),
    }));

    for (const old of previousSelected) {
      const { error } = await erpQuery(() => supabase
        .from('erp_material_suppliers').update({ is_selected: false }).eq('id', old.id));
      if (error) {
        set((s2) => ({ orders: restoreOrderIn(s2.orders, prev, selOrderId) }));
        toast.error('Не удалось сменить поставщика');
        return false;
      }
    }
    const { error } = await erpQuery(() => supabase
      .from('erp_material_suppliers').update({ is_selected: true }).eq('id', optionId));
    if (error) {
      set((s2) => ({ orders: restoreOrderIn(s2.orders, prev, selOrderId) }));
      toast.error('Не удалось выбрать поставщика');
      return false;
    }
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
    const { error } = await erpQuery(() => supabase.from('erp_material_suppliers').delete().eq('id', optionId));
    if (error) {
      toast.error('Не удалось удалить вариант поставщика');
      return false;
    }
    set((s) => ({
      orders: patchSuppliersIn(s.orders, materialId, (list) =>
        list.filter((o) => o.id !== optionId)),
    }));
    if (option?.is_selected) await get().updateMaterial(materialId, { supplier: null });
    return true;
  },

  /**
   * Приход материала частями (правки заказчика 10.08, волна 3.3).
   *
   * Документ: «пришло 60 из 100, потом ещё 35 — видно, что осталось 5».
   * Пишем СТРОКУ ЖУРНАЛА, а не поле: сумму по журналу ведёт триггер и кладёт
   * её в `erp_materials.qty_received`, которую читают материальный гейт, гейт
   * отгрузки и автозакрытие закупки. Прямая запись в колонку из карточки
   * убрана — иначе у одного значения два писателя, и приход затирал бы приход.
   *
   * Не optimistic: сумму считает сервер, и показать её раньше ответа значит
   * нарисовать число, которого может не получиться (права, CHECK на отклонении).
   */
  addMaterialReceipt: async (materialId, input) => {
    const qty = Number(input.qty);
    if (!(qty > 0)) {
      toast.error('Количество прихода должно быть больше нуля');
      return false;
    }
    const status = input.acceptStatus ?? 'accepted_full';
    const comment = (input.comment ?? '').trim();
    if (status !== 'accepted_full' && status !== 'accepted_partial' && !comment) {
      toast.error('Отклонение нужно объяснить — заполните комментарий');
      return false;
    }
    const { error } = await erpQuery(() => supabase
      .from('erp_material_receipts')
      .insert({
        material_id: materialId,
        qty,
        unit: input.unit ?? null,
        accept_status: status,
        invoice: input.invoice?.trim() || null,
        comment: comment || null,
        received_on: input.receivedOn || factoryToday(),
        author: currentActor(),
      }));
    if (error) {
      erpError('Приход не записан', error);
      return false;
    }
    // Сумму пересчитал триггер — перечитываем заказ, чтобы гейты увидели новое
    const order = get().orders.find((o) => o.materials.some((m) => m.id === materialId));
    if (order) await get().loadOne(order.id);
    return true;
  },

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
    if (openSupply.length === 0) return;
    /*
     * Побочный эффект спрашивает права ТЕМ ЖЕ гейтом, что кнопка.
     *
     * Закрытие этапа закупки требует `stage.complete` (плюс принадлежность
     * цеху) — так же, как любое другое закрытие этапа. Право есть у закупщика
     * (выдано 12.08 ровно ради этого) и у руководящего состава, но НЕТ
     * у кладовщика: решение записано в `DEFAULT_PERMISSIONS` («этапа
     * в маршруте у склада нет вовсе»). А сюда приходит именно кладовщик —
     * `acceptMaterial` → `updateMaterial` → это место, — и раньше уходил
     * на сервер без всякой проверки, получая от `erp_stage_guard` 42501
     * и красное «Этап не обновлён» поверх успешно принятого материала.
     * Менеджер получал то же самое, правя закупочные поля: они правом
     * не гейтятся, а закрытие этапа — гейтится.
     *
     * Без права просто НЕ закрываем: у закупщика есть явное действие
     * «Закупка завершена», и заказ остаётся в его очереди (`ordersAwaitingSupply`
     * считает открытые этапы). Ложная ошибка исчезает, а решение остаётся
     * за тем, за кем оно и должно быть по документу.
     */
    const user = useAuthStore.getState().user;
    const canClose = actorCanDo(
      {
        profileRole: user?.role,
        isDev: user?.id === 'dev',
        employeeRole: get().myRole,
        myDeptId: get().myDeptId,
        matrix: get().permissionMatrix,
      },
      'stage.complete',
      supplyDept.id,
    );
    if (!canClose) return;
    for (const st of openSupply) {
      await get().setStageStatus(st.id, 'done', { comment: 'Материалы готовы — закупка закрыта автоматически' });
    }
    toast.success('Материалы готовы — закупка по заказу закрыта');
  },

  takeSupply: async (orderId) => {
    const order = get().orders.find((o) => o.id === orderId);
    const supplyDept = findSupplyDept(get().departments);
    if (!order || !supplyDept) return false;
    // Берём только ещё не начатые: повторный перевод в `in_progress` — лишний
    // запрос, а у заблокированного этапа сначала снимают блокировку
    const toTake = openSupplyStages(order, supplyDept.id)
      .filter((st) => st.status !== 'in_progress' && st.status !== 'blocked');
    if (toTake.length === 0) return false;
    for (const st of toTake) {
      const ok = await get().setStageStatus(st.id, 'in_progress', {
        comment: 'Закупка взята в работу',
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
    if (!order || !supplyDept) return false;
    const openSupply = openSupplyStages(order, supplyDept.id);
    if (openSupply.length === 0) return false;
    for (const st of openSupply) {
      const ok = await get().setStageStatus(st.id, 'done', { comment: text });
      if (!ok) return false;
    }
    toast.success('Закупка по заказу закрыта');
    return true;
  },
});
