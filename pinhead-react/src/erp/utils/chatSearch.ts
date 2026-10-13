/**
 * ПОИСК ПО ПЕРЕПИСКЕ — чистая часть (вторая очередь чата, документ 20.09, п. 4).
 *
 * Сервер отдаёт тело НАЙДЕННОГО СООБЩЕНИЯ ЦЕЛИКОМ, и это решение: обрезка
 * на сервере однажды отдала бы кусок без найденного слова. Значит обрезать —
 * здесь, и обрезать надо ВОКРУГ совпадения, а не «первые N символов»:
 * у реплики на полтора экрана начало не содержит того, что искали.
 */

/** Сколько символов показывать вокруг найденного */
export const SNIPPET_RADIUS = 60;

/**
 * Кусок текста вокруг первого совпадения, с многоточиями там, где отрезано.
 *
 * Регистр не важен (`ILIKE` на сервере ищет так же), пустой запрос
 * или отсутствие совпадения дают начало текста — это честнее пустоты:
 * сообщение нашлось, просто подсветить нечего.
 */
export function searchSnippet(body: string, query: string): string {
  const text = body ?? '';
  const q = (query ?? '').trim();
  if (text.length <= SNIPPET_RADIUS * 2) return text;

  const at = q.length >= 2 ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return `${text.slice(0, SNIPPET_RADIUS * 2)}…`;

  const from = Math.max(0, at - SNIPPET_RADIUS);
  const to = Math.min(text.length, at + q.length + SNIPPET_RADIUS);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}
