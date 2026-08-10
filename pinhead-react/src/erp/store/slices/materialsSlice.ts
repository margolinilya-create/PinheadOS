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
import { localToday } from '../../../utils/date';

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
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        materials: o.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    }));
    const { error } = await erpQuery(() => supabase.from('erp_materials').update(patch).eq('id', id));
    if (error) {
      set({ orders: prev });
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
      received_at: localToday(),
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
    set((s) => ({
      orders: patchSuppliersIn(s.orders, materialId, (list) =>
        list.map((o) => (o.id === optionId ? { ...o, ...patch } : o))),
    }));
    const { error } = await erpQuery(() => supabase
      .from('erp_material_suppliers').update(patch).eq('id', optionId));
    if (error) {
      set({ orders: prev });
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
        set({ orders: prev });
        toast.error('Не удалось сменить поставщика');
        return false;
      }
    }
    const { error } = await erpQuery(() => supabase
      .from('erp_material_suppliers').update({ is_selected: true }).eq('id', optionId));
    if (error) {
      set({ orders: prev });
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
        received_on: input.receivedOn || localToday(),
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
    const supplyDept = get().departments.find((d) => d.code === 'supply');
    if (!order || !supplyDept) return;
    // «Готов» = пришло / зарезервировано со склада / не требуется.
    // length>0 — не закрывать закупку у заказа вовсе без материалов (аудит, LOW).
    const allIn = order.materials.length > 0 && order.materials.every(
      (m) => m.status === 'received' || m.status === 'reserved' || m.status === 'not_needed');
    if (!allIn) return;
    // Правка 4.1.3: плановое кол-во (qty_expected) — обязательная графа закупки. Без него
    // сделка не идёт дальше (иначе на приёмке склад не увидит план). Гейтим только закупаемые.
    const missingPlan = order.materials.filter(
      (m) => m.source === 'purchase' && (m.qty_expected == null || m.qty_expected <= 0));
    if (missingPlan.length > 0) {
      toast.warning(`Укажите плановое кол-во в закупке: ${missingPlan.map((m) => m.name).join(', ')}`);
      return;
    }
    const openSupply = order.items.flatMap((it) =>
      it.stages.filter(
        (st) => st.department_id === supplyDept.id &&
          st.status !== 'done' && st.status !== 'skipped'));
    for (const st of openSupply) {
      await get().setStageStatus(st.id, 'done', { comment: 'Материалы готовы — закупка закрыта автоматически' });
    }
    if (openSupply.length > 0) toast.success('Материалы готовы — закупка по заказу закрыта');
  },
});
