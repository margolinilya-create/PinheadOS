import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock, type MockExtras } from '../support/mockSupabase';
import { dbCatalogs, designExtras } from '../support/visualStudioFx';
import { unclampShell } from './unclamp';
import { SHOTS, WIDTHS, THEMES, type Shot } from './routes';

/**
 * ОБХОД РАЗДЕЛА ГЛАЗАМИ: ~40 состояний × 3 ширины × 2 темы (с вехи 8 — и «Оформление заказа»).
 *
 * Это НЕ сторож (см. шапку `playwright.bench.config.ts`): здесь нет ни одного
 * сравнения с эталоном, только `page.screenshot`. Результат — галерея в `.shots/`,
 * которую читает человек. Метка прогона задаётся `SHOTS_LABEL` (`before`,
 * `after`, `wave1`…), чтобы можно было положить две галереи рядом.
 *
 * Запуск:  npm run shots               — метка `current`
 *          SHOTS_LABEL=before npm run shots
 *          npm run shots -- -g "1440"  — только десктопная ширина
 */

// Тот же момент, что у `visual.spec.ts`: относительно него в фикстурах
// посчитаны сроки, и «просрочен 31 дн.» не должен дрейфовать между прогонами
const FIXED_TIME = new Date('2026-07-20T09:00:00');

const LABEL = process.env.SHOTS_LABEL || 'current';

/**
 * Тема ставится ДО первой отрисовки, через хранилище, откуда её читает
 * `useTheme` (ключ `ph_theme`). Переключить тумблером после загрузки нельзя:
 * тумблер живёт в шапке, и снимок пришлось бы делать после лишнего клика
 * на каждом экране; а поставить `data-theme` руками мало — React перепишет
 * атрибут своим эффектом при первом же рендере.
 */
/**
 * Мок раздела «Оформление заказа» (веха 8): справочники «из базы» (каталог не на
 * запасном пути), заказ с флэтом и логотипом (фикстура эталонов), он же на запуске
 */
function orderMock(): MockExtras {
  const extra = designExtras();
  const db = dbCatalogs() as { catalog_config: Record<string, unknown>; app_config: Record<string, unknown> };
  db.app_config = { ...db.app_config, ...(extra.catalogs?.app_config ?? {}) };
  return { ...extra, catalogs: db };
}

const STUDIO_MOCKS: Record<NonNullable<Shot['mock']>, () => MockExtras> = {
  catalogs: () => ({ catalogs: dbCatalogs() }),
  order: () => orderMock(),
  launch: () => {
    const extra = orderMock();
    const [row] = extra.salesOrders as Record<string, unknown>[];
    Object.assign(row, { status: 'ready_to_launch', sent_at: '2026-07-20T08:00:00Z', due_date: '2026-08-20' });
    return extra;
  },
};

async function prepare(page: Page, theme: string, shot: Shot) {
  await page.addInitScript((t) => {
    try { localStorage.setItem('ph_theme', t); } catch { /* приватный режим */ }
  }, theme);
  await installSupabaseMock(page, shot.mock ? STUDIO_MOCKS[shot.mock]() : {});
  await page.clock.setFixedTime(FIXED_TIME);
}

async function shoot(page: Page, shot: Shot, widthName: string, theme: string) {
  const sep = shot.path.includes('?') ? '&' : '?';
  await page.goto(`${shot.path}${sep}studio=${shot.studio ? 1 : 0}`);

  // Ждём ЗАГОЛОВОК ЭКРАНА, а не `networkidle`: `page.goto` дожидается модулей,
  // но инициализация сессии и `erp_bootstrap` идут ПОСЛЕ `load`, и на холодном
  // старте снимок поймал бы глобальное «Загрузка…» (ровно этот отказ разбирался
  // в сессии 36 — отсюда `gotoScreen` в erp-a11y). `h1` рисует `PageHead`
  // внутри самого экрана, оболочка его не рисует.
  const h1 = shot.heading
    ? page.getByRole('heading', { level: 1, name: shot.heading })
    : page.locator('h1');
  await expect(h1.first()).toBeVisible({ timeout: 20_000 });

  // Скелетоны сменяются содержимым уже после появления заголовка
  await page.waitForTimeout(600);
  // Шрифты меняют ширину текста: `font-display: swap` подменяет начертание
  // уже после отрисовки, и снимок без этого ожидания ловит чужие метрики
  await page.evaluate(() => document.fonts.ready);

  await unclampShell(page);
  await page.screenshot({
    path: `.shots/${LABEL}/${shot.name}-${widthName}-${theme}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

for (const w of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${w.name} ${theme}`, () => {
      test.use({
        viewport: { width: w.width, height: w.height },
        hasTouch: w.hasTouch,
      });

      for (const shot of SHOTS) {
        if (shot.minWidth && w.width < shot.minWidth) continue;
        test(`${shot.name} ${w.name} ${theme}`, async ({ page }) => {
          await prepare(page, theme, shot);
          await shoot(page, shot, w.name, theme);
        });
      }
    });
  }
}
