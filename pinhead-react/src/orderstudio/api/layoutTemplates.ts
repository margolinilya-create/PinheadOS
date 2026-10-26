/**
 * «Мои раскладки» (веха 5в, Э8) — строки `order_templates` с `data.kind = 'layout'`.
 * ЕДИНСТВЕННЫЙ модуль, который читает и пишет таблицу (сторож
 * `layoutTemplatesWrites.test.ts`). Миграции нет: политики «свои»
 * (`created_by = auth.uid()`) на select / insert / delete — `20260727230000`.
 *
 * Данные из базы недоверенные: строка с битыми данными или старый шаблон визарда
 * v3 (другая форма `data`) в список не попадает (`parseLayoutTemplate`).
 * Ошибка Supabase → `toast.error` и `null` / `false`.
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';
import { parseLayoutTemplate, type LayoutTemplateData } from '../design/model/layoutTemplate';

const TABLE = 'order_templates';
export const LAYOUT_NAME_MAX = 60;
export const LAYOUT_LIST_LIMIT = 50;
/** Предел данных одной раскладки, байт JSON (20 нанесений — около 5 КБ) */
export const LAYOUT_DATA_MAX_BYTES = 16 * 1024;

export interface LayoutTemplateRow {
  id: string;
  name: string;
  data: LayoutTemplateData;
}

interface Raw {
  id?: unknown;
  name?: unknown;
  data?: unknown;
}

function rowOf(r: Raw): LayoutTemplateRow | null {
  const data = parseLayoutTemplate(r.data);
  if (!data || typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  return { id: r.id, name: r.name.slice(0, LAYOUT_NAME_MAX), data };
}

function failed(context: string, e: unknown, network = false): null {
  console.error(context, e);
  const msg = network ? networkFailureMessage(e) : translateSupabaseError((e as { message?: string } | null)?.message);
  toast.error(msg ? `${context}: ${msg}` : context);
  return null;
}

/** Свои раскладки, новые сверху; ошибка — тост и `null` */
export async function listLayoutTemplates(uid: string): Promise<LayoutTemplateRow[] | null> {
  const context = 'Не удалось загрузить раскладки';
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, name, data')
      .eq('created_by', uid)
      .eq('data->>kind', 'layout')
      .order('created_at', { ascending: false })
      .limit(LAYOUT_LIST_LIMIT);
    if (error) return failed(context, error);
    return ((data ?? []) as Raw[]).map(rowOf).filter((r): r is LayoutTemplateRow => r !== null);
  } catch (e) {
    return failed(context, e, true);
  }
}

/** Причина отказа до запроса; всё в порядке — `null` */
export function layoutNameIssue(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Введите название раскладки';
  if (n.length > LAYOUT_NAME_MAX) return `Название длиннее ${LAYOUT_NAME_MAX} знаков`;
  return null;
}

/** Сохранить раскладку; ответ — новая строка либо `null` (тост уже показан) */
export async function saveLayoutTemplate(uid: string, name: string, data: LayoutTemplateData): Promise<LayoutTemplateRow | null> {
  const context = 'Раскладка не сохранена';
  const issue = layoutNameIssue(name);
  if (issue) {
    toast.error(`${context}: ${issue.toLowerCase()}`);
    return null;
  }
  if (!parseLayoutTemplate(data) || new TextEncoder().encode(JSON.stringify(data)).length > LAYOUT_DATA_MAX_BYTES) {
    toast.error(`${context}: раскладка слишком большая или повреждена`);
    return null;
  }
  try {
    const { data: row, error } = await supabase
      .from(TABLE)
      .insert({ name: name.trim(), created_by: uid, data })
      .select('id, name, data')
      .single();
    if (error) return failed(context, error);
    return rowOf(row as Raw) ?? failed(context, new Error('сервер вернул другую раскладку'));
  } catch (e) {
    return failed(context, e, true);
  }
}

/** Удалить свою раскладку; `false` — не удалось (тост уже показан) */
export async function deleteLayoutTemplate(id: string): Promise<boolean> {
  const context = 'Раскладка не удалена';
  try {
    const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id');
    if (error) return failed(context, error) ?? false;
    if (!data?.length) {
      toast.error(`${context}: её уже нет`);
      return false;
    }
    return true;
  } catch (e) {
    return failed(context, e, true) ?? false;
  }
}
