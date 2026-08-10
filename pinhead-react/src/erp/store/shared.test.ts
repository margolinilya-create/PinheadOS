import { describe, it, expect } from 'vitest';
import { erpQuery, erpRead, networkFailureMessage } from './shared';

/**
 * Сбой ДО ответа сервера.
 *
 * `supabase-js` возвращает `error`, когда сервер ответил, и БРОСАЕТ, когда ответа
 * не было. В сторе это учитывали три функции из шестидесяти, и цена ошибки везде
 * одинаковая: ветка `if (error) …` — со снятием busy-флага, откатом и сообщением —
 * просто не выполняется. `erpQuery` приводит оба случая к одному виду.
 */
describe('erpQuery — бросок читается как ошибка ответа', () => {
  it('обычный ответ проходит насквозь', async () => {
    const res = await erpQuery(async () => ({ data: [{ id: 1 }], error: null }));
    expect(res.data).toEqual([{ id: 1 }]);
    expect(res.error).toBeNull();
  });

  it('ошибка сервера проходит насквозь', async () => {
    const res = await erpQuery(async () => ({
      data: null, error: { message: 'new row violates row-level security policy' },
    }));
    expect(res.error?.message).toMatch(/row-level security/);
  });

  it('бросок превращается в error, а не в отклонённый промис', async () => {
    const res = await erpQuery<unknown[]>(() => {
      throw new TypeError('Load failed');
    });
    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();
  });

  it('отклонённый промис тоже становится error', async () => {
    const res = await erpQuery<unknown[]>(async () => {
      await Promise.resolve();
      throw new TypeError('Failed to fetch');
    });
    expect(res.error?.message).toBe('нет связи с сервером');
  });
});

describe('networkFailureMessage — причина словами', () => {
  it('«Load failed» из WebKit человеку ничего не говорит', () => {
    expect(networkFailureMessage(new TypeError('Load failed'))).toBe('нет связи с сервером');
  });

  it('«Failed to fetch» из Chromium — то же самое', () => {
    expect(networkFailureMessage(new TypeError('Failed to fetch'))).toBe('нет связи с сервером');
  });

  it('осмысленное сообщение сохраняется как есть', () => {
    expect(networkFailureMessage(new Error('permission denied for table erp_orders')))
      .toBe('permission denied for table erp_orders');
  });

  it('не-Error тоже не роняет', () => {
    expect(networkFailureMessage('что-то пошло не так')).toBe('что-то пошло не так');
    expect(networkFailureMessage(null)).toBe('нет связи с сервером');
  });
});

/**
 * Повтор чтения при обрыве сети.
 *
 * Заказчик просил retry для временных сбоев: цеховой Wi-Fi роняет запрос на секунду,
 * и человек получает пустой экран там, где данные есть. Но повторять можно не всё —
 * ответ сервера это решение, а не помеха, а повтор записи создаёт второй заказ.
 */
describe('erpRead — повтор только сети и только чтения', () => {
  it('успех с первого раза не повторяется', async () => {
    let calls = 0;
    const res = await erpRead(async () => { calls += 1; return { data: [1], error: null }; });
    expect(calls).toBe(1);
    expect(res.data).toEqual([1]);
  });

  it('обрыв сети повторяется один раз и второй заход спасает экран', async () => {
    let calls = 0;
    const res = await erpRead<number[]>(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Load failed');
      return { data: [42], error: null };
    });
    expect(calls).toBe(2);
    expect(res.data).toEqual([42]);
    expect(res.error).toBeNull();
  });

  it('отказ сервера НЕ повторяется — это решение, а не помеха', async () => {
    let calls = 0;
    const res = await erpRead(async () => {
      calls += 1;
      return { data: null, error: { message: 'permission denied for table erp_orders' } };
    });
    expect(calls).toBe(1);
    expect(res.error?.message).toMatch(/permission denied/);
  });

  it('если сеть не вернулась, ошибка доходит до вызывающего', async () => {
    let calls = 0;
    const res = await erpRead<number[]>(async () => {
      calls += 1;
      throw new TypeError('Failed to fetch');
    });
    expect(calls).toBe(2);
    expect(res.error?.message).toBe('нет связи с сервером');
  });
});
