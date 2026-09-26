import { describe, it, expect, vi } from 'vitest';
import {
  deptsSettled, erpQuery, erpRead, logStageEvent, networkFailureMessage, STAGE_EVENT_RETRY_MS,
} from './shared';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';

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

/**
 * Резерв места под состав участков снимается по ОТВЕТУ, а не по данным.
 *
 * Обе половины предиката закрывают свой отказ, и обе обязаны быть покрыты —
 * иначе следующая правка выкинет одну как лишнюю, и вернётся либо заглушка
 * поверх приехавшего меню, либо фантомная пустота навсегда.
 */
describe('deptsSettled — когда место под участки резервировать уже не нужно', () => {
  it('пусто и ответа не было — состав не окончателен, место резервируем', () => {
    expect(deptsSettled([], false)).toBe(false);
  });

  it('цеха принёс второй писатель (loadAll) — резерв снимается, даже если пакет ещё в пути', () => {
    expect(deptsSettled([{ id: 'dep-cutting' }], false)).toBe(true);
  });

  it('пакет ОТВЕТИЛ ошибкой — цехов нет, но резерв снимается: иначе заглушка навсегда', () => {
    expect(deptsSettled([], true)).toBe(true);
  });
});

/**
 * `logStageEvent` — fire-and-forget, но не «fire-and-crash» (обзор 26.09, п. 12).
 *
 * supabase-js БРОСАЕТ на сбое до ответа. Голый `attempt().then(…)` без
 * обработки броска давал unhandled rejection: событие терялось молча, а
 * vitest такой прогон роняет — это и есть мутационная проверка: убрать
 * `erpQuery` из `attempt` — тест красный.
 */
describe('logStageEvent — бросок клиента не становится unhandled rejection', () => {
  it('обе попытки сорвались на сети → предупреждение и тост, без исключения', async () => {
    vi.useFakeTimers();
    const insert = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.mocked(supabase.from).mockReturnValueOnce({ insert } as never)
      .mockReturnValueOnce({ insert } as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => {});
    try {
      logStageEvent({ stage_id: 's1', event_type: 'start' } as never);
      await vi.advanceTimersByTimeAsync(STAGE_EVENT_RETRY_MS + 10);
      expect(insert).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith('stage event not logged:', 'нет связи с сервером');
      expect(errorToast).toHaveBeenCalledWith('Событие истории не записалось');
    } finally {
      warn.mockRestore();
      errorToast.mockRestore();
      vi.useRealTimers();
    }
  });
});
