import { describe, expect, it } from 'vitest';
import {
  contextKey, isWholeDeal, messageInContext, sameContext, unreadForContext,
} from './chatContext';

/**
 * КОНТЕКСТ ОБСУЖДЕНИЯ (правка 14.09, п. 5).
 *
 * Разбор простой, а цена ошибки — нет: по ключу контекста хранится черновик
 * («не туда отправил») и выбирается счётчик непрочитанного («в сделке пусто,
 * а в задаче есть»). Оба дефекта молчаливые.
 */

const STAGE = { stageId: 's1' };
const ITEM = { itemId: 'i1' };

describe('что считается «всей сделкой»', () => {
  it('пусто, null и объект без якорей — одно и то же', () => {
    expect(isWholeDeal(null)).toBe(true);
    expect(isWholeDeal(undefined)).toBe(true);
    expect(isWholeDeal({})).toBe(true);
    expect(isWholeDeal({ stageId: null, itemId: null })).toBe(true);
  });

  it('любой якорь сужает контекст', () => {
    expect(isWholeDeal(STAGE)).toBe(false);
    expect(isWholeDeal(ITEM)).toBe(false);
    expect(isWholeDeal({ experimentalId: 'd1' })).toBe(false);
  });
});

describe('ключ контекста', () => {
  it('порядок полей в объекте на ключ не влияет', () => {
    /**
     * `JSON.stringify` печатает ключи в порядке ВСТАВКИ, и ключ, собранный
     * из него, зависел бы от того, в каком месте кода открыли окно, —
     * то есть черновик терялся бы через раз.
     */
    expect(contextKey({ stageId: 's1', itemId: 'i1' }))
      .toBe(contextKey({ itemId: 'i1', stageId: 's1' }));
  });

  it('разные якоря дают разные ключи, «вся сделка» — свой', () => {
    expect(contextKey({})).toBe('all');
    expect(contextKey(STAGE)).not.toBe(contextKey(ITEM));
    expect(contextKey(STAGE)).not.toBe('all');
  });

  it('сравнение контекстов идёт по ключу', () => {
    expect(sameContext(STAGE, { stageId: 's1' })).toBe(true);
    expect(sameContext(STAGE, ITEM)).toBe(false);
    expect(sameContext(null, {})).toBe(true);
  });
});

describe('какое сообщение попадает в ленту контекста', () => {
  const msg = (over = {}) => ({
    item_id: null, stage_id: null, experimental_id: null, ...over,
  });

  it('в ленте ВСЕЙ сделки видны и общие, и контекстные', () => {
    // Иначе переписка по задаче исчезала бы из общей ленты, и человек
    // решил бы, что её нет вовсе
    expect(messageInContext(msg(), {})).toBe(true);
    expect(messageInContext(msg({ stage_id: 's1' }), {})).toBe(true);
  });

  it('в ленте задачи видны только её сообщения', () => {
    expect(messageInContext(msg({ stage_id: 's1' }), STAGE)).toBe(true);
    expect(messageInContext(msg({ stage_id: 's2' }), STAGE)).toBe(false);
    expect(messageInContext(msg(), STAGE)).toBe(false);
  });
});

describe('какой счётчик показать', () => {
  const unread = { total: 7, byStage: { s1: 2, s2: 1 } };

  it('у сделки — общее число', () => {
    expect(unreadForContext(unread, {})).toBe(7);
  });

  it('у задачи — её число, а НЕ сумма с общим', () => {
    // Сумма посчитала бы сообщение задачи дважды
    expect(unreadForContext(unread, STAGE)).toBe(2);
    expect(unreadForContext(unread, { stageId: 'нет-такого' })).toBe(0);
  });

  it('контекст без этапа считается по сделке', () => {
    // У позиции и разработки своей водяной отметки нет: документ просит
    // отдельный счётчик у ЗАДАЧИ, и выдумывать третий вид не за чем
    expect(unreadForContext(unread, ITEM)).toBe(7);
  });

  it('счётчика ещё нет — это ноль, а не падение', () => {
    expect(unreadForContext(null, {})).toBe(0);
    expect(unreadForContext(undefined, STAGE)).toBe(0);
  });
});
