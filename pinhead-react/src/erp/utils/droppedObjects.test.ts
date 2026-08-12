import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Удалённый объект БД не должен остаться в теле живой функции.
 *
 * ЧТО СЛУЧИЛОСЬ 12.08. Уборка старой модели ЭКС дропнула
 * `erp_experimental_ops`. Таблицу искали по клиентскому коду — `grep` нашёл
 * слайс, тип и подписку realtime, и всё выглядело убранным. Но её подтягивала
 * `erp_bootstrap()` эмбедом `ops`, а пакет оболочки собирается при КАЖДОЙ
 * загрузке страницы: весь раздел «Производство» стал отвечать 42P01 —
 * ни меню, ни прав, ни справочников.
 *
 * Тела функций живут в БАЗЕ, а не в исходниках: последняя миграция,
 * определяющая `erp_bootstrap`, лежала в репозитории с 03.08, и в изменённых
 * файлах упоминания удаляемой таблицы не было вовсе. Поэтому проверка не может
 * смотреть только на диф — она обходит ВСЕ миграции и берёт ПОСЛЕДНЕЕ
 * определение каждой функции, то есть то, что реально исполняет база.
 *
 * ГРАНИЦА ЧЕСТНОСТИ. Тест читает репозиторий, а не базу. Функция, созданная
 * мимо миграций, сюда не попадёт. Но правило проекта — все изменения схемы
 * идут миграциями, и именно их набор описывает прод.
 */

const MIGRATIONS = join(process.cwd(), '../supabase/migrations');

/** Объекты, удалённые миграциями: `drop table` / `drop function` */
function droppedObjects(files: string[]): Map<string, string> {
  const dropped = new Map<string, string>();
  for (const name of files) {
    const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
    for (const m of sql.matchAll(/drop table (?:if exists )?public\.(\w+)/gi)) {
      dropped.set(m[1], name);
    }
    for (const m of sql.matchAll(/drop function (?:if exists )?public\.(\w+)\s*\(/gi)) {
      dropped.set(m[1], name);
    }
  }
  return dropped;
}

/** Последнее определение каждой функции: имя → { текст тела, файл } */
function latestFunctionBodies(files: string[]): Map<string, { body: string; file: string }> {
  const out = new Map<string, { body: string; file: string }>();
  for (const name of files) {
    const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
    const re = /create or replace function public\.(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      // Тело — до закрывающего `$$;`, как его видит Postgres
      const end = sql.indexOf('$$;', m.index);
      const body = end < 0 ? sql.slice(m.index) : sql.slice(m.index, end);
      out.set(m[1], { body, file: name });
    }
  }
  return out;
}

describe('удалённые объекты не остаются в живых функциях', () => {
  const FILES = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
  const DROPPED = droppedObjects(FILES);
  const BODIES = latestFunctionBodies(FILES);

  it('обе стороны найдены — сторож не сторожит пустоту', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(DROPPED.size).toBeGreaterThanOrEqual(2);
    expect(BODIES.size).toBeGreaterThan(20);
  });

  it('в схеме числятся удалёнными те объекты, которые мы убрали 12.08', () => {
    expect([...DROPPED.keys()]).toEqual(
      expect.arrayContaining(['erp_experimental_ops', 'erp_tz_assignments']),
    );
  });

  it('ни одна действующая функция не ссылается на удалённый объект', () => {
    const problems: string[] = [];
    for (const [fn, { body, file }] of BODIES) {
      // Функция, которую саму дропнули, уже не действует
      if (DROPPED.has(fn)) continue;
      for (const [obj, dropFile] of DROPPED) {
        if (obj === fn) continue;
        // Порядок важен: объект, удалённый ПОЗЖЕ определения функции, —
        // это и есть поломка. Файлы отсортированы по времени
        if (dropFile <= file) continue;
        if (new RegExp(`\\b${obj}\\b`).test(body)) {
          problems.push(`${fn}() (${file}) ссылается на ${obj}, удалённый в ${dropFile}`);
        }
      }
    }
    expect(problems, problems.join('; ')).toEqual([]);
  });
});
