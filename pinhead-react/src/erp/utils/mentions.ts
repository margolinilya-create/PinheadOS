import type { ErpChatPerson } from '../types';

/**
 * УПОМИНАНИЯ (правка 14.09, п. 5).
 *
 * Документ: «упоминание сотрудника через @ с поиском по имени и email…
 * просто введённый текст „@Имя" без выбора сотрудника из списка
 * не считается упоминанием и уведомление не отправляет».
 *
 * Отсюда модель: в тексте сообщения живёт только ЧИТАЕМЫЙ токен `@Имя`,
 * а адресаты — отдельный список идентификаторов. Разбирать текст обратно
 * в людей нельзя: тёзки, пробелы в именах и «@ткань на складе» дали бы
 * уведомление тому, кого никто не звал, — и заметил бы это адресат,
 * а не автор.
 *
 * СЕРВЕР ВСЁ РАВНО ФИЛЬТРУЕТ (`erp_chat_send` оставляет только активных
 * участников): здесь удобство, гейт там. Две половины не дублируют друг
 * друга — они отвечают на разные вопросы: «кого человек выбрал» и «кому
 * вообще можно писать».
 */

/** Как упоминание выглядит в тексте */
export function mentionToken(name: string): string {
  return `@${name}`;
}

/**
 * Кого действительно упомянули: из выбранных остаются те, чей токен
 * ещё СТОИТ в тексте.
 *
 * Правило важнее, чем кажется: человек выбрал коллегу из списка, потом
 * стёр `@Имя` — и без этой проверки тот всё равно получил бы уведомление
 * о сообщении, в котором его не зовут.
 */
export function mentionsInText(
  text: string,
  chosen: { user_id: string; name: string }[],
): string[] {
  const out: string[] = [];
  for (const person of chosen) {
    if (!text.includes(mentionToken(person.name))) continue;
    if (!out.includes(person.user_id)) out.push(person.user_id);
  }
  return out;
}

/**
 * Что человек набирает после `@` прямо сейчас. `null` — подсказку показывать
 * не нужно.
 *
 * `@` считается началом упоминания ТОЛЬКО в начале слова: адрес почты
 * в тексте (`za@pnhd.ru`) не должен открывать список сотрудников.
 */
export function mentionQuery(
  text: string,
  caret: number,
): { query: string; from: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const prev = at > 0 ? before[at - 1] : ' ';
  if (!/\s/.test(prev)) return null;
  const query = before.slice(at + 1);
  // Перевод строки закрывает набор: упоминание — это одно слово-другое,
  // а не всё, что человек написал после случайной собаки
  if (query.includes('\n')) return null;
  return { query, from: at };
}

/** Поиск по имени И по email — прямое требование документа */
export function matchPeople(
  people: ErpChatPerson[],
  query: string,
  limit = 6,
): ErpChatPerson[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? people.filter((p) => p.name.toLowerCase().includes(q)
      || (p.email ?? '').toLowerCase().includes(q))
    : people;
  return list.slice(0, limit);
}

/**
 * Подставить выбранного: токен заменяет набранное `@…` и получает пробел
 * в хвост — иначе следующее слово прилипнет к имени и токен перестанет
 * находиться в тексте.
 */
export function applyMention(
  text: string,
  from: number,
  caret: number,
  person: { name: string },
): { text: string; caret: number } {
  const token = `${mentionToken(person.name)} `;
  const next = text.slice(0, from) + token + text.slice(caret);
  return { text: next, caret: from + token.length };
}

/**
 * Разбор сообщения на куски для показа: токены упоминаний подсвечиваются.
 *
 * Подсвечиваются ТОЛЬКО те имена, что реально в списке адресатов сообщения:
 * подсветка по любому `@слово` обещала бы, что человека позвали, — а его
 * могли и не позвать (см. правило выше).
 */
export function splitMentions(
  body: string,
  mentions: string[],
  people: ErpChatPerson[],
): { text: string; mention: boolean }[] {
  const names = mentions
    .map((id) => people.find((p) => p.user_id === id)?.name)
    .filter((n): n is string => Boolean(n))
    // Длинные имена первыми: «Мария» не должна съесть начало «Мария Иванова»
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text: body, mention: false }];

  const parts: { text: string; mention: boolean }[] = [];
  let rest = body;
  while (rest.length > 0) {
    let bestAt = -1;
    let bestName = '';
    for (const name of names) {
      const at = rest.indexOf(mentionToken(name));
      if (at >= 0 && (bestAt < 0 || at < bestAt)) { bestAt = at; bestName = name; }
    }
    if (bestAt < 0) { parts.push({ text: rest, mention: false }); break; }
    if (bestAt > 0) parts.push({ text: rest.slice(0, bestAt), mention: false });
    parts.push({ text: mentionToken(bestName), mention: true });
    rest = rest.slice(bestAt + mentionToken(bestName).length);
  }
  return parts;
}
