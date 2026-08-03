import { describe, it, expect } from 'vitest';
import {
  currentVersion,
  currentDocuments,
  orderTzDocuments,
  itemTzDocuments,
  documentHistory,
  itemTzDocument,
  itemHasTz,
  stageMissingTz,
  deptNeedsTz,
  missingTzItems,
  missingTzMessage,
  listRu,
  validateTzDocs,
  tzUpdatedAfterStart,
  tzFilePath,
  itemLabel,
} from './tz';
import type { ErpTzDocument } from '../types';

const doc = (over: Partial<ErpTzDocument> & Pick<ErpTzDocument, 'group_id'>): ErpTzDocument => ({
  id: `d-${over.group_id}-${over.version ?? 1}`,
  order_id: 'o1',
  item_id: null,
  version: 1,
  is_current: true,
  file_path: 'tz/o1/g/v1-tz.pdf',
  file_name: 'tz.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1024,
  note: null,
  uploaded_by: 'Менеджер',
  created_at: '2026-07-20T10:00:00Z',
  ...over,
});

describe('currentVersion', () => {
  it('берёт версию с is_current, а не последнюю по номеру', () => {
    const docs = [
      doc({ group_id: 'g1', version: 1, is_current: false }),
      doc({ group_id: 'g1', version: 2, is_current: true }),
      doc({ group_id: 'g2', version: 1 }),
    ];
    expect(currentVersion(docs, 'g1')?.version).toBe(2);
  });

  it('падает обратно на старшую версию, если is_current нигде не стоит', () => {
    const docs = [
      doc({ group_id: 'g1', version: 1, is_current: false }),
      doc({ group_id: 'g1', version: 3, is_current: false }),
      doc({ group_id: 'g1', version: 2, is_current: false }),
    ];
    expect(currentVersion(docs, 'g1')?.version).toBe(3);
  });

  it('возвращает null для неизвестной группы', () => {
    expect(currentVersion([doc({ group_id: 'g1' })], 'нет')).toBeNull();
    expect(currentVersion(null, 'g1')).toBeNull();
  });
});

describe('currentDocuments / orderTzDocuments / itemTzDocuments', () => {
  const order = {
    tz_documents: [
      doc({ group_id: 'general', version: 1, is_current: false, created_at: '2026-07-20T09:00:00Z' }),
      doc({ group_id: 'general', version: 2, created_at: '2026-07-21T09:00:00Z' }),
      doc({ group_id: 'cut', item_id: 'i1', created_at: '2026-07-20T11:00:00Z' }),
      doc({ group_id: 'other', item_id: 'i2', created_at: '2026-07-20T12:00:00Z' }),
    ],
  };

  it('оставляет по одной актуальной версии на группу', () => {
    const cur = currentDocuments(order);
    expect(cur).toHaveLength(3);
    expect(cur.find((d) => d.group_id === 'general')?.version).toBe(2);
  });

  it('общее ТЗ заказа — документы без позиции', () => {
    expect(orderTzDocuments(order).map((d) => d.group_id)).toEqual(['general']);
  });

  it('позиции доступны её файлы и общее ТЗ заказа, но не файлы чужой позиции', () => {
    expect(itemTzDocuments(order, 'i1').map((d) => d.group_id).sort())
      .toEqual(['cut', 'general']);
    expect(itemTzDocuments(order, 'i2').map((d) => d.group_id).sort())
      .toEqual(['general', 'other']);
  });

  it('история группы — новые версии сверху', () => {
    expect(documentHistory(order, 'general').map((d) => d.version)).toEqual([2, 1]);
  });
});

describe('itemTzDocument — одно ТЗ на весь маршрут позиции', () => {
  it('замена файла подхватывается сразу: резолюция берёт актуальную версию', () => {
    const order = {
      tz_documents: [
        doc({ group_id: 'g1', item_id: 'i1', version: 1, is_current: false }),
        doc({ group_id: 'g1', item_id: 'i1', version: 2 }),
      ],
    };
    expect(itemTzDocument(order, 'i1')?.version).toBe(2);
  });

  it('позиция без своего ТЗ работает по общему ТЗ заказа', () => {
    const order = { tz_documents: [doc({ group_id: 'general', item_id: null })] };
    expect(itemTzDocument(order, 'i1')?.group_id).toBe('general');
    expect(itemHasTz(order, 'i1')).toBe(true);
  });

  it('своё ТЗ позиции важнее общего', () => {
    const order = {
      tz_documents: [
        doc({ group_id: 'general', item_id: null, created_at: '2026-07-20T09:00:00Z' }),
        doc({ group_id: 'own', item_id: 'i1', created_at: '2026-07-20T10:00:00Z' }),
      ],
    };
    expect(itemTzDocument(order, 'i1')?.group_id).toBe('own');
    // ...а у соседней позиции своего нет — она читает общее
    expect(itemTzDocument(order, 'i2')?.group_id).toBe('general');
  });

  it('ТЗ чужой позиции своей не считается', () => {
    const order = { tz_documents: [doc({ group_id: 'own', item_id: 'i2' })] };
    expect(itemTzDocument(order, 'i1')).toBeNull();
    expect(itemHasTz(order, 'i1')).toBe(false);
  });

  it('заказ без документов — ТЗ нет', () => {
    expect(itemHasTz({ tz_documents: [] }, 'i1')).toBe(false);
    expect(itemHasTz({}, 'i1')).toBe(false);
  });
});

/**
 * В фикстурах id цеха совпадает с кодом. Признак производственного участка теперь
 * приходит строкой цеха (`is_production`), а не выводится из кода.
 */
const dept = (code: string, isProduction: boolean) => ({ code, is_production: isProduction });
const DEPTS = new Map([
  ['cutting', dept('cutting', true)],
  ['sewing', dept('sewing', true)],
  ['vto', dept('vto', true)],
  ['supply', dept('supply', false)],
]);

describe('stageMissingTz — гейт запуска этапа', () => {
  /** ТЗ загружено на позицию i1; у позиции i2 своего нет и общего тоже */
  const order = {
    tz_required: true,
    tz_documents: [doc({ group_id: 'g1', item_id: 'i1' })],
  };

  it('позиция без ТЗ — этап производственного цеха не запускается', () => {
    expect(stageMissingTz(order, 'i2', dept('cutting', true))).toBe(true);
  });

  it('одно ТЗ позиции открывает ВСЕ цеха её маршрута', () => {
    expect(stageMissingTz(order, 'i1', dept('cutting', true))).toBe(false);
    expect(stageMissingTz(order, 'i1', dept('sewing', true))).toBe(false);
    expect(stageMissingTz(order, 'i1', dept('vto', true))).toBe(false);
    expect(stageMissingTz(order, 'i1', dept('qc', true))).toBe(false);
  });

  it('закупка и склады ТЗ не требуют — гейт их не трогает', () => {
    expect(stageMissingTz(order, 'i2', dept('supply', false))).toBe(false);
    expect(stageMissingTz(order, 'i2', dept('warehouse', false))).toBe(false);
  });

  it('неизвестный цех не блокирует — остановка цеха fail-open', () => {
    expect(stageMissingTz(order, 'i2', undefined)).toBe(false);
    expect(stageMissingTz(order, 'i2', null)).toBe(false);
  });

  it('новый участок из админки сразу под гейтом, хотя кода нет в сиде', () => {
    // ОТК: заведён после внедрения, в QUEUE_DEPT_CODES его нет
    expect(stageMissingTz(order, 'i2', dept('qc', true))).toBe(true);
  });

  it('заказ без требования ТЗ не гейтится вовсе', () => {
    const legacy = { ...order, tz_required: false };
    expect(stageMissingTz(legacy, 'i2', dept('cutting', true))).toBe(false);
  });

  it('deptNeedsTz — по признаку из БД, с откатом на код при его отсутствии', () => {
    expect(deptNeedsTz(dept('cutting', true))).toBe(true);
    expect(deptNeedsTz(dept('supply', false))).toBe(false);
    // Строка без is_production (старый кэш) — падаем на сид-набор кодов
    expect(deptNeedsTz({ code: 'sewing' })).toBe(true);
    expect(deptNeedsTz({ code: 'supply' })).toBe(false);
    expect(deptNeedsTz(null)).toBe(false);
  });
});

describe('missingTzItems', () => {
  const items = [
    {
      id: 'i1',
      product_type: 'Футболка',
      variant: 'Regular',
      stages: [
        { department_id: 'cutting' },
        { department_id: 'sewing' },
        { department_id: 'vto' },
      ],
    },
  ];

  it('одного файла на позицию хватает всему маршруту', () => {
    const order = {
      items,
      tz_required: true,
      tz_documents: [doc({ group_id: 'g1', item_id: 'i1' })],
    };
    expect(missingTzItems(order, DEPTS)).toEqual([]);
  });

  it('называет позицию, у которой ТЗ нет', () => {
    const order = { items, tz_required: true, tz_documents: [] };
    expect(missingTzItems(order, DEPTS)).toEqual([
      { itemId: 'i1', itemLabel: 'Футболка Regular' },
    ]);
  });

  it('общее ТЗ заказа закрывает позицию без своего файла', () => {
    const order = {
      items,
      tz_required: true,
      tz_documents: [doc({ group_id: 'general', item_id: null })],
    };
    expect(missingTzItems(order, DEPTS)).toEqual([]);
  });

  it('пропущенные этапы ТЗ не требуют', () => {
    const order = {
      items: [{ ...items[0], stages: [{ department_id: 'cutting', status: 'skipped' }] }],
      tz_required: true,
      tz_documents: [],
    };
    expect(missingTzItems(order, DEPTS)).toEqual([]);
  });

  it('позиция без производственных цехов (подряд) в гейт не попадает', () => {
    const order = {
      items: [{ ...items[0], stages: [{ department_id: 'supply' }] }],
      tz_required: true,
      tz_documents: [],
    };
    expect(missingTzItems(order, DEPTS)).toEqual([]);
  });

  it('к заказам, заведённым до внедрения ТЗ, гейт не применяется', () => {
    const order = { items, tz_required: false, tz_documents: [] };
    expect(missingTzItems(order, DEPTS)).toEqual([]);
  });

  it('без явного tz_required гейт не срабатывает — блокировка цеха fail-open', () => {
    expect(missingTzItems({ items, tz_documents: [] }, DEPTS)).toEqual([]);
  });
});

describe('missingTzMessage', () => {
  it('называет позиции без ТЗ', () => {
    const missing = missingTzItems({
      items: [
        { id: 'i1', product_type: 'Футболка', variant: 'Regular', stages: [{ department_id: 'sewing' }] },
        { id: 'i2', product_type: 'Худи', stages: [{ department_id: 'vto' }] },
      ],
      tz_required: true,
      tz_documents: [],
    }, DEPTS);
    expect(missingTzMessage(missing)).toBe(
      'Невозможно создать заказ: не загружено ТЗ для позиций «Футболка Regular» и «Худи»',
    );
  });

  it('одна позиция — единственное число', () => {
    expect(missingTzMessage([{ itemId: 'i1', itemLabel: 'Худи' }])).toBe(
      'Невозможно создать заказ: не загружено ТЗ для позиции «Худи»',
    );
  });

  it('без недостающих — null', () => {
    expect(missingTzMessage([])).toBeNull();
  });

  it('умеет другой префикс — для гейта уже созданного заказа', () => {
    expect(missingTzMessage([{ itemId: 'i1', itemLabel: 'Худи' }], 'Заказ не запустится')).toBe(
      'Заказ не запустится: не загружено ТЗ для позиции «Худи»',
    );
  });
});

describe('listRu', () => {
  it('перечисляет по-русски', () => {
    expect(listRu([])).toBe('');
    expect(listRu(['Швейка'])).toBe('Швейка');
    expect(listRu(['Швейка', 'ОТК'])).toBe('Швейка и ОТК');
    expect(listRu(['Закрой', 'Швейка', 'ОТК'])).toBe('Закрой, Швейка и ОТК');
  });
});

describe('validateTzDocs (форма создания)', () => {
  const items = [
    {
      index: 0,
      label: 'Футболка Regular',
      stages: [
        { departmentId: 'd-cut', departmentName: 'Закрой' },
        { departmentId: 'd-sew', departmentName: 'Швейка' },
      ],
    },
    {
      index: 1,
      label: 'Худи',
      stages: [{ departmentId: 'd-cut', departmentName: 'Закрой' }],
    },
  ];

  it('по файлу на позицию — комплект собран', () => {
    const res = validateTzDocs(items, [
      { itemIndex: 0, uploaded: true },
      { itemIndex: 1, uploaded: true },
    ]);
    expect(res.missing).toEqual([]);
    expect(res.message).toBeNull();
  });

  it('одно общее ТЗ заказа закрывает все позиции', () => {
    const res = validateTzDocs(items, [{ itemIndex: null, uploaded: true }]);
    expect(res.message).toBeNull();
  });

  it('называет позиции без ТЗ', () => {
    const res = validateTzDocs(items, [{ itemIndex: 0, uploaded: true }]);
    expect(res.missing).toEqual([{ index: 1, label: 'Худи' }]);
    expect(res.message).toBe(
      'Невозможно создать заказ: не загружено ТЗ для позиции «Худи»',
    );
  });

  /**
   * Незагруженный файл ТЗ не считается: раньше загрузка шла в сабмите, и форма
   * пускала «Создать заказ» с файлом, которого в бакете не было, — заказ падал
   * на первой же ошибке Storage.
   */
  it('файл, который ещё грузится или упал, комплект не закрывает', () => {
    expect(validateTzDocs([items[1]], [{ itemIndex: 1, uploaded: false }]).missing)
      .toHaveLength(1);
    expect(validateTzDocs([items[1]], [{ itemIndex: null, uploaded: false }]).missing)
      .toHaveLength(1);
  });

  it('позиция без производственных цехов ТЗ не требует', () => {
    const res = validateTzDocs([{ index: 0, label: 'Подряд', stages: [] }], []);
    expect(res.missing).toEqual([]);
  });
});

describe('tzUpdatedAfterStart', () => {
  const stage = { started_at: '2026-07-20T12:00:00Z' };

  it('первая версия обновлением не считается', () => {
    expect(tzUpdatedAfterStart(doc({ group_id: 'g', version: 1 }), stage)).toBe(false);
  });

  it('новая версия после старта — предупреждаем цех', () => {
    const d = doc({ group_id: 'g', version: 2, created_at: '2026-07-20T15:00:00Z' });
    expect(tzUpdatedAfterStart(d, stage)).toBe(true);
  });

  it('версия, загруженная до старта, цеху уже известна', () => {
    const d = doc({ group_id: 'g', version: 2, created_at: '2026-07-20T09:00:00Z' });
    expect(tzUpdatedAfterStart(d, stage)).toBe(false);
  });

  it('этап ещё не начат — предупреждать не о чем', () => {
    const d = doc({ group_id: 'g', version: 2, created_at: '2026-07-20T15:00:00Z' });
    expect(tzUpdatedAfterStart(d, { started_at: null })).toBe(false);
    expect(tzUpdatedAfterStart(d, null)).toBe(false);
    expect(tzUpdatedAfterStart(null, stage)).toBe(false);
  });
});

describe('tzFilePath', () => {
  /**
   * Ключ обязан быть строго ASCII. Supabase Storage проверяет его регуляркой
   * S3-safe символов, где `\w` объявлен без флага `u`, и на кириллицу отвечает
   * `InvalidKey`. Прежняя версия функции кириллицу СОХРАНЯЛА, и ни одно ТЗ
   * не загрузилось ни разу — в бакете не было ни одного объекта `tz/`.
   */
  const ASCII_KEY = /^[\w/.-]+$/;

  it('складывает путь версии внутри группы, транслитерируя имя', () => {
    expect(tzFilePath('o1', 'g1', 2, 'ТЗ футболка.pdf'))
      .toBe('tz/o1/g1/v2-TZ_futbolka.pdf');
  });

  it('имя из отчёта менеджера даёт валидный ключ', () => {
    const path = tzFilePath('new', 'g1', 1, 'ТЗ[59746] Футболки Regular для склада_норм.pdf');
    expect(path).toBe('tz/new/g1/v1-TZ_59746_Futbolki_Regular_dlya_sklada_norm.pdf');
    expect(path).toMatch(ASCII_KEY);
  });

  it('имя целиком из кириллицы не теряет расширение', () => {
    expect(tzFilePath('o1', 'g1', 1, 'Задание.pdf')).toBe('tz/o1/g1/v1-Zadanie.pdf');
  });

  it('имя из непереводимых символов не съедает расширение', () => {
    expect(tzFilePath('o1', 'g1', 1, '文件.pdf')).toBe('tz/o1/g1/v1-tz.pdf');
  });

  it('чистит опасные символы имени — путь не уезжает из группы', () => {
    expect(tzFilePath('new', 'g1', 1, '../../etc/passwd.pdf'))
      .toBe('tz/new/g1/v1-etc_passwd.pdf');
  });

  it('подставляет имя по умолчанию', () => {
    expect(tzFilePath('new', 'g1', 1, '')).toBe('tz/new/g1/v1-tz.pdf');
  });

  it('любое имя даёт ASCII-ключ', () => {
    const names = [
      'ТЗ.pdf', 'Ёлка №5 (2).pdf', 'футболка — чёрная.pdf', 'ЩУКА_ЪЫЬ.pdf',
      'a'.repeat(300) + '.pdf', 'без расширения', '.pdf', '文件.pdf',
    ];
    for (const name of names) {
      expect(tzFilePath('o1', 'g1', 1, name)).toMatch(ASCII_KEY);
    }
  });
});

describe('itemLabel', () => {
  it('склеивает изделие и вариант', () => {
    expect(itemLabel({ product_type: 'Футболка', variant: 'Regular' })).toBe('Футболка Regular');
    expect(itemLabel({ product_type: 'Худи', variant: null })).toBe('Худи');
    expect(itemLabel({})).toBe('Позиция');
  });
});
