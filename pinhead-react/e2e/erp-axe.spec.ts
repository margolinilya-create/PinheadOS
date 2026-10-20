import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installSupabaseMock } from './support/mockSupabase';
import { CUT_DEPT_PATCH, CUT_ORDER } from './support/cutFormFx';

/**
 * АВТОМАТИЧЕСКИЙ АУДИТ ДОСТУПНОСТИ ПО ВСЕМУ РАЗДЕЛУ.
 *
 * ЗАЧЕМ ОН РЯДОМ С РУКОПИСНЫМ `erp-a11y.spec.ts`. Тот проверяет ОБЕЩАНИЯ
 * интерфейса — skip-link ведёт куда надо, у вкладок полный таб-паттерн,
 * тосты объявляются, — и axe таких вещей не знает. Но обратное тоже верно,
 * и аудит 03.09 это показал: половина найденного (`role="list"` без прямых
 * `listitem`, `aria-label` на `<span>` без роли, контраст, `<td>` вместо
 * `<th scope="row">`) — ровно то, что axe находит сам, а рукописный сторож
 * не искал. Причём покрывал он ШЕСТЬ экранов из пятнадцати: все четыре
 * найденных барьера лежали за его пределами.
 *
 * Зависимость `@axe-core/playwright` — devDependency, в прод-сборку не едет
 * (решение владельца 03.09; правило «не добавлять пакеты без обсуждения»
 * соблюдено).
 *
 * ПОЧЕМУ НЕ «НОЛЬ НАРУШЕНИЙ ЛЮБОГО ПРАВИЛА». Проверяются нарушения уровня
 * A и AA — то, под чем проект подписался. Порог «ноль» держится ратчетом
 * (`KNOWN`): правило, которое сегодня не выполнено осознанно, перечислено
 * поимённо и с причиной, а не отключено молча. Пустой `KNOWN` — цель,
 * и сейчас он пуст.
 */

const SCREENS = [
  { name: 'Обзор', url: '/?studio=0' },
  { name: 'Заказы', url: '/orders?studio=0' },
  { name: 'Карточка заказа', url: '/orders/ord-a?studio=0' },
  { name: 'Доска производства', url: '/board?studio=0' },
  { name: 'План производства', url: '/plan?studio=0' },
  { name: 'Загрузка цехов', url: '/load?studio=0' },
  { name: 'Гант', url: '/gantt?studio=0' },
  { name: 'Очередь цеха', url: '/queue/cutting?studio=0' },
  { name: 'Закупка', url: '/purchasing?studio=0' },
  { name: 'Склад', url: '/warehouse?studio=0' },
  { name: 'Подряд', url: '/subcontracting?studio=0' },
  { name: 'Экспериментальный цех', url: '/experimental?studio=0' },
  { name: 'Админка', url: '/admin?studio=0' },
  // Правки 19.10, п. 7: общий раздел и карточка бизнес-задачи (фикстура `bt-1`, мок `bizTasksRpc`)
  { name: 'Бизнес-задачи', url: '/biz-tasks?studio=0' },
  { name: 'Карточка бизнес-задачи', url: '/biz-tasks/bt-1?studio=0' },
];

/**
 * Осознанно принятые нарушения: правило → почему. Список ПУСТ, и это его
 * нормальное состояние. Появилась запись — рядом обязана стоять причина,
 * иначе через месяц никто не отличит «решили так» от «забыли починить».
 */
const KNOWN: Record<string, string> = {};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-20T09:00:00Z'));
  await installSupabaseMock(page);
});

for (const screen of SCREENS) {
  test(`${screen.name}: нет нарушений WCAG 2.1 A/AA`, async ({ page }) => {
    await page.goto(screen.url);
    /**
     * Ждём САМ ЭКРАН, а не `load`. Экраны ERP — ленивые чанки: `page.goto`
     * разрешается, когда оболочка уже нарисована, а на месте экрана ещё
     * скелетон. Сканировать скелетон — значит проверять пустоту и всегда
     * получать зелёный результат (та же ловушка, из-за которой в `erp-a11y`
     * заведён `gotoScreen`). `h1` рисует `PageHead` ВНУТРИ экрана.
     */
    await expect(page.locator('h1')).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const unexpected = violations.filter((v) => !(v.id in KNOWN));
    /**
     * В отчёт идёт и `failureSummary` — без него «контраст ниже нормы»
     * не говорит, КАКИЕ цвета и насколько: чинить приходится вслепую.
     */
    const report = unexpected.map((v) => {
      const nodes = v.nodes.slice(0, 3).map((n) => {
        const why = (n.failureSummary ?? '').replace(/\s+/g, ' ').trim();
        return `      ${n.target.join(' ')}\n        ${why}`;
      }).join('\n');
      return `${v.id} (${v.impact}): ${v.help}\n${nodes}`;
    });
    expect(report, `${screen.name} — нарушения:\n${report.join('\n')}`).toEqual([]);
  });
}

/**
 * ФОРМА СДАЧИ ЗАКРОЯ ОТКРЫТОЙ, 375 px (правки 19.10). Экран «Очередь цеха»
 * выше снимается с закрытыми карточками, а форма — самое плотное место
 * раздела: таблица выпуска, плитки режимов, вложенные группы радио и липкая
 * полоса итогов. Ширина задана в самом тесте: на телефоне строки рулонов —
 * карточками, и проверять надо именно эту раскладку. Мок ставится второй
 * раз — со своим заказом и схемой отчёта закроя; поздний маршрут главнее.
 */
test('Очередь закроя с открытой формой сдачи (375 px): нет нарушений WCAG 2.1 A/AA', async ({ page }) => {
  await installSupabaseMock(page, { orders: [CUT_ORDER], deptPatch: CUT_DEPT_PATCH });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/queue/cutting?studio=0');
  const card = page.locator('[class*="queueCard"]', { hasText: 'Свитшоты закрой-тест' }).first();
  await card.getByRole('button', { name: /Записать результат/ }).click();
  await expect(page.getByRole('heading', { name: 'Расход ткани' })).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Рулон №2 — использование' }).getByText('Частично').click();

  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const report = violations.filter((v) => !(v.id in KNOWN)).map((v) => {
    const nodes = v.nodes.slice(0, 3)
      .map((n) => `      ${n.target.join(' ')}\n        ${(n.failureSummary ?? '').replace(/\s+/g, ' ').trim()}`)
      .join('\n');
    return `${v.id} (${v.impact}): ${v.help}\n${nodes}`;
  });
  expect(report, `форма закроя — нарушения:\n${report.join('\n')}`).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

/**
 * ФОРМА «НОВАЯ ЗАДАЧА» ОТКРЫТОЙ (правки 19.10, п. 7): вкладка «Задачи» заказа,
 * раскрытый блок «Дополнительно» — комбобоксы людей, радио типа, чек-лист.
 * Экраны выше снимаются с закрытой формой, а она — самое плотное место раздела.
 */
test('Форма новой бизнес-задачи: нет нарушений WCAG 2.1 A/AA', async ({ page }) => {
  await page.goto('/orders/ord-a?studio=0&tab=tasks');
  await page.getByRole('button', { name: 'Создать задачу' }).click();
  const form = page.getByRole('form', { name: 'Новая задача' });
  await form.getByRole('button', { name: /Дополнительно/ }).click();
  await form.getByRole('button', { name: 'Добавить пункт' }).click();

  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const report = violations.filter((v) => !(v.id in KNOWN)).map((v) => {
    const nodes = v.nodes.slice(0, 3)
      .map((n) => `      ${n.target.join(' ')}\n        ${(n.failureSummary ?? '').replace(/\s+/g, ' ').trim()}`)
      .join('\n');
    return `${v.id} (${v.impact}): ${v.help}\n${nodes}`;
  });
  expect(report, `форма задачи — нарушения:\n${report.join('\n')}`).toEqual([]);
});
