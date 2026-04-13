// redesign/v2 — Payroll bounded context (ADR-0001)
//
// Read-heavy: load batches, load entries (by batch, by worker), create
// new entries, close a batch. NEVER update a paid entry — corrections
// take the form of new reversal_of rows (ADR-0002, DB trigger enforces).
//
// Critical invariant reminder: once paid_at is set, piecework_entries
// row is immutable at DB level. This store never issues UPDATEs that
// would touch a paid row — the trigger would reject it anyway.

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../lib/supabase';
import { emitDomainEvent } from '../lib/domainEvents';
import { toast } from './useToastStore';
import { translateSupabaseError } from '../utils/i18n';
import type { PieceworkBatch, PieceworkEntry } from '../types/production';

interface PayrollStore {
  batches: PieceworkBatch[];
  entriesByBatch: Record<string, PieceworkEntry[]>;
  loading: boolean;
  error: string | null;

  loadBatches: () => Promise<void>;
  loadEntriesForBatch: (batchId: string) => Promise<void>;
  loadEntriesForWorker: (workerId: string, limit?: number) => Promise<PieceworkEntry[]>;

  createBatch: (periodStart: string, periodEnd: string, notes?: string) => Promise<PieceworkBatch | null>;
  createEntry: (
    entry: Omit<PieceworkEntry, 'id' | 'paid_at' | 'created_at' | 'created_by'>
  ) => Promise<PieceworkEntry | null>;
  reverseEntry: (
    originalEntry: PieceworkEntry,
    reason: string,
    amount?: number
  ) => Promise<PieceworkEntry | null>;
  closeBatch: (batchId: string) => Promise<boolean>;

  reset: () => void;
}

const initialState = {
  batches: [] as PieceworkBatch[],
  entriesByBatch: {} as Record<string, PieceworkEntry[]>,
  loading: false,
  error: null,
};

export const usePayrollStore = create<PayrollStore>((set, get) => ({
  ...initialState,

  loadBatches: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('piecework_batches')
      .select('*')
      .order('period_start', { ascending: false });

    if (error) {
      toast.error(translateSupabaseError(error.message));
      set({ loading: false, error: error.message });
      return;
    }
    set({ batches: (data ?? []) as PieceworkBatch[], loading: false });
  },

  loadEntriesForBatch: async (batchId) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('piecework_entries')
      .select('*')
      .eq('batch_id', batchId)
      .order('created_at');

    if (error) {
      toast.error(translateSupabaseError(error.message));
      set({ loading: false, error: error.message });
      return;
    }
    set((s) => ({
      entriesByBatch: { ...s.entriesByBatch, [batchId]: (data ?? []) as PieceworkEntry[] },
      loading: false,
    }));
  },

  loadEntriesForWorker: async (workerId, limit = 100) => {
    const { data, error } = await supabase
      .from('piecework_entries')
      .select('*')
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return [];
    }
    return (data ?? []) as PieceworkEntry[];
  },

  createBatch: async (periodStart, periodEnd, notes) => {
    const { data, error } = await supabase
      .from('piecework_batches')
      .insert({ period_start: periodStart, period_end: periodEnd, notes: notes ?? null })
      .select()
      .single();

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return null;
    }
    const row = data as PieceworkBatch;
    set((s) => ({ batches: [row, ...s.batches] }));
    return row;
  },

  createEntry: async (entry) => {
    const { data, error } = await supabase
      .from('piecework_entries')
      .insert(entry)
      .select()
      .single();

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return null;
    }
    const row = data as PieceworkEntry;
    set((s) => {
      const existing = s.entriesByBatch[row.batch_id] ?? [];
      return {
        entriesByBatch: {
          ...s.entriesByBatch,
          [row.batch_id]: [...existing, row],
        },
      };
    });

    void emitDomainEvent({
      event_type: 'piecework.entry_created',
      aggregate_type: 'piecework_entry',
      aggregate_id: row.id,
      payload: {
        batch_id: row.batch_id,
        worker_id: row.worker_id,
        amount: row.amount,
        entry_type: row.entry_type,
      },
      idempotency_suffix: 'create',
    });

    return row;
  },

  reverseEntry: async (originalEntry, reason, amount) => {
    if (!reason?.trim()) {
      toast.error('Причина обязательна для сторно');
      return null;
    }

    // Find or create an open batch — reversals must land in unpaid territory.
    let openBatch = get().batches.find((b) => b.status === 'open');
    if (!openBatch) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      openBatch = await get().createBatch(start, end, 'Auto-created for reversal');
      if (!openBatch) return null;
    }

    // Default to full reversal of the original amount (negated).
    const reversalAmount = amount !== undefined ? amount : -originalEntry.amount;

    return get().createEntry({
      batch_id: openBatch.id,
      worker_id: originalEntry.worker_id,
      tech_operation_id: originalEntry.tech_operation_id,
      entry_type: 'reversal_of',
      qty: 0,
      rate: 0,
      amount: reversalAmount,
      reason: reason.trim(),
      reversal_of: originalEntry.id,
    });
  },

  closeBatch: async (batchId) => {
    // Two-step close: (1) flip batch status, (2) stamp paid_at on all
    // entries inside. Once paid_at is set, the DB trigger freezes the
    // rows forever. Order matters: update entries BEFORE flipping batch
    // status in case the batch update fails — entries with paid_at but
    // no closed batch are a recoverable state (just flip batch later).
    // The reverse would leave a closed batch with unpaid entries, which
    // is a harder state to reason about.
    const nowIso = new Date().toISOString();

    const { error: entriesErr } = await supabase
      .from('piecework_entries')
      .update({ paid_at: nowIso })
      .eq('batch_id', batchId)
      .is('paid_at', null);

    if (entriesErr) {
      toast.error(translateSupabaseError(entriesErr.message));
      return false;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;

    const { data, error } = await supabase
      .from('piecework_batches')
      .update({ status: 'closed', closed_at: nowIso, closed_by: userId })
      .eq('id', batchId)
      .select()
      .single();

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return false;
    }

    set((s) => ({
      batches: s.batches.map((b) => (b.id === batchId ? (data as PieceworkBatch) : b)),
    }));

    void emitDomainEvent({
      event_type: 'payroll.batch_closed',
      aggregate_type: 'piecework_batch',
      aggregate_id: batchId,
      payload: { closed_by: userId, closed_at: nowIso },
      idempotency_suffix: 'close',
    });

    return true;
  },

  reset: () => set(initialState),
}));

export const usePayroll = <T>(selector: (s: PayrollStore) => T) =>
  usePayrollStore(useShallow(selector));
