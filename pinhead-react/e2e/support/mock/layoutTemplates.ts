/**
 * Мок `order_templates` для e2e «Моих раскладок» (веха 5в, Э8): единственный
 * клиентский писатель — `api/layoutTemplates.ts` (список, вставка, удаление).
 * Политики сервера (миграция P) — «свои строки», поэтому список отдаёт только
 * строки `created_by = eq.<uid>` с `data->>kind = eq.layout`, новые сверху.
 * UPDATE у клиента нет (P его отзывает) — здесь ответ 403, как у PostgREST.
 *
 * Регистрирует модуль `mockSupabase.ts` (ветка `**\/rest/v1/order_templates`).
 */

export type LayoutTemplateRow = { id: string; name: string; created_by: string; created_at: string; data: unknown };

export type LayoutTemplatesReply = { status: number; body: unknown };

/** Что знает модуль о наборе `MockExtras` */
type TemplatesExtras = { layoutTemplates?: LayoutTemplateRow[] };

let seq = 0;

const eqOf = (params: URLSearchParams, key: string) => params.get(key)?.replace(/^eq\./, '') ?? null;

const pick = (r: LayoutTemplateRow) => ({ id: r.id, name: r.name, data: r.data });

export function layoutTemplatesReply(
  method: string, params: URLSearchParams, body: string | null, extra: TemplatesExtras,
): LayoutTemplatesReply {
  const rows = (extra.layoutTemplates ??= []);
  if (method === 'GET') {
    const uid = eqOf(params, 'created_by');
    const kind = eqOf(params, 'data->>kind');
    const list = rows
      .filter((r) => (uid === null || r.created_by === uid) && (kind === null || (r.data as { kind?: string })?.kind === kind))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { status: 200, body: list.map(pick) };
  }
  if (method === 'POST') {
    const input = JSON.parse(body ?? '{}') as Omit<LayoutTemplateRow, 'id' | 'created_at'>;
    seq += 1;
    const row: LayoutTemplateRow = {
      id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
      name: input.name,
      created_by: input.created_by,
      created_at: new Date(Date.UTC(2026, 9, 27, 12, 0, seq)).toISOString(),
      data: input.data,
    };
    rows.push(row);
    return { status: 201, body: [pick(row)] };
  }
  if (method === 'DELETE') {
    const id = eqOf(params, 'id');
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return { status: 200, body: [] };
    const [gone] = rows.splice(i, 1);
    return { status: 200, body: [{ id: gone.id }] };
  }
  return { status: 403, body: { code: '42501', message: 'permission denied for table order_templates', details: null, hint: null } };
}
