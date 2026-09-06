import { expect, test } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * АДМИНКА: МАТРИЦА ПРАВ ЧИТАЕМА ПРИ ПРОКРУТКЕ.
 *
 * Прав шестнадцать, ролей пятнадцать — 240 галочек в таблице, которая
 * не помещается ни по ширине, ни по высоте. Липкий ПЕРВЫЙ СТОЛБЕЦ стоял
 * с самого начала, а второй половины той же связи — липкой ШАПКИ — не было:
 * стоило дойти до середины списка прав, и галочка ставилась в колонку, чьё
 * имя уехало за верхний край. Ошибка тут молча отключает людям работу,
 * и заметна она только по жалобе из цеха.
 *
 * Сторож меряет ГЕОМЕТРИЮ, а не наличие правила в CSS: `position: sticky`
 * не срабатывает, если контейнер прокрутки окажется другим, а объявление
 * при этом остаётся на месте и выглядит рабочим.
 */
test.describe('матрица прав', () => {
  test('шапка ролей и столбец прав остаются на экране при прокрутке', async ({ page }) => {
    await installSupabaseMock(page);
    await page.goto('/admin?tab=roles&studio=0');
    await page.getByRole('heading', { level: 1 }).first().waitFor();

    const header = page.getByRole('columnheader', { name: /Диспетчер/ });
    // Имя права стоит и в ячейке, и в `aria-label` пятнадцати галочек той же строки
    const firstCol = page.getByRole('cell', { name: /Брать задания в работу/ }).first();
    await expect(header).toBeVisible();

    const before = await header.boundingBox();
    const rowBefore = await firstCol.boundingBox();
    expect(before, 'шапка роли обязана быть отрисована').toBeTruthy();

    /**
     * Прокрутка идёт ВНУТРИ коробки матрицы (`.matrixWrap`), поэтому курсор
     * ставится над таблицей. Позиций несколько: перекрытие зависит от того,
     * какая строка сейчас под шапкой, и одна проба была зелёной на сломанном
     * экране — заголовки групп прав идут через каждые три-пять строк.
     */
    await page.mouse.move(700, 600);
    for (const step of [300, 300, 300, 300]) {
      await page.mouse.wheel(0, step);
      await page.waitForTimeout(200);

      const after = await header.boundingBox();
      expect(Math.abs(after!.y - before!.y), 'шапка ролей уехала вместе со строками')
        .toBeLessThan(4);

      /**
       * КООРДИНАТ МАЛО. Первая редакция сторожа была ЗЕЛЁНОЙ на экране, где
       * шапка стояла на месте, а по названиям ролей ехала белая полоса тела
       * таблицы: заголовок группы прав (`th[colspan]`) попадал под правило
       * липкого первого столбца, становился позиционированным с тем же
       * `z-index` — и при равном z-index спор решает порядок в DOM. Геометрия
       * была верна, увидел это только снимок экрана. Поэтому проверяется
       * ВИДИМОСТЬ: в точках названия роли верхним элементом обязана быть
       * сама ячейка шапки.
       */
      const covered = await page.evaluate(() => {
        const heads = [...document.querySelectorAll('thead th')];
        return heads.filter((th) => {
          const b = th.getBoundingClientRect();
          const x = b.x + b.width / 2;
          // Роли, уехавшие за правый край коробки, точкой не проверить
          if (x < 0 || x > window.innerWidth) return false;
          // Щупаем ВСЮ высоту ячейки: полоса накрывала первую строку названия
          return [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].some((k) => {
            const top = document.elementFromPoint(x, b.y + b.height * k);
            return top !== th && !th.contains(top);
          });
        }).map((th) => th.textContent?.trim() ?? '?');
      });
      expect(covered, `названия ролей перекрыты: ${covered.join(', ')}`).toEqual([]);
    }

    const rowAfter = await firstCol.boundingBox();
    expect(rowAfter!.y, 'таблица обязана была прокрутиться')
      .toBeLessThan(rowBefore!.y - 100);
    await expect(header).toBeInViewport();
  });

  test('в шапку помещается семь ролей из пятнадцати', async ({ page }) => {
    await installSupabaseMock(page);
    await page.goto('/admin?tab=roles&studio=0');
    await page.getByRole('heading', { level: 1 }).first().waitFor();

    /**
     * Названия ролей — те, что выбрал владелец («Менеджер сопровождения»),
     * и второго словаря сокращений мы не заводим. Читаемость даёт ПЕРЕНОС
     * по словам: в одну строку колонка занимала 200px, и на 1280px помещалось
     * четыре роли из пятнадцати — до пятнадцатой надо было проскроллить
     * три экрана вбок, потеряв из виду название права.
     */
    // Только шапка таблицы: заголовки групп прав — тоже `columnheader`
    const heads = page.locator('thead th:not(:first-child)');
    const total = await heads.count();
    let visible = 0;
    for (let i = 0; i < total; i += 1) {
      const box = await heads.nth(i).boundingBox();
      if (box && box.x >= 0 && box.x + box.width <= 1280) visible += 1;
    }
    /**
     * РАТЧЕТ, а не «больше половины»: до переноса по словам помещались ЧЕТЫРЕ
     * роли из пятнадцати, стало семь. Порог держит достигнутое и падает,
     * если колонка снова начнёт растягиваться по длине названия.
     */
    expect(total, 'ролей в матрице').toBe(15);
    expect(visible, `в шапку попало ролей: ${visible} из ${total}`)
      .toBeGreaterThanOrEqual(7);
  });
});
