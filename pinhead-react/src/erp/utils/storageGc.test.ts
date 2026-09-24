import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, withoutComments } from './migrations.testutil';
import { DEFAULT_PERMISSIONS } from './permissions';

/**
 * Сторож носителей ключа в бакете `erp-attachments`.
 *
 * ЗАЧЕМ. Уборка `storage-gc` удаляет объект, чей ключ не встречается ни в одной
 * строке-носителе, и список носителей у неё РУКОПИСНЫЙ. Список отстаёт от схемы
 * молча: 15.09 появилась `erp_sku_card_files.file_path` — снимок ключа
 * вложения разработки, — а в уборщик она не попала, и девять дней техпакет
 * модели считался ничьим. Тот же класс дыры, что у стража с поимённым
 * перечнем колонок: зелёный, пока не стёрт живой файл.
 *
 * Поэтому сторож ВЫВОДИТ список из миграций, а не проверяет известные имена:
 * всякая таблица с колонкой `file_path` обязана стоять в `REFERENCES` уборщика
 * и учитываться клиентом при удалении объекта.
 */

const GC_SRC = readFileSync(
  join(process.cwd(), '../supabase/functions/storage-gc/index.ts'),
  'utf8',
);

/** Таблицы, у которых миграции объявляют колонку `file_path` (в create или add column) */
function tablesWithFilePath(): Set<string> {
  const tables = new Set<string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = withoutComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    // create table [if not exists] public.<t> ( … file_path text … )
    const create = /create table(?: if not exists)? public\.(\w+)\s*\(([\s\S]*?)\);/gi;
    for (const m of sql.matchAll(create)) {
      if (/\bfile_path\s+text\b/i.test(m[2])) tables.add(m[1]);
    }
    // alter table public.<t> add column [if not exists] file_path text
    const alter = /alter table(?: if exists)? public\.(\w+)[\s\S]*?add column(?: if not exists)? file_path\s+text/gi;
    for (const m of sql.matchAll(alter)) tables.add(m[1]);
  }
  return tables;
}

describe('storage-gc: носители ключа выводятся из схемы', () => {
  const tables = tablesWithFilePath();

  it('миграции объявляют хотя бы три носителя (иначе парсер сломан)', () => {
    // Известные на 24.09: вложения заказа, ТЗ в PDF, файлы карточки модели.
    // Меньше трёх — значит регулярка перестала видеть create table
    expect(tables.size).toBeGreaterThanOrEqual(3);
    expect(tables.has('erp_sku_card_files')).toBe(true);
  });

  it('каждая таблица с file_path перечислена в REFERENCES уборщика', () => {
    const refs = new Set(
      [...GC_SRC.matchAll(/\{\s*table:\s*'(\w+)',\s*column:\s*'file_path'\s*\}/g)]
        .map((m) => m[1]),
    );
    for (const t of tables) {
      expect(refs.has(t), `${t} держит file_path, но уборщик его не читает`).toBe(true);
    }
  });
});

describe('удаление объекта на клиенте спрашивает карточки модели', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), 'src/erp/store', rel), 'utf8');

  /**
   * Три места, где клиент убирает объект бакета по пути: удаление заказа,
   * файла разработки и вложения заказа. Каждое обязано пройти через
   * `freeOfSkuCards` — иначе строка карточки переживёт вложение, а объект нет.
   */
  it('deleteOrder, deleteDevFile и deleteOrderAttachment идут через freeOfSkuCards', () => {
    const orderWrite = read('slices/orderWriteSlice.ts');
    const experimental = read('slices/experimentalSlice.ts');

    const deleteOrder = orderWrite.slice(orderWrite.indexOf('deleteOrder: async'));
    expect(deleteOrder.slice(0, deleteOrder.indexOf('return true;')))
      .toMatch(/freeOfSkuCards\(paths\)/);

    const deleteAtt = orderWrite.slice(orderWrite.indexOf('deleteOrderAttachment: async'));
    expect(deleteAtt.slice(0, deleteAtt.indexOf('return true;')))
      .toMatch(/freeOfSkuCards\(\[att\.file_path\]\)/);

    const deleteDev = experimental.slice(experimental.indexOf('deleteDevFile: async'));
    expect(deleteDev.slice(0, deleteDev.indexOf('return true;')))
      .toMatch(/freeOfSkuCards\(\[att\.file_path\]\)/);
  });

  /**
   * Проверка держится на чтении `erp_sku_card_files` под RLS (`sku.view`).
   * Роль, которая может снять файл, но не видит карточек, получила бы пустой
   * ответ — и удалила бы объект, считая его ничьим. Матрица правится
   * в админке, поэтому здесь сторожатся ДЕФОЛТЫ: они же зеркало seed.
   */
  it('всякая роль с правом снимать файлы видит карточки модели', () => {
    for (const [role, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
      const deletes = perms.includes('files.manage') || perms.includes('experimental.manage');
      if (!deletes) continue;
      expect(perms.includes('sku.view'), `${role}: снимает файлы, но не видит карточек`).toBe(true);
    }
  });
});
