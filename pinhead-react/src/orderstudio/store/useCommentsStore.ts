import { create } from 'zustand';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';

export interface Comment {
  id: number | string;
  order_id: number | string;
  text: string;
  author_name: string;
  author_role: string;
  created_at: string;
}

interface CommentsStore {
  comments: Record<string | number, Comment[]>;
  loading: Record<string | number, boolean>;
  fetchComments: (orderId: string | number) => Promise<void>;
  addComment: (
    orderId: string | number,
    text: string,
    authorName: string,
    authorRole: string
  ) => Promise<void>;
}

export const useCommentsStore = create<CommentsStore>((set) => ({
  comments: {},
  loading: {},

  fetchComments: async (orderId) => {
    set((s) => ({ loading: { ...s.loading, [orderId]: true } }));
    const { data, error } = await supabase
      .from('order_comments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (!error && data) {
      set((s) => ({
        comments: { ...s.comments, [orderId]: data as Comment[] },
        loading: { ...s.loading, [orderId]: false },
      }));
    } else {
      toast.error('Не удалось загрузить комментарии');
      set((s) => ({ loading: { ...s.loading, [orderId]: false } }));
    }
  },

  addComment: async (orderId, text, authorName, authorRole) => {
    if (!text.trim()) return;
    const row = {
      order_id: orderId,
      text: text.trim(),
      author_name: authorName,
      author_role: authorRole,
    };
    const { data, error } = await supabase.from('order_comments').insert(row).select();
    if (!error && data?.[0]) {
      set((s) => ({
        comments: {
          ...s.comments,
          [orderId]: [...(s.comments[orderId] || []), data[0] as Comment],
        },
      }));
    } else {
      toast.error('Не удалось добавить комментарий');
    }
  },
}));
