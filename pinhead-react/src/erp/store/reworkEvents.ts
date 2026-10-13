/**
 * Последнее событие возврата брака по этапу — для баннера получателю в очереди
 * цеха. Вынесено из `stagesSlice` 26.09 (ратчет размера файла).
 *
 * Событие возврата неизменяемо, поэтому ответ кэшируется (`cachedQuery`,
 * 30 с): очередь перечитывала журнал при любом чужом патче этапа, потому что
 * зависела от пересобранного массива. Колонок ровно столько, сколько читает
 * баннер (`qty_rework`, `comment`).
 */

import { supabase } from '../../lib/supabase';
import type { ErpStageEvent } from '../types';
import { cachedQuery } from './queryCache';
import { erpQuery } from './shared';

export async function loadReworkEvents(
  stageIds: string[], cacheKey?: string,
): Promise<Record<string, ErpStageEvent>> {
  if (stageIds.length === 0) return {};
  // Ключ кэша несёт версию набора (id + qty_rework от вызывающего): второй
  // возврат по тому же этапу меняет qty и получает свежий ответ (ревью 26.09)
  const key = `rework:${cacheKey ?? [...stageIds].sort().join(',')}`;
  return cachedQuery(key, async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_stage_events')
      .select('id, stage_id, qty_rework, comment, created_at')
      .in('stage_id', stageIds)
      .not('qty_rework', 'is', null)
      .order('created_at', { ascending: false }));
    if (error) return {};
    const map: Record<string, ErpStageEvent> = {};
    for (const ev of (data ?? []) as ErpStageEvent[]) {
      if (!map[ev.stage_id]) map[ev.stage_id] = ev;
    }
    return map;
  });
}
