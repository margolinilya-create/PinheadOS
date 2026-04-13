// redesign/v2 — Notifications bounded context (ADR-0001, ADR-0004)
//
// W2 skeleton: subscribe to the domain_events outbox via Supabase
// realtime (postgres_changes), cache recent events, expose unread count
// for the header bell. Filtering by event_type happens at the consumer
// level — the outbox is a shared bus (ADR-0004).
//
// "Unread" is a client-side concept (localStorage seenAt). Once we have
// per-user notification routing (W3+), this will move to a real table.

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../lib/supabase';
import { toast } from './useToastStore';
import { translateSupabaseError } from '../utils/i18n';
import type { DomainEvent } from '../types/production';

const SEEN_AT_KEY = 'pinhead_notifications_seen_at';
const RECENT_LIMIT = 50;

interface NotificationsStore {
  events: DomainEvent[];
  seenAt: string | null;
  loading: boolean;
  error: string | null;
  subscribed: boolean;

  loadRecent: () => Promise<void>;
  subscribe: () => void;
  unsubscribe: () => void;
  markAllSeen: () => void;
  unreadCount: () => number;
  reset: () => void;
}

const initialSeenAt = (() => {
  try {
    return localStorage.getItem(SEEN_AT_KEY);
  } catch {
    return null;
  }
})();

const initialState = {
  events: [] as DomainEvent[],
  seenAt: initialSeenAt,
  loading: false,
  error: null,
  subscribed: false,
};

// Supabase realtime channel handle kept module-scoped so subscribe/
// unsubscribe works across remounts without leaking channels.
let channel: ReturnType<typeof supabase.channel> | null = null;

export const useNotificationsStore = create<NotificationsStore>((set, get) => ({
  ...initialState,

  loadRecent: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('domain_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      set({ loading: false, error: error.message });
      return;
    }
    set({ events: (data ?? []) as DomainEvent[], loading: false });
  },

  subscribe: () => {
    if (channel) return;
    channel = supabase
      .channel('domain_events_stream')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'domain_events' },
        (payload) => {
          const row = payload.new as DomainEvent;
          set((s) => ({
            events: [row, ...s.events].slice(0, RECENT_LIMIT),
          }));
        }
      )
      .subscribe();
    set({ subscribed: true });
  },

  unsubscribe: () => {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
    set({ subscribed: false });
  },

  markAllSeen: () => {
    const now = new Date().toISOString();
    try {
      localStorage.setItem(SEEN_AT_KEY, now);
    } catch {
      /* ignore quota errors */
    }
    set({ seenAt: now });
  },

  unreadCount: () => {
    const { events, seenAt } = get();
    if (!seenAt) return events.length;
    return events.filter((e) => e.created_at > seenAt).length;
  },

  reset: () => {
    get().unsubscribe();
    set(initialState);
  },
}));

export const useNotifications = <T>(selector: (s: NotificationsStore) => T) =>
  useNotificationsStore(useShallow(selector));
