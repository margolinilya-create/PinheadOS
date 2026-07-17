/** «Время в этапе» — компактный формат как в kontora24 (мин/ч/дн). */
export function formatTimeIn(since: string | null, nowMs: number = Date.now()): string {
  if (!since) return '';
  const ms = nowMs - new Date(since).getTime();
  if (ms < 60_000) return 'только что';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.floor(h / 24)} дн`;
}
