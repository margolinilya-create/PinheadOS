// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestMatching, withoutComments, withoutJsComments } from './migrations.testutil';
import { TZ_MAX_BYTES } from '../types';
import { ATTACH_MAX_BYTES } from '../hooks/useAttachmentUploads';

/**
 * ЛИМИТ РАЗМЕРА ВЛОЖЕНИЯ ОБЪЯВЛЕН В ЧЕТЫРЁХ МЕСТАХ, И ОНИ МОГУТ РАЗОЙТИСЬ
 * МОЛЧА.
 *
 * Величина одна («какой файл принимает ERP»), а мест четыре: `file_size_limit`
 * двух бакетов и две клиентские константы. Ни одно расхождение не роняет
 * ни сборку, ни тест — оно проявляется у человека:
 *
 *   · клиент МЯГЧЕ бакета — форма приняла файл, а Storage отказал ПОСЛЕ того,
 *     как человек дождался загрузки восемнадцати мегабайт с цехового планшета.
 *     Худший случай: отказ приходит тогда, когда работа уже сделана;
 *   · клиент СТРОЖЕ бакета — часть оплаченной ёмкости недостижима, а два
 *     соседних экрана называют РАЗНЫЕ числа («файл больше 15 МБ» у вложения
 *     заказа и «больше 20 МБ» у ТЗ), и человек не понимает, какое правило
 *     действует;
 *   · две клиентские константы разошлись между собой — то же самое, только
 *     без участия сервера.
 *
 * ЭТО НЕ ГИПОТЕТИКА: расхождение уже было записано в правилах проекта
 * с ошибкой — «величина живёт в трёх местах». Живая база 15.09 показала
 * ЧЕТЫРЕ: бакетов два, и оба стояли на 15 МБ. Сторож пишется по схеме,
 * а не по памяти.
 *
 * ИСТОЧНИК ПРАВДЫ — МИГРАЦИЯ, А НЕ ЖИВАЯ БАЗА. Живую базу из CI не прочитать
 * (ровно поэтому `migrations:verify` в гейт не ставится), поэтому серверная
 * половина берётся из последней миграции, задающей лимит, — тем же приёмом
 * `latestMatching`, что и прочие сторожа SQL. Сверка снимка с продом остаётся
 * ручным ритуалом.
 */

const SRC = join(process.cwd(), 'src');
const SQL = withoutComments(latestMatching(
  /update storage\.buckets[\s\S]{0,200}?erp-attachments/,
  'лимит бакета erp-attachments',
));

/** Значение `file_size_limit`, которое миграция ставит бакету ERP */
function bucketLimit(): number {
  const m = SQL.match(/set file_size_limit = (\d+)/);
  expect(m, 'в миграции не найден file_size_limit — разбор сломан').toBeTruthy();
  return Number(m![1]);
}

describe('лимит размера вложения не расходится между местами объявления', () => {
  it('разбор миграции находит число (иначе сторож зелен на чём угодно)', () => {
    expect(bucketLimit()).toBeGreaterThan(1024 * 1024);
  });

  it('клиентский лимит вложений равен лимиту бакета', () => {
    expect(
      ATTACH_MAX_BYTES,
      'ATTACH_MAX_BYTES разошёлся с file_size_limit бакета erp-attachments',
    ).toBe(bucketLimit());
  });

  it('клиентский лимит ТЗ равен лимиту бакета', () => {
    // ТЗ и вложения лежат в ОДНОМ бакете, значит и предел у них один:
    // две величины здесь означали бы, что один и тот же файл принимается
    // одной формой и отвергается соседней
    expect(
      TZ_MAX_BYTES,
      'TZ_MAX_BYTES разошёлся с file_size_limit бакета erp-attachments',
    ).toBe(bucketLimit());
  });

  /**
   * ЧЕЛОВЕК ЧИТАЕТ ЧИСЛО В МЕГАБАЙТАХ, и оно считается из той же константы,
   * а не пишется в текст руками. Строка «Файл больше 15 МБ» рядом с лимитом
   * 20 МБ — это подпись, пережившая свою величину; проверяется тем, что
   * в сообщениях нет литерального числа мегабайт вовсе.
   */
  it('сообщения об отказе считают мегабайты из константы, а не из текста', () => {
    const sources = [
      'erp/hooks/useAttachmentUploads.js',
      'erp/store/slices/tzSlice.ts',
      // ТЗ формы заказа — свой хук с 27.09 (правка 12)
      'erp/screens/orders/create/useTzDocs.js',
    ];
    for (const rel of sources) {
      /**
       * КОММЕНТАРИИ СНИМАЮТСЯ ДО ПОИСКА — записанное правило проекта, и первая
       * редакция этого сторожа на нём же и упала: объяснение «клиент СТРОЖЕ
       * бакета — два разных числа в соседних сообщениях („файл больше 15 МБ“…)»
       * содержит и слово «больше», и обратные апострофы вокруг имён констант,
       * то есть выглядит как сообщение человеку. Сторож, падающий на СВОЁМ
       * объяснении, учит удалять объяснения.
       */
      const text = withoutJsComments(readFileSync(join(SRC, rel), 'utf8'));
      const messages = [...text.matchAll(/`[^`]*больше[^`]*`/g)].map((m) => m[0]);
      expect(messages.length, `${rel}: сообщение про размер не найдено`).toBeGreaterThan(0);
      for (const msg of messages) {
        expect(
          msg,
          `${rel}: в сообщении «${msg}» число МБ вписано руками — оно переживёт смену лимита`,
        ).toMatch(/MAX_BYTES/);
      }
    }
  });

  /**
   * ПИСАТЕЛИ ORDER КЛАДУТ В ТОТ ЖЕ БАКЕТ (правка 19.10, решение Р9).
   *
   * Order копирует ТЗ и макеты в `erp-attachments` при запуске и заранее
   * предупреждает менеджера: «Файл больше N МБ — производство его не примет».
   * Своя константа у Order разошлась бы с бакетом молча: мягче — отказ
   * Storage посреди запуска; строже — текст «больше 20 МБ — производство
   * не примет» стал бы неправдой при бакете на 30. Поэтому сверяются и
   * константы (в том числе мок бакета e2e), и числа в самих текстах.
   *
   * Константы читаются ТЕКСТОМ, а не импортом: `api/erpFiles.ts` тянет
   * клиент Supabase, а мок e2e живёт вне `src`.
   */
  it('писатели Order не мягче бакета', () => {
    const MB = 1024 * 1024;
    const writers = [
      ['orderstudio/api/erpFiles.ts', /ERP_FILE_MAX_BYTES = (\d+) \* 1024 \* 1024/],
      ['orderstudio/tz/model/sendChecklist.ts', /ERP_FILE_MAX_BYTES = (\d+) \* 1024 \* 1024/],
      ['../e2e/support/mock/storageBuckets.ts', /ERP_FILE_LIMIT = (\d+) \* 1024 \* 1024/],
    ] as const;
    for (const [rel, re] of writers) {
      const m = readFileSync(join(SRC, rel), 'utf8').match(re);
      expect(m, `${rel}: предел не найден — разбор сломан`).toBeTruthy();
      expect(Number(m![1]) * MB, `${rel}: предел Order разошёлся с бакетом`).toBe(bucketLimit());
    }
    const texts = [
      'orderstudio/api/erpFiles.ts',
      'orderstudio/tz/model/sendChecklist.ts',
      'orderstudio/bridge/launchFiles.ts',
      '../e2e/support/mock/storageBuckets.ts',
    ];
    let seen = 0;
    for (const rel of texts) {
      const text = readFileSync(join(SRC, rel), 'utf8');
      for (const m of text.matchAll(/(?:больше|предел) (\d+) МБ/g)) {
        seen += 1;
        expect(Number(m[1]) * MB, `${rel}: «${m[0]}» не равно лимиту бакета`).toBe(bucketLimit());
      }
    }
    expect(seen, 'в текстах Order не найдено ни одного «больше N МБ» — разбор сломан').toBeGreaterThan(3);
  });

  /**
   * `sku-photos` СВОЯ ВЕЛИЧИНА, И ЭТО РЕШЕНИЕ, А НЕ ЗАБЫВЧИВОСТЬ.
   *
   * Это фото моделей Order Studio — другой раздел, другой вопрос («какой
   * снимок каталога мы принимаем»). Правка 14.09 про вложения ERP и переписку;
   * поднять заодно и каталог значило бы менять то, о чём не просили. Сторож
   * фиксирует РАЗДЕЛЬНОСТЬ: миграция лимита ERP не имеет права молча задеть
   * второй бакет.
   */
  it('миграция лимита ERP не трогает бакет каталога', () => {
    expect(SQL).not.toMatch(/sku-photos/);
  });
});
