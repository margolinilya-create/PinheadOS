// redesign/v2 — undo stack for destructive actions
//
// Self-contained mini-store. Caller wraps a destructive action like:
//
//   await removeOperation(id);
//   pushUndo({
//     label: 'Операция удалена',
//     restore: () => restoreOperation(id),
//   });
//
// UndoToastHost renders each entry with a "Отменить" button. Entries
// auto-expire after AUTO_DISMISS_MS (5s) — at that point the soft delete
// is effectively permanent (the row is already deleted_at=now in DB).

import { create } from 'zustand';

export const AUTO_DISMISS_MS = 5000;

export interface UndoEntry {
  id: number;
  label: string;
  restore: () => Promise<void> | void;
}

interface UndoStore {
  entries: UndoEntry[];
  push: (input: { label: string; restore: () => Promise<void> | void }) => void;
  dismiss: (id: number) => void;
  trigger: (id: number) => Promise<void>;
}

export const useUndoStore = create<UndoStore>((set, get) => ({
  entries: [],

  push: ({ label, restore }) => {
    const id = Date.now() + Math.random();
    set((s) => ({ entries: [...s.entries, { id, label, restore }] }));
    setTimeout(() => {
      // Auto-dismiss only if still present (user didn't trigger restore)
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    }, AUTO_DISMISS_MS);
  },

  dismiss: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

  trigger: async (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return;
    // Remove first so spamming the button doesn't double-fire
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    await entry.restore();
  },
}));
