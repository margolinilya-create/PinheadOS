import { describe, it, expect } from 'vitest';
import { createAttemptKeeper } from './attemptKey';

/**
 * Правило, которое этот ключ выражает: **не изменил ввод — это та же попытка**.
 *
 * Опасный случай ровно один и не редкий: запрос ушёл, сервер его закоммитил,
 * ответ не вернулся, человек жмёт «Принять» второй раз. Для приёмки материала
 * это молча удвоенный приход — то есть неверное количество материала
 * на фабрике. Клиентский `saving` не помогает: он гасит кнопку на время ОДНОГО
 * запроса, а здесь их два, и оба настоящие.
 */
describe('createAttemptKeeper', () => {
  it('повтор с тем же вводом — тот же ключ', () => {
    const k = createAttemptKeeper();
    const first = k.keyFor('m1|60|accepted_partial');
    expect(k.keyFor('m1|60|accepted_partial')).toBe(first);
  });

  it('изменился ввод — новая попытка', () => {
    // 60 и потом ещё 35 — это ДВА прихода, и второй обязан записаться
    const k = createAttemptKeeper();
    const first = k.keyFor('m1|60|accepted_partial');
    expect(k.keyFor('m1|35|accepted_partial')).not.toBe(first);
  });

  it('после успеха следующая приёмка — новая, даже с тем же вводом', () => {
    const k = createAttemptKeeper();
    const first = k.keyFor('m1|60|accepted_partial');
    k.reset();
    expect(k.keyFor('m1|60|accepted_partial')).not.toBe(first);
  });

  it('ключи разных форм не совпадают', () => {
    const a = createAttemptKeeper();
    const b = createAttemptKeeper();
    expect(a.keyFor('same')).not.toBe(b.keyFor('same'));
  });
});
