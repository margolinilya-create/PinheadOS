import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrations.testutil';

/**
 * Кнопка «Удалить заказ» показана ровно тем, кому база разрешает удалять.
 *
 * ЧТО СЛУЧИЛОСЬ 12.08. Политика `erp_orders_delete` стоит на `is_admin()`
 * (`profiles.role = 'admin'`), а кнопку гейтил `access.isPrivileged` —
 * `FULL_ACCESS_PROFILE_ROLES`, то есть admin + director + РОП. Рядом стоял
 * комментарий «ровно как на сервере», написанный при ПРЕДЫДУЩЕМ сужении
 * гейта и никем не сверенный.
 *
 * Отказ при этом был хуже, чем 42501. **RLS запрещает DELETE через `USING`,
 * то есть «удалено 0 строк», а не исключение**: слайс проверял только `error`,
 * поэтому директор получал зелёное «Заказ удалён», заказ исчезал из списка —
 * и возвращался при следующей загрузке. Проверено на живой базе с откатом:
 * директор, удалено строк 0, заказ остался.
 *
 * Поэтому здесь три утверждения, а не одно: правило базы, гейт интерфейса
 * и способ, которым клиент отличает отказ от успеха. Любое в одиночку
 * не удержит инвариант — расхождение и жило между ними.
 */

const FILES = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort();
const sql = (name: string) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('удаление заказа: гейт интерфейса = политика базы', () => {
  it('политика DELETE заводится с предикатом is_admin() и покрывает erp_orders', () => {
    // Политики создаются циклом `format(... %I ... t || '_delete' ...)`,
    // поэтому имени `erp_orders_delete` в миграциях нет — искать надо цикл
    const creating = FILES.filter((f) => /_delete', t\)/.test(sql(f)));
    expect(creating, 'не найдена миграция, заводящая политики удаления').not.toEqual([]);

    const text = sql(creating[creating.length - 1]);
    expect(text).toMatch(/for delete to authenticated using \(public\.is_admin\(\)\)/);
    expect(text).toMatch(/'erp_orders'/);
  });

  it('ни одна поздняя миграция не ослабляет удаление заказа', () => {
    // Сторож, читающий ПЕРВОЕ определение, сторожит файл, а не базу:
    // политику могли переписать позже (так уже случалось с `erp_att_update`)
    const weakened = FILES.filter((f) => {
      const text = sql(f);
      return /alter policy\s+erp_orders_delete/i.test(text)
        || /create policy\s+erp_orders_delete/i.test(text);
    });
    expect(weakened, `политику меняли в: ${weakened.join(', ')}`).toEqual([]);
  });

  it('экран гейтит удаление по isAdmin, а не по isPrivileged', () => {
    const screen = src('erp/screens/OrdersScreen.jsx');
    expect(screen).toMatch(/const canDelete = access\.isAdmin;/);
    // Именно это и было расхождением — оно не должно вернуться
    expect(screen).not.toMatch(/const canDelete = access\.isPrivileged;/);
  });

  it('isAdmin — зеркало серверной is_admin(), а не синоним isPrivileged', () => {
    const access = src('erp/store/useErpAccess.ts');
    expect(access).toMatch(/isAdmin: isDev \|\| user\?\.role === 'admin'/);
    // FULL_ACCESS_PROFILE_ROLES шире на директора и РОПа — подмена вернула бы дефект
    expect(access).not.toMatch(/isAdmin:.*FULL_ACCESS_PROFILE_ROLES/);
  });

  it('клиент отличает «0 строк» от успеха — иначе отказ выглядит зелёным', () => {
    const slice = src('erp/store/slices/ordersSlice.ts');
    // `.select(...)` после delete — единственный способ узнать, что удалилось
    expect(slice).toMatch(/\.from\('erp_orders'\)\.delete\(\)\.eq\('id', id\)\.select\(/);
    expect(slice).toMatch(/data\.length === 0/);
  });

  it('файлы заказа убираются из бакета — сироты копились именно так', () => {
    const slice = src('erp/store/slices/ordersSlice.ts');
    // Пути собираются ДО удаления: обе таблицы уедут каскадом
    expect(slice).toMatch(/erp_tz_documents/);
    expect(slice).toMatch(/erp_order_attachments/);
    expect(slice).toMatch(/storage\.from\('erp-attachments'\)\.remove\(paths\)/);
  });
});
