import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { latestMatching } from './migrations.testutil';
import { BRANDING_METHOD_LABELS } from '../types';
import { DEPARTMENTS } from '../data/departments';
import { buildRoute } from './routes';
import type { BrandingMethod } from '../types';

/**
 * Метод нанесения живёт в ШЕСТИ местах, и пропуск любого не роняет ничего —
 * он даёт молча неработающую половину. Ровно так в проекте уже терялись
 * единицы измерения в справочниках и терминальный статус складской задачи.
 *
 * ЧТО ЭТО ЗА ЖАНР ДЕФЕКТА. Метод, у которого нет цеха в `BRANDING_DEPT`,
 * приравнивается к «прочему»: `buildRoute` не добавляет этап вовсе. Позиция
 * с таким нанесением проходит маршрут БЕЗ печати — ошибки нет, задания нет,
 * и узнают об этом на сдаче. Именно это и случилось бы с DTG, который в визарде
 * ТЗ был с самого начала, а в производственной модели отсутствовал.
 *
 * Места:
 *   1. CHECK `erp_item_prints.method` — иначе вставка падает на 23514;
 *   2. `BrandingMethod` + подпись — иначе метод не выбрать и не показать;
 *   3. `BRANDING_DEPT` — иначе этап не появится в маршруте;
 *   4. строка участка в справочнике цехов клиента (сид);
 *   5–6. участок и цеховая роль на сервере — проверяются миграцией ниже.
 */

const SRC = join(process.cwd(), 'src');

/** Методы из ДЕЙСТВУЮЩЕГО CHECK — последняя миграция, которая его пересоздаёт */
function methodsInCheck(): string[] {
  const sql = latestMatching(
    /check \(method in \(/,
    'CHECK методов нанесения',
  );
  const block = sql.match(/check \(method in \(([\s\S]*?)\)\)/)?.[1] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

/** Ключи карты «метод → цех» из исходника: значение может быть null, ключ обязан быть */
function methodsInRouteMap(): string[] {
  const src = readFileSync(join(SRC, 'erp/utils/routes.ts'), 'utf8');
  const block = src.match(/const BRANDING_DEPT: Record<BrandingMethod, string \| null> = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  return [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]).sort();
}

const IN_CHECK = methodsInCheck();
const IN_TYPES = (Object.keys(BRANDING_METHOD_LABELS) as BrandingMethod[]).sort();
const IN_ROUTE = methodsInRouteMap();

describe('метод нанесения сходится во всех местах', () => {
  it('обе стороны найдены — сторож не сторожит пустоту', () => {
    expect(IN_CHECK.length).toBeGreaterThanOrEqual(5);
    expect(IN_ROUTE.length).toBeGreaterThanOrEqual(5);
  });

  it('CHECK базы и тип клиента перечисляют одно и то же', () => {
    expect(IN_TYPES).toEqual(IN_CHECK);
  });

  it('у каждого метода есть решение по цеху', () => {
    // Отсутствие ключа читается как «цеха нет» молча — то же, что осознанный
    // null у «прочих», но без решения человека
    expect(IN_ROUTE).toEqual(IN_TYPES);
  });

  it('у каждого метода есть подпись', () => {
    for (const m of IN_TYPES) {
      expect(BRANDING_METHOD_LABELS[m], `нет подписи у ${m}`).toBeTruthy();
    }
  });
});

describe('цех метода существует и попадает в маршрут', () => {
  const deptCodes = new Set(DEPARTMENTS.map((d) => d.code));

  it.each(IN_TYPES)('%s: этап появляется в маршруте либо цеха нет осознанно', (method) => {
    const route = buildRoute({
      productionType: 'sewing',
      brandingMethods: [method],
      brandingOn: 'finished',
    });
    const src = readFileSync(join(SRC, 'erp/utils/routes.ts'), 'utf8');
    const mapped = src.match(new RegExp(`^\\s{2}${method}: '([a-z_]+)'`, 'm'))?.[1] ?? null;

    if (mapped === null) return; // «прочие» — работа внутри швейки, этапа нет
    expect(deptCodes, `цеха ${mapped} нет в справочнике`).toContain(mapped);
    expect(route.some((s) => s.departmentCode === mapped)).toBe(true);
  });
});

describe('DTG заведён целиком', () => {
  it('метод известен базе и клиенту', () => {
    expect(IN_CHECK).toContain('dtg');
    expect(IN_TYPES).toContain('dtg');
  });

  it('у DTG свой участок, а не «прочее»', () => {
    // В «прочие» его сводить нельзя: цеха у них нет, и позиция прошла бы
    // маршрут вообще без этапа печати
    expect(DEPARTMENTS.some((d) => d.code === 'dtg')).toBe(true);
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['dtg'], brandingOn: 'finished',
    });
    expect(route.some((s) => s.departmentCode === 'dtg')).toBe(true);
  });

  it('участок и цеховая роль заведены на сервере', () => {
    const sql = latestMatching(/'dtg', 'Цех DTG'/, 'участок DTG');
    expect(sql).toContain('is_production');
    expect(sql).toMatch(/erp_employees_role_check[\s\S]*'dtg'/);
  });
});
