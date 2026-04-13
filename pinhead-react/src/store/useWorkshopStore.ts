// redesign/v2 — Workshop bounded context root store (ADR-0001)
//
// Workshop Board is the live view of approved tech operations routed to
// each section. Foreman uses this to see "what needs doing in my section
// right now" and drag cards between queues. W1 Day-2/3 scope: data
// loaders only. UI drag-and-drop lands in W4.

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../lib/supabase';
import { toast } from './useToastStore';
import { translateSupabaseError } from '../utils/i18n';
import type {
  Section,
  OrderTechOperation,
  OrderTechCard,
} from '../types/production';

// An op enriched with parent tech card context for the board view.
// Kept local to Workshop — TechDesign store doesn't need this shape.
export interface WorkshopOperation extends OrderTechOperation {
  // Joined from order_tech_cards
  tech_card_status: OrderTechCard['status'];
  // Joined from orders for card header
  order_number?: string;
}

interface WorkshopStore {
  sections: Section[];
  operationsBySection: Record<string, WorkshopOperation[]>;
  loading: boolean;
  error: string | null;

  loadBoard: () => Promise<void>;
  // Filter helper — foreman screen loads one section at a time.
  loadSection: (sectionId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  sections: [] as Section[],
  operationsBySection: {} as Record<string, WorkshopOperation[]>,
  loading: false,
  error: null,
};

// Shared select projection. Joining order_tech_cards for status filter
// and orders for the visible order_number.
const OPERATIONS_SELECT = `
  *,
  order_tech_cards!inner(status),
  orders(order_number)
`;

type RawOperationRow = OrderTechOperation & {
  order_tech_cards: { status: OrderTechCard['status'] };
  orders: { order_number: string } | null;
};

function flatten(row: RawOperationRow): WorkshopOperation {
  const { order_tech_cards, orders, ...op } = row;
  return {
    ...op,
    tech_card_status: order_tech_cards.status,
    order_number: orders?.order_number,
  };
}

export const useWorkshopStore = create<WorkshopStore>((set) => ({
  ...initialState,

  loadBoard: async () => {
    set({ loading: true, error: null });

    const [sectionsRes, opsRes] = await Promise.all([
      supabase.from('sections').select('*').is('deleted_at', null).order('sort_order'),
      supabase
        .from('order_tech_operations')
        .select(OPERATIONS_SELECT)
        .is('deleted_at', null)
        .in('order_tech_cards.status', ['approved', 'locked']),
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

    const grouped: Record<string, WorkshopOperation[]> = {};
    for (const raw of (opsRes.data ?? []) as RawOperationRow[]) {
      const op = flatten(raw);
      (grouped[op.section_id] ??= []).push(op);
    }

    set({
      sections: (sectionsRes.data ?? []) as Section[],
      operationsBySection: grouped,
      loading: false,
    });
  },

  loadSection: async (sectionId) => {
    set({ loading: true, error: null });

    const { data, error } = await supabase
      .from('order_tech_operations')
      .select(OPERATIONS_SELECT)
      .eq('section_id', sectionId)
      .is('deleted_at', null)
      .in('order_tech_cards.status', ['approved', 'locked']);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      set({ loading: false, error: error.message });
      return;
    }

    const ops = ((data ?? []) as RawOperationRow[]).map(flatten);
    set((s) => ({
      operationsBySection: { ...s.operationsBySection, [sectionId]: ops },
      loading: false,
    }));
  },

  reset: () => set(initialState),
}));

export const useWorkshop = <T>(selector: (s: WorkshopStore) => T) =>
  useWorkshopStore(useShallow(selector));
