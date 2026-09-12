import { describe, it, expect } from 'vitest';
import { buildCommandEntries, nextIndex, ORDER_LIMIT } from './commandPalette';
import { NAV_GROUPS } from '../layout/navGroups';
import { canOpenScreen } from './screenAccess';

const DEPTS = [
  { id: 'd1', code: 'cutting', name: 'Закройный цех', is_production: true, active: true },
  { id: 'd2', code: 'sewing', name: 'Швейный цех', is_production: true, active: true },
  { id: 'd3', code: 'supply', name: 'Закупка', is_production: false, active: true },
  { id: 'd4', code: 'dtg', name: 'DTG', is_production: true, active: false },
];

const ORDERS = [
  { id: 'o1', bitrix_id: '60448', order_number: 'PH-0001', title: 'Футболки', customer: 'Ромашка' },
  { id: 'o2', bitrix_id: '60449', order_number: 'PH-0002', title: 'Худи', customer: 'Василёк' },
];

/** Полный доступ — чтобы проверять отбор, а не гейт. */
const ALL = { can: () => true, isAdmin: true };
/** Рабочий цеха: ни одного права разделов «Операции», не админ. */
const WORKER = { can: () => false, isAdmin: false };

const ctx = (access = ALL) => ({ access, departments: DEPTS, orders: ORDERS });
const labels = (entries: ReturnType<typeof buildCommandEntries>) => entries.map((e) => e.label);

describe('buildCommandEntries — разделы', () => {
  it('пустой запрос предлагает разделы и цеха, но НЕ заказы', () => {
    const out = buildCommandEntries('', ctx());
    expect(out.some((e) => e.group === 'Разделы')).toBe(true);
    expect(out.some((e) => e.group === 'Цеха')).toBe(true);
    /*
     * `matchesOrderQuery` с пустым запросом совпадает со ВСЕМ: без отдельной
     * проверки открытая палитра показывала бы шесть случайных заказов, то есть
     * отвечала бы на вопрос, которого не задавали.
     */
    expect(out.some((e) => e.group === 'Заказы')).toBe(false);
  });

  /**
   * ГЕЙТ ПО ПРАВУ — ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ. Палитра это ещё один вход
   * в раздел, и предложение, ведущее в отказ, — тот же дефект «декоративного
   * права», только наоборот. Сверка идёт с `canOpenScreen`, а не со списком
   * имён: перечисление разошлось бы с гейтом в первую же правку.
   */
  it('рабочему цеха не предлагает ни одного закрытого раздела', () => {
    const out = buildCommandEntries('', ctx(WORKER));
    const offered = out.filter((e) => e.group === 'Разделы').map((e) => e.to);
    for (const to of offered) {
      expect(canOpenScreen(WORKER.can, to), `${to} предложен без права`).toBe(true);
    }
  });

  it('раздел под `admin` не предлагается не-админу', () => {
    const adminItems = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.admin);
    expect(adminItems.length, 'в меню нет admin-пунктов — проверка вырождается')
      .toBeGreaterThan(0);

    const out = buildCommandEntries('', ctx({ can: () => true, isAdmin: false }));
    for (const item of adminItems) {
      expect(out.some((e) => e.to === item.to), `${item.to} предложен не-админу`).toBe(false);
    }
  });

  it('админу админка предлагается', () => {
    const out = buildCommandEntries('админ', ctx());
    expect(out.some((e) => e.to === '/admin')).toBe(true);
  });

  it('фильтрует разделы по подстроке, без учёта регистра', () => {
    expect(labels(buildCommandEntries('ЗАКАЗ', ctx()))).toContain('Заказы');
    expect(labels(buildCommandEntries('произв', ctx()))).toContain('Производство');
  });
});

describe('buildCommandEntries — цеха', () => {
  it('предлагает только производственные и только активные', () => {
    const depts = buildCommandEntries('', ctx()).filter((e) => e.group === 'Цеха');
    const tos = depts.map((e) => e.to);
    expect(tos).toContain('/queue/cutting');
    expect(tos).toContain('/queue/sewing');
    // Закупка непроизводственная — у неё свой экран, очереди участка нет
    expect(tos).not.toContain('/queue/supply');
    // Деактивированный участок (DTG снят 07.09) не предлагается
    expect(tos).not.toContain('/queue/dtg');
  });

  it('ищет и по короткому имени, и по полному', () => {
    expect(buildCommandEntries('швей', ctx()).some((e) => e.to === '/queue/sewing')).toBe(true);
  });
});

describe('buildCommandEntries — заказы', () => {
  it('находит по номеру сделки', () => {
    const out = buildCommandEntries('60448', ctx());
    const orders = out.filter((e) => e.group === 'Заказы');
    expect(orders).toHaveLength(1);
    expect(orders[0].to).toBe('/orders/o1');
  });

  it('находит по заказчику и по названию — тем же матчером, что список', () => {
    expect(buildCommandEntries('ромашка', ctx()).some((e) => e.to === '/orders/o1')).toBe(true);
    expect(buildCommandEntries('худи', ctx()).some((e) => e.to === '/orders/o2')).toBe(true);
  });

  it('не показывает больше ORDER_LIMIT заказов', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`, bitrix_id: `7${i}`, order_number: `PH-9${i}`, title: 'Футболки', customer: 'Ромашка',
    }));
    const out = buildCommandEntries('футболки', { access: ALL, departments: DEPTS, orders: many });
    expect(out.filter((e) => e.group === 'Заказы')).toHaveLength(ORDER_LIMIT);
  });

  it('ключи записей уникальны — они же id опций для activedescendant', () => {
    const out = buildCommandEntries('а', ctx());
    expect(new Set(out.map((e) => e.key)).size).toBe(out.length);
  });
});

describe('nextIndex — стрелки заворачиваются', () => {
  it('вниз с последнего ведёт на первый', () => {
    expect(nextIndex(2, 3, 1)).toBe(0);
  });

  it('вверх с первого ведёт на последний', () => {
    // Без заворота «вверх» на первом не делает ничего, и палитра выглядит
    // зависшей — у списка два конца, и оба легко сделать тупиком
    expect(nextIndex(0, 3, -1)).toBe(2);
  });

  it('на пустом списке остаётся нулём', () => {
    expect(nextIndex(0, 0, 1)).toBe(0);
    expect(nextIndex(0, 0, -1)).toBe(0);
  });
});
