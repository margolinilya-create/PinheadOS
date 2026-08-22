/**
 * Сторож: репозиторий не отстаёт от боевой базы.
 *
 * Отказ, от которого он поставлен, случался ДВАЖДЫ (18.08 и 13.08) и оба раза
 * был замечен задним числом: миграцию применяли к проду через MCP, файл
 * в `supabase/migrations/` не заводили. Прод при этом работает правильно —
 * ломается репозиторий, и ломается молча, тремя способами сразу:
 *
 *   1. Реплей на чистое окружение (превью-ветка, staging, восстановление
 *      из бэкапа) воспроизводит НЕ ту систему, что в проде. У потери 13.08
 *      цена была прямая: `erp_warehouse_ops_insert` и `erp_item_prints_*`
 *      в репозитории стояли `with check (true)` — любой вошедший пишет
 *      складские операции и нанесения.
 *   2. Сторожевые тесты, читающие ПОСЛЕДНЮЮ репозиторную миграцию
 *      (`latestDefining` в `migrations.testutil.ts`), сверяются с устаревшим
 *      текстом и остаются зелёными. Сторож, подтверждающий отсутствие гейта
 *      как норму, хуже отсутствующего.
 *   3. Следующий, кто станет пересоздавать функцию «по подлинному тексту
 *      прежней миграции», возьмёт текст, которого в базе давно нет.
 *
 * Как это проверяется. Живой журнал (`supabase_migrations.schema_migrations`)
 * из юнит-теста не прочитать — в CI нет доступа к базе. Поэтому сторож
 * работает со СНИМКОМ журнала: `supabase/migrations/APPLIED.json`, который
 * обновляется руками после каждой выкладки (порядок — в
 * `supabase/migrations/README.md`).
 *
 * Снимок слабее живой сверки и честно об этом говорит: он ловит «применили
 * и не завели файл», но не поймает «применили и не обновили снимок».
 * Второе, в отличие от первого, видно в диффе выкладки — там, где о нём
 * есть кому спросить.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');
const SNAPSHOT = join(MIGRATIONS_DIR, 'APPLIED.json');

interface AppliedEntry {
  version: string;
  name: string;
  /**
   * Файлы репозитория, несущие это изменение. Обычно один — с тем же слагом,
   * что имя в журнале. Больше одного, когда изменение применили одной версией,
   * а в репозитории разложили на несколько файлов; ноль — когда файла быть
   * не должно (`noFile`).
   */
  files: string[];
  /** Файла нет и не должно быть: перенос данных, бэкфилл, отменённое изменение */
  noFile?: true;
  note?: string;
}

interface Snapshot {
  project: string;
  capturedAt: string;
  /** Базовая схема, применённая до того, как завели журнал */
  preJournalFiles: string[];
  migrations: AppliedEntry[];
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Snapshot;
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
const fileSet = new Set(files);

describe('журнал миграций боевой базы и репозиторий', () => {
  it('снимок не пустой и назван проектом', () => {
    expect(snapshot.project).toBe('pinhead-os-v2');
    expect(snapshot.migrations.length).toBeGreaterThan(100);
  });

  it('у каждой применённой миграции есть файл или названная причина его отсутствия', () => {
    const orphans = snapshot.migrations.filter(
      (m) => (m.files ?? []).length === 0 && !m.noFile);
    expect(
      orphans.map((m) => `${m.version} ${m.name}`),
      'применено к проду, но в репозитории не описано ничем — так терялись миграции 13.08 и 18.08',
    ).toEqual([]);
  });

  it('каждый названный файл существует', () => {
    const broken = [
      ...snapshot.migrations.flatMap((m) => m.files ?? []),
      ...snapshot.preJournalFiles,
    ].filter((f) => !fileSet.has(f));
    expect(
      [...new Set(broken)],
      'снимок ссылается на файл, которого в supabase/migrations больше нет (переименовали или удалили)',
    ).toEqual([]);
  });

  it('отсутствие файла всегда объяснено', () => {
    const silent = snapshot.migrations
      .filter((m) => m.noFile && !m.note)
      .map((m) => `${m.version} ${m.name}`);
    expect(
      silent,
      'noFile — это решение; решение без записанной причины через месяц неотличимо от недосмотра',
    ).toEqual([]);
  });

  /**
   * Соответствие, выведенное не из совпадения имён, обязано нести причину.
   * Без неё через месяц не отличить «разложили на два файла осознанно»
   * от «привязали к первому попавшемуся, чтобы тест позеленел».
   */
  it('нетривиальное соответствие объяснено', () => {
    const slugOf = (f: string) => f.replace(/^\d+_/, '').replace(/\.sql$/, '');
    const silent = snapshot.migrations
      .filter((m) => !m.noFile
        && !(m.files.length === 1 && slugOf(m.files[0]) === m.name)
        && !m.note)
      .map((m) => `${m.version} ${m.name}`);
    expect(silent, 'файлы названы, а почему именно они — нет').toEqual([]);
  });

  it('версии в снимке уникальны и упорядочены', () => {
    const versions = snapshot.migrations.map((m) => m.version);
    expect(new Set(versions).size, 'повтор версии в снимке').toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
  });

  /**
   * Обратное направление — файл, которого нет в журнале.
   *
   * Это НОРМАЛЬНОЕ состояние ветки: миграцию пишут раньше, чем применяют,
   * и падать на каждой значило бы запретить писать миграции. Но накопление
   * таких файлов означает «забыли выложить», поэтому тест их не запрещает,
   * а держит потолок: несколько неприменённых — рабочий объём одной ветки,
   * десяток — потерянная выкладка.
   *
   * Это же направление поймало две настоящие неточности при заведении снимка:
   * у `erp_experimental_stages` (10.08 и 20.08) и у пары
   * `erp_item_packaging_details` / `erp_create_order_packaging` слаги
   * повторяются, и сопоставление по имени молча привязывало обе записи
   * к одному файлу, оставляя второй бесхозным.
   */
  it('неприменённых файлов не больше, чем помещается в одну ветку', () => {
    const claimed = new Set([
      ...snapshot.migrations.flatMap((m) => m.files ?? []),
      ...snapshot.preJournalFiles,
    ]);
    const pending = files.filter((f) => !claimed.has(f));
    expect(
      pending.length,
      `файлы есть, в журнале прода их нет — выложены ли они? ${pending.join(', ')}`,
    ).toBeLessThanOrEqual(5);
  });
});
