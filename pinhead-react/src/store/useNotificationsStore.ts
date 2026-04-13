// redesign/v2 — Notifications bounded context (ADR-0001, ADR-0004)
//
// Reads from `notifications` table (populated by domain-events-dispatcher
// consumer) — NOT from raw domain_events. The dispatcher does the
// translation from event_type to user-facing title/body.
//
// Subscribes to realtime INSERTs on notifications. Unread = count of
// rows where read_at IS NULL. Mark-as-read is a real DB update so the
// state survives refresh / multi-device.

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../lib/supabase';
import { toast } from './useToastStore';
import { translateSupabaseError } from '../utils/i18n';
import type { Notification } from '../types/production';

const RECENT_LIMIT = 50;

interface NotificationsStore {
  notifications: Notification[];
  loading: boolean;
  error: string | null;
  subscribed: boolean;

  loadRecent: () => Promise<void>;
  subscribe: () => void;
  unsubscribe: () => void;
  markAllRead: () => Promise<void>;
  markOneRead: (id: string) => Promise<void>;
  unreadCount: () => number;
  reset: () => void;
}

const initialState = {
  notifications: [] as Notification[],
  loading: false,
  error: null,
  subscribed: false,
};

let channel: ReturnType<typeof supabase.channel> | null = null;

export const useNotificationsStore = create<NotificationsStore>((set, get) => ({
  ...initialState,

  loadRecent: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      set({ loading: false, error: error.message });
      return;
    }
    set({ notifications: (data ?? []) as Notification[], loading: false });
  },

  subscribe: () => {
    if (channel) return;
    channel = supabase
      .channel('notifications_stream')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const row = payload.new as Notification;
          set((s) => ({
            notifications: [row, ...s.notifications].slice(0, RECENT_LIMIT),
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

  markAllRead: async () => {
    const unread = get().notifications.filter((n) => !n.read_at);
    if (unread.length === 0) return;

    const nowIso = new Date().toISOString();
    // Optimistic
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.read_at ? n : { ...n, read_at: nowIso }
      ),
    }));

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: nowIso })
      .in('id', unread.map((n) => n.id));

    if (error) {
      toast.error(translateSupabaseError(error.message));
      // Best-effort rollback
      set({ notifications: get().notifications.map((n) =>
        unread.find((u) => u.id === n.id) ? { ...n, read_at: null } : n
      ) });
    }
  },

  markOneRead: async (id) => {
    const target = get().notifications.find((n) => n.id === id);
    if (!target || target.read_at) return;

    const nowIso = new Date().toISOString();
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read_at: nowIso } : n
      ),
    }));

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: nowIso })
      .eq('id', id);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      set((s) => ({
        notifications: s.notifications.map((n) =>
          n.id === id ? { ...n, read_at: null } : n
        ),
      }));
    }
  },

  unreadCount: () => get().notifications.filter((n) => !n.read_at).length,

  reset: () => {
    get().unsubscribe();
    set(initialState);
  },
}));

export const useNotifications = <T>(selector: (s: NotificationsStore) => T) =>
  useNotificationsStore(useShallow(selector));
