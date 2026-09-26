// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import { latestDefining, latestMatching, migration, migrationFiles } from './migrations.testutil';

/**
 * КЭШ ЧТЕНИЯ МИГРАЦИЙ (обзор 26.09, п. 13).
 *
 * `latestDefining` зовут 146 раз из 43 файлов, и до кэша каждый вызов
 * листал каталог и перечитывал все ~265 SQL-файлов. Этот тест закрепляет
 * поведение: второе обращение к тому же имени — ноль чтений с диска.
 *
 * `node:fs` подменяется целиком обёртками над настоящими функциями:
 * шпион на отдельный экспорт ESM-модуля Vitest не ставит («namespace is
 * not configurable»), а через `vi.mock` хелпер получает те же функции
 * с учётом вызовов.
 *
 * Мутации (проверены 26.09): убрать `texts.set` — второй `migration()` снова
 * читает файл; убрать `sqlFiles ??=` — `readdirSync` на каждый вызов;
 * убрать `latest.set` — шаблон снова прогоняется по всем файлам.
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return { ...real, readFileSync: vi.fn(real.readFileSync), readdirSync: vi.fn(real.readdirSync) };
});

const read = vi.mocked(fs.readFileSync);
const dir = vi.mocked(fs.readdirSync);

describe('migrations.testutil — кэш на модуль', () => {
  it('повторный latestDefining того же имени не читает диск', () => {
    // Прогрев: каталог и тексты уже в кэше после первого обращения
    latestDefining('erp_stage_guard');
    read.mockClear();
    dir.mockClear();
    latestDefining('erp_stage_guard');
    expect(read).not.toHaveBeenCalled();
    expect(dir).not.toHaveBeenCalled();
  });

  it('каталог листается один раз', () => {
    migrationFiles();
    dir.mockClear();
    expect(migrationFiles()).toBe(migrationFiles());
    expect(dir).not.toHaveBeenCalled();
  });

  it('текст миграции читается один раз', () => {
    const name = migrationFiles()[0];
    migration(name);
    read.mockClear();
    expect(migration(name)).toBe(migration(name));
    expect(read).not.toHaveBeenCalled();
  });

  it('ответ latestMatching на тот же шаблон отдаётся без повторного прогона', () => {
    const pattern = /create or replace function public\.erp_stage_guard\(/;
    latestMatching(pattern, 'erp_stage_guard()');
    const test = vi.spyOn(pattern, 'test');
    latestMatching(pattern, 'erp_stage_guard()');
    expect(test).not.toHaveBeenCalled();
    test.mockRestore();
  });

  it('список миграций отсортирован по версии', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(200);
    expect([...files].sort()).toEqual(files);
  });
});
