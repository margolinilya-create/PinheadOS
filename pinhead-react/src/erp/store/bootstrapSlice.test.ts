import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useErpStore, resetErpStore } from './useErpStore';
import { supabase } from '../../lib/supabase';

/**
 * Бутстрап оболочки. Проверяется одно обещание: **оболочка поднимается
 * при любом исходе запроса**.
 *
 * Меню, права и справочники грузятся до первого экрана, поэтому провал
 * бутстрапа — это не «пустой виджет», а приложение, застрявшее на скелетоне.
 * Веток исхода три (данные / `error` в ответе / брошенное исключение),
 * и раньше третья не была закрыта: supabase-js возвращает `error` на ответ
 * сервера, но БРОСАЕТ, когда ответа не было вовсе.
 */

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

const PAYLOAD = {
  departments: [{ id: 'd1', code: 'cutting', name: 'Закрой' }],
  permissions: [{ role: 'production_head', permission: 'plan.manage', allowed: true }],
  dictionaries: [{ id: 'x1', kind: 'block_reason', value: 'Нет ткани', active: true }],
  subcontracting: [],
  experimental: [],
  my_employee: { department_id: 'd1', role: 'worker' },
};

describe('loadBootstrap', () => {
  beforeEach(() => {
    resetErpStore();
    rpc.mockReset();
  });

  it('раскладывает ответ по слайсам-владельцам', async () => {
    rpc.mockResolvedValue({ data: PAYLOAD, error: null });
    await useErpStore.getState().loadBootstrap();

    const s = useErpStore.getState();
    expect(s.departments).toHaveLength(1);
    expect(s.dictionaries).toHaveLength(1);
    expect(s.myDeptId).toBe('d1');
    expect(s.bootstrapLoaded).toBe(true);
  });

  it('матрица прав собирается в объект «роль → право → разрешено»', async () => {
    rpc.mockResolvedValue({ data: PAYLOAD, error: null });
    await useErpStore.getState().loadBootstrap();
    expect(useErpStore.getState().permissionMatrix?.production_head?.['plan.manage']).toBe(true);
  });

  it('при ошибке в ответе флаги всё равно выставляются', async () => {
    // Иначе эффект `if (!loaded) load()` крутится по кругу, а экран
    // остаётся скелетоном навсегда.
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await useErpStore.getState().loadBootstrap();

    const s = useErpStore.getState();
    expect(s.bootstrapLoaded).toBe(true);
    expect(s.permissionsLoaded).toBe(true);
    expect(s.dictionariesLoaded).toBe(true);
    expect(s.myDeptLoaded).toBe(true);
  });

  it('брошенное исключение обрабатывается так же, как ошибка в ответе', async () => {
    // Нет сети / CORS / клиент не настроен — ответа нет вовсе, и supabase-js
    // бросает. Без этой ветки был unhandled rejection и пустой экран.
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(useErpStore.getState().loadBootstrap()).resolves.toBeUndefined();
    expect(useErpStore.getState().bootstrapLoaded).toBe(true);
  });

  it('повторный вызов не ходит в сеть', async () => {
    rpc.mockResolvedValue({ data: PAYLOAD, error: null });
    await useErpStore.getState().loadBootstrap();
    await useErpStore.getState().loadBootstrap();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
