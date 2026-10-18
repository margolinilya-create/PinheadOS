import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock, type MockExtras } from './support/mockSupabase';
import { axeSerious, staffFx } from './support/orderCatalogFx';
import { smallTargets } from './support/orderFlowFx';
import { FLATS_ITEM, FLATS_ORDER, darkTheme, dbCatalogs, designExtras } from './support/visualStudioFx';

/**
 * Доступность раздела «Оформление заказа» после рестайла (веха 8, задача 9):
 * axe serious/critical = 0 на 375, 760, 768 px и десктопе — `/sku`, `/express`,
 * `/sales/:id` (все четыре вкладки), `/sales-staff` с открытым журналом признаков;
 * `color-contrast` — в светлой И тёмной теме на `/sku`, `/express`, `/sales/:id`
 * (тёмную axe проверяет тем же набором правил, контраст в нём есть).
 * Тач-цели ≥ 44 px — с `hasTouch` (`pointer: coarse`): без него компактная
 * раскладка контролов не включается, и мерить было бы не тот интерфейс.
 *
 * Ширины задаются в тесте, поэтому спека идёт одним проектом (desktop).
 */

const WIDTHS = [375, 760, 768, 1280] as const;

type Screen = { name: string; path: string; ready: (page: Page) => Promise<void>; extra: () => MockExtras };

const heading = (page: Page, name: string | RegExp) => expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

const SCREENS: Screen[] = [
  { name: '/sku', path: '/sku', extra: () => ({ catalogs: dbCatalogs() }), ready: (p) => heading(p, 'Каталог моделей и цен') },
  { name: '/express', path: '/express', extra: () => ({ catalogs: dbCatalogs() }), ready: (p) => heading(p, 'Экспресс-расчёт') },
  ...['item', 'design', 'client', 'summary'].map((tab) => ({
    name: `/sales/:id ?tab=${tab}`,
    path: `/sales/${FLATS_ORDER}?tab=${tab}&item=${FLATS_ITEM}`,
    extra: designExtras,
    ready: async (p: Page) => {
      await heading(p, 'PH-9100 · ООО Тест');
      await expect(p.getByRole('tabpanel')).toBeVisible();
    },
  })),
];

/** «Экспресс» — с выбранным изделием и тканью: иначе axe смотрит пустую форму */
async function fillExpress(page: Page) {
  await page.getByLabel('Изделие').selectOption({ label: 'Футболка Free Fit' });
  await page.getByLabel('Ткань').selectOption({ index: 1 });
  await expect(page.getByText(/^Итого за 100 шт/).first()).toBeVisible();
}

async function open(page: Page, s: Screen) {
  await installSupabaseMock(page, s.extra());
  await page.goto(`${s.path}${s.path.includes('?') ? '&' : '?'}studio=1`);
  await s.ready(page);
  if (s.name === '/express') await fillExpress(page);
}

/** «Сотрудники продаж»: отметить признак, раскрыть журнал «Кто и когда менял» */
async function openStaffWithJournal(page: Page) {
  await installSupabaseMock(page, { salesStaff: staffFx() });
  await page.goto('/sales-staff?studio=1');
  await heading(page, 'Сотрудники продаж');
  const box = page.getByRole('checkbox', { name: 'МС: Олег Петров' }).first();
  await box.check();
  await expect(box).toBeChecked();
  const journal = page.locator('details').filter({ hasText: 'Кто и когда менял' });
  await journal.locator('summary').click();
  await expect(journal).toHaveAttribute('open', '');
}

const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('доступность раздела «Оформление заказа» (веха 8)', () => {
  test.beforeEach(() => test.skip(test.info().project.name !== 'desktop', 'Ширины задаются в тесте — один проект'));

  for (const theme of ['light', 'dark'] as const) {
    for (const s of SCREENS) {
      test(`${s.name}, ${theme === 'dark' ? 'тёмная' : 'светлая'} тема: axe serious/critical = 0 на 375/760/768/1280`, async ({ page }) => {
        test.slow();
        if (theme === 'dark') await darkTheme(page);
        await open(page, s);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await s.ready(page);
          expect(await axeSerious(page), `${s.name}, ${theme}, ${width} px`).toEqual([]);
          expect(await pageOverflow(page), `${s.name}: горизонтальная прокрутка страницы на ${width} px`).toBeLessThanOrEqual(0);
        }
      });
    }
  }

  test('/sales-staff с журналом признаков: axe serious/critical = 0 на 375/760/768/1280', async ({ page }) => {
    await openStaffWithJournal(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      expect(await axeSerious(page), `/sales-staff, ${width} px`).toEqual([]);
      expect(await pageOverflow(page), `/sales-staff: горизонтальная прокрутка на ${width} px`).toBeLessThanOrEqual(0);
    }
  });
});

/**
 * Известные находки задачи 9 (исправление — задача 11, по находке на коммит): мелкая цель
 * названа здесь ТОЧНО, по ширине. Сторож красный и на новой мелкой цели, и на исправленной
 * (тогда запись удаляется) — список не может молча протухнуть.
 * Пусто с задачи 11: W3 (ссылка позиции на «ТЗ и цена») и M-7 (раскрывашки «Изделия») исправлены.
 */
const KNOWN_SMALL: Record<string, RegExp[]> = {};

test.describe('тач-цели раздела ≥ 44 px (pointer: coarse)', () => {
  test.beforeEach(() => test.skip(test.info().project.name !== 'desktop', 'Ширины задаются в тесте — один проект'));
  test.use({ hasTouch: true });

  for (const s of [...SCREENS, { name: '/sales-staff', path: '', extra: () => ({}), ready: async () => {} } as Screen]) {
    test(`${s.name}: кнопки и ссылки в main ≥ 44 px на 375/760/768/1280`, async ({ page }) => {
      test.slow();
      if (s.name === '/sales-staff') await openStaffWithJournal(page);
      else await open(page, s);
      const known = KNOWN_SMALL[s.name] ?? [];
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await s.ready(page);
        const small = await smallTargets(page);
        const fresh = small.filter((t) => !known.some((re) => re.test(t)));
        expect(fresh, `${s.name}, ${width} px`).toEqual([]);
        for (const re of known) expect(small.some((t) => re.test(t)), `${s.name}, ${width} px: находка ${re} исправлена — уберите её из KNOWN_SMALL`).toBe(true);
      }
    });
  }
});
