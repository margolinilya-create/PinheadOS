// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, withoutComments } from './migrations.testutil';

/**
 * Сторож ночной копии Storage (сессия 68).
 *
 * ЗАЧЕМ. Прежний `storage-backup.yml` клал архив ВСЕХ файлов в артефакты
 * GitHub Actions и печатал в лог путь каждого объекта. Пока секретов не было,
 * это ничего не стоило: 57 прогонов падали на проверке. Первый зелёный (#58,
 * 24.09) выдал архив в артефакты ПУБЛИЧНОГО репозитория — его скачивает любой
 * вошедший на GitHub, — а лог раскрыл ключи объектов публичного бакета, то есть
 * прямые ссылки на файлы. Теперь копия серверная, в приватный бакет того же
 * проекта, и сторож держит ровно те свойства, нарушение которых снова
 * выложит файлы наружу или молча оставит часть данных без копии.
 */

const ROOT = join(process.cwd(), '..');
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/storage-backup.yml'), 'utf8');
/** Код шага без строк-комментариев YAML: объяснение причин упоминает то, чего быть не должно */
const STEPS = WORKFLOW.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');

const BACKUP_BUCKET = 'storage-backup';

/** Бакеты, которые заводят миграции: `insert into storage.buckets … values ('<id>', …)` */
function bucketsFromMigrations(): Map<string, string> {
  const found = new Map<string, string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = withoutComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    const re = /insert into storage\.buckets[^;]*?values\s*\(\s*'([\w-]+)'[^;]*;/gi;
    for (const m of sql.matchAll(re)) found.set(m[1], m[0]);
  }
  return found;
}

describe('копия Storage не выходит наружу', () => {
  it('ни одного артефакта: файлы не покидают проект', () => {
    expect(STEPS).not.toMatch(/upload-artifact/);
  });

  it('в лог не печатаются ключи объектов — только счётчики', () => {
    const logs = STEPS.split('\n').filter((l) => /console\.(log|error|warn|info)\(/.test(l));
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line, `строка лога выводит путь объекта: ${line.trim()}`)
        .not.toMatch(/\$\{[^}]*(path|dest|name)[^}]*\}/);
    }
  });

  it('копирование серверное и только в приватный бакет копии', () => {
    expect(STEPS).toMatch(new RegExp(`const TARGET = '${BACKUP_BUCKET}'`));
    expect(STEPS).toMatch(/\.copy\([^)]*\{\s*destinationBucket:\s*TARGET\s*\}\)/);
  });

  it('из копии и из рабочих бакетов ничего не удаляется', () => {
    // Копия заведена ради файлов, удалённых из рабочего бакета: remove() — hard delete
    expect(STEPS).not.toMatch(/\.remove\(/);
    expect(STEPS).not.toMatch(/\.emptyBucket\(|\.deleteBucket\(/);
  });

  it('workflow не просит больше прав, чем чтение репозитория', () => {
    expect(STEPS).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });
});

describe('бакет копии приватный и без политик', () => {
  const buckets = bucketsFromMigrations();

  it('миграции заводят бакет копии с public = false', () => {
    const stmt = buckets.get(BACKUP_BUCKET);
    expect(stmt, 'бакет копии не заведён ни одной миграцией').toBeTruthy();
    expect(stmt).toMatch(new RegExp(`'${BACKUP_BUCKET}',\\s*'${BACKUP_BUCKET}',\\s*false`));
  });

  it('ни одна политика ни в одной миграции не открывает бакет копии', () => {
    // Политик для него нет вовсе: читать и писать может только service_role
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    for (const f of files) {
      const sql = withoutComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
      for (const m of sql.matchAll(/create policy[\s\S]*?;/gi)) {
        expect(m[0], `${f}: политика упоминает ${BACKUP_BUCKET}`).not.toContain(BACKUP_BUCKET);
      }
    }
  });
});

describe('копия охватывает все рабочие бакеты', () => {
  /**
   * Список источников выводится из МИГРАЦИЙ, а не проверяется по известным
   * именам — тот же урок, что у носителей ключа в `storageGc.test.ts`:
   * бакет, заведённый позже, иначе остался бы без копии при зелёном стороже.
   */
  it('каждый бакет из миграций, кроме самой копии, — в SOURCES', () => {
    const sources = /const SOURCES = \[([^\]]*)\]/.exec(STEPS);
    expect(sources, 'в workflow нет списка SOURCES').toBeTruthy();
    const listed = new Set([...sources![1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]));
    const working = [...bucketsFromMigrations().keys()].filter((b) => b !== BACKUP_BUCKET);
    expect(working.length).toBeGreaterThanOrEqual(2);
    for (const b of working) {
      expect(listed.has(b), `бакет ${b} не попадает в копию`).toBe(true);
    }
    expect(listed.has(BACKUP_BUCKET), 'копия не копирует саму себя').toBe(false);
  });
});
