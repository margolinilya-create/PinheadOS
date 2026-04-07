import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { toast } from './useToastStore';

export const useCommentsStore = create((set, _get) => ({
  comments: {},   // { [orderId]: Comment[] }
  loading: {},    // { [orderId]: boolean }

  fetchComments: async (orderId) => {
    set(s => ({ loading: { ...s.loading, [orderId]: true } }));
    const { data, error } = await supabase
      .from('order_comments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (!error && data) {
      set(s => ({
        comments: { ...s.comments, [orderId]: data },
        loading: { ...s.loading, [orderId]: false },
      }));
    } else {
      toast.error('Не удалось загрузить комментарии');
      set(s => ({ loading: { ...s.loading, [orderId]: false } }));
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
    const { data, error } = await supabase
      .from('order_comments')
      .insert(row)
      .select();
    if (!error && data?.[0]) {
      set(s => ({
        comments: {
          ...s.comments,
          [orderId]: [...(s.comments[orderId] || []), data[0]],
        },
      }));
    } else {
      toast.error('Не удалось добавить комментарий');
    }
  },
}));
