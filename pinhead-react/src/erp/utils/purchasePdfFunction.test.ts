import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож серверной функции листа закупки — читает ЕЁ ИСХОДНИК.
 *
 * ЗАЧЕМ. Deno-файл лежит вне `tsconfig` фронтенда, поэтому `tsc` его не смотрит;
 * e2e ходит в мок; тесты слайса мокают сам вызов. Гейт и правила этой функции
 * не покрыты больше НИЧЕМ — ровно та же дыра, ради которой заведён
 * `adminUsers.test.ts`.
 */

const SRC = readFileSync(
  join(process.cwd(), '../supabase/functions/purchase-list-pdf/index.ts'),
  'utf8',
);

describe('purchase-list-pdf: гейт и права', () => {
  /**
   * Личность берётся из ТОКЕНА, а не из тела запроса. Иначе достаточно прислать
   * чужой `order_id` и получить лист закупки по чужому заказу.
   */
  it('вызывающий определяется по токену', () => {
    expect(SRC).toMatch(/caller\.auth\.getUser\(\)/);
    expect(SRC).toMatch(/Authorization: authHeader/);
  });

  /**
   * Права — той же функцией, на которой стоят политики таблиц заказа.
   * Своя проверка роли разошлась бы с политикой в первую же её правку;
   * в проекте на таком расхождении уже ловились.
   */
  it('право проверяется вызовом erp_is_member от лица вызывающего', () => {
    expect(SRC).toMatch(/caller\.rpc\('erp_is_member'\)/);
    expect(SRC).toMatch(/403/);
  });

  /**
   * Данные читаются клиентом ВЫЗЫВАЮЩЕГО, а не сервисным ключом: право видеть
   * заказ проверяет RLS, и обойти её ради удобства значит позволить собрать
   * лист по чужому заказу даже при живом гейте выше.
   */
  it('заказ и материалы читаются под RLS, а не сервисным ключом', () => {
    expect(SRC).toMatch(/await caller\s*\n?\s*\.from\('erp_orders'\)/);
    expect(SRC).toMatch(/await caller\s*\n?\s*\.from\('erp_materials'\)/);
    // Сервисный клиент заводится ТОЛЬКО для записи файла, ниже сборки документа
    expect(SRC.indexOf('const admin = createClient(url, serviceKey)'))
      .toBeGreaterThan(SRC.indexOf('Сборка документа'));
  });
});

describe('purchase-list-pdf: кириллица и хранение', () => {
  /**
   * Четырнадцать стандартных шрифтов PDF кодируют текст в WinAnsi и кириллицы
   * не знают вообще. Без встроенного TTF и явного `fontkit` документ выходит
   * пустым или мусорным — причём МОЛЧА, и заметно это только глазами.
   */
  it('шрифт с кириллицей встраивается через fontkit', () => {
    expect(SRC).toMatch(/registerFontkit\(fontkit\)/);
    expect(SRC).toMatch(/embedFont\(await loadFont\(\)/);
    expect(SRC).toMatch(/DejaVuSans\.ttf/);
  });

  /** Сбой шрифта — отказ всей операции, а не «сделаем без кириллицы» */
  it('несостоявшийся шрифт роняет сборку, а не молчит', () => {
    expect(SRC).toMatch(/throw new Error\(`шрифт не загрузился/);
  });

  /**
   * Путь фиксированный: лист закупки один на заказ. Иначе каждое формирование
   * плодило бы копию, и во вкладке «Файлы» копился бы список одинаковых листов
   * с вопросом «какая из них настоящая».
   */
  it('файл и строка заменяются, а не накапливаются', () => {
    expect(SRC).toMatch(/purchase-list\.pdf/);
    expect(SRC).toMatch(/upsert: true/);
    expect(SRC).toMatch(/\.delete\(\)[\s\S]{0,120}file_path/);
  });

  /** Файл без строки не виден в интерфейсе и занимает место — убираем за собой */
  it('при сбое привязки файл убирается из бакета', () => {
    expect(SRC).toMatch(/storage\.from\(BUCKET\)\.remove\(\[path\]\)/);
  });
});
