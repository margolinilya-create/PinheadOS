import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';
import { DEPARTMENTS, isQueueDept } from '../src/erp/data/departments';

/**
 * Сторож РАСКЛАДКИ: место под поздние данные обязано быть зарезервировано.
 *
 * Дефект, ради которого спека написана: данные оболочки приезжают одним
 * `erp_bootstrap`, и пока их нет, блоки, зависящие от состава участков, имеют
 * нулевую высоту. Приезд пакета вставлял ≈315px меню между «Мой цех»
 * и «Операции» (263 → 578), а на очереди цеха поднимал ряд вкладок с 0 до 48px
 * и домонтировал тулбар с фильтрами — содержимое уезжало на 126px вниз.
 * На планшете это значит, что пункт уходит из-под пальца через доли секунды
 * после появления экрана.
 *
 * ПОЧЕМУ ГЕЙТ, А НЕ ЗАДЕРЖКА В МИЛЛИСЕКУНДАХ. Чтобы доказать резерв, надо снять
 * геометрию в состоянии «данные ещё не приехали». С задержкой остаётся окно,
 * в котором пакет успевает ответить до замера, и сторож зеленеет на сломанном
 * коде — то есть перестаёт быть сторожем. `deptsGate` держит ответ, пока спека
 * сама его не отпустит, поэтому состояние «до» гарантировано.
 *
 * ПОЧЕМУ ОДНОГО ПОРОГА CLS НЕ ХВАТИЛО БЫ. На момент написания CLS выше порога
 * Web Vitals (0.1) был только у очереди (0.140) и плана (0.131); обзор (0.034),
 * заказы (0.023) и доска (0.023) прошли бы порог ПРЯМО СЕЙЧАС, на неисправленном
 * коде, хотя сдвиг сайдбара есть на всех пяти. Поэтому блокирующая проверка —
 * геометрическая и детерминированная, а агрегатный CLS идёт вторым слоем.
 *
 * Прогон против СОБРАННОГО приложения (порт 4173, проект `perf`): dev раздаёт
 * неминифицированные модули со своим водопадом, и числа, снятые на нём,
 * к продакшену отношения не имеют.
 */

/** Сколько участков окажется в меню — из тех же данных, что и у приложения. */
const PROD_DEPTS = DEPARTMENTS.filter((d) => isQueueDept(d.code) && d.code !== 'qc').length;

/** Экраны, на которых сдвиг сайдбара виден одинаково. */
const SCREENS = ['/', '/orders', '/board', '/queue', '/plan'];

type Gate = { promise: Promise<void>; release: () => void };

function makeGate(): Gate {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/**
 * Прогреть память устройства и открыть экран с ЗАКРЫТЫМ гейтом состава участков.
 *
 * Прогрев обязателен: резерв опирается на запомненное число строк, а цеховой
 * планшет открывают каждый день на одном и том же устройстве. Первый заход
 * в чистом профиле резерва не имеет по построению — это названная плата,
 * а не забытый случай.
 */
async function openWithDeptsHeld(page: Page, path: string): Promise<Gate> {
  await installSupabaseMock(page);
  await page.goto(`http://localhost:4173${path}?studio=0`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('nav a[href^="/queue/"]')).toHaveCount(PROD_DEPTS);

  const gate = makeGate();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await installSupabaseMock(page, { deptsGate: gate.promise });
  await page.goto(`http://localhost:4173${path}?studio=0`);
  await expect(page.locator('h1')).toBeVisible();
  return gate;
}

test.describe('Раскладка не прыгает от позднего erp_bootstrap', () => {
  for (const path of SCREENS) {
    test(`сайдбар: группа «Операции» не уезжает вниз — ${path}`, async ({ page }) => {
      const gate = await openWithDeptsHeld(page, path);

      const ops = page.locator('nav[class*="sidebarNav"] div[class*="navGroup"]', {
        hasText: /^Операции$/,
      });
      await expect(ops).toBeVisible();
      const before = await ops.boundingBox();

      gate.release();
      await expect(page.locator('nav a[href^="/queue/"]')).toHaveCount(PROD_DEPTS);
      const after = await ops.boundingBox();

      expect(before, 'группа «Операции» должна быть видна до приезда участков').not.toBeNull();
      expect(after).not.toBeNull();
      expect(
        Math.abs(after!.y - before!.y),
        `«Операции» уехали с y=${Math.round(before!.y)} на y=${Math.round(after!.y)} — `
        + 'место под группу «Цеха» не зарезервировано',
      ).toBeLessThanOrEqual(1);
    });
  }

  test('очередь цеха: ряд вкладок держит высоту до приезда участков', async ({ page }) => {
    const gate = await openWithDeptsHeld(page, '/queue');

    const tabs = page.locator('[class*="deptTabsWrap"]');
    await expect(tabs).toBeVisible();
    const before = await tabs.boundingBox();

    gate.release();
    await expect(page.locator('nav a[href^="/queue/"]')).toHaveCount(PROD_DEPTS);
    const after = await tabs.boundingBox();

    expect(
      Math.abs(after!.height - before!.height),
      `ряд вкладок вырос с ${Math.round(before!.height)}px до ${Math.round(after!.height)}px`,
    ).toBeLessThanOrEqual(1);
  });

  test('очередь цеха: обвязка экрана видна до приезда данных', async ({ page }) => {
    /*
     * Переключатель вида и панель фильтров стояли под `dept && loaded`, то есть
     * ждали ВТОРОЙ запрос ради обвязки, которая от него не зависит: вид живёт
     * в localStorage, чипы фильтров — константы, сами фильтры в адресе.
     * Их доментирование и давало те самые 126px.
     */
    const gate = await openWithDeptsHeld(page, '/queue/cutting');

    await expect(page.getByRole('button', { name: /Очередь/ })).toBeVisible();
    // Именно поиск ПО ЗАДАНИЯМ: глобальный поиск в шапке есть всегда и о резерве
    // ничего не сказал бы
    await expect(page.getByRole('searchbox', { name: 'Поиск по заданиям' })).toBeVisible();

    gate.release();
    await expect(page.locator('nav a[href^="/queue/"]')).toHaveCount(PROD_DEPTS);
  });

  test('план: до приезда участков рисуется скелетон, а не пустой ответ', async ({ page }) => {
    /*
     * `planLoaded` отвечает по маленькому запросу слотов и встаёт раньше, чем
     * приезжают цеха и заказы. Между этими моментами экран рисовал ПОЛНОЦЕННЫЙ,
     * но неправдивый кадр: «Не запланировано (0)» и «ничего не запланировано» —
     * вакуумная истина на пустом списке цехов.
     */
    const gate = await openWithDeptsHeld(page, '/plan');

    const panel = page.locator('#plan-tabpanel');
    await expect(panel.locator('[role="status"]')).toBeVisible();
    await expect(panel.getByText('Не запланировано', { exact: false })).toHaveCount(0);

    gate.release();
    await expect(page.locator('nav a[href^="/queue/"]')).toHaveCount(PROD_DEPTS);
  });
});

test.describe('Совокупный CLS под нагрузкой', () => {
  for (const path of SCREENS) {
    test(`CLS ниже порога Web Vitals — ${path}`, async ({ page, context }) => {
      // Цеховой планшет медленнее ноутбука: без замедления сдвиги съезжают
      // в один кадр и наблюдатель их не разделяет
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

      await page.addInitScript(() => {
        const w = window as unknown as {
          __cls: { value: number; unsupported: boolean; sources: string[] };
        };
        w.__cls = { value: 0, unsupported: true, sources: [] };
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as unknown as Array<{
              value: number; hadRecentInput: boolean;
              sources?: Array<{ node?: Node }>;
            }>) {
              if (entry.hadRecentInput) continue;
              w.__cls.value += entry.value;
              for (const s of entry.sources ?? []) {
                const el = s.node as Element | undefined;
                if (!el || el.nodeType !== 1) continue;
                const cls = typeof el.className === 'string' ? el.className.split(/\s+/)[0] : '';
                w.__cls.sources.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`);
              }
            }
          }).observe({ type: 'layout-shift', buffered: true });
          w.__cls.unsupported = false;
        } catch { /* тип не поддержан — останется unsupported */ }
      });

      await installSupabaseMock(page);
      // Прогрев: резерв сайдбара опирается на память устройства
      await page.goto(`http://localhost:4173${path}?studio=0`);
      await expect(page.locator('h1')).toBeVisible();
      await page.goto(`http://localhost:4173${path}?studio=0`);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('nav a[href^="/queue/"]')).toHaveCount(PROD_DEPTS);
      await page.waitForTimeout(1500);

      const cls = await page.evaluate(() => (window as unknown as {
        __cls: { value: number; unsupported: boolean; sources: string[] };
      }).__cls);

      // Без этой строки сторож вечно зелен в среде, где типа layout-shift нет
      expect(cls.unsupported, 'layout-shift не поддержан — сторож ничего не проверил').toBe(false);
      expect(
        cls.value,
        `CLS ${cls.value.toFixed(3)}; сдвинулись: ${[...new Set(cls.sources)].join(', ') || '—'}`,
      ).toBeLessThan(0.1);
    });
  }
});
