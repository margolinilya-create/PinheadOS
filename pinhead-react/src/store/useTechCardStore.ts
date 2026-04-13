// redesign/v2 — TechDesign bounded context root store (ADR-0001)
//
// Separate Zustand root store from the existing sales useStore. Cross-store
// reads happen via params (pass orderId), writes via domain events (ADR-0004).
// W1 Day-2 scope: catalog loaders + tech card CRUD skeleton. UI wiring lands
// in W3 Tech Card Builder.

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../lib/supabase';
import { emitDomainEvent } from '../lib/domainEvents';
import { toast } from './useToastStore';
import { translateSupabaseError } from '../utils/i18n';
import type {
  Section,
  OperationType,
  SkuTechTemplate,
  SkuTechTemplateItem,
  OrderTechCard,
  OrderTechOperation,
} from '../types/production';

interface TechCardStore {
  // Catalog — loaded once per session, read-heavy
  sections: Section[];
  operationTypes: OperationType[];
  catalogLoaded: boolean;

  // Current order context — single tech card being edited
  currentOrderId: string | null;
  techCard: OrderTechCard | null;
  operations: OrderTechOperation[];

  // Templates — loaded on demand per SKU
  templatesBySku: Record<string, SkuTechTemplate[]>;
  templateItems: Record<string, SkuTechTemplateItem[]>;

  loading: boolean;
  error: string | null;

  loadCatalog: () => Promise<void>;
  loadTechCardForOrder: (orderId: string) => Promise<void>;
  loadTemplatesForSku: (skuCode: string) => Promise<void>;

  createDraftTechCard: (orderId: string, templateId?: string) => Promise<OrderTechCard | null>;
  addOperation: (operationTypeId: string, qty: number) => Promise<void>;
  updateOperationQty: (operationId: string, qty: number) => Promise<void>;
  removeOperation: (operationId: string) => Promise<OrderTechOperation | null>;
  restoreOperation: (operation: OrderTechOperation) => Promise<void>;
  approveTechCard: () => Promise<boolean>;

  reset: () => void;
}

const initialState = {
  sections: [] as Section[],
  operationTypes: [] as OperationType[],
  catalogLoaded: false,
  currentOrderId: null,
  techCard: null,
  operations: [] as OrderTechOperation[],
  templatesBySku: {} as Record<string, SkuTechTemplate[]>,
  templateItems: {} as Record<string, SkuTechTemplateItem[]>,
  loading: false,
  error: null,
};

export const useTechCardStore = create<TechCardStore>((set, get) => ({
  ...initialState,

  loadCatalog: async () => {
    if (get().catalogLoaded) return;
    set({ loading: true, error: null });

    const [sectionsRes, opsRes] = await Promise.all([
      supabase.from('sections').select('*').is('deleted_at', null).order('sort_order'),
      supabase.from('operation_types').select('*').is('deleted_at', null).order('sort_order'),
    ]);

    if (sectionsRes.error) {
      toast.error(translateSupabaseError(sectionsRes.error.message));
      set({ loading: false, error: sectionsRes.error.message });
      return;
    }
    if (opsRes.error) {
      toast.error(translateSupabaseError(opsRes.error.message));
      set({ loading: false, error: opsRes.error.message });
      return;
    }

    set({
      sections: (sectionsRes.data ?? []) as Section[],
      operationTypes: (opsRes.data ?? []) as OperationType[],
      catalogLoaded: true,
      loading: false,
    });
  },

  loadTechCardForOrder: async (orderId) => {
    set({ loading: true, error: null, currentOrderId: orderId });

    const { data: card, error: cardErr } = await supabase
      .from('order_tech_cards')
      .select('*')
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .maybeSingle();

    if (cardErr) {
      toast.error(translateSupabaseError(cardErr.message));
      set({ loading: false, error: cardErr.message });
      return;
    }

    if (!card) {
      set({ techCard: null, operations: [], loading: false });
      return;
    }

    const { data: ops, error: opsErr } = await supabase
      .from('order_tech_operations')
      .select('*')
      .eq('tech_card_id', card.id)
      .is('deleted_at', null)
      .order('sort_order');

    if (opsErr) {
      toast.error(translateSupabaseError(opsErr.message));
      set({ loading: false, error: opsErr.message });
      return;
    }

    set({
      techCard: card as OrderTechCard,
      operations: (ops ?? []) as OrderTechOperation[],
      loading: false,
    });
  },

  loadTemplatesForSku: async (skuCode) => {
    if (get().templatesBySku[skuCode]) return;

    const { data: templates, error: tplErr } = await supabase
      .from('sku_tech_templates')
      .select('*')
      .eq('sku_code', skuCode)
      .is('deleted_at', null);

    if (tplErr) {
      toast.error(translateSupabaseError(tplErr.message));
      return;
    }

    const list = (templates ?? []) as SkuTechTemplate[];
    set((s) => ({ templatesBySku: { ...s.templatesBySku, [skuCode]: list } }));

    if (list.length === 0) return;

    const { data: items, error: itemsErr } = await supabase
      .from('sku_tech_template_items')
      .select('*')
      .in('template_id', list.map((t) => t.id))
      .is('deleted_at', null)
      .order('sort_order');

    if (itemsErr) {
      toast.error(translateSupabaseError(itemsErr.message));
      return;
    }

    const grouped: Record<string, SkuTechTemplateItem[]> = {};
    for (const item of (items ?? []) as SkuTechTemplateItem[]) {
      (grouped[item.template_id] ??= []).push(item);
    }
    set((s) => ({ templateItems: { ...s.templateItems, ...grouped } }));
  },

  createDraftTechCard: async (orderId, templateId) => {
    const { data, error } = await supabase
      .from('order_tech_cards')
      .insert({ order_id: orderId, template_id: templateId ?? null, status: 'draft' })
      .select()
      .single();

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return null;
    }

    set({ techCard: data as OrderTechCard, operations: [], currentOrderId: orderId });
    return data as OrderTechCard;
  },

  addOperation: async (operationTypeId, qty) => {
    const { techCard, operationTypes, operations } = get();
    if (!techCard) {
      toast.error('Tech card не создан');
      return;
    }
    if (techCard.status !== 'draft') {
      toast.error('Tech card уже утверждена — нельзя добавлять операции');
      return;
    }

    const opType = operationTypes.find((o) => o.id === operationTypeId);
    if (!opType) {
      toast.error('Операция не найдена в каталоге');
      return;
    }

    // Snapshot at insert-time. Refresh-on-approve happens in approveTechCard().
    const { data, error } = await supabase
      .from('order_tech_operations')
      .insert({
        tech_card_id: techCard.id,
        order_id: techCard.order_id,
        operation_type_id: opType.id,
        section_id: opType.section_id,
        qty,
        rate_snapshot: opType.base_rate,
        minutes_snapshot: opType.base_minutes,
        name_snapshot: opType.name,
        unit_snapshot: opType.unit,
        sort_order: operations.length * 10,
      })
      .select()
      .single();

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return;
    }

    set((s) => ({ operations: [...s.operations, data as OrderTechOperation] }));
  },

  updateOperationQty: async (operationId, qty) => {
    const { techCard, operations } = get();
    if (!techCard || techCard.status === 'locked') {
      toast.error('Нельзя изменять операции заблокированной карты');
      return;
    }

    const prev = operations.find((o) => o.id === operationId);
    if (!prev) return;

    // Optimistic
    set((s) => ({
      operations: s.operations.map((o) => (o.id === operationId ? { ...o, qty } : o)),
    }));

    const { error } = await supabase
      .from('order_tech_operations')
      .update({ qty })
      .eq('id', operationId);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      // Rollback
      set((s) => ({
        operations: s.operations.map((o) => (o.id === operationId ? prev : o)),
      }));
    }
  },

  removeOperation: async (operationId) => {
    const { techCard, operations } = get();
    if (!techCard || techCard.status !== 'draft') {
      toast.error('Удаление возможно только в draft статусе');
      return null;
    }

    const removed = operations.find((o) => o.id === operationId) ?? null;

    const { error } = await supabase
      .from('order_tech_operations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', operationId);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return null;
    }

    set((s) => ({ operations: s.operations.filter((o) => o.id !== operationId) }));
    return removed;
  },

  restoreOperation: async (operation) => {
    const { error } = await supabase
      .from('order_tech_operations')
      .update({ deleted_at: null })
      .eq('id', operation.id);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return;
    }

    set((s) => {
      // Re-insert at original sort position; if the list moved, append.
      const exists = s.operations.some((o) => o.id === operation.id);
      if (exists) return s;
      const restored = { ...operation, deleted_at: null };
      const next = [...s.operations];
      const insertIdx = next.findIndex((o) => o.sort_order > restored.sort_order);
      if (insertIdx === -1) next.push(restored);
      else next.splice(insertIdx, 0, restored);
      return { operations: next };
    });
  },

  approveTechCard: async () => {
    const { techCard, operations, operationTypes } = get();
    if (!techCard || techCard.status !== 'draft') return false;

    // Refresh snapshots from current operation_types catalog (ADR-0002:
    // freeze happens at approve-time, not at draft-add-time).
    for (const op of operations) {
      const current = operationTypes.find((o) => o.id === op.operation_type_id);
      if (!current) continue;
      if (
        current.base_rate !== op.rate_snapshot ||
        current.base_minutes !== op.minutes_snapshot ||
        current.name !== op.name_snapshot
      ) {
        const { error } = await supabase
          .from('order_tech_operations')
          .update({
            rate_snapshot: current.base_rate,
            minutes_snapshot: current.base_minutes,
            name_snapshot: current.name,
            unit_snapshot: current.unit,
          })
          .eq('id', op.id);
        if (error) {
          toast.error(translateSupabaseError(error.message));
          return false;
        }
      }
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;

    const { data, error } = await supabase
      .from('order_tech_cards')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: userId,
      })
      .eq('id', techCard.id)
      .select()
      .single();

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return false;
    }

    set({ techCard: data as OrderTechCard });

    // Emit domain event (ADR-0004). Best-effort; not wrapped in the
    // same tx as the UPDATE above, but idempotency_key scopes it per
    // card so replays dedupe consumer-side.
    void emitDomainEvent({
      event_type: 'tech_card.approved',
      aggregate_type: 'order_tech_card',
      aggregate_id: techCard.id,
      payload: {
        order_id: techCard.order_id,
        operation_count: operations.length,
        approved_by: userId,
      },
      idempotency_suffix: 'approve',
    });

    // Reload operations to pick up refreshed snapshots
    await get().loadTechCardForOrder(techCard.order_id);
    return true;
  },

  reset: () => set(initialState),
}));

// Shallow-selector helper for consumers that read multiple fields.
// Pattern matches existing slices in useStore.
export const useTechCard = <T>(selector: (s: TechCardStore) => T) =>
  useTechCardStore(useShallow(selector));
