import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Сторож повторной попытки после неудачной загрузки доменного чанка.
 *
 * ДЕФЕКТ, РАДИ КОТОРОГО НАПИСАН. `ensureDomainSlices` кэшировал промис через
 * `??=`, а `??=` присваивает только при `null`. Отклонённый промис оставался
 * в переменной НАВСЕГДА: каждая следующая попытка возвращала тот же отказ,
 * и кнопка «Повторить» на экране ошибки не могла сработать в принципе —
 * лечила только перезагрузка страницы. Ровно это и наблюдалось на проде после
 * выкатки: чанк `domainSlices-*.js` не доехал один раз, а экран остался
 * сломанным до F5.
 *
 * Проверяется ПОВЕДЕНИЕ (вторая попытка доходит до успеха), а не наличие
 * `catch` в тексте модуля: сторож, читающий исходник, зеленел бы на любой
 * переформулировке.
 *
 * `vi.hoisted` обязателен: фабрика `vi.mock` поднимается в начало файла,
 * и обычные переменные модуля ей ещё не видны.
 */
const h = vi.hoisted(() => ({
  attachDomainSlices: vi.fn(),
  calls: 0,
  failFirst: true,
}));

vi.mock('./store/domainSlices', () => ({
  /*
   * Отказ имитируем на ПРИСОЕДИНЕНИИ слайсов, а не броском из фабрики:
   * vitest оборачивает бросок фабрики в собственное сообщение, и проверять
   * пришлось бы его текст, а не поведение. Для сторожа это безразлично —
   * кэш сбрасывается при ЛЮБОМ отклонении цепочки, а «чанк не доехал»
   * и «чанк доехал, но подключение упало» дают одинаковое отклонение.
   *
   * Считаем ВЫЗОВЫ, а не прогоны фабрики: при повторном импорте того же
   * модуля фабрика не перезапускается, и счётчик в ней стоял бы на месте.
   */
  attachDomainSlices: () => {
    h.calls += 1;
    if (h.failFirst && h.calls === 1) {
      throw new Error(
        'Failed to fetch dynamically imported module: /assets/domainSlices-CPH-CwXL.js',
      );
    }
    h.attachDomainSlices();
  },
}));

describe('ensureDomainSlices — отказ не запоминается навсегда', () => {
  beforeEach(() => {
    h.calls = 0;
    h.failFirst = true;
    h.attachDomainSlices.mockClear();
    vi.resetModules();
  });

  it('после неудачи следующая попытка грузит чанк заново и доходит до успеха', async () => {
    const { ensureDomainSlices } = await import('./lazyScreen');

    await expect(ensureDomainSlices()).rejects.toThrow(/dynamically imported module/);

    // Вторая попытка — то, что делает кнопка «Повторить». Со старым `??=`
    // здесь возвращался бы тот же отклонённый промис, и повтор был бы
    // декоративным
    await expect(ensureDomainSlices()).resolves.toBeUndefined();
    expect(h.attachDomainSlices).toHaveBeenCalledTimes(1);
  });

  it('успешный результат кэшируется — второй экран не грузит чанк повторно', async () => {
    h.failFirst = false;
    const { ensureDomainSlices } = await import('./lazyScreen');

    await ensureDomainSlices();
    await ensureDomainSlices();

    expect(h.attachDomainSlices).toHaveBeenCalledTimes(1);
  });
});
