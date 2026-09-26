import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadReworkEvents } from './reworkEvents';
import { clearQueryCache } from './queryCache';
import { supabase } from '../../lib/supabase';

/**
 * Кэш ответа живёт 30 с, и сам он новый возврат по тому же этапу не заметит:
 * ключ набора приносит вызывающий (id + qty_rework). Мутация (проверена
 * 26.09): игнорировать `cacheKey` в ключе — второй тест красный.
 */
function chainWith(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'not']) chain[m] = vi.fn(() => chain);
  chain.order = vi.fn(async () => ({ data: rows, error: null }));
  return chain;
}

describe('loadReworkEvents — кэш с ключом версии', () => {
  beforeEach(() => clearQueryCache());

  it('тот же набор → один запрос', async () => {
    const chain = chainWith([{ id: 'ev1', stage_id: 's1', qty_rework: 5, comment: 'шов' }]);
    vi.mocked(supabase.from).mockReturnValue(chain as never);
    const a = await loadReworkEvents(['s1'], 's1:5');
    const b = await loadReworkEvents(['s1'], 's1:5');
    expect(a.s1.comment).toBe('шов');
    expect(b).toBe(a);
    expect(chain.order).toHaveBeenCalledTimes(1);
  });

  it('новый возврат по тому же этапу (другой qty) обходит кэш', async () => {
    const first = chainWith([{ id: 'ev1', stage_id: 's1', qty_rework: 5, comment: 'шов' }]);
    vi.mocked(supabase.from).mockReturnValue(first as never);
    await loadReworkEvents(['s1'], 's1:5');
    const second = chainWith([{ id: 'ev2', stage_id: 's1', qty_rework: 8, comment: 'пятно' }]);
    vi.mocked(supabase.from).mockReturnValue(second as never);
    const fresh = await loadReworkEvents(['s1'], 's1:8');
    expect(fresh.s1.comment).toBe('пятно');
  });
});
