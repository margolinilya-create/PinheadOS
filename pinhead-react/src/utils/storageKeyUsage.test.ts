/**
 * КЛЮЧ ОБЪЕКТА STORAGE СОБИРАЕТ ОДНА ФУНКЦИЯ — И ЕЁ ЗОВУТ ВСЕ ЗАГРУЗЧИКИ.
 *
 * ЗАЧЕМ. Supabase проверяет ключ регуляркой S3-safe символов, где `\w`
 * объявлен БЕЗ флага `u`, то есть только ASCII. Любая русская буква — ответ
 * `InvalidKey`, и файл не загружается вообще. На этом когда-то не создавался
 * НИ ОДИН заказ с ТЗ, и ради этого правило вынесено в отдельный модуль.
 *
 * ЧТО НАШЛА РЕВИЗИЯ 25.08. Три загрузчика собирали ключ мимо модуля, все три
 * одинаково: `file.name.split('.').pop() || 'jpg'`. У имени БЕЗ точки `split`
 * отдаёт массив из одного элемента, и `pop()` возвращает имя ЦЕЛИКОМ —
 * фолбэк не срабатывал никогда. Файл «Скан» превращался в ключ
 * `<orderId>/1699.скан`, и человек получал «Не удалось загрузить фото»
 * без единого объяснения.
 *
 * Тест проверяет РЕЗУЛЬТАТ (ключ строго ASCII), а не наличие вызова: сторож,
 * сверяющий имена функций, зелен и тогда, когда рядом живёт вторая копия
 * правила.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentFilePath, safeFileName } from './storageKey';
import { skuPhotoPath } from '../lib/storage';
import { withoutJsComments } from '../erp/utils/migrations.testutil';

/** Ровно то, что принимает Supabase Storage: ASCII, без пробелов и кавычек */
const S3_SAFE = /^[\w!\-.*'()/]+$/;

const NASTY = [
  'Скан',                       // без расширения вовсе — здесь ломался `pop()`
  'макет.чертёж',               // кириллица В РАСШИРЕНИИ
  'Фото образца.JPG',           // пробел и кириллица в основе
  'отчёт.v1/final',             // слэш из имени уезжал в путь
  '../../секрет.pdf',           // серии точек — обход каталога
  '.gitignore',                 // точка первым символом: расширения нет
  'a'.repeat(300) + '.png',     // длинное имя
  '№1 «Пинхед» (2).png',        // типографика
];

describe('ключ вложения заказа строго ASCII', () => {
  it.each(NASTY)('%s', (name) => {
    const key = attachmentFilePath('ord-1', 'preview', '17', name);
    expect(key).toMatch(S3_SAFE);
  });
});

describe('ключ фото артикула строго ASCII', () => {
  it.each(NASTY)('%s', (name) => {
    const ext = safeFileName(name, 'photo', 'jpg').split('.').pop() as string;
    expect(skuPhotoPath('ФУТ-01', 0, ext)).toMatch(S3_SAFE);
  });

  it('код артикула тоже обеззараживается, а не уезжает в ключ как есть', () => {
    expect(skuPhotoPath('ФУТ-01', 0, 'jpg')).toMatch(S3_SAFE);
    // Пустой после обеззараживания код не должен давать ключ, начинающийся с «_»
    expect(skuPhotoPath('«»', 1, 'png')).toBe('sku_1.png');
  });

  /**
   * Загрузка и удаление обязаны собирать ОДИН ключ. Обеззаразь только
   * загрузку — и `deleteSkuPhoto` перестанет находить свои же файлы, причём
   * молча: удаление несуществующего пути ошибкой не считается.
   */
  it('удаление собирает тот же путь, что и загрузка', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/storage.ts'), 'utf8');
    const del = src.slice(src.indexOf('export async function deleteSkuPhoto'));
    expect(del).toContain('skuPhotoPath(');
    expect(del, 'путь собирается шаблоном рядом с общей функцией').not.toMatch(/`\$\{code\}_/);
  });
});

/**
 * Ни один загрузчик не собирает расширение сам. Оборот
 * `file.name.split('.').pop()` возвращает имя целиком, когда точки нет, —
 * и три места в проекте делали именно так.
 */
describe('своих сборок расширения в проекте не осталось', () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) sources(p, out);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
    return out;
  }

  it('file.name.split(\'.\').pop() нигде не строит ключ', () => {
    /**
     * Комментарии снимаются ДО поиска. Объяснение, почему оборота больше нет,
     * содержит тот же оборот — и первая версия этого сторожа падала на двух
     * файлах, где в коде всё было верно, а в комментарии описан прежний способ.
     * Правило записано в проекте отдельно; здесь оно ровно и сработало.
     */
    const offenders = sources(join(process.cwd(), 'src'))
      .filter((p) => /file\.name\.split\(['"]\.['"]\)\.pop\(\)/
        .test(withoutJsComments(readFileSync(p, 'utf8'))))
      .map((p) => p.replace(process.cwd() + '/', ''));
    expect(
      offenders,
      'ключ собирается мимо utils/storageKey: имя без точки даст расширением '
      + 'само имя, и кириллица уедет в ключ — Supabase ответит InvalidKey',
    ).toEqual([]);
  });
});
