// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockAnswersForTest as mock, resetChatMock } from '../../../e2e/support/mockSupabase';
import { BIZ_TASK_TEXTS } from '../../../e2e/support/mock/bizTasksRpc';

/**
 * Мок e2e диалога бизнес-задачи (правки 19.10, п. 7, Task 8): тред задачи —
 * своя лента, не переписка сделки; повтор отправки — то же сообщение;
 * адрес сделки у сообщения задачи — 22023, как у сервера.
 */
const rpc = (fn: string, body: Record<string, unknown>) => mock.rpc(fn, body, {}) as {
  data?: Record<string, unknown> & { messages?: { id: string; body: string }[] };
  error?: { code: string; message: string };
};

beforeEach(() => resetChatMock());

describe('мок e2e: тред задачи', () => {
  it('тред задачи и лента сделки не смешиваются', () => {
    const deal = rpc('erp_chat_page', { p_order_id: 'ord-a' }).data?.messages ?? [];
    const task = rpc('erp_chat_page', { p_order_id: null, p_task_id: 'bt-1' }).data?.messages ?? [];
    expect(task.map((m) => m.id)).toEqual(['bt-1-msg-1']);
    expect(deal.some((m) => m.id.startsWith('bt-1'))).toBe(false);

    rpc('erp_chat_send', { p_order_id: null, p_task_id: 'bt-1', p_body: 'Заказал', p_client_key: 'k1' });
    expect(rpc('erp_chat_page', { p_order_id: 'ord-a' }).data?.messages).toHaveLength(deal.length);
  });

  it('повтор с тем же ключом — то же сообщение', () => {
    const body = { p_order_id: null, p_task_id: 'bt-1', p_body: 'Заказал', p_client_key: 'k1' };
    const a = rpc('erp_chat_send', body).data;
    const b = rpc('erp_chat_send', body).data;
    expect(b?.message_id).toBe(a?.message_id);
    expect(b?.duplicate).toBe(true);
    expect(rpc('erp_chat_page', { p_order_id: null, p_task_id: 'bt-1' }).data?.messages).toHaveLength(2);
  });

  it('сообщение задачи с адресом сделки — 22023', () => {
    const r = rpc('erp_chat_send', { p_order_id: 'ord-a', p_task_id: 'bt-1', p_body: 'x', p_client_key: 'k2' });
    expect(r.error).toEqual({ code: '22023', message: BIZ_TASK_TEXTS.dealAnchor });
  });

  it('результат — строка задачи целиком; чужое сообщение — отказ', () => {
    const sent = rpc('erp_chat_send', { p_order_id: null, p_task_id: 'bt-1', p_body: 'Молнии заказаны', p_client_key: 'k3' });
    const row = rpc('erp_biz_task_set_result', { p_id: 'bt-1', p_text: null, p_message_id: sent.data?.message_id }).data;
    expect(row).toMatchObject({ id: 'bt-1', title: 'Заказать молнии', result_text: 'Молнии заказаны' });

    const foreign = rpc('erp_biz_task_set_result', { p_id: 'bt-1', p_text: null, p_message_id: 'bt-1-msg-1' });
    expect(foreign.error?.code).toBe('22023');
  });

  it('тексты отказов — побуквенно из миграции', () => {
    const sql = readFileSync(
      join(process.cwd(), '..', 'supabase', 'migrations', '20261020100000_erp_biz_tasks_rpc.sql'), 'utf8',
    );
    for (const text of Object.values(BIZ_TASK_TEXTS)) expect(sql).toContain(text);
  });

  it('строка задачи читается с наблюдателями и заказом', () => {
    const rows = mock.table('erp_biz_tasks', 'id=eq.bt-1', {}) as { watchers: unknown[]; order: { id: string } }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].watchers).toEqual([]);
    expect(rows[0].order.id).toBe('ord-a');
  });
});
