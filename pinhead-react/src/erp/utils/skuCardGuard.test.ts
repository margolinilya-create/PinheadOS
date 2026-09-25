import { describe, expect, it } from 'vitest';
import {
  functionBody, latestDefining, snapshotExclusions, withoutComments,
} from './migrations.testutil';
import { columnTypesOf } from '../../types/schema.testutil';

/**
 * СТРАЖ КАРТОЧКИ МОДЕЛИ — СЕРВЕРНАЯ ПОЛОВИНА (сессия 68).
 *
 * Клиентскую половину («три действия — три права») сторожит
 * `screens/skuCard/SkuCardPage.test.jsx`. Здесь — то, что сервер обязан
 * запрещать и без кнопок: запрос в REST идёт мимо формы.
 *
 * До 24.09 страж перечислял охраняемые колонки, и пять колонок (`id`,
 * `experimental_id`, `source_item_id`, `created_by`, `created_at`) не охранял
 * никто: держатель `sku.edit` перепривязывал карточку к чужой разработке.
 * Теперь страж перечисляет ИСКЛЮЧЕНИЯ — снимок строки минус поля, которые
 * меняются по праву, — и сторож спрашивает три вещи:
 *   1. исключены ровно записанные здесь поля: расширить набор молча нельзя;
 *   2. у КАЖДОГО исключения есть своя проверка — поле, вычтенное из снимка
 *      без проверки, открыто всем, кого пускает UPDATE-политика;
 *   3. колонки, которые обязаны быть неизменными, в исключения не попали.
 */

const sql = withoutComments(latestDefining('erp_sku_card_guard'));
const guard = withoutComments(functionBody(sql, 'erp_sku_card_guard'));

/** Описание модели — то, что шлёт форма карточки; право `sku.edit` */
const EDIT = [
  'name', 'category', 'description', 'fit', 'pattern_tech_name',
  'pattern_version', 'final_package', 'price_min', 'price_max',
];

/** Поля, меняющиеся по праву: у каждого своя проверка в теле стража */
const BY_RIGHT = ['status', 'code', 'experimental_id', 'source_item_id', ...EDIT];

/** Проверка поля: от `if new.<f> is distinct from old.<f>` до её `end if` */
function clause(field: string): string {
  const at = guard.indexOf(`if new.${field} is distinct from old.${field}`);
  if (at < 0) throw new Error(`у поля ${field} нет своей проверки`);
  return guard.slice(at, guard.indexOf('end if;', at));
}

describe('страж карточки модели: снимок и исключения', () => {
  const excluded = snapshotExclusions(guard);

  it('страж сравнивает снимки строки, а не перечисляет охраняемые колонки', () => {
    expect(excluded).not.toBeNull();
  });

  it('исключены ровно поля, меняющиеся по праву, и updated_at', () => {
    expect(excluded).toEqual(new Set([...BY_RIGHT, 'updated_at']));
  });

  it('у каждого исключения своя проверка — вычтенное без проверки открыто всем', () => {
    const unchecked = BY_RIGHT.filter((f) => !guard.includes(`new.${f} is distinct from old.${f}`));
    expect(unchecked).toEqual([]);
  });

  it('updated_at ставит сам страж — значение клиента до записи не доживает', () => {
    expect(guard).toMatch(/new\.updated_at := now\(\);\s*return new;/);
  });

  it('исключения — настоящие колонки, а служебные держит снимок', () => {
    const cols = [...columnTypesOf('erp_sku_cards').keys()];
    const stale = [...(excluded ?? [])].filter((f) => !cols.includes(f));
    expect(stale, 'колонку переименовали — исключение устарело').toEqual([]);
    for (const col of ['id', 'created_at', 'created_by', 'card_version']) {
      expect(cols).toContain(col);
      expect(excluded?.has(col), `${col} обязана быть неизменной`).toBe(false);
    }
  });
});

describe('страж карточки модели: право на каждое поле', () => {
  it('описание модели — под sku.edit', () => {
    const at = guard.indexOf("if not public.erp_has_permission('sku.edit')");
    expect(at).toBeGreaterThanOrEqual(0);
    const block = guard.slice(at, guard.indexOf('end if;', at));
    for (const f of EDIT) expect(block).toContain(`new.${f} is distinct from old.${f}`);
  });

  it('статус: выпуск — sku.publish, архив — sku.archive, черновик — sku.edit', () => {
    const at = guard.indexOf('if new.status is distinct from old.status then');
    const block = guard.slice(at, guard.indexOf('end if;\n  end if;', at));
    expect(block).toMatch(/new\.status = 'active' and not public\.erp_has_permission\('sku\.publish'\)/);
    expect(block).toMatch(/new\.status = 'archived' and not public\.erp_has_permission\('sku\.archive'\)/);
    expect(block).toMatch(/new\.status = 'draft' and not public\.erp_has_permission\('sku\.edit'\)/);
  });

  it('код артикула — под sku.publish', () => {
    expect(clause('code')).toContain("not public.erp_has_permission('sku.publish')");
  });

  /**
   * Не «неизменна для всех»: `erp_sku_from_dev` меняет привязку у существующей
   * карточки через `on conflict (code) do update`, и это UPDATE.
   */
  it('привязка к разработке — под sku.publish, как у erp_sku_from_dev', () => {
    const c = clause('experimental_id');
    expect(c).toContain("not public.erp_has_permission('sku.publish')");
    expect(c).toContain('not v_dev_gone');
    const fromDev = withoutComments(latestDefining('erp_sku_from_dev'));
    expect(fromDev).toMatch(/if not public\.erp_has_permission\('sku\.publish'\) then/);
    expect(fromDev).toMatch(/on conflict \(code\) do update\s+set experimental_id = excluded\.experimental_id/);
  });

  it('позицию-источник не открывает никакое право', () => {
    const c = clause('source_item_id');
    expect(c).toContain('not v_item_gone');
    expect(c).not.toContain('erp_has_permission');
  });

  it('версию ведёт триггер истории — клиенту запрещено всем', () => {
    const c = clause('card_version');
    expect(c).not.toContain('erp_has_permission');
    expect(c).toContain("errcode = '42501'");
  });
});

describe('страж карточки модели: обнуление ссылки базой', () => {
  /**
   * `on delete set null` у обеих ссылок: удаление разработки или позиции
   * заказа приходит в страж UPDATE-ом с `auth.uid()` удаляющего. Проба 24.09:
   * без ветки удаление позиции-источника падало 42501 даже у админа.
   * Общее правило для всех стражей сторожит `guardSetNull.test.ts`.
   */
  it('ветка открывается, только когда родителя больше нет', () => {
    expect(guard).toMatch(/v_dev_gone := new\.experimental_id is null and old\.experimental_id is not null\s+and not exists \(select 1 from public\.erp_experimental e where e\.id = old\.experimental_id\);/);
    expect(guard).toMatch(/v_item_gone := new\.source_item_id is null and old\.source_item_id is not null\s+and not exists \(select 1 from public\.erp_order_items i where i\.id = old\.source_item_id\);/);
  });
});

describe('страж карточки модели: обвязка', () => {
  it('service_role проходит: пустой auth.uid() не запирает починку через SQL', () => {
    expect(guard).toMatch(/if \(select auth\.uid\(\)\) is null then\s*\n\s*return new;/);
  });

  it('функция-триггер клиенту не выставлена', () => {
    expect(sql).toMatch(/revoke execute on function public\.erp_sku_card_guard\(\) from public, anon, authenticated;/);
  });
});
