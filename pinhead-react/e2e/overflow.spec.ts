import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Сторож горизонтального переполнения (правило 3 отчёта QA 13.08.2026).
 *
 * Находки H-03…H-06 — один и тот же дефект в четырёх местах: содержимое шире
 * своего контейнера, а человеку об этом НИЧЕГО не сообщается. Колонка «Действия»
 * в цехах, правый край матрицы прав, «Срок» и «Статус» на обзоре, два цеха
 * из шести на канбане — всё это просто отсутствовало на экране.
 *
 * Правило проекта уже было («горизонтально прокручиваемый блок оборачивается
 * в ScrollHintBox»), не было только сторожа. Поэтому проверяется не «ничего
 * не переполняется» — таблица цехов ШИРЕ ноутбука по существу, и прокрутка
 * тут правильный ответ, — а два свойства:
 *
 *   1. страница целиком по горизонтали не ездит (иначе уезжает вся вёрстка);
 *   2. у каждого реально переполненного блока есть подсказка прокрутки,
 *      он достижим с клавиатуры и объявлен скринридеру.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00Z');

/** Все маршруты ERP со своим экраном */
const ROUTES = [
  '/', '/orders', '/board', '/plan', '/load', '/queue',
  '/purchasing', '/warehouse', '/subcontracting', '/experimental',
  '/admin?tab=users', '/admin?tab=depts', '/admin?tab=perms',
  '/admin?tab=dicts', '/admin?tab=capacity',
];

const withErp = (route: string) => `${route}${route.includes('?') ? '&' : '?'}studio=0`;

/** Экран отрисован: чанк приехал, скелетон снят */
async function ready(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('[class*="skeleton" i]')).toHaveCount(0, { timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
  await installSupabaseMock(page);
});

for (const route of ROUTES) {
  test(`горизонтальная прокрутка под контролем: ${route}`, async ({ page }, testInfo) => {
    await page.goto(withErp(route));
    await ready(page);

    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      doc.scrollWidth,
      `${route}: документ шире окна на ${doc.scrollWidth - doc.clientWidth}px`,
    ).toBeLessThanOrEqual(doc.clientWidth + 1);

    /**
     * Дальше — ДЕСКТОПНАЯ часть проверки.
     *
     * Находки H-03…H-06 измерены на десктопе, и «не видно, что справа есть
     * содержимое» — это про мышь: на тач-экране прокрутка вбок делается
     * свайпом, а сама подсказка — наполовину видимая соседняя колонка
     * (так и устроены доска плана и канбан на 375px, у них свои сценарии
     * в `erp-mobile.spec.ts`). Клавиатуры там тоже нет. Проверять на телефоне
     * десктопное требование значит требовать не того — и я это уже сделал:
     * первый прогон покрасил мобильные `/plan` и обзор красным именно так.
     *
     * Инвариант выше (страница не ездит по горизонтали) остаётся на ВСЕХ
     * проектах: он мобильный в первую очередь.
     */
    if (testInfo.project.name !== 'desktop') return;

    /**
     * Прокручиваемый блок обязан объявлять себя — два требования, оба
     * из находки H-04 («матрица обрезана справа, скролл без визуальной
     * подсказки»):
     *
     *   ВИДНО   — у края нарисован градиент (`ScrollHintBox`, `TabStrip`,
     *             канбан рисуют его одинаково, элементом-соседом);
     *   ДОСТУПНО — до содержимого можно добраться с клавиатуры: либо сам
     *             контейнер в табуляции, либо внутри есть фокусируемые
     *             элементы, прокручивающие его фокусом (WCAG 2.1.1).
     *
     * Проверяется именно градиент, а не набор ARIA-атрибутов: у таблицы,
     * полосы вкладок и доски канбана правильные роли РАЗНЫЕ (region /
     * tablist / list), а вопрос «видно ли, что справа есть содержимое»
     * у всех троих один.
     */
    const silent = await page.evaluate(() => {
      const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]';
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
        if (el.scrollWidth - el.clientWidth <= 2) continue;
        if (!['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) continue;

        const hinted = Boolean(el.parentElement?.querySelector('[class*="Fade" i]'));
        const named = Boolean(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
        const reachable = el.getAttribute('tabindex') === '0' || Boolean(el.querySelector(FOCUSABLE));
        if (hinted && named && reachable) continue;

        out.push([
          `${el.tagName}.${String(el.className).slice(0, 60)}`,
          `${el.clientWidth}/${el.scrollWidth}px`,
          hinted ? '' : 'без подсказки',
          named ? '' : 'без названия',
          reachable ? '' : 'недостижим с клавиатуры',
        ].filter(Boolean).join(' · '));
      }
      return out;
    });
    expect(silent, `${route}: прокрутка не объявлена`).toEqual([]);
  });
}

test('канбан из шести цехов сообщает о прокрутке', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'на 375px канбан листается свайпом');
  // H-06: видны 4 цеха из 6, ШВЕЙКА и ВТО за скроллом. Доска — не вид
  // по умолчанию, поэтому маршрутный обход выше до неё не доходит.
  await page.goto(withErp('/board'));
  await ready(page);
  await page.getByRole('button', { name: 'Канбан' }).click();

  const board = page.getByRole('list', { name: 'Канбан по цехам' });
  await expect(board).toBeVisible();

  const state = await board.evaluate((el) => ({
    scrolls: el.scrollWidth - el.clientWidth > 2,
    hinted: Boolean(el.parentElement?.querySelector('[class*="Fade" i]')),
  }));
  if (state.scrolls) expect(state.hinted, 'доска шире экрана и молчит об этом').toBe(true);
});

test('таблица «Заказы в работе» помещается целиком', async ({ page }, testInfo) => {
  // Только десктоп: на 375px таблицы на обзоре нет вовсе — там карточки,
  // и требовать «шесть колонок влезают» бессмысленно
  test.skip(testInfo.project.name !== 'desktop', 'десктопная раскладка обзора');
  /*
    H-05: виджет получал треть ряда — 283px при нужных 537, и колонки «Срок»
    и «Статус» просто отсутствовали. Прокрутка внутри виджета шириной в половину
    таблицы — не решение: сторож выше её бы принял, поэтому здесь проверяется
    именно ВЛЕЗАЕТ ли таблица.
  */
  await page.goto(withErp('/'));
  await ready(page);

  const wrap = page.getByRole('region', { name: 'Заказы в работе' });
  await expect(wrap).toBeVisible();
  const size = await wrap.evaluate((el) => ({ view: el.clientWidth, need: el.scrollWidth }));
  expect(size.view, `таблице нужно ${size.need}px, видно ${size.view}px`)
    .toBeGreaterThanOrEqual(size.need);
});
