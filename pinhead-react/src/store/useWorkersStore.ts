// redesign/v2 — Workers bounded context (ADR-0001)
//
// Thin store: load workers (optionally by section), create/update/
// soft-delete. HR-level writes are RLS-gated to admin/senior_foreman.

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../lib/supabase';
import { toast } from './useToastStore';
import { translateSupabaseError } from '../utils/i18n';
import type { Worker } from '../types/production';

interface WorkersStore {
  workers: Worker[];
  loading: boolean;
  error: string | null;

  loadAll: () => Promise<void>;
  loadBySection: (sectionId: string) => Promise<void>;
  create: (patch: Omit<Worker, 'id' | 'deleted_at' | 'created_at'>) => Promise<Worker | null>;
  update: (id: string, patch: Partial<Omit<Worker, 'id' | 'created_at'>>) => Promise<void>;
  softDelete: (id: string) => Promise<boolean>;
  restore: (id: string) => Promise<boolean>;
  reset: () => void;
}

const initialState = {
  workers: [] as Worker[],
  loading: false,
  error: null,
};

export const useWorkersStore = create<WorkersStore>((set, get) => ({
  ...initialState,

  loadAll: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('workers')
      .select('*')
      .is('deleted_at', null)
      .order('full_name');

    if (error) {
      toast.error(translateSupabaseError(error.message));
      set({ loading: false, error: error.message });
      return;
    }
    set({ workers: (data ?? []) as Worker[], loading: false });
  },

  loadBySection: async (sectionId) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('workers')
      .select('*')
      .eq('section_id', sectionId)
      .is('deleted_at', null)
      .order('full_name');

    if (error) {
      toast.error(translateSupabaseError(error.message));
      set({ loading: false, error: error.message });
      return;
    }
    set({ workers: (data ?? []) as Worker[], loading: false });
  },

  create: async (patch) => {
    const { data, error } = await supabase
      .from('workers')
      .insert(patch)
      .select()
      .single();

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return null;
    }
    const row = data as Worker;
    set((s) => ({ workers: [...s.workers, row] }));
    return row;
  },

  update: async (id, patch) => {
    const prev = get().workers.find((w) => w.id === id);
    if (!prev) return;

    set((s) => ({
      workers: s.workers.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));

    const { error } = await supabase.from('workers').update(patch).eq('id', id);
    if (error) {
      toast.error(translateSupabaseError(error.message));
      set((s) => ({ workers: s.workers.map((w) => (w.id === id ? prev : w)) }));
    }
  },

  softDelete: async (id) => {
    const { error } = await supabase
      .from('workers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return false;
    }
    set((s) => ({ workers: s.workers.filter((w) => w.id !== id) }));
    return true;
  },

  restore: async (id) => {
    const { data, error } = await supabase
      .from('workers')
      .update({ deleted_at: null })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      toast.error(translateSupabaseError(error.message));
      return false;
    }
    set((s) => {
      const next = s.workers.filter((w) => w.id !== id);
      next.push(data as Worker);
      next.sort((a, b) => a.full_name.localeCompare(b.full_name));
      return { workers: next };
    });
    return true;
  },

  reset: () => set(initialState),
}));

export const useWorkers = <T>(selector: (s: WorkersStore) => T) =>
  useWorkersStore(useShallow(selector));
