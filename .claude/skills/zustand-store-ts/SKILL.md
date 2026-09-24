---
name: zustand-store-ts
description: Use when creating or modifying Zustand stores in Pinhead. Triggers on "новый стор", "create store", "useStore", "zustand", "state management", "slice".
---

# Zustand Store Patterns — Pinhead Order Studio

## Правила для всех сторов в Pinhead

### Базовый шаблон нового стора

```js
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { toast } from './useToastStore';
import { useAuthStore } from './useAuthStore';

export const useMyStore = create((set, get) => ({
  // State
  items: [],
  loading: false,

  // Actions
  fetchItems: async () => {
    set({ loading: true });
    const { data, error } = await supabase.from('my_table').select('*');
    if (!error && data) {
      set({ items: data, loading: false });
    } else {
      toast.error('Не удалось загрузить данные');
      set({ loading: false });
    }
  },

  createItem: async (payload) => {
    const { data, error } = await supabase.from('my_table').insert(payload).select();
    if (!error && data?.[0]) {
      set(s => ({ items: [data[0], ...s.items] }));
      return data[0]; // ВСЕГДА возвращаем объект при успехе
    }
    toast.error('Не удалось создать запись');
    return null; // ВСЕГДА null при ошибке — не fallback объект
  },

  deleteItem: async (id) => {
    // НЕ optimistic — ждём Supabase
    const { error } = await supabase.from('my_table').delete().eq('id', id);
    if (!error) {
      set(s => ({ items: s.items.filter(i => i.id !== id) }));
      return true;
    }
    toast.error('Не удалось удалить');
    return false;
  },
}));
```

## Правила селекторов в компонентах

```js
// ✅ ПРАВИЛЬНО — useShallow для объектов
const { items, loading } = useMyStore(
  useShallow(s => ({ items: s.items, loading: s.loading }))
);

// ✅ ПРАВИЛЬНО — прямой селектор для одного значения
const loading = useMyStore(s => s.loading);

// ❌ НЕПРАВИЛЬНО — без селектора
const store = useMyStore();
```

## Критические правила Pinhead

1. **null при ошибке** — все async функции возвращают `null` при ошибке Supabase
2. **Нет local_ fallback** — не создавать локальные объекты при ошибке сети
3. **toast.error** — всегда показывать пользователю что пошло не так
4. **Optimistic update только с rollback** — сохранить prev, восстановить при ошибке
5. **useShallow** — обязательно для объектных селекторов

## Новый доменный слайс ERP

Покупательский портал, который здесь служил примером, отменён (Roadmap
в `PROJECT.md`). В ERP новый стор не заводится — заводится слайс:

```ts
// erp/store/slices/fooSlice.ts
export const fooSlice: StateCreator<ErpStore, [], [], FooSlice> = (set) => ({
  foos: [],
  foosLoaded: false,
  loadFoos: async () => {
    const { data, error } = await erpQuery(() => supabase.from('erp_foos').select('*'));
    if (error) { erpError('Не удалось загрузить', error); return null; }
    set({ foos: data ?? [], foosLoaded: true });
    return data;
  },
});
```

Дальше: тип в `erp/store/types.ts`, регистрация в `domainSlices.ts`,
тест по образцу `useErpStore.test.ts`.
