import { describe, it, expect } from 'vitest';
import { searchSnippet, SNIPPET_RADIUS } from './chatSearch';

/**
 * ОБРЕЗКА НАХОДКИ (вторая очередь чата, документ 20.09, п. 4).
 *
 * Сервер отдаёт тело найденного сообщения ЦЕЛИКОМ — и это решение: обрезка
 * там однажды вернула бы кусок без найденного слова. Значит режет клиент,
 * и режет ВОКРУГ совпадения. Правило тихое: «первые 140 символов» выглядят
 * прилично ровно до первой длинной реплики, где искомое в конце.
 */

const long = (mid: string) => `${'а'.repeat(200)}${mid}${'б'.repeat(200)}`;

describe('кусок вокруг найденного', () => {
  it('короткое сообщение показывается целиком', () => {
    expect(searchSnippet('Ткань приехала', 'ткань')).toBe('Ткань приехала');
  });

  it('в длинном показывается окрестность совпадения, а не начало', () => {
    const out = searchSnippet(long('РОМАШКА'), 'ромашка');
    expect(out).toContain('РОМАШКА');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    // Радиус с двух сторон плюс само слово плюс два многоточия
    expect(out.length).toBeLessThanOrEqual(SNIPPET_RADIUS * 2 + 'РОМАШКА'.length + 2);
  });

  it('регистр не важен — сервер ищет так же', () => {
    expect(searchSnippet(long('Ромашка'), 'РОМАШКА')).toContain('Ромашка');
  });

  it('совпадение у начала не получает лишнего многоточия слева', () => {
    const out = searchSnippet(`РОМАШКА${'б'.repeat(300)}`, 'ромашка');
    expect(out.startsWith('…')).toBe(false);
    expect(out.endsWith('…')).toBe(true);
  });

  /**
   * Сообщение нашлось по другому слову той же реплики или запрос короче
   * порога — показываем начало. Это честнее пустоты: находка есть,
   * подсветить нечего.
   */
  it('без совпадения показывается начало', () => {
    const out = searchSnippet(long('X'), 'нетакого');
    expect(out.startsWith('а')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('пустой запрос не ломает обрезку', () => {
    expect(() => searchSnippet(long('X'), '')).not.toThrow();
    expect(searchSnippet('короткое', '')).toBe('короткое');
  });
});
