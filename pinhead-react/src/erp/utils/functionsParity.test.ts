/**
 * Сторож: репозиторий не отстаёт от боевых edge-функций.
 *
 * Дисциплина «репозиторий = прод» в проекте есть — но только для миграций:
 * `APPLIED.json` + `migrationJournal.test.ts` + `npm run migrations:verify`,
 * и она работает (02.09.2026 отпечаток сошёлся байт в байт). Для edge-функций
 * не было НИЧЕГО, и аудит 02.09 нашёл дрейф в трёх из четырёх:
 *
 *   1. `tz-pdf` — выкачена 17.08, работает, гейт `erp_is_member` на месте,
 *      пишет версионированные документы в `erp_tz_documents`. Исходника
 *      не было ни в репозитории, ни где-либо ещё: код, который исполняется
 *      в проде и которого нет нигде. При этом `CLAUDE.md` числил генерацию
 *      ТЗ-PDF как «следующую очередь» — документация считала несделанным то,
 *      что выкачено и работает.
 *   2. `purchase-list-pdf` — в проде версия 2 (загрузка шрифта переведена
 *      на общий `_shared/pdfFont.ts`), в репозитории лежала версия 1 со своей
 *      копией `loadFont`. Слаг тот же, файл на месте, дрейф молчаливый.
 *   3. `domain-events-dispatcher` — остаток снесённой итерации `redesign/v2`.
 *      Миграция `20260716120000` убрала её таблицы и расписание cron, но
 *      edge-функцию SQL снять не может, а шага «снять функцию» в чеклисте
 *      не было. Висит ACTIVE с `verify_jwt: false`, то есть открыта без токена,
 *      и внутри поднимает `service_role`.
 *
 * Это тот же класс дефекта, против которого стоит `droppedObjects.test.ts` —
 * «удалили объект, забыли про потребителя», — только тот сторож смотрит
 * функции БД и edge-функцию не видит по построению.
 *
 * ЧТО ЭТОТ СТОРОЖ ЛОВИТ, А ЧТО НЕТ. Живой список функций из CI не прочитать
 * (он за Management API), поэтому сторож работает со СНИМКОМ
 * `supabase/functions/DEPLOYED.json` и сверяет его с файлами на диске.
 * Он ловит «выложили и не завели исходник» и «завели каталог и не вписали
 * в снимок». Он НЕ поймает «выложили и не обновили снимок» — ровно то
 * допущение, которое у миграций однажды отказало. Поэтому рядом живёт
 * `npm run functions:verify`: команда, а не надежда на внимательность
 * в диффе выкладки.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Тот же приём, что у `MIGRATIONS_DIR`: vitest всегда стартует из `pinhead-react/` */
const FUNCTIONS_DIR = join(process.cwd(), '../supabase/functions');
const SNAPSHOT_PATH = join(FUNCTIONS_DIR, 'DEPLOYED.json');

interface DeployedFn {
  slug: string;
  version: number;
  verifyJwt: boolean;
  dir: string | null;
  orphan?: boolean;
  note: string;
}

interface Snapshot {
  capturedAt: string;
  project: string;
  sharedDirs: string[];
  orphanCeiling: number;
  functions: DeployedFn[];
}

const snapshot: Snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

/** Каталоги функций на диске — без общих (`_shared`) и без служебных файлов */
function dirsOnDisk(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !snapshot.sharedDirs.includes(name))
    .sort();
}

describe('снимок edge-функций описывает то, что лежит в репозитории', () => {
  it('у каждой функции со своим каталогом есть index.ts на диске', () => {
    const missing = snapshot.functions
      .filter((f) => f.dir !== null)
      .filter((f) => !existsSync(join(FUNCTIONS_DIR, f.dir as string, 'index.ts')))
      .map((f) => f.slug);

    expect(
      missing,
      'Функция объявлена выкаченной, а исходника нет. Именно так пропала '
      + '`tz-pdf`: работающий код, которого нигде не существует.',
    ).toEqual([]);
  });

  it('каждый каталог функции вписан в снимок', () => {
    const known = new Set(
      snapshot.functions.map((f) => f.dir).filter((d): d is string => d !== null),
    );
    const unlisted = dirsOnDisk().filter((d) => !known.has(d));

    expect(
      unlisted,
      'Каталог функции есть, а записи в снимке нет — значит неизвестно, '
      + 'выкачена ли она и какой версии.',
    ).toEqual([]);
  });

  it('каждая запись объясняет себя заметкой', () => {
    const silent = snapshot.functions
      .filter((f) => !f.note || f.note.trim().length < 20)
      .map((f) => f.slug);

    expect(
      silent,
      'Запись без заметки не отвечает на вопрос «почему так» — как обязательный '
      + '`note` у записей журнала миграций.',
    ).toEqual([]);
  });
});

describe('функция без исходника — потеря, а не решение', () => {
  /**
   * Ратчет, а не запрет: `domain-events-dispatcher` удаляется только через
   * дашборд, руками владельца проекта, и до тех пор запрет держал бы CI вечно
   * красным — то есть сделал бы сторожа тем, мимо чего смотрят. Ровно так же
   * устроен ратчет потерянных файлов миграций (`fileLost`).
   */
  it('число функций без исходника не растёт', () => {
    const orphans = snapshot.functions.filter((f) => f.orphan);

    expect(
      orphans.length,
      `Функций без исходника стало больше потолка (${snapshot.orphanCeiling}). `
      + 'Потолок опускают, когда лишнюю функцию удалили из прода, — и никогда '
      + 'не поднимают, чтобы пропустить новую.',
    ).toBeLessThanOrEqual(snapshot.orphanCeiling);
  });

  it('функция без исходника не притворяется имеющей каталог', () => {
    const lying = snapshot.functions
      .filter((f) => f.orphan && f.dir !== null)
      .map((f) => f.slug);

    expect(lying, 'orphan: true означает «в репозитории её нет», то есть dir: null')
      .toEqual([]);
  });
});

describe('открытый без токена эндпоинт назван вслух', () => {
  /**
   * `verify_jwt: false` — законная настройка (вебхук, вызов от cron
   * с `service_role` в заголовке), но она снимает проверку авторизации
   * на входе, и молча стоять не должна. Заметка обязана объяснять, почему
   * токен не требуется, и что делает функцию безопасной без него.
   */
  it('у каждой такой функции заметка объясняет причину', () => {
    const open = snapshot.functions.filter((f) => f.verifyJwt === false);
    for (const fn of open) {
      expect(
        fn.note.length,
        `${fn.slug}: verify_jwt отключён — заметка обязана сказать, почему это `
        + 'безопасно или что с этим делать.',
      ).toBeGreaterThan(60);
    }
  });
});

describe('общий код функций лежит там, где его ищут импорты', () => {
  /**
   * `tz-pdf` и `purchase-list-pdf` обе импортируют `../_shared/pdfFont.ts`.
   * Файла в репозитории не было вовсе: реплей на чистое окружение упал бы
   * на импорте, а не на поведении, — и причина была бы неочевидна.
   */
  it('каждый импорт из ../_shared разрешается в существующий файл', () => {
    const problems: string[] = [];

    for (const dir of dirsOnDisk()) {
      const entry = join(FUNCTIONS_DIR, dir, 'index.ts');
      if (!existsSync(entry)) continue;
      const source = readFileSync(entry, 'utf8');
      for (const m of source.matchAll(/from\s+'\.\.\/_shared\/([\w./-]+)'/g)) {
        const target = join(FUNCTIONS_DIR, '_shared', m[1]);
        if (!existsSync(target)) problems.push(`${dir} → _shared/${m[1]}`);
      }
    }

    expect(problems, 'Импорт общего модуля не разрешается — файла нет в репозитории')
      .toEqual([]);
  });
});
