import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { toast } from './useToastStore';
import { useAuthStore } from './useAuthStore';

export const useTemplatesStore = create((set, _get) => ({
  templates: [],
  loading: false,

  fetchTemplates: async () => {
    set({ loading: true });
    const { data, error } = await supabase
      .from('order_templates')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      set({ templates: data, loading: false });
    } else {
      toast.error('Не удалось загрузить шаблоны');
      set({ loading: false });
    }
  },

  saveTemplate: async (name, itemData) => {
    const auth = useAuthStore.getState();
    const userId = auth.user?.id;
    if (!userId || userId === 'dev') {
      toast.error('Шаблоны недоступны в dev-режиме');
      return null;
    }
    const { data, error } = await supabase
      .from('order_templates')
      .insert({ name, data: itemData, created_by: userId })
      .select();
    if (!error && data?.[0]) {
      set(s => ({ templates: [data[0], ...s.templates] }));
      toast.success('Шаблон сохранён: ' + name);
      return data[0];
    }
    toast.error('Не удалось сохранить шаблон');
    return null;
  },

  deleteTemplate: async (id) => {
    const { error } = await supabase.from('order_templates').delete().eq('id', id);
    if (error) {
      toast.error('Не удалось удалить шаблон');
      return false;
    }
    set(s => ({ templates: s.templates.filter(t => t.id !== id) }));
    toast.success('Шаблон удалён');
    return true;
  },
}));
