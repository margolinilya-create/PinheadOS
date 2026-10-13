import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * ПОСАДОЧНАЯ ПО РОЛИ (обход 04.09, Б2): половина, достижимая в прогоне.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Цеховой роли в e2e не бывает по построению:
 * работает dev-автологин под `admin`, а `resolveErpRole` приводит профиль
 * администратора к `director` независимо от строки `erp_employees`. Спека,
 * написанная под рабочего, была бы зелёной и на снятой посадочной — то есть
 * сторожем, который нечего сторожить. Ветвление по ролям и однократность
 * решения проверяет `src/erp/hooks/useRoleLanding.test.jsx` (мутациями).
 *
 * Здесь — то, что этот прогон нарушить МОЖЕТ: посадочная не должна трогать
 * тех, у кого её нет, и не должна перебивать прямую ссылку. Обе проверки
 * покраснеют, если завтра кто-нибудь сделает редирект безусловным.
 */

test.describe('Посадочная по роли', () => {
  test('руководящая роль остаётся на обзоре', async ({ page }) => {
    await installSupabaseMock(page);
    await page.goto('/?studio=0');

    await expect(page.getByRole('heading', { name: 'Обзор производства' })).toBeVisible();
    // Пакет оболочки приезжает после первой отрисовки — даём ему сработать
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('прямая ссылка сильнее посадочной', async ({ page }) => {
    await installSupabaseMock(page);
    await page.goto('/orders?studio=0');

    await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe('/orders');
  });
});
