import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { _clearAppResets, registerAppReset, runAppResets } from './appReset';

describe('реестр сбросов', () => {
  beforeEach(() => _clearAppResets());
  afterEach(() => _clearAppResets());

  it('пустой реестр вызывается без ошибки', () => {
    expect(() => runAppResets()).not.toThrow();
  });

  it('зовёт всё зарегистрированное', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerAppReset(a);
    registerAppReset(b);
    runAppResets();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('повторная регистрация той же функции не удваивает вызов', () => {
    const a = vi.fn();
    registerAppReset(a);
    registerAppReset(a);
    runAppResets();
    expect(a).toHaveBeenCalledTimes(1);
  });

  /**
   * Выход обязан дочистить остальное: на общем цеховом планшете недочищенный
   * стор — это чужие заказы у следующего работника, а не косметика.
   */
  it('падение одного сброса не отменяет остальные', () => {
    const boom = vi.fn(() => { throw new Error('нет'); });
    const after = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerAppReset(boom);
    registerAppReset(after);
    expect(() => runAppResets()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

/**
 * Страж входного чанка.
 *
 * `useAuthStore` импортировал `resetErpStore` напрямую, и это тянуло ВЕСЬ
 * ERP-стор — четырнадцать слайсов — во входной чанк, который грузит и тот,
 * кто открыл только Order Studio. Стоило это 26 кБ gzip и упирало бюджет
 * входа в потолок: каждая правка любого слайса росла там, где её быть не должно.
 *
 * Сам по себе такой импорт выглядит совершенно безобидно — поэтому и прожил
 * долго. Тест читает исходники: обычный бюджет бандла скажет «стало на 26 кБ
 * больше», но не скажет, из-за какой строки.
 */
describe('входной чанк не тянет ERP-стор', () => {
  const SRC = join(process.cwd(), 'src');

  /** Файлы, попадающие во входной чанк: стор приложения, точка входа, роутер */
  function entrySideFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|js|jsx)$/.test(name) || /\.test\./.test(name)) continue;
        out.push(full);
      }
    };
    walk(join(SRC, 'store'));
    out.push(join(SRC, 'main.jsx'), join(SRC, 'App.jsx'));
    return out;
  }

  it('ни один файл входа не импортирует erp/store статически', () => {
    const guilty = entrySideFiles().filter((file) => {
      const src = readFileSync(file, 'utf8');
      // Только СТАТИЧЕСКИЕ импорты: динамический import() создаёт свой чанк
      return /^\s*import\s[^;]*from\s+'[^']*erp\/store\//m.test(src);
    });
    expect(guilty, `Эти файлы втягивают ERP-стор во вход: ${guilty.join(', ')}. `
      + 'Зарегистрируйте нужное через store/appReset вместо прямого импорта.')
      .toEqual([]);
  });

  /**
   * ЗЕРКАЛЬНОЕ ПРАВИЛО, и оно нарушалось ровно так же — только в другую сторону.
   *
   * `main.jsx` восстанавливал черновик визарда и грузил каталоги под проверкой
   * `if (FEATURES.orderStudio)`, а `useStore` импортировал наверху файла.
   * Проверка рантайм, импорт статический: стор Order Studio со всеми слайсами,
   * весь `src/data` (SKU, цвета, ткани, цены, обработки), `utils/pricing`
   * и `lib/catalogs` ехали во входном чанке — каждому, кто открыл
   * «Производство», где раздел выключен флагом. 15,3 кБ gzip; оболочка ERP
   * стояла на 99 % бюджета.
   *
   * Тот же класс отказа, что был у CSS Order Studio 22.08: условие в коде есть,
   * а в графе сборки его нет. Флаг выключает поведение, но не импорт — раздел
   * за флагом обязан быть отдельным чанком целиком, вместе со своим стартом.
   *
   * `App.jsx` в списке не случайно: он монтирует оба раздела и однажды
   * «на секунду» уже мог бы получить сюда прямой импорт.
   */
  it('ни один файл входа не импортирует стор Order Studio статически', () => {
    const guilty = entrySideFiles()
      .filter((f) => !/[\\/]store[\\/](useStore|slices)/.test(f))
      .filter((file) => {
        const src = readFileSync(file, 'utf8');
        return /^\s*import\s[^;]*from\s+'[^']*(store\/useStore|\.\.?\/data')/m.test(src);
      });
    expect(guilty, `Эти файлы втягивают Order Studio во вход: ${guilty.join(', ')}. `
      + 'Раздел за флагом стартует сам — см. orderstudio/OrderStudioApp.')
      .toEqual([]);
  });
});
