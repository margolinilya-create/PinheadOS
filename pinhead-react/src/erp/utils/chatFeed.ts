import { FACTORY_TIMEZONE, factoryDate } from '../../utils/date';
import type { ErpChatMessage } from '../types';

/**
 * ЛЕНТА ПЕРЕПИСКИ: дни и группы (правка заказчика 20.09, п. 4).
 *
 * «Добавить разделители „Сегодня", „Вчера", далее „18 сентября", а для
 * прошлых лет — с годом… Последовательные сообщения одного автора в пределах
 * пяти минут объединять визуально, не пересекая разделители дней
 * и непрочитанного».
 *
 * ПОЧЕМУ ДЕНЬ СЧИТАЕТСЯ ПО ЧАСОВОМУ ПОЯСУ ФАБРИКИ, А НЕ БРАУЗЕРА. Документ
 * называет пояс прямо: «использовать часовой пояс аккаунта, по умолчанию
 * для Pinhead — Москва». В разделе это уже решено для сроков и плана
 * (`factoryDate`), и второй ответ на вопрос «какой сегодня день» развёл бы
 * ленту с планом: сообщение, написанное в 23:30 по Москве, у менеджера
 * в другом поясе оказалось бы «завтрашним».
 *
 * ЗДЕСЬ НЕТ РАЗМЕТКИ И НЕТ ОБРАЩЕНИЙ К СТОРУ: это разбор значений, и он
 * обязан одинаково работать у ленты, у теста и у будущего поиска.
 */

/** Элемент ленты: разделитель дня, граница непрочитанного или группа сообщений */
export type FeedNode =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: 'unread' }
  | { kind: 'group'; key: string; authorId: string | null; messages: ErpChatMessage[] };

/** Сообщения одного автора внутри этого окна склеиваются в группу */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Подпись дня: «Сегодня» / «Вчера» / «18 сентября» / «18 сентября 2025».
 *
 * Год добавляется ТОЛЬКО для прошлых лет: «18 сентября 2026» в сентябре
 * 2026-го — это шум, который человек всё равно не читает.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const day = factoryDate(new Date(iso));
  const today = factoryDate(now);
  if (day === today) return 'Сегодня';

  const yesterday = factoryDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (day === yesterday) return 'Вчера';

  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: FACTORY_TIMEZONE,
  });
}

/** Время сообщения — ЧЧ:ММ по поясу фабрики (документ: «Время сообщения — ЧЧ:ММ») */
export function messageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: FACTORY_TIMEZONE,
  });
}

/** Полные дата и время — для подсказки по наведению */
export function messageFullTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: FACTORY_TIMEZONE,
  });
}

/**
 * Лента, разобранная на узлы.
 *
 * `firstUnreadId` — первое непрочитанное сообщение: перед ним встаёт граница.
 * Она НЕ двигается от того, что сообщения тут же отмечаются прочитанными:
 * идентификатор фиксируется при открытии окна и живёт весь сеанс (документ:
 * «граница остаётся ориентиром в текущем сеансе, даже когда видимые
 * сообщения уже отмечены прочитанными»).
 */
export function buildFeed(
  messages: readonly ErpChatMessage[] | null | undefined,
  options: { firstUnreadId?: string | null; now?: Date } = {},
): FeedNode[] {
  const list = [...(messages ?? [])];
  if (list.length === 0) return [];

  const now = options.now ?? new Date();
  const out: FeedNode[] = [];
  let lastDay: string | null = null;
  let group: Extract<FeedNode, { kind: 'group' }> | null = null;

  for (const m of list) {
    const day = factoryDate(new Date(m.created_at));

    if (day !== lastDay) {
      out.push({ kind: 'day', key: `day-${day}`, label: dayLabel(m.created_at, now) });
      lastDay = day;
      // Новый день — новая группа: склейка «не пересекает разделители дней»
      group = null;
    }

    if (options.firstUnreadId && m.id === options.firstUnreadId) {
      out.push({ kind: 'unread', key: 'unread' });
      // И разделитель непрочитанного тоже разрывает группу
      group = null;
    }

    const prev = group?.messages[group.messages.length - 1];
    const sameAuthor = prev && prev.author_id === m.author_id;
    const close = prev
      && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() <= GROUP_WINDOW_MS;

    if (group && sameAuthor && close) {
      group.messages.push(m);
    } else {
      group = {
        kind: 'group',
        key: `g-${m.id}`,
        authorId: m.author_id ?? null,
        messages: [m],
      };
      out.push(group);
    }
  }

  return out;
}
