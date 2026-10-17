import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FX_CREATED } from './mockSupabase';

/**
 * Фикстуры «Справочников заказа» (веха 4) для e2e: маленькие, но той же
 * формы, что `catalog_config.suppliers` и `app_config.prices` после
 * миграции G. Свои, а не сиды кода: сид — сотня цветов, а спеке нужны
 * три предсказуемых случая — цвет в продаже, снятый цвет и чужая палитра.
 *
 * Мок держит справочники С СОСТОЯНИЕМ на объект `MockExtras`
 * (`catalogs`), поэтому фикстура отдаётся копией (`orderCatalogs()`):
 * общий объект между спеками протёк бы записью одной в другую.
 */

export const SUPPLIERS_FX = [
  {
    id: 'cottonprom',
    name: 'Коттонпром',
    isDefault: true,
    fabricSupplierNames: [],
    active: true,
    palette: {
      groups: [{ id: 'base', label: 'Базовые' }],
      colors: [
        { code: '40-01', name: 'Чёрный', hex: '#1A1A1A', group: 'base', active: true },
        { code: '01-01', name: 'Белый', hex: '#FFFFFF', group: 'base', active: true },
        { code: '77-07', name: 'Бордо', hex: '#6D1A2A', group: 'base', active: false },
      ],
    },
  },
  {
    id: 'medastex',
    name: 'Медастекс',
    isDefault: false,
    fabricSupplierNames: ['Медас'],
    active: true,
    palette: {
      groups: [],
      colors: [{ code: '5001', name: 'Белый', hex: '#FAFAFA', group: '', active: true }],
    },
  },
];

/** Справочники для `installSupabaseMock({ catalogs })` — свежая копия на каждый вызов */
export function orderCatalogs() {
  return structuredClone({
    catalog_config: { suppliers: SUPPLIERS_FX },
    app_config: { prices: { prepFees: {}, minMarginPct: null } },
  });
}

/** Строка заказа v4 (`schema_version = 4`) в черновике — ответ мока на карточку */
export function draftOrder(id: string, items: unknown[]) {
  return {
    id,
    schema_version: 4,
    order_number: 'PH-9100',
    title: 'Худи для команды',
    customer: 'ООО Тест',
    status: 'draft',
    kind: 'run',
    price_total: null,
    due_date: null,
    updated_at: FX_CREATED,
    created_by: null,
    order_items: items,
    order_notes_cards: [],
  };
}

/** Позиция-худи одного цвета: панели визарда грузят её в буфер */
export function hoodieItem(id: string, color: string, prints: unknown[] = []) {
  return {
    id,
    kind: 'sku',
    sku_code: 'H-002',
    product_type: 'Худи',
    size_grid: { sizes: ['M', 'L'], rows: [{ color, sizes: { M: 10, L: 5 } }] },
    extras: [],
    sort_order: 0,
    order_item_prints: prints,
    order_item_labels: [],
  };
}

/** Профили «Сотрудников продаж»: продавец и человек цеха без признаков */
export function staffFx() {
  return [
    {
      id: 'p-maria', name: 'Мария Кузнецова', email: 'maria@pinhead.ru', role: 'manager',
      active: true, approved: true, is_sales: true, is_ms: false,
    },
    {
      id: 'p-oleg', name: 'Олег Петров', email: 'oleg@pinhead.ru', role: 'production',
      active: true, approved: true, is_sales: false, is_ms: false,
    },
  ];
}

/**
 * Профиль вошедшего — поверх dev-автологина (admin). Стор тот же, что у
 * приложения: модуль Vite один на адрес. Меняется ДО перехода по меню —
 * `page.goto` перезагрузил бы страницу и вернул админа.
 */
export async function setProfile(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (p) => {
    const { useAuthStore } = await import('/src/store/useAuthStore.ts');
    const user = useAuthStore.getState().user;
    useAuthStore.setState({ user: { ...user, ...p } });
  }, patch);
}

/** Нарушения axe уровня serious/critical внутри `main` — отчётом, пустой = чисто */
export async function axeSerious(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => {
      const nodes = v.nodes.slice(0, 3).map((n) => {
        const why = (n.failureSummary ?? '').replace(/\s+/g, ' ').trim();
        return `      ${n.target.join(' ')}\n        ${why}`;
      }).join('\n');
      return `${v.id} (${v.impact}): ${v.help}\n${nodes}`;
    });
}
