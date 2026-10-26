import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import type { LayoutTemplateData } from '../design/model/layoutTemplate';
import {
  LAYOUT_LIST_LIMIT, deleteLayoutTemplate, layoutNameIssue, listLayoutTemplates, saveLayoutTemplate,
} from './layoutTemplates';

/**
 * «Мои раскладки» (Э8): `order_templates` под политиками «свои»; в список — только
 * `kind = 'layout'` с целыми данными; ошибка — тост и null/false.
 */
const from = supabase.from as unknown as ReturnType<typeof vi.fn>;
const UID = '11111111-1111-4111-8111-111111111111';

const DATA: LayoutTemplateData = {
  kind: 'layout', v: 1, flat_id: 'tshirt-freefit',
  prints: [{
    view: 'front', area_id: 'chest', zone_id: 'front', method: 'dtf', width_mm: 250, down_mm: 80, dx_mm: 0,
    rotation_deg: 0,
  }],
};

function chain(result: unknown) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const k of ['select', 'eq', 'order', 'insert', 'delete']) c[k] = vi.fn(() => c);
  c.limit = vi.fn(() => Promise.resolve(result));
  c.single = vi.fn(() => Promise.resolve(result));
  (c as unknown as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return c;
}

describe('layoutTemplates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    from.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('список: свои, только раскладки, новые сверху, предел 50; битая и чужая форма — отброшены', async () => {
    const c = chain({
      data: [
        { id: 'a', name: 'Команда', data: DATA },
        { id: 'b', name: 'Старый шаблон v3', data: { items: [] } },
        { id: 'c', name: 'Битая', data: { ...DATA, prints: [{ ...DATA.prints[0], width_mm: 'много' }] } },
      ],
      error: null,
    });
    from.mockReturnValueOnce(c);
    expect(await listLayoutTemplates(UID)).toEqual([{ id: 'a', name: 'Команда', data: DATA }]);
    expect(from).toHaveBeenCalledWith('order_templates');
    expect(c.eq).toHaveBeenCalledWith('created_by', UID);
    expect(c.eq).toHaveBeenCalledWith('data->>kind', 'layout');
    expect(c.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(c.limit).toHaveBeenCalledWith(LAYOUT_LIST_LIMIT);
  });

  it('список: ошибка — тост и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    from.mockReturnValueOnce(chain({ data: null, error: { message: 'permission denied for table order_templates' } }));
    expect(await listLayoutTemplates(UID)).toBeNull();
    expect(err.mock.calls[0][0]).toMatch(/^Не удалось загрузить раскладки/);
  });

  it('сохранение: insert своей строки с обрезанным именем', async () => {
    const c = chain({ data: { id: 'n', name: 'Грудь и спина', data: DATA }, error: null });
    from.mockReturnValueOnce(c);
    expect(await saveLayoutTemplate(UID, '  Грудь и спина ', DATA)).toEqual({ id: 'n', name: 'Грудь и спина', data: DATA });
    expect(c.insert).toHaveBeenCalledWith({ name: 'Грудь и спина', created_by: UID, data: DATA });
  });

  it.each([
    ['пустое имя', '   ', DATA, /введите название/],
    ['длинное имя', 'я'.repeat(61), DATA, /длиннее 60/],
    ['битые данные', 'Ок', { ...DATA, v: 2 } as unknown as LayoutTemplateData, /повреждена/],
  ])('сохранение: %s — отказ словами без запроса', async (_, name, data, msg) => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await saveLayoutTemplate(UID, name, data)).toBeNull();
    expect(from).not.toHaveBeenCalled();
    expect(err.mock.calls[0][0]).toMatch(msg);
  });

  it('удаление: по id; строки уже нет — тост и false', async () => {
    const c = chain({ data: [{ id: 'a' }], error: null });
    from.mockReturnValueOnce(c);
    expect(await deleteLayoutTemplate('a')).toBe(true);
    expect(c.delete).toHaveBeenCalled();
    expect(c.eq).toHaveBeenCalledWith('id', 'a');
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    from.mockReturnValueOnce(chain({ data: [], error: null }));
    expect(await deleteLayoutTemplate('a')).toBe(false);
    expect(err.mock.calls[0][0]).toMatch(/её уже нет/);
  });

  it('layoutNameIssue', () => {
    expect(layoutNameIssue('Команда')).toBeNull();
    expect(layoutNameIssue('')).toBe('Введите название раскладки');
  });
});
