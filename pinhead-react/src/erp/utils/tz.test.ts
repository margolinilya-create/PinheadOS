import { describe, it, expect } from 'vitest';
import {
  currentVersion,
  currentDocuments,
  orderTzDocuments,
  itemTzDocuments,
  documentHistory,
  stageTzDocument,
  stageHasTz,
  stageMissingTz,
  deptNeedsTz,
  missingTzStages,
  missingTzMessage,
  listRu,
  validateTzAssignments,
  tzUpdatedAfterStart,
  tzFilePath,
  itemLabel,
} from './tz';
import type { ErpTzAssignment, ErpTzDocument } from '../types';

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

const asg = (
  itemId: string,
  departmentId: string,
  groupId: string,
): ErpTzAssignment => ({
  id: `a-${itemId}-${departmentId}`,
  order_id: 'o1',
  item_id: itemId,
  department_id: departmentId,
  group_id: groupId,
  assigned_by: 'Менеджер',
  created_at: '2026-07-20T10:00:00Z',
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

describe('stageTzDocument', () => {
  const order = {
    tz_documents: [
      doc({ group_id: 'g1', version: 1, is_current: false }),
      doc({ group_id: 'g1', version: 2 }),
    ],
    tz_assignments: [asg('i1', 'sewing', 'g1'), asg('i1', 'vto', 'g1')],
  };

  it('замена файла подхватывается всеми связанными цехами разом', () => {
    expect(stageTzDocument(order, 'i1', 'sewing')?.version).toBe(2);
    expect(stageTzDocument(order, 'i1', 'vto')?.version).toBe(2);
  });

  it('этап без назначения остаётся без ТЗ', () => {
    expect(stageTzDocument(order, 'i1', 'cutting')).toBeNull();
    expect(stageHasTz(order, 'i1', 'cutting')).toBe(false);
  });

  it('назначение на несуществующую группу не считается наличием ТЗ', () => {
    const broken = { tz_documents: [], tz_assignments: [asg('i1', 'sewing', 'g1')] };
    expect(stageHasTz(broken, 'i1', 'sewing')).toBe(false);
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
  const order = {
    tz_required: true,
    tz_documents: [doc({ group_id: 'g1' })],
    tz_assignments: [asg('i1', 'sewing', 'g1')],
  };

  it('производственный цех без ТЗ — этап не запускается', () => {
    expect(stageMissingTz(order, 'i1', 'cutting', dept('cutting', true))).toBe(true);
  });

  it('цех с назначенным ТЗ — не блокирует', () => {
    expect(stageMissingTz(order, 'i1', 'sewing', dept('sewing', true))).toBe(false);
  });

  it('закупка и склады ТЗ не требуют — гейт их не трогает', () => {
    expect(stageMissingTz(order, 'i1', 'supply', dept('supply', false))).toBe(false);
    expect(stageMissingTz(order, 'i1', 'wh', dept('warehouse', false))).toBe(false);
  });

  it('неизвестный цех не блокирует — остановка цеха fail-open', () => {
    expect(stageMissingTz(order, 'i1', 'cutting', undefined)).toBe(false);
    expect(stageMissingTz(order, 'i1', 'cutting', null)).toBe(false);
  });

  it('новый участок из админки сразу под гейтом, хотя кода нет в сиде', () => {
    // ОТК: заведён после внедрения, в QUEUE_DEPT_CODES его нет
    expect(stageMissingTz(order, 'i1', 'qc', dept('qc', true))).toBe(true);
  });

  it('заказ без требования ТЗ не гейтится вовсе', () => {
    const legacy = { ...order, tz_required: false };
    expect(stageMissingTz(legacy, 'i1', 'cutting', dept('cutting', true))).toBe(false);
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

describe('missingTzStages', () => {
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

  it('перечисляет этапы без ТЗ', () => {
    const order = {
      items,
      tz_required: true,
      tz_documents: [doc({ group_id: 'g1' })],
      tz_assignments: [asg('i1', 'cutting', 'g1')],
    };
    expect(missingTzStages(order, DEPTS).map((m) => m.departmentId)).toEqual(['sewing', 'vto']);
  });

  it('пропущенные этапы ТЗ не требуют', () => {
    const order = {
      items: [{ ...items[0], stages: [{ department_id: 'cutting', status: 'skipped' }] }],
      tz_required: true,
      tz_documents: [],
      tz_assignments: [],
    };
    expect(missingTzStages(order, DEPTS)).toEqual([]);
  });

  it('к заказам, заведённым до внедрения ТЗ, гейт не применяется', () => {
    const order = { items, tz_required: false, tz_documents: [], tz_assignments: [] };
    expect(missingTzStages(order, DEPTS)).toEqual([]);
  });

  it('заказ с tz_required требует ТЗ на каждом этапе маршрута', () => {
    const order = { items, tz_required: true, tz_documents: [], tz_assignments: [] };
    expect(missingTzStages(order, DEPTS)).toHaveLength(3);
  });

  it('без явного tz_required гейт не срабатывает — блокировка цеха fail-open', () => {
    const order = { items, tz_documents: [], tz_assignments: [] };
    expect(missingTzStages(order, DEPTS)).toEqual([]);
  });
});

describe('missingTzMessage', () => {
  const names = new Map([['sewing', 'Швейка'], ['vto', 'ВТО']]);

  it('группирует по позиции и называет цеха', () => {
    const missing = missingTzStages({
      items: [{ id: 'i1', product_type: 'Футболка', variant: 'Regular', stages: [
        { department_id: 'sewing' }, { department_id: 'vto' },
      ] }],
      tz_required: true,
      tz_documents: [],
      tz_assignments: [],
    }, DEPTS);
    expect(missingTzMessage(missing, names)).toBe(
      'Невозможно создать заказ: для позиции «Футболка Regular» не назначено ТЗ: Швейка и ВТО',
    );
  });

  it('без недостающих — null', () => {
    expect(missingTzMessage([], names)).toBeNull();
  });

  it('умеет другой префикс — для гейта уже созданного заказа', () => {
    const missing = [{ itemId: 'i1', itemLabel: 'Худи', departmentId: 'vto' }];
    expect(missingTzMessage(missing, names, 'Заказ не запустится')).toBe(
      'Заказ не запустится: для позиции «Худи» не назначено ТЗ: ВТО',
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

describe('validateTzAssignments (форма создания)', () => {
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

  it('полный комплект назначений проходит', () => {
    const res = validateTzAssignments(items, {
      '0:d-cut': 'g1', '0:d-sew': 'g1', '1:d-cut': 'g2',
    });
    expect(res.missing).toEqual([]);
    expect(res.message).toBeNull();
  });

  it('одно ТЗ можно назначить нескольким цехам', () => {
    const res = validateTzAssignments([items[0]], { '0:d-cut': 'g1', '0:d-sew': 'g1' });
    expect(res.message).toBeNull();
  });

  it('называет конкретную позицию и конкретные цеха', () => {
    const res = validateTzAssignments(items, { '0:d-cut': 'g1' });
    expect(res.missing).toHaveLength(2);
    expect(res.message).toBe(
      'Невозможно создать заказ: для позиции «Футболка Regular» не назначено ТЗ: Швейка; '
      + 'для позиции «Худи» не назначено ТЗ: Закрой',
    );
  });

  it('пустая строка в назначении считается отсутствием', () => {
    const res = validateTzAssignments([items[1]], { '1:d-cut': '' });
    expect(res.missing).toHaveLength(1);
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
  it('складывает путь версии внутри группы', () => {
    expect(tzFilePath('o1', 'g1', 2, 'ТЗ футболка.pdf'))
      .toBe('tz/o1/g1/v2-ТЗ футболка.pdf');
  });

  it('чистит опасные символы имени — путь не уезжает из группы', () => {
    expect(tzFilePath('new', 'g1', 1, '../../etc/passwd.pdf'))
      .toBe('tz/new/g1/v1-etc_passwd.pdf');
  });

  it('подставляет имя по умолчанию', () => {
    expect(tzFilePath('new', 'g1', 1, '')).toBe('tz/new/g1/v1-tz.pdf');
  });
});

describe('itemLabel', () => {
  it('склеивает изделие и вариант', () => {
    expect(itemLabel({ product_type: 'Футболка', variant: 'Regular' })).toBe('Футболка Regular');
    expect(itemLabel({ product_type: 'Худи', variant: null })).toBe('Худи');
    expect(itemLabel({})).toBe('Позиция');
  });
});
