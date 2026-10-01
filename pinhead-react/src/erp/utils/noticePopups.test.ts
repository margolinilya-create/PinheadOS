import { describe, it, expect } from 'vitest';
import {
  newPopups, seenIds, mergePopups, POPUP_LIMIT, SEEN_LIMIT,
} from './noticePopups';
import type { ErpNotification } from '../types';

const N = (id: string, extra: Partial<ErpNotification> = {}): ErpNotification => ({
  id,
  user_id: 'u1',
  kind: 'chat_message',
  order_id: 'o1',
  title: `Сообщение ${id}`,
  body: null,
  link: '/orders/o1?tab=chat',
  created_at: '2026-09-20T10:00:00Z',
  read_at: null,
  ...extra,
});

describe('всплывающие уведомления', () => {
  it('первая загрузка не показывает ничего, даже когда непрочитанные есть', () => {
    expect(newPopups([N('a'), N('b')], [], true)).toEqual([]);
  });

  it('после первой загрузки всплывает только новое', () => {
    const seen = seenIds([N('a')]);
    expect(newPopups([N('b'), N('a')], seen, false).map((n) => n.id)).toEqual(['b']);
  });

  it('прочитанное не всплывает', () => {
    const rows = [N('b', { read_at: '2026-09-20T10:05:00Z' }), N('c')];
    expect(newPopups(rows, ['a'], false).map((n) => n.id)).toEqual(['c']);
  });

  /** Полоса поверх работы, а не лента: больше трёх карточек перекрывают экран */
  it('за раз показывается не больше лимита', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => N(id));
    expect(newPopups(rows, [], false)).toHaveLength(POPUP_LIMIT);
  });

  /**
   * Помним ВЕСЬ список, а не только показанное: прочитанное в соседней вкладке
   * иначе всплыло бы у того, кто его там и прочитал.
   */
  it('запоминаются и прочитанные', () => {
    expect(seenIds([N('a', { read_at: '2026-09-20T10:05:00Z' }), N('b')])).toEqual(['a', 'b']);
  });

  it('повтор не дублирует висящую карточку', () => {
    const cur = [N('b')];
    expect(mergePopups(cur, [N('b')])).toBe(cur);
  });

  it('новое встаёт сверху и вытесняет лишнее', () => {
    const cur = [N('c'), N('b'), N('a')];
    expect(mergePopups(cur, [N('d')]).map((n) => n.id)).toEqual(['d', 'c', 'b']);
  });

  it('пустой приход ничего не меняет', () => {
    const cur = [N('a')];
    expect(mergePopups(cur, [])).toBe(cur);
  });

  /**
   * ПЕРЕПОДКЛЮЧЕНИЕ НЕ ДАЁТ ДУБЛЕЙ (правка 01.10, п. 4). Память накопительная:
   * уведомление, выпавшее из окна в 50 строк и вернувшееся в него при
   * следующем перечитывании, не считается новым.
   */
  it('уже виденное, выпавшее из окна и вернувшееся, не всплывает снова', () => {
    const first = seenIds([N('a')]);
    const second = seenIds([N('b')], first);
    expect(second).toEqual(['b', 'a']);
    expect(newPopups([N('a'), N('b')], second, false)).toEqual([]);
  });

  it('память вкладки ограничена', () => {
    const prev = Array.from({ length: SEEN_LIMIT }, (_, i) => `old${i}`);
    const next = seenIds([N('new')], prev);
    expect(next).toHaveLength(SEEN_LIMIT);
    expect(next[0]).toBe('new');
  });
});
