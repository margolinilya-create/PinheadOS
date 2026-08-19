import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Сторож серверной функции ТЗ-PDF — читает ЕЁ ИСХОДНИК.
 *
 * ЗАЧЕМ. Deno-файл лежит вне `tsconfig` фронтенда, поэтому `tsc` его не смотрит;
 * e2e ходит в мок; тесты слайса мокают сам вызов. Гейт и правила этой функции
 * не покрыты больше ничем — та же дыра, ради которой заведены
 * `adminUsers.test.ts` и `purchasePdfFunction.test.ts`.
 *
 * Проверяется не «код красивый», а четыре вещи, каждая из которых уже
 * ломалась в этом проекте или могла бы сломаться молча.
 */

const FUNCTIONS = join(process.cwd(), '../supabase/functions');
const SRC = readFileSync(join(FUNCTIONS, 'tz-pdf/index.ts'), 'utf8');
const PURCHASE = readFileSync(join(FUNCTIONS, 'purchase-list-pdf/index.ts'), 'utf8');
const FONT = readFileSync(join(FUNCTIONS, '_shared/pdfFont.ts'), 'utf8');

describe('tz-pdf: гейт и права', () => {
  it('вызывающий определяется по токену, а не по телу запроса', () => {
    // Иначе достаточно прислать чужой order_id и получить ТЗ по чужому заказу
    expect(SRC).toMatch(/caller\.auth\.getUser\(\)/);
    expect(SRC).toMatch(/Authorization: authHeader/);
  });

  it('право проверяется той же функцией, что стоит в политиках заказа', () => {
    expect(SRC).toMatch(/caller\.rpc\('erp_is_member'\)/);
    expect(SRC).toMatch(/403/);
  });

  it('данные читаются под RLS, а не сервисным ключом', () => {
    expect(SRC).toMatch(/await caller\s*\n?\s*\.from\('erp_orders'\)/);
    expect(SRC).toMatch(/await caller\s*\n?\s*\.from\('erp_order_items'\)/);
  });
});

describe('tz-pdf: документ попадает туда, где его считает гейт', () => {
  /**
   * Лист закупки лежит вложением вида `purchase` СПЕЦИАЛЬНО, чтобы гейт ТЗ
   * не счёл его техническим заданием и не открыл цехам работу без ТЗ.
   * Здесь наоборот: документ обязан попасть в таблицу, которую гейт считает.
   */
  it('пишется в erp_tz_documents, а не во вложения заказа', () => {
    expect(SRC).toMatch(/from\('erp_tz_documents'\)\s*\.insert/);
    expect(SRC).not.toMatch(/from\('erp_order_attachments'\)\s*\.insert/);
  });

  it('документ принадлежит ПОЗИЦИИ — так его видят все цеха её маршрута', () => {
    expect(SRC).toMatch(/item_id: item\.id/);
  });
});

describe('tz-pdf: версии, а не перезапись', () => {
  /**
   * Правка ТЗ после запуска обязана быть видна цеху бейджем «ТЗ обновлено»
   * (`tz.tzUpdatedAfterStart`). Перезаписанный по тому же пути файл сменился
   * бы у всех молча, и человек, работающий по распечатке, не узнал бы
   * об изменении.
   */
  it('версия растёт, путь файла её несёт', () => {
    expect(SRC).toMatch(/version = \(previous\?\.version \?\? 0\) \+ 1/);
    expect(SRC).toMatch(/v\$\{version\}\.pdf/);
  });

  it('is_current снимается ПЕРЕД вставкой новой версии', () => {
    // Обратный порядок падает с 23505 на частичном уникальном индексе
    // `unique (group_id) where is_current` — правило проекта
    const clear = SRC.indexOf('is_current: false');
    const insert = SRC.indexOf("from('erp_tz_documents').insert");
    expect(clear).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(clear);
  });

  it('прежняя версия ищется по ПУТИ, а не по имени файла', () => {
    // По имени искать нельзя: человек мог загрузить свой PDF с тем же именем,
    // и новая версия записалась бы поверх ЧУЖОГО документа
    expect(SRC).toMatch(/\.like\('file_path'/);
    expect(SRC).toMatch(/tz\/auto\//);
  });

  it('сбой вставки возвращает флаг прежней версии', () => {
    // Иначе у позиции не окажется актуального ТЗ вовсе, и гейт остановит цех
    // из-за нашей же ошибки
    const failBranch = SRC.slice(SRC.indexOf('if (rowErr)'));
    expect(failBranch).toMatch(/is_current: true/);
    expect(failBranch).toMatch(/storage[\s\S]{0,60}remove/);
  });
});

describe('tz-pdf: кириллица', () => {
  /**
   * Стандартные шрифты PDF кодируют текст в WinAnsi и кириллицы не знают
   * вообще — документ выходит мусорным МОЛЧА. Проверять это надо в готовом
   * файле, но отсутствие встроенного шрифта видно и здесь.
   */
  it('шрифт встраивается и fontkit подключается', () => {
    expect(SRC).toMatch(/registerFontkit\(fontkit\)/);
    expect(SRC).toMatch(/embedFont\(font/);
  });

  it('загрузка шрифта — общий модуль, а не копия в каждой функции', () => {
    // Копия означала бы, что однажды одна из функций останется со старым URL
    // и сломается способом, который не виден по коду
    expect(SRC).toMatch(/from '\.\.\/_shared\/pdfFont\.ts'/);
    expect(PURCHASE).toMatch(/from '\.\.\/_shared\/pdfFont\.ts'/);
    expect(FONT).toMatch(/dejavu-fonts-ttf/);
    // Ни одна из функций не тянет шрифт сама
    expect(SRC).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(PURCHASE).not.toMatch(/cdn\.jsdelivr\.net/);
  });
});

describe('клиент зовёт функцию по имени, совпадающему с папкой', () => {
  it('имя функции в сторе и папка совпадают', () => {
    // Опечатка здесь не ломает ни сборку, ни один тест — она отвечает 404
    // на том действии, которое никто не прокликал
    const slice = readFileSync(
      join(process.cwd(), 'src/erp/store/slices/ordersSlice.ts'), 'utf8',
    );
    expect(slice).toMatch(/invokeFunction\('tz-pdf'/);
  });

  it('автосборка не подменяет приложенное человеком ТЗ', () => {
    // Загруженный вручную PDF важнее собранного из полей
    const slice = readFileSync(
      join(process.cwd(), 'src/erp/store/slices/ordersSlice.ts'), 'utf8',
    );
    expect(slice).toMatch(/\(tz\?\.documents \?\? \[\]\)\.length === 0/);
  });
});
