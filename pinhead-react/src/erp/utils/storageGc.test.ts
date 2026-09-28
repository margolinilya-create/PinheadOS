// @vitest-environment node
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
 *
 * УБОРЩИКОВ ДВА, И СТОРОЖИТСЯ КАЖДЫЙ (сессия 68). Edge-функция и npm-скрипт
 * `storage:gc` — равноправные дороги уборки (`CLAUDE.md`), а сторож читал
 * только функцию. Сессия 67 дописала третий носитель в неё одну, и скрипт
 * остался с двумя: его `--apply` удалил бы техпакет модели. Тот же урок
 * этажом выше — копия списка, которую никто не сверяет, отстаёт молча.
 */

const GC_SOURCES = {
  'edge-функция storage-gc': readFileSync(
    join(process.cwd(), '../supabase/functions/storage-gc/index.ts'), 'utf8'),
  'npm-скрипт storage:gc': readFileSync(
    join(process.cwd(), 'scripts/storage-gc.mjs'), 'utf8'),
};

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

  it.each(Object.entries(GC_SOURCES))(
    'каждая таблица с file_path перечислена в REFERENCES: %s',
    (_name, src) => {
      const refs = new Set(
        [...src.matchAll(/\{\s*table:\s*'(\w+)',\s*column:\s*'file_path'\s*\}/g)]
          .map((m) => m[1]),
      );
      // Пустой разбор — сломанная регулярка, а не «носителей нет»
      expect(refs.size).toBeGreaterThanOrEqual(3);
      for (const t of tables) {
        expect(refs.has(t), `${t} держит file_path, но уборщик его не читает`).toBe(true);
      }
    },
  );
});

/**
 * ЧЕТВЁРТЫЙ НОСИТЕЛЬ — JSON ЧЕРНОВИКА (правка 28.09). С 20.09
 * `erp_order_drafts.payload` хранит пути уже загруженных файлов блоков и ТЗ,
 * а колонки `file_path` у черновика нет — вывод из миграций выше его
 * не видит, и уборщики стирали файлы черновика старше суток. Поэтому набор
 * массивов выводится из ФОРМЫ СНИМКА (`OrderDraftEnvelope`): всякое поле
 * вида `Draft…[]`, чей тип несёт `path: string`, обязано стоять в
 * `JSON_REFERENCES` каждого уборщика.
 */
function draftPathArrays(): Set<string> {
  const src = readFileSync(join(process.cwd(), 'src/erp/utils/orderDraftEnvelope.ts'), 'utf8');
  const envelope = src.match(/interface OrderDraftEnvelope\s*\{([\s\S]*?)\n\}/);
  if (!envelope) return new Set();
  const withPath = new Set(
    [...src.matchAll(/interface (Draft\w+)\s*\{([\s\S]*?)\n\}/g)]
      .filter((m) => /\n\s*path:\s*string;/.test(m[2]))
      .map((m) => m[1]),
  );
  return new Set(
    [...envelope[1].matchAll(/\n\s*(\w+)\??:\s*(Draft\w+)\[\];/g)]
      .filter((m) => withPath.has(m[2]))
      .map((m) => m[1]),
  );
}

describe('storage-gc: черновик заказа — носитель ключа', () => {
  const arrays = draftPathArrays();

  it('форма снимка несёт пути в attachments и tzDocs (иначе парсер сломан)', () => {
    expect(arrays.has('attachments')).toBe(true);
    expect(arrays.has('tzDocs')).toBe(true);
  });

  it.each(Object.entries(GC_SOURCES))(
    'erp_order_drafts.payload стоит в JSON_REFERENCES: %s',
    (_name, src) => {
      const decl = src.match(/const JSON_REFERENCES = \[([\s\S]*?)\n\]/);
      expect(decl, 'нет списка JSON_REFERENCES').not.toBeNull();
      const entry = decl![1].match(
        /\{\s*table:\s*'erp_order_drafts',\s*column:\s*'payload',\s*arrays:\s*\[([^\]]*)\]\s*\}/,
      );
      expect(entry, 'уборщик не читает erp_order_drafts.payload').not.toBeNull();
      const listed = new Set([...entry![1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
      for (const a of arrays) {
        expect(listed.has(a), `payload.${a}[].path не читается уборщиком`).toBe(true);
      }
      // Список должен реально обходиться, а не просто стоять объявленным
      expect(src).toMatch(/of JSON_REFERENCES\)/);
    },
  );
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
