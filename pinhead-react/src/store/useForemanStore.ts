// redesign/v2 — Foreman bounded context (ADR-0001)
//
// Мастер-экран бригадира. Aggregates one section's approved/locked
// operations and provides quick-action helpers for assigning work and
// emitting piecework entries. Reads are section-scoped; writes go via
// piecework store (imports would cross bounded contexts — we pass the
// needed refs as params instead per ADR-0001).

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../lib/supabase';
import { toast } from './useToastStore';
import { translateSupabaseError } from '../utils/i18n';
import type { OrderTechOperation, TechCardStatus, Worker } from '../types/production';

// Foreman's row view combines the op with its parent tech card status
// and a display-only order_number. Workers show up separately so the
// board can render "who does what" when entries are already created.
export interface ForemanOperation extends OrderTechOperation {
  tech_card_status: TechCardStatus;
  order_number?: string;
}

interface ForemanStore {
  sectionId: string | null;
  operations: ForemanOperation[];
  sectionWorkers: Worker[];
  loading: boolean;
  error: string | null;

  loadSection: (sectionId: string) => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  sectionId: null,
  operations: [] as ForemanOperation[],
  sectionWorkers: [] as Worker[],
  loading: false,
  error: null,
};

const OPERATIONS_SELECT = `
  *,
  order_tech_cards!inner(status),
  orders(order_number)
`;

type RawOpRow = OrderTechOperation & {
  order_tech_cards: { status: TechCardStatus };
  orders: { order_number: string } | null;
};

function flatten(row: RawOpRow): ForemanOperation {
  const { order_tech_cards, orders, ...op } = row;
  return {
    ...op,
    tech_card_status: order_tech_cards.status,
    order_number: orders?.order_number,
  };
}

export const useForemanStore = create<ForemanStore>((set, get) => ({
  ...initialState,

  loadSection: async (sectionId) => {
    set({ loading: true, error: null, sectionId });

    const [opsRes, workersRes] = await Promise.all([
      supabase
        .from('order_tech_operations')
        .select(OPERATIONS_SELECT)
        .eq('section_id', sectionId)
        .is('deleted_at', null)
        .in('order_tech_cards.status', ['approved', 'locked']),
      supabase
        .from('workers')
        .select('*')
        .eq('section_id', sectionId)
        .is('deleted_at', null)
        .order('full_name'),
    ]);

    if (opsRes.error) {
      toast.error(translateSupabaseError(opsRes.error.message));
      set({ loading: false, error: opsRes.error.message });
      return;
    }
    if (workersRes.error) {
      toast.error(translateSupabaseError(workersRes.error.message));
      set({ loading: false, error: workersRes.error.message });
      return;
    }

    const ops = ((opsRes.data ?? []) as RawOpRow[]).map(flatten);
    set({
      operations: ops,
      sectionWorkers: (workersRes.data ?? []) as Worker[],
      loading: false,
    });
  },

  refresh: async () => {
    const { sectionId } = get();
    if (sectionId) await get().loadSection(sectionId);
  },

  reset: () => set(initialState),
}));

export const useForeman = <T>(selector: (s: ForemanStore) => T) =>
  useForemanStore(useShallow(selector));
