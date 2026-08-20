import { describe, expect, it } from 'vitest';
import { latestDefining } from './migrations.testutil';
import {
  DEV_ATTACHMENT_KINDS,
  devAttachments,
  finalPackageProgress,
  isFinalPackageReady,
  missingFinalPackage,
} from './finalPackage';

/**
 * Финальный технический пакет: гейт кнопки и серверный страж — ОДНО правило.
 *
 * Проверяется две вещи: что перечень недостающего верен, и что страж
 * `erp_dev_package_guard` спрашивает ровно то же. Расхождение половин даёт
 * либо «кнопка есть, действие падает», либо дыру — в этом проекте случалось
 * и то, и другое.
 */

const FULL = {
  pattern_tech_name: 'PH-HOODIE-01',
  pattern_version: 'v1.2',
  price_min: 1200,
  price_max: 1800,
  final_package: {
    description: 'Худи оверсайз',
    fit: 'oversize',
    size_row: 'XS–3XL',
    fabrics: ['Футер 320'],
    branding: ['DTF'],
    modifications: ['Длина рукава'],
  },
};

const FILES = [
  { kind: DEV_ATTACHMENT_KINDS.pattern },
  { kind: DEV_ATTACHMENT_KINDS.passport },
  { kind: DEV_ATTACHMENT_KINDS.photo },
];

describe('чего не хватает для «Готово к серии»', () => {
  it('полный пакет — пусто', () => {
    expect(missingFinalPackage(FULL, FILES)).toEqual([]);
    expect(isFinalPackageReady(FULL, FILES)).toBe(true);
  });

  it('пустая разработка перечисляет ВСЁ, а не первое попавшееся', () => {
    // Документ: «система должна показать, какие поля ещё не заполнены» —
    // множественное число здесь существенно, иначе человек ходит по кругу
    const missing = missingFinalPackage({}, []);
    expect(missing).toContain('Техническое название лекал');
    expect(missing).toContain('Технический паспорт');
    expect(missing).toContain('Фото образца');
    expect(missing).toContain('Доступные ткани');
    expect(missing).toContain('Ценовая вилка');
    expect(missing.length).toBeGreaterThan(10);
  });

  it('ссылка на лекала заменяет файл — документ допускает оба варианта', () => {
    const dev = { ...FULL, final_package: { ...FULL.final_package, pattern_link: 'https://d/1' } };
    const files = FILES.filter((f) => f.kind !== DEV_ATTACHMENT_KINDS.pattern);
    expect(missingFinalPackage(dev, files)).toEqual([]);
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

  it('прогресс считается той же функцией — второй константы нет', () => {
    expect(finalPackageProgress(FULL, FILES)).toEqual({ done: 12, total: 12 });
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
    for (const kind of Object.values(DEV_ATTACHMENT_KINDS)) {
      expect(GUARD).toContain(`'${kind}'`);
    }
  });

  it('называет недостающее теми же словами', () => {
    // Человек читает один и тот же список — и в кнопке, и в отказе сервера
    for (const label of missingFinalPackage({}, [])) {
      expect(GUARD).toContain(label);
    }
  });

  it('ссылка на лекала — альтернатива файлу и на сервере', () => {
    expect(GUARD).toMatch(/'pattern_link'/);
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
