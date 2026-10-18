import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { MockCall, MockExtras } from './mockSupabase';
import { seedFlatObjects, seedFlatsCatalog } from './flatsFixture';

/**
 * Помощники сквозного e2e заказа (`order-flow.spec.ts`, веха 6+7, задача 7):
 * мок с бакетами С ТЕЛОМ, флэт футболки, вход МС поверх dev-автологина,
 * чтение PDF ТЗ из мока и текста из него pdfjs.
 */

const FIX = new URL('../fixtures/tz/', import.meta.url);
export const tzFixture = (name: string): Buffer => readFileSync(new URL(name, FIX));

export const FLAT = 'tshirt-freefit';
/** Id нового заказа: путь файлов заказа требует uuid (`artworkPath`), а мок по умолчанию даёт `mock-sales-1` */
export const NEW_ORDER = '7a0e3c1d-6b6e-4c47-9f1a-0000000067a1';
/** Часы сценария: 20.10.2026 10:00 по Москве (решение 40) */
export const NOW = '2026-10-20T10:00:00+03:00';

/** МС: профиль приложения и вызывающий RPC мока (у мока свой, у приложения свой) */
export const MS = { id: 'p-ms', name: 'Ирина МС', role: 'manager', is_sales: false, is_ms: true } as const;
export const MS2 = { id: 'p-ms2', name: 'Пётр Второй', role: 'manager', is_sales: false, is_ms: true } as const;

/** Мок сквозного сценария: флэт FreeFit, бакеты с телом, журнал вызовов */
export function flowMock(calls: MockCall[], more: Partial<MockExtras> = {}): MockExtras {
  return {
    calls,
    catalogs: { app_config: { garmentFlats: seedFlatsCatalog([FLAT]) } },
    storageObjects: { ...seedFlatObjects([FLAT]) },
    ...more,
  };
}

export const rpcCalls = (calls: MockCall[], name: string) => calls.filter((c) => c.kind === 'rpc' && c.name === name);
export const storageUploads = (calls: MockCall[], bucket: string) => calls
  .filter((c) => c.kind === 'storage' && c.name.startsWith(`${bucket}/`))
  .map((c) => c.name.slice(bucket.length + 1));

/**
 * Первое сохранение нового заказа получает uuid `NEW_ORDER`: подменяем `p_order.id`
 * в теле запроса до мока (`route.fallback` с новым телом). Регистрировать ПОСЛЕ
 * `installSupabaseMock` — поздний обработчик Playwright срабатывает первым.
 */
export async function newOrderGetsUuid(page: Page, id = NEW_ORDER): Promise<void> {
  await page.route('**/rest/v1/rpc/order_v4_save_full', async (route) => {
    const body = route.request().postDataJSON() as { p_order?: { id?: string | null } };
    if (body?.p_order && !body.p_order.id) {
      await route.fallback({ postData: JSON.stringify({ ...body, p_order: { ...body.p_order, id } }) });
      return;
    }
    await route.fallback();
  });
}

/** Автосохранение дошло: индикатор «Сохранено» */
export async function settled(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Сохранено$/ })).toBeVisible();
}

/** Профиль вошедшего поверх dev-автологина: стор приложения тот же, перезагрузка вернула бы админа */
export async function loginAs(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (p) => {
    const { useAuthStore } = await import('/src/store/useAuthStore.ts');
    const user = useAuthStore.getState().user;
    useAuthStore.setState({ user: { ...user, ...p } });
  }, patch);
}

/** Текст PDF (pdfjs в Node): кириллица из текстового слоя и число страниц */
export async function pdfInfo(bytes: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { text: parts.join('\n'), pages };
}

/** Тело объекта `order-artworks` из мока по пути */
export function artworkObject(extra: MockExtras, path: string): Buffer {
  const o = extra.storageObjects?.[`order-artworks/${path}`];
  expect(o, `нет объекта order-artworks/${path}`).toBeDefined();
  return o!.body;
}

/** Нарушения тач-целей: видимые кнопки и ссылки внутри `main` меньше 44 px по высоте */
export async function smallTargets(page: Page, scope = 'main'): Promise<string[]> {
  const out: string[] = [];
  for (const el of await page.locator(`${scope} button:visible, ${scope} a[href]:visible, ${scope} input[type="date"]:visible`).all()) {
    const box = await el.boundingBox();
    if (!box || box.height >= 44) continue;
    const name = (await el.getAttribute('aria-label')) ?? (await el.innerText()).trim();
    out.push(`${name || '(без имени)'}: ${Math.round(box.width)}×${Math.round(box.height)}`);
  }
  return out;
}
