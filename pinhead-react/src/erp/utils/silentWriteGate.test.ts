/**
 * ОТКАЗ RLS ОБЯЗАН БЫТЬ ВИДЕН — сторож на «0 строк = успех».
 *
 * ЧТО ЗА ДЕФЕКТ. RLS на UPDATE и DELETE запрещает через `USING`, то есть
 * возвращает пустой результат, а НЕ ошибку; исключение бросает только
 * `WITH CHECK`. Клиент, проверяющий один `error`, показывает зелёное
 * «сохранено» там, где в базе не изменилось ничего: оптимистичная правка
 * остаётся на экране до следующего чтения, тоста нет, причины никто не узнаёт.
 *
 * На проде это ловилось трижды — на удалении заказа, на привязке
 * предварительной закупки и (ревью 25.08) на всей вкладке «Пользователи»:
 * `profiles_update` стоит на `is_admin()`, а раздел `/admin` пускает и
 * директора, поэтому «Подтвердить» новому сотруднику отвечало успехом,
 * ничего не изменив.
 *
 * ЧТО СТОРОЖИТ ТЕСТ. Он берёт из миграций таблицы, у которых `USING` политики
 * UPDATE — это ПРАВО или РОЛЬ (`erp_has_permission(…)`, `is_admin()`,
 * `erp_is_manager()`), а не просто «участник» (`erp_is_member()`), и требует,
 * чтобы каждая запись в такую таблицу из слайсов шла через `erpWrite` —
 * единственное место, где пустой ответ читается как отказ.
 *
 * Список таблиц НЕ перечислен здесь руками: перечисление по именам не переживает
 * следующего имени. Он считается из самих миграций, поэтому таблица, у которой
 * гейт появится завтра, попадёт под сторожа сама.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migration, withoutComments, withoutJsComments } from './migrations.testutil';

const SLICES_DIR = join(process.cwd(), 'src/erp/store/slices');

/**
 * Записи, которые читают пустой ответ САМИ и потому в `erpWrite` не нуждаются.
 *
 * Список именно с причинами, а не «эти пропускаем»: каждая строка — решение,
 * и без объяснения следующий человек либо снимет нужное, либо допишет сюда
 * очередное исключение вместо починки.
 */
const READS_EMPTY_ITSELF: Record<string, string> = {
  'materialsSlice.ts': 'attachPreliminaryToOrder проверяет (data ?? []).length === 0 явно: '
    + 'пустой ответ там означает ещё и «строку уже привязали в соседней вкладке»',
  'orderDraftsSlice.ts': 'saveOrderDraft возвращает null при пустом ответе и не трогает стор',
  'invitesSlice.ts': 'revokeInvite проверяет !data?.length рядом с error',
};

/** Последняя политика UPDATE каждой таблицы — та, что реально работает в базе */
function latestUpdatePolicies(): Map<string, string> {
  const out = new Map<string, string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = withoutComments(migration(file));
    const re = /create\s+policy\s+"?[\w ]+"?\s+on\s+(?:public\.)?(\w+)([\s\S]*?);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const [, table, body] = m;
      if (!/for\s+update/i.test(body)) continue;
      out.set(table, body);
    }
  }
  return out;
}

/** Гейт по праву или роли — отказ придёт нулём строк, а не исключением */
function gatedByPermission(policyBody: string): boolean {
  const using = policyBody.split(/with\s+check/i)[0];
  return /erp_has_permission\s*\(|is_admin\s*\(|erp_is_manager\s*\(/i.test(using)
    // `auth.uid()` в USING — это тоже «чужую строку не отдадим молча»
    || /auth\.uid\s*\(\)/i.test(using);
}

/**
 * Обращения `.from('<таблица>')`, у которых в том же выражении есть `.update(`.
 *
 * Границей выражения считается следующая строка, начинающаяся с `const`, `set(`,
 * `return` или закрывающая функцию: PostgREST-цепочка всегда умещается в один
 * оператор, а разбирать TypeScript ради сторожа — заводить второй парсер.
 */
function updateStatements(source: string): { table: string; text: string }[] {
  const clean = withoutJsComments(source);
  const out: { table: string; text: string }[] = [];
  const re = /\.from\(\s*'(\w+)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const text = clean.slice(Math.max(0, m.index - 400), m.index + 400);
    if (!/\.update\(/.test(clean.slice(m.index, m.index + 400))) continue;
    out.push({ table: m[1], text });
  }
  return out;
}

describe('запись в таблицу с permission-гейтом идёт через erpWrite', () => {
  const policies = latestUpdatePolicies();
  const gated = new Set(
    [...policies.entries()].filter(([, body]) => gatedByPermission(body)).map(([t]) => t),
  );

  it('такие таблицы в схеме вообще есть — иначе сторож зелен впустую', () => {
    // Подтверждаем, что разбор миграций работает: пустое множество означало бы
    // не «дефектов нет», а «тест ничего не нашёл и потому доволен»
    expect(gated.size).toBeGreaterThan(5);
    expect(gated).toContain('profiles');
    expect(gated).toContain('erp_employees');
    expect(gated).toContain('erp_calendar_slots');
  });

  it('таблица под `erp_is_member()` гейтом не считается — там отказ бросает страж', () => {
    // `erp_item_stages` и `erp_orders` пускают любого участника, а разбор по
    // колонкам делают триггеры-стражи: они RAISE, то есть отказ и так виден
    expect(gated.has('erp_item_stages')).toBe(false);
    expect(gated.has('erp_orders')).toBe(false);
  });

  const files = readdirSync(SLICES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it.each(files)('%s: ни одной записи мимо erpWrite', (file) => {
    const source = readFileSync(join(SLICES_DIR, file), 'utf8');
    const offenders = updateStatements(source)
      .filter(({ table }) => gated.has(table))
      .filter(({ text }) => !/erpWrite\(/.test(text))
      .map(({ table }) => table);

    if (offenders.length > 0 && READS_EMPTY_ITSELF[file]) return;
    expect(offenders, `${file}: запись в ${offenders.join(', ')} читает только error, `
      + 'а RLS отказывает нулём строк').toEqual([]);
  });

  it('исключения перечислены с причиной, а не просто перечислены', () => {
    for (const [file, why] of Object.entries(READS_EMPTY_ITSELF)) {
      expect(readdirSync(SLICES_DIR)).toContain(file);
      expect(why.length).toBeGreaterThan(40);
    }
  });
});
