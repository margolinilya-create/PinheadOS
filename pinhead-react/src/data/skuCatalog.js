// ═══════════════════════════════════════════
// SKU_CATALOG_DEFAULT — полный каталог 50 артикулов
// Цены пошива (sewingPrice) — добавить позже
// Мокапы: убраны для Олимпийки и Бомберов (нет подходящего)
// ═══════════════════════════════════════════
export const SKU_CATEGORIES = [
  { id: 'tshirts',      name: 'Футболки' },
  { id: 'longsleeves',  name: 'Лонгсливы' },
  { id: 'sweatshirts',  name: 'Свитшоты' },
  { id: 'halfzips',     name: 'Халф-зипы' },
  { id: 'hoodies',      name: 'Худи' },
  { id: 'ziphoodies',   name: 'Зип-худи' },
  { id: 'polo',         name: 'Поло / Регбийка / Олимпийка' },
  { id: 'bombers',      name: 'Бомберы' },
  { id: 'pants',        name: 'Штаны' },
  { id: 'shorts',       name: 'Шорты' },
  { id: 'accessories',  name: 'Аксессуары' },
];
export const SKU_CATALOG_DEFAULT = [
  // ── ФУТБОЛКИ ──────────────────────────────────────────
  { code: 'T-001', name: 'Футболка Classic woman',   category: 'tshirts', fit: 'classic',  sewingPrice: 0, mainFabricUsage: 1.0, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'T-002', name: 'Футболка Classic man',     category: 'tshirts', fit: 'classic',  sewingPrice: 0, mainFabricUsage: 1.0, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'T-003', name: 'Футболка Regular',         category: 'tshirts', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.0, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'T-004', name: 'Футболка Free Fit',        category: 'tshirts', fit: 'free',     sewingPrice: 0, mainFabricUsage: 1.1, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'T-005', name: 'Футболка Oversize',        category: 'tshirts', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.3, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'T-006', name: 'Футболка Oversize Cropped',category: 'tshirts', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.1, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'] },
  // ── ЛОНГСЛИВЫ ─────────────────────────────────────────
  { code: 'LS-001', name: 'Лонгслив Classic woman', category: 'longsleeves', fit: 'classic',  sewingPrice: 0, mainFabricUsage: 1.3, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'longsleeve', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'LS-002', name: 'Лонгслив Regular',       category: 'longsleeves', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.3, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'longsleeve', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'LS-003', name: 'Лонгслив Free Fit',      category: 'longsleeves', fit: 'free',     sewingPrice: 0, mainFabricUsage: 1.4, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'longsleeve', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'LS-004', name: 'Лонгслив Oversize',      category: 'longsleeves', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.5, trimCode: 'ribana-1x1', trimUsage: 0.20, mockupType: 'longsleeve', zones: ['front','back','sleeve-l','sleeve-r'] },
  // ── СВИТШОТЫ ──────────────────────────────────────────
  { code: 'SW-001', name: 'Свитшот Classic',  category: 'sweatshirts', fit: 'classic',  sewingPrice: 0, mainFabricUsage: 1.4, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'sweat', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'SW-002', name: 'Свитшот Regular',  category: 'sweatshirts', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.4, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'sweat', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'SW-003', name: 'Свитшот Free Fit', category: 'sweatshirts', fit: 'free',     sewingPrice: 0, mainFabricUsage: 1.5, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'sweat', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'SW-004', name: 'Свитшот Oversize', category: 'sweatshirts', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.6, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'sweat', zones: ['front','back','sleeve-l','sleeve-r'] },
  // ── ХАЛФ-ЗИПЫ ─────────────────────────────────────────
  { code: 'HZ-001', name: 'Свитшот-халф-зип Regular',             category: 'halfzips', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.4, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'HZ-002', name: 'Свитшот-халф-зип Regular без пояса',   category: 'halfzips', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.3, trimCode: 'kashkorse', trimUsage: 0.18, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'HZ-003', name: 'Свитшот-халф-зип Free Fit',            category: 'halfzips', fit: 'free',     sewingPrice: 0, mainFabricUsage: 1.5, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'HZ-004', name: 'Свитшот-халф-зип Free Fit без пояса',  category: 'halfzips', fit: 'free',     sewingPrice: 0, mainFabricUsage: 1.4, trimCode: 'kashkorse', trimUsage: 0.18, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'HZ-005', name: 'Свитшот-халф-зип Oversize',            category: 'halfzips', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.6, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'HZ-006', name: 'Свитшот-халф-зип Oversize без пояса',  category: 'halfzips', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.5, trimCode: 'kashkorse', trimUsage: 0.20, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'] },
  // ── ХУДИ ──────────────────────────────────────────────
  { code: 'H-001', name: 'Худи Classic',  category: 'hoodies', fit: 'classic',  sewingPrice: 0, mainFabricUsage: 1.6, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'] },
  { code: 'H-002', name: 'Худи Regular',  category: 'hoodies', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.6, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'] },
  { code: 'H-003', name: 'Худи Free Fit', category: 'hoodies', fit: 'free',     sewingPrice: 0, mainFabricUsage: 1.7, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'] },
  { code: 'H-004', name: 'Худи Oversize', category: 'hoodies', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.8, trimCode: 'kashkorse', trimUsage: 0.30, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'] },
  { code: 'H-005', name: 'Худи Reglan',   category: 'hoodies', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.6, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'] },
  // ── ЗИП-ХУДИ ──────────────────────────────────────────
  { code: 'ZH-001', name: 'Худи-зип Regular',                    category: 'ziphoodies', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.7, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'] },
  { code: 'ZH-002', name: 'Худи-зип Free Fit',                   category: 'ziphoodies', fit: 'free',     sewingPrice: 0, mainFabricUsage: 1.8, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'] },
  { code: 'ZH-003', name: 'Худи-зип Oversize',                   category: 'ziphoodies', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.9, trimCode: 'kashkorse', trimUsage: 0.30, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'] },
  { code: 'ZH-004', name: 'Худи-зип Regular с капюшоном стойкой', category: 'ziphoodies', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.7, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'ZH-005', name: 'Худи-зип Free Fit с капюшоном стойкой',category: 'ziphoodies', fit: 'free',     sewingPrice: 0, mainFabricUsage: 1.8, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'ZH-006', name: 'Худи-зип Oversize с капюшоном стойкой',category: 'ziphoodies', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.9, trimCode: 'kashkorse', trimUsage: 0.30, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r'] },
  // ── ПОЛО / РЕГБИЙКА / ОЛИМПИЙКА ───────────────────────
  { code: 'PL-001', name: 'Поло Regular',      category: 'polo', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.0, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'polo',        zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'PL-002', name: 'Поло Oversize',     category: 'polo', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.2, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'polo',        zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'RG-001', name: 'Регбийка Regular',  category: 'polo', fit: 'regular',  sewingPrice: 0, mainFabricUsage: 1.2, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'longsleeve',  zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'RG-002', name: 'Регбийка Oversize', category: 'polo', fit: 'oversize', sewingPrice: 0, mainFabricUsage: 1.4, trimCode: 'ribana-1x1', trimUsage: 0.20, mockupType: 'longsleeve',  zones: ['front','back','sleeve-l','sleeve-r'] },
  // Олимпийка — мокап убран (нет подходящего силуэта)
  { code: 'OL-001', name: 'Олимпийка Free Fit', category: 'polo', fit: 'free',    sewingPrice: 0, mainFabricUsage: 1.5, trimCode: 'kashkorse',  trimUsage: 0.22, mockupType: null,           zones: ['front','back','sleeve-l','sleeve-r'] },
  // ── БОМБЕРЫ ───────────────────────────────────────────
  // Мокап убран (нет подходящего силуэта)
  { code: 'BM-001', name: 'Бомбер-basic на кнопках', category: 'bombers', fit: 'regular', sewingPrice: 0, mainFabricUsage: 1.6, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: null, zones: ['front','back','sleeve-l','sleeve-r'] },
  { code: 'BM-002', name: 'Бомбер-zipped на молнии', category: 'bombers', fit: 'regular', sewingPrice: 0, mainFabricUsage: 1.6, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: null, zones: ['front','back','sleeve-l','sleeve-r'] },
  // ── ШТАНЫ ─────────────────────────────────────────────
  { code: 'P-001', name: 'Штаны Regular woman',          category: 'pants', fit: 'regular', sewingPrice: 0, mainFabricUsage: 1.4, trimCode: 'kashkorse', trimUsage: 0.15, mockupType: 'pants', zones: ['front','back'] },
  { code: 'P-002', name: 'Штаны-отрезные Regular woman', category: 'pants', fit: 'regular', sewingPrice: 0, mainFabricUsage: 1.3, trimCode: 'kashkorse', trimUsage: 0.12, mockupType: 'pants', zones: ['front','back'] },
  { code: 'P-003', name: 'Штаны Regular man',            category: 'pants', fit: 'regular', sewingPrice: 0, mainFabricUsage: 1.4, trimCode: 'kashkorse', trimUsage: 0.15, mockupType: 'pants', zones: ['front','back'] },
  { code: 'P-004', name: 'Штаны-отрезные Regular man',   category: 'pants', fit: 'regular', sewingPrice: 0, mainFabricUsage: 1.3, trimCode: 'kashkorse', trimUsage: 0.12, mockupType: 'pants', zones: ['front','back'] },
  { code: 'P-005', name: 'Штаны Free Fit man',           category: 'pants', fit: 'free',    sewingPrice: 0, mainFabricUsage: 1.6, trimCode: 'kashkorse', trimUsage: 0.18, mockupType: 'pants', zones: ['front','back'] },
  { code: 'P-006', name: 'Штаны-отрезные Free Fit man',  category: 'pants', fit: 'free',    sewingPrice: 0, mainFabricUsage: 1.5, trimCode: 'kashkorse', trimUsage: 0.15, mockupType: 'pants', zones: ['front','back'] },
  // ── ШОРТЫ ─────────────────────────────────────────────
  { code: 'SH-001', name: 'Шорты man',   category: 'shorts', fit: 'regular', sewingPrice: 0, mainFabricUsage: 0.9, trimCode: 'kashkorse', trimUsage: 0.12, mockupType: 'shorts', zones: ['front','back'] },
  { code: 'SH-002', name: 'Шорты woman', category: 'shorts', fit: 'regular', sewingPrice: 0, mainFabricUsage: 0.8, trimCode: 'kashkorse', trimUsage: 0.10, mockupType: 'shorts', zones: ['front','back'] },
  // ── ШОППЕРЫ ───────────────────────────────────────────
  { code: 'BAG-001', name: 'Шоппер Classic Bag',     category: 'accessories', fit: null, sewingPrice: 0, mainFabricUsage: 0.6, trimCode: null, trimUsage: 0, mockupType: 'shopper', zones: ['front','back'] },
  { code: 'BAG-002', name: 'Шоппер Composite bag',   category: 'accessories', fit: null, sewingPrice: 0, mainFabricUsage: 0.7, trimCode: null, trimUsage: 0, mockupType: 'shopper', zones: ['front','back'] },
  { code: 'BAG-003', name: 'Шоппер Contraction bag', category: 'accessories', fit: null, sewingPrice: 0, mainFabricUsage: 0.6, trimCode: null, trimUsage: 0, mockupType: 'shopper', zones: ['front','back'] },
  { code: 'BAG-004', name: 'Шоппер Horizontal bag',  category: 'accessories', fit: null, sewingPrice: 0, mainFabricUsage: 0.7, trimCode: null, trimUsage: 0, mockupType: 'shopper', zones: ['front','back'] },
];
