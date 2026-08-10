/**
 * Единые форматтеры ERP: срок, просрочка, проценты, дата-время.
 *
 * Зачем понадобился отдельный модуль. Строку «сколько осталось до срока» до
 * 03.08.2026 собирали СЕМЬ мест, и все по-разному:
 *
 *   KanbanCard      `просрочен 5 дн`      — без точки
 *   ErpDashboard    `просрочен 5 дн.` + `сегодня`/`завтра`/`через 5 дн.`
 *   BoardCardMobile `· просрочен 5`       — вообще без единицы
 *   QueueCard       `· −5 дн.`            — минусом, слово «просрочен» потеряно
 *   DueCell, QueueRow, ProductionBoard, ProductionTask, PlanTaskCard — свои копии
 *
 * Один и тот же заказ на канбане, в очереди и на дашборде подписан тремя
 * разными способами. Здесь два варианта — и ровно два, каждый со своей задачей:
 * `dueLabel` там, где есть место и фраза читается целиком, `dueLabelCompact` —
 * в плотных строках и карточках. Оба обязаны пережить `null`.
 */

/** Порог «горящего» срока (дней) — тот же, что у `isUrgent` в time.ts */
export const URGENT_DAYS = 3;

/**
 * Прозаическая метка срока: дашборд, карточка заказа, страница задания.
 * `сегодня`/`завтра` вместо «через 0 дн.» — иначе фраза не по-русски.
 */
export function dueLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'срок не задан';
  if (days < 0) return `просрочен ${-days} ${dayWord(-days)}`;
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} ${dayWord(days)}`;
}

/**
 * Плотная метка: строка очереди, карточка канбана, ячейка таблицы.
 * Слово «просрочен» остаётся — минус в потоке цифр читается как дефис,
 * и «−5 дн.» на планшете цеха выглядело просто как «5 дн.».
 */
export function dueLabelCompact(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—';
  if (days < 0) return `просрочен ${-days} ${dayWord(-days)}`;
  return `${days} ${dayWord(days)}`;
}

/**
 * «дн.» — общепринятое сокращение и по числам не склоняется. Функция есть
 * затем, чтобы точка не терялась (её теряли два места из семи) и чтобы
 * единица задавалась в одном месте, если её однажды решат писать словом.
 */
export function dayWord(_n: number): string {
  return 'дн.';
}

/** Ступень просрочки. Решение заказчика 03.08.2026: 1–7 / 8–30 / 30+ дней */
export type OverdueBucket = 'none' | 'week' | 'month' | 'stale';

/**
 * Ступень по числу дней просрочки (положительное число дней ПОСЛЕ срока).
 *
 * Зачем ступени: на 03.08.2026 просрочены 47 активных заказов из 76, и плитка
 * «Просрочено: 47» не отвечает на вопрос «что делать сейчас». По ступеням это
 * 6 / 39 / 2 — и видно, что горит на самом деле шесть.
 */
export function overdueBucket(overdueDays: number): OverdueBucket {
  if (overdueDays <= 0) return 'none';
  if (overdueDays <= 7) return 'week';
  if (overdueDays <= 30) return 'month';
  return 'stale';
}

export const OVERDUE_BUCKET_LABEL: Record<OverdueBucket, string> = {
  none: 'В срок',
  week: 'Просрочен до недели',
  month: 'Просрочен 8–30 дней',
  stale: 'Просрочен больше месяца',
};

/** Короткое имя ступени — для чипов и легенды */
export const OVERDUE_BUCKET_SHORT: Record<OverdueBucket, string> = {
  none: 'в срок',
  week: '1–7 дн.',
  month: '8–30 дн.',
  stale: '30+ дн.',
};

/**
 * Процент выполнения — `null`, когда базы нет.
 *
 * Прежние `planPercent`/`dayTotals` при плане 0 возвращали 100 («план ноль —
 * считаем выполненным»), и пустая неделя рисовалась как «100 %» — то есть
 * «всё сделано» там, где не запланировано ничего. Ноль в знаменателе — это
 * «неизвестно», а не «готово»; отличить одно от другого обязан вызывающий,
 * поэтому здесь `null`, а не число.
 */
export function percentOf(part: number, whole: number): number | null {
  const raw = percentUncapped(part, whole);
  return raw === null ? null : Math.min(100, raw);
}

/**
 * Тот же процент, но БЕЗ потолка в 100.
 *
 * Нужен там, где превышение — это и есть сигнал: загрузка производства против
 * доступной мощности (правки 10.08) отвечает на вопрос «влезаем ли», и
 * заклампленные 100 % вместо 130 % прячут ровно тот случай, ради которого
 * показатель заводили. Правило про ноль в знаменателе — общее с `percentOf`,
 * поэтому оно живёт здесь, а не в двух копиях.
 */
export function percentUncapped(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return Math.max(0, Math.round((part / whole) * 100));
}

/** Процент строкой: `null` → «—», иначе «73%» */
export function formatPercent(part: number, whole: number): string {
  return percentLabel(percentOf(part, whole));
}

/**
 * Уже посчитанный процент строкой. Отдельно от `formatPercent`, потому что
 * сводки плана считают процент один раз на день и на неделю, а рисуют
 * в четырёх местах — пересчитывать в каждом значило бы снова развести правила.
 */
export function percentLabel(p: number | null | undefined): string {
  return p === null || p === undefined ? '—' : `${p}%`;
}

/**
 * Дата и время события: «14.08, 09:30».
 *
 * Заменяет `screens/orderCard/format.js`, где было `new Date(d)` без защиты.
 * Строку вида `2026-08-14` (без времени) движок разбирает как UTC-полночь,
 * и западнее Гринвича она печаталась предыдущим днём. Здесь тот же приём,
 * что в `time.ts`: короткая дата достраивается до локальной полуночи.
 */
export function formatDateTimeShort(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = parseLocal(d);
  if (!dt) return '—';
  return dt.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Дата без времени: «14.08.2026». `null` → «—» (в отличие от time.formatDateShort) */
export function formatDateCell(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = parseLocal(d);
  if (!dt) return '—';
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Дата и месяц: «14.08» — для узких ячеек канбана */
export function formatDayMonth(d: string | null | undefined): string {
  if (!d) return '';
  const dt = parseLocal(d);
  if (!dt) return '';
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

/** `YYYY-MM-DD` → локальная полночь; полный ISO — как есть; мусор → null */
function parseLocal(d: string): Date | null {
  const iso = d.length === 10 ? `${d}T00:00:00` : d;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
