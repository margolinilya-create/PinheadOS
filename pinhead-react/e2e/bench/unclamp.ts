import type { Page } from '@playwright/test';

/**
 * РАЗЖАТИЕ ОБОЛОЧКИ ПЕРЕД ПОЛНЫМ СНИМКОМ.
 *
 * `fullPage: true` снимает высоту ДОКУМЕНТА. В разделе «Производство» документ
 * не прокручивается вовсе: `.shell { height: 100dvh; overflow: hidden }`,
 * `.rightcol { height: 100dvh }`, прокручивается `<main>` внутри. Поэтому
 * `fullPage` там вырождается в снимок области просмотра.
 *
 * Это не теория: все восемь ERP-эталонов `e2e/visual.spec.ts-snapshots/*.png`
 * имеют размер РОВНО 1280×800 и 375×812 — при `fullPage: true` в самой спеке.
 * То есть визуальный сторож продукта видит только первый экран каждой страницы,
 * а таблицы, очереди и виджеты, ради которых на эти экраны и заходят, живут
 * ниже сгиба и не сторожатся ничем. Для сравнения `studio-sku-desktop.png` —
 * 1280×3896: у Order Studio прокручивается документ, и там всё честно.
 *
 * ПОЧЕМУ ОБХОД ПО DOM, А НЕ СЕЛЕКТОРАМИ.
 * Имена классов хешируются CSS-модулями (`.shell` → `_shell_1f2a3_12`),
 * и селектор вида `[class*="shell"]` держится на формате хеша, то есть
 * на настройке сборщика. Стенд, который молча снял первый экран вместо
 * целого, — это инструмент, врущий ровно в том, ради чего заведён. Поэтому
 * идём от настоящего `<main>` вверх по предкам и снимаем ограничения там,
 * где они ФАКТИЧЕСКИ стоят, по вычисленным стилям.
 *
 * `position: fixed` не трогаем: ниже 1024px сайдбар — выезжающий оверлей,
 * и «разжатый» оверлей растянулся бы на всю высоту документа поверх контента.
 */
export async function unclampShell(page: Page): Promise<void> {
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return;

    const relax = (el: HTMLElement) => {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') return;
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
        el.style.setProperty('overflow', 'visible', 'important');
      }
      // Высота, заданная вьюпортом (100dvh/100vh) или числом, держит документ
      // в один экран — снимаем её вместе с ограничением сверху
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      el.style.setProperty('min-height', '0', 'important');
    };

    relax(main as HTMLElement);
    for (let el = main.parentElement; el; el = el.parentElement) {
      relax(el as HTMLElement);
    }

    // Сайдбар — брат `<main>`, а не предок: по цепочке вверх он не попадается.
    // Ему нужна не «авто», а ЯВНАЯ высота разжатого документа: `min-height: 100%`
    // здесь не работает, потому что у родителя высота стала `auto` — процент
    // считать не от чего, и тёмная панель обрывается на высоте экрана, а снимок
    // читается как поломка вёрстки там, где её нет.
    const docHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    document.querySelectorAll('nav, aside').forEach((node) => {
      const el = node as HTMLElement;
      if (getComputedStyle(el).position === 'fixed') return;
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('min-height', `${docHeight}px`, 'important');
    });
  });
}
