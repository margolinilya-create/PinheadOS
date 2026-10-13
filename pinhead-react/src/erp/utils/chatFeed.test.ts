import { describe, it, expect } from 'vitest';
import { buildFeed, dayLabel, messageTime } from './chatFeed';

/** Момент в поясе фабрики (UTC+3): «20 сентября 2026, 12:00 по Москве» */
const msk = (iso: string) => `${iso}+03:00`;
const NOW = new Date(msk('2026-09-20T12:00:00'));

const msg = (id: string, at: string, author = 'u1') => ({
  id,
  author_id: author,
  body: id,
  created_at: msk(at),
}) as never;

describe('dayLabel — дни считаются по поясу фабрики, а не браузера', () => {
  it('сегодня и вчера названы словами', () => {
    expect(dayLabel(msk('2026-09-20T09:00:00'), NOW)).toBe('Сегодня');
    expect(dayLabel(msk('2026-09-19T23:00:00'), NOW)).toBe('Вчера');
  });

  it('прошлые дни этого года — без года', () => {
    expect(dayLabel(msk('2026-09-18T10:00:00'), NOW)).toBe('18 сентября');
  });

  it('прошлый год — с годом: иначе «18 сентября» читается как недавнее', () => {
    expect(dayLabel(msk('2025-09-18T10:00:00'), NOW)).toBe('18 сентября 2025 г.');
  });

  /**
   * ГРАНИЦА СУТОК — САМОЕ ЦЕННОЕ ЗДЕСЬ. 23:59 по Москве — это уже 20:59 UTC,
   * и разбор по UTC отнёс бы сообщение к предыдущему дню. Сроки и план
   * в разделе считаются по `factoryDate`, и вторая трактовка «сегодня»
   * развела бы ленту с ними.
   */
  it('23:59 и 00:01 по Москве — разные дни', () => {
    expect(dayLabel(msk('2026-09-20T23:59:00'), NOW)).toBe('Сегодня');
    expect(dayLabel(msk('2026-09-21T00:01:00'), NOW)).not.toBe('Сегодня');
  });

  it('время показывается по Москве, а не по поясу браузера', () => {
    expect(messageTime(msk('2026-09-20T23:59:00'))).toBe('23:59');
  });
});

describe('buildFeed — разделители дней, групп и непрочитанного', () => {
  it('каждый новый день начинается своим разделителем', () => {
    const feed = buildFeed([
      msg('a', '2026-09-19T10:00:00'),
      msg('b', '2026-09-20T10:00:00'),
    ], { now: NOW });
    expect(feed.filter((n) => n.kind === 'day').map((n) => n.label))
      .toEqual(['Вчера', 'Сегодня']);
  });

  it('сообщения одного автора в пределах пяти минут — одна группа', () => {
    const feed = buildFeed([
      msg('a', '2026-09-20T10:00:00'),
      msg('b', '2026-09-20T10:03:00'),
    ], { now: NOW });
    const groups = feed.filter((n) => n.kind === 'group');
    expect(groups).toHaveLength(1);
    expect(groups[0].messages.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('шесть минут — уже отдельная группа', () => {
    const feed = buildFeed([
      msg('a', '2026-09-20T10:00:00'),
      msg('b', '2026-09-20T10:06:00'),
    ], { now: NOW });
    expect(feed.filter((n) => n.kind === 'group')).toHaveLength(2);
  });

  it('другой автор группу разрывает, как бы близко ни было', () => {
    const feed = buildFeed([
      msg('a', '2026-09-20T10:00:00', 'u1'),
      msg('b', '2026-09-20T10:00:30', 'u2'),
    ], { now: NOW });
    expect(feed.filter((n) => n.kind === 'group')).toHaveLength(2);
  });

  it('склейка НЕ пересекает разделитель дня', () => {
    // Полночь: те же пять минут, но дни разные
    const feed = buildFeed([
      msg('a', '2026-09-19T23:59:00'),
      msg('b', '2026-09-20T00:01:00'),
    ], { now: NOW });
    expect(feed.filter((n) => n.kind === 'group')).toHaveLength(2);
    expect(feed.filter((n) => n.kind === 'day')).toHaveLength(2);
  });

  it('граница непрочитанного встаёт перед первым непрочитанным и рвёт группу', () => {
    const feed = buildFeed([
      msg('a', '2026-09-20T10:00:00'),
      msg('b', '2026-09-20T10:01:00'),
    ], { now: NOW, firstUnreadId: 'b' });

    const kinds = feed.map((n) => n.kind);
    expect(kinds).toEqual(['day', 'group', 'unread', 'group']);
  });

  it('пустая лента — пустой разбор, без разделителей в пустоту', () => {
    expect(buildFeed([], { now: NOW })).toEqual([]);
    expect(buildFeed(null, { now: NOW })).toEqual([]);
  });
});
