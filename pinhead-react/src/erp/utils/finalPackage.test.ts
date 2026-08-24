import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, withoutComments } from './migrations.testutil';
import {
  DEV_ATTACHMENT_KINDS,
  devAttachments,
  finalPackageProgress,
  isFinalPackageReady,
  missingFinalPackage,
  wantsSkuCard,
} from './finalPackage';

/**
 * Финальный технический пакет: гейт кнопки и серверный страж — ОДНО правило.
 *
 * Проверяется две вещи: что перечень недостающего верен, и что страж
 * `erp_dev_package_guard` спрашивает ровно то же. Расхождение половин даёт
 * либо «кнопка есть, действие падает», либо дыру — в этом проекте случалось
 * и то, и другое.
 *
 * ПРАВКА 24.08 (пп. 4.5, 4.6) разделила пакет надвое: техдокументация нужна
 * всегда, карточка SKU — только когда модель идёт в каталог.
 */

/** Только техдокументация: разработка без карточки SKU (переключатель выключен) */
const DOCS = {
  pattern_tech_name: 'PH-HOODIE-01',
  pattern_version: 'v1.2',
};

/** Полная карточка SKU поверх техдокументации */
const FULL = {
  ...DOCS,
  price_min: 1200,
  price_max: 1800,
  final_package: {
    add_to_sku: true,
    description: 'Худи оверсайз',
    fit: 'oversize',
    size_row: 'XS–3XL',
    fabrics: ['Футер 320'],
    branding: ['DTF'],
    modifications: ['Длина рукава'],
  },
};

const FILES = [
  { kind: DEV_ATTACHMENT_KINDS.passport },
  { kind: DEV_ATTACHMENT_KINDS.photo },
];

describe('переключатель «Добавить модель в каталог SKU»', () => {
  it('не задан — считается выключенным', () => {
    // Ключа у заведённых раньше разработок нет вовсе, и «не задано» обязано
    // читаться как «не идёт»: иначе правка никому не смягчила бы гейт
    expect(wantsSkuCard({})).toBe(false);
    expect(wantsSkuCard(null)).toBe(false);
    expect(wantsSkuCard({ final_package: {} })).toBe(false);
  });

  it('сравнение строгое — строка «true» флагом не считается', () => {
    expect(wantsSkuCard({ final_package: { add_to_sku: true } })).toBe(true);
    expect(wantsSkuCard({ final_package: { add_to_sku: 'true' } as never })).toBe(false);
    expect(wantsSkuCard({ final_package: { add_to_sku: false } })).toBe(false);
  });
});

describe('чего не хватает, чтобы завершить разработку', () => {
  /**
   * ГЛАВНОЕ ИЗМЕНЕНИЕ 24.08 (п. 4.6): «если переключатель выключен, технолог
   * заполняет ТОЛЬКО обязательную техническую документацию и завершает
   * разработку». До правки такая разработка не закрывалась вовсе — гейт
   * требовал выдумать ценовую вилку и модификации изделия, которое в каталог
   * не идёт.
   */
  it('без карточки SKU достаточно техдокументации', () => {
    expect(missingFinalPackage(DOCS, FILES)).toEqual([]);
    expect(isFinalPackageReady(DOCS, FILES)).toBe(true);
  });

  it('переключатель включён — карточка SKU снова обязательна', () => {
    const dev = { ...DOCS, final_package: { add_to_sku: true } };
    const missing = missingFinalPackage(dev, FILES);
    expect(missing).toContain('Описание изделия');
    expect(missing).toContain('Доступные ткани');
    expect(missing).toContain('Ценовая вилка');
  });

  it('полный пакет с карточкой SKU — пусто', () => {
    expect(missingFinalPackage(FULL, FILES)).toEqual([]);
    expect(isFinalPackageReady(FULL, FILES)).toBe(true);
  });

  it('пустая разработка перечисляет ВСЁ, а не первое попавшееся', () => {
    // Документ: «система должна показать, какие поля ещё не заполнены» —
    // множественное число здесь существенно, иначе человек ходит по кругу
    const missing = missingFinalPackage({ final_package: { add_to_sku: true } }, []);
    expect(missing).toContain('Техническое название лекал');
    expect(missing).toContain('Технический паспорт');
    expect(missing).toContain('Фото образца');
    expect(missing).toContain('Доступные ткани');
    expect(missing).toContain('Ценовая вилка');
    expect(missing.length).toBeGreaterThan(10);
  });

  /**
   * «ПОЛЕ „ФАЙЛ ЛЕКАЛ ИЛИ ССЫЛКА" НЕ НУЖНО» (п. 4.5). Ни файл, ни ссылка
   * больше не спрашиваются — и завершению не мешают.
   */
  it('лекала не требуются ни файлом, ни ссылкой', () => {
    expect(missingFinalPackage(DOCS, FILES)).not.toContain('Файл или ссылка на лекала');
    expect(missingFinalPackage({ final_package: { add_to_sku: true } }, []))
      .not.toContain('Файл или ссылка на лекала');
  });

  it('«комментарии и особенности производства» — при необходимости, не обязательны', () => {
    // Документ помечает поле этими словами: оно есть в форме, но не в гейте
    expect(missingFinalPackage(DOCS, FILES)).toEqual([]);
  });

  it('пустая строка в списке за значение не считается', () => {
    const dev = { ...FULL, final_package: { ...FULL.final_package, fabrics: ['', '  '] } };
    expect(missingFinalPackage(dev, FILES)).toEqual(['Доступные ткани']);
  });

  it('вилка «от» больше «до» — отдельная строка, а не молчаливый пропуск', () => {
    const dev = { ...FULL, price_min: 2000, price_max: 1000 };
    expect(missingFinalPackage(dev, FILES)).toEqual(['Ценовая вилка: «от» больше «до»']);
  });

  it('ноль — валидная цена, а не «не заполнено»', () => {
    const dev = { ...FULL, price_min: 0, price_max: 0 };
    expect(missingFinalPackage(dev, FILES)).toEqual([]);
  });

  /**
   * ЗНАМЕНАТЕЛЬ СЧИТАЕТСЯ В ТОМ ЖЕ РЕЖИМЕ. Иначе собранная техдокументация
   * показывала бы «4 / 11» — то есть врала бы ровно там, где человек ждёт
   * подтверждения, что всё готово.
   */
  it('прогресс считается той же функцией и в том же режиме', () => {
    expect(finalPackageProgress(DOCS, FILES)).toEqual({ done: 4, total: 4 });
    expect(finalPackageProgress(FULL, FILES)).toEqual({ done: 11, total: 11 });
    expect(finalPackageProgress({}, []).done).toBe(0);
  });

  it('вложения отбираются по разработке, а не по заказу', () => {
    const list = [
      { id: '1', kind: 'dev_photo', experimental_id: 'e1' },
      { id: '2', kind: 'dev_photo', experimental_id: 'e2' },
      { id: '3', kind: 'preview', experimental_id: 'e1' },
    ];
    expect(devAttachments(list, 'e1').map((a) => a.id)).toEqual(['1', '3']);
    expect(devAttachments(list, 'e1', 'dev_photo').map((a) => a.id)).toEqual(['1']);
  });
});

describe('серверный страж повторяет клиентский гейт', () => {
  const GUARD = latestDefining('erp_dev_package_guard');

  it('срабатывает ТОЛЬКО на переходе в «Готово к серии»', () => {
    // Прочие исходы пакета не требуют: незаконченная разработка и должна
    // закрываться незаконченной
    expect(GUARD).toMatch(/new\.outcome is distinct from 'ready_for_serial'/);
    expect(GUARD).toMatch(/old\.outcome is not distinct from new\.outcome/);
  });

  it('service_role пропускается — иначе починку через SQL не сделать', () => {
    expect(GUARD).toMatch(/\(select auth\.uid\(\)\) is null/);
  });

  it('спрашивает те же поля, что и клиент', () => {
    for (const field of ['pattern_tech_name', 'pattern_version', 'price_min', 'price_max']) {
      expect(GUARD).toContain(`new.${field}`);
    }
    for (const key of ['description', 'fit', 'size_row', 'fabrics', 'branding', 'modifications']) {
      expect(GUARD).toContain(`'${key}'`);
    }
    // Лекала из обязательных сняты — сторожим их отсутствие поимённо
    for (const kind of [DEV_ATTACHMENT_KINDS.passport, DEV_ATTACHMENT_KINDS.photo]) {
      expect(GUARD).toContain(`'${kind}'`);
    }
  });

  it('называет недостающее теми же словами', () => {
    // Человек читает один и тот же список — и в кнопке, и в отказе сервера
    for (const label of missingFinalPackage({ final_package: { add_to_sku: true } }, [])) {
      expect(GUARD).toContain(label);
    }
  });

  /**
   * ЛЕКАЛА СНЯТЫ И НА СЕРВЕРЕ (п. 4.5: «поле „Файл лекал или ссылка"
   * не нужно»). Оставленная на сервере проверка дала бы худший вид
   * расхождения: кнопка доступна, а действие падает 23514 — и человек
   * не поймёт, чего от него хотят, потому что в перечне этого поля уже нет.
   */
  it('лекала не проверяются: ни файлом, ни ссылкой', () => {
    /**
     * Читаем ТЕЛО функции без комментариев: объяснение, почему проверки
     * не стало, содержит те же слова, что и сама проверка, — и утверждение
     * «этого здесь нет» ловило бы объяснение. На этом приёме проект уже
     * получал два ложных падения.
     */
    const body = withoutComments(functionBody(GUARD, 'erp_dev_package_guard'));
    expect(body).not.toContain('Файл или ссылка на лекала');
    expect(body).not.toContain('pattern_link');
    expect(body).not.toContain(DEV_ATTACHMENT_KINDS.pattern);
  });

  /**
   * КАРТОЧКА SKU — ПОД ФЛАГОМ, И ИМЕННО СТРОГИМ (п. 4.6). Мягкое сравнение
   * («ключ есть» или `->> = 'true'`) разошлось бы с клиентским `=== true`
   * на строке "true" — то есть гейт кнопки и страж ответили бы по-разному
   * на одних и тех же данных.
   */
  it('поля карточки SKU уведены под флаг add_to_sku', () => {
    expect(GUARD).toMatch(/erp_pkg_flag\(v_pkg, 'add_to_sku'\)/);
    // Проверки карточки идут ВНУТРИ этой ветки, а не рядом с ней
    const branch = GUARD.slice(GUARD.indexOf("erp_pkg_flag(v_pkg, 'add_to_sku')"));
    for (const key of ['description', 'fabrics', 'modifications']) {
      expect(branch).toContain(`'${key}'`);
    }
    expect(branch).toContain('Ценовая вилка');
  });

  it('флаг сравнивается строго с jsonb true — зеркало клиентского === true', () => {
    const FLAG = latestDefining('erp_pkg_flag');
    expect(FLAG).toMatch(/= 'true'::jsonb/);
  });

  it('перечень собирается array_append, а не оператором ||', () => {
    /**
     * НАЙДЕНО НА БОЕВОЙ БАЗЕ. `v_missing || 'Техническое название лекал'`
     * не добавляет строку: у `||` есть вариант `anyarray || anyarray`, и
     * нетипизированный литерал Postgres предпочитает разобрать КАК МАССИВ.
     * Страж срабатывал — но вместо перечня полей отвечал «malformed array
     * literal», то есть человек видел отказ без единой подсказки, что делать.
     */
    expect(GUARD).toMatch(/array_append\(v_missing, '/);
    expect(GUARD).not.toMatch(/v_missing := v_missing \|\|/);
  });
});
