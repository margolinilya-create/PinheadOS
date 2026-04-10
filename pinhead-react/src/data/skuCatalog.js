// ═══════════════════════════════════════════
// SKU_CATALOG_DEFAULT — полный каталог 50 артикулов
// Цены пошива (sewingPrice) — реальные данные из Админской
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

// ── Size charts ─────────────────────────────────────────────
const SIZE_CHART_TEE = {
  headers: ['Размер', 'Длина', 'Ширина', 'Рукав'],
  rows: [
    ['S',   '68', '48', '19'],
    ['M',   '72', '52', '20'],
    ['L',   '74', '54', '21'],
    ['XL',  '76', '56', '22'],
    ['2XL', '78', '58', '23'],
  ],
};

const SIZE_CHART_LONGSLEEVE = {
  headers: ['Размер', 'Длина', 'Ширина', 'Рукав'],
  rows: [
    ['S',   '68', '48', '60'],
    ['M',   '72', '52', '62'],
    ['L',   '74', '54', '63'],
    ['XL',  '76', '56', '64'],
    ['2XL', '78', '58', '65'],
  ],
};

const SIZE_CHART_SWEAT = {
  headers: ['Размер', 'Длина', 'Ширина', 'Рукав'],
  rows: [
    ['S',   '66', '54', '60'],
    ['M',   '69', '57', '62'],
    ['L',   '72', '60', '63'],
    ['XL',  '74', '63', '64'],
    ['2XL', '76', '66', '65'],
  ],
};

const SIZE_CHART_HOODIE = {
  headers: ['Размер', 'Длина', 'Ширина', 'Рукав'],
  rows: [
    ['S',   '67', '55', '60'],
    ['M',   '70', '58', '62'],
    ['L',   '73', '61', '63'],
    ['XL',  '75', '64', '64'],
    ['2XL', '77', '67', '65'],
  ],
};

const SIZE_CHART_PANTS = {
  headers: ['Размер', 'Длина', 'Талия', 'Бёдра'],
  rows: [
    ['S',   '100', '68', '96'],
    ['M',   '102', '74', '102'],
    ['L',   '104', '80', '108'],
    ['XL',  '106', '86', '114'],
    ['2XL', '108', '92', '120'],
  ],
};

const SIZE_CHART_SHORTS = {
  headers: ['Размер', 'Длина', 'Талия', 'Бёдра'],
  rows: [
    ['S',   '48', '68', '96'],
    ['M',   '50', '74', '102'],
    ['L',   '52', '80', '108'],
    ['XL',  '54', '86', '114'],
    ['2XL', '56', '92', '120'],
  ],
};

const SIZE_CHART_POLO = {
  headers: ['Размер', 'Длина', 'Ширина', 'Рукав'],
  rows: [
    ['S',   '69', '49', '20'],
    ['M',   '72', '52', '21'],
    ['L',   '74', '55', '22'],
    ['XL',  '76', '58', '23'],
    ['2XL', '78', '61', '24'],
  ],
};

const SIZE_CHART_BOMBER = {
  headers: ['Размер', 'Длина', 'Ширина', 'Рукав'],
  rows: [
    ['S',   '64', '54', '62'],
    ['M',   '67', '57', '64'],
    ['L',   '70', '60', '65'],
    ['XL',  '72', '63', '66'],
    ['2XL', '74', '66', '67'],
  ],
};

export const SKU_CATALOG_DEFAULT = [
  // ── ФУТБОЛКИ ──────────────────────────────────────────
  { code: 'T-001', name: 'Футболка Classic woman',   category: 'tshirts', fit: 'classic',  sewingPrice: 141, mainFabricUsage: 0.95, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'], description: 'Классический женский крой, хлопок 240 г/м², рибана 1×1 на вороте', photoUrl: null, sizeChart: SIZE_CHART_TEE },
  { code: 'T-002', name: 'Футболка Classic man',     category: 'tshirts', fit: 'classic',  sewingPrice: 141, mainFabricUsage: 0.90, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'], description: 'Классический мужской крой, хлопок 240 г/м², рибана 1×1 на вороте', photoUrl: null, sizeChart: SIZE_CHART_TEE },
  { code: 'T-003', name: 'Футболка Regular',         category: 'tshirts', fit: 'regular',  sewingPrice: 141, mainFabricUsage: 0.91, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'], description: 'Прямой крой, хлопок 240 г/м², рибана 1×1 на вороте', photoUrl: null, sizeChart: SIZE_CHART_TEE },
  { code: 'T-004', name: 'Футболка Free Fit',        category: 'tshirts', fit: 'free',     sewingPrice: 141, mainFabricUsage: 1.08, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'], description: 'Свободный крой, хлопок 240 г/м², рибана 1×1 на вороте', photoUrl: null, sizeChart: SIZE_CHART_TEE },
  { code: 'T-005', name: 'Футболка Oversize',        category: 'tshirts', fit: 'oversize', sewingPrice: 143, mainFabricUsage: 1.13, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'], description: 'Oversized крой, хлопок 240 г/м², рибана 1×1 на вороте, спущенное плечо', photoUrl: null, sizeChart: SIZE_CHART_TEE },
  { code: 'T-006', name: 'Футболка Oversize Cropped',category: 'tshirts', fit: 'oversize', sewingPrice: 141, mainFabricUsage: 1.00, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'tee',        zones: ['front','back','sleeve-l','sleeve-r'], description: 'Укороченный oversized крой, хлопок 240 г/м², рибана 1×1 на вороте', photoUrl: null, sizeChart: SIZE_CHART_TEE },
  // ── ЛОНГСЛИВЫ ─────────────────────────────────────────
  { code: 'LS-001', name: 'Лонгслив Classic woman', category: 'longsleeves', fit: 'classic',  sewingPrice: 146, mainFabricUsage: 1.40, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'longsleeve', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Классический женский крой с длинным рукавом, манжеты рибана', photoUrl: null, sizeChart: SIZE_CHART_LONGSLEEVE },
  { code: 'LS-002', name: 'Лонгслив Regular',       category: 'longsleeves', fit: 'regular',  sewingPrice: 146, mainFabricUsage: 1.40, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'longsleeve', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Прямой крой с длинным рукавом, манжеты рибана', photoUrl: null, sizeChart: SIZE_CHART_LONGSLEEVE },
  { code: 'LS-003', name: 'Лонгслив Free Fit',      category: 'longsleeves', fit: 'free',     sewingPrice: 146, mainFabricUsage: 1.70, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'longsleeve', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Свободный крой с длинным рукавом, манжеты рибана', photoUrl: null, sizeChart: SIZE_CHART_LONGSLEEVE },
  { code: 'LS-004', name: 'Лонгслив Oversize',      category: 'longsleeves', fit: 'oversize', sewingPrice: 146, mainFabricUsage: 1.70, trimCode: 'ribana-1x1', trimUsage: 0.20, mockupType: 'longsleeve', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Oversized крой с длинным рукавом, спущенное плечо, манжеты рибана', photoUrl: null, sizeChart: SIZE_CHART_LONGSLEEVE },
  // ── СВИТШОТЫ ──────────────────────────────────────────
  { code: 'SW-001', name: 'Свитшот Classic',  category: 'sweatshirts', fit: 'classic',  sewingPrice: 156, mainFabricUsage: 0.90, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'sweat', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Классический крой, начёс, рибана на вороте и манжетах', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  { code: 'SW-002', name: 'Свитшот Regular',  category: 'sweatshirts', fit: 'regular',  sewingPrice: 156, mainFabricUsage: 0.90, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'sweat', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Прямой крой, начёс, рибана на вороте и манжетах', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  { code: 'SW-003', name: 'Свитшот Free Fit', category: 'sweatshirts', fit: 'free',     sewingPrice: 156, mainFabricUsage: 1.00, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'sweat', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Свободный крой, начёс, рибана на вороте и манжетах', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  { code: 'SW-004', name: 'Свитшот Oversize', category: 'sweatshirts', fit: 'oversize', sewingPrice: 156, mainFabricUsage: 1.10, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'sweat', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Oversized крой, начёс, спущенное плечо, рибана на вороте и манжетах', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  // ── ХАЛФ-ЗИПЫ ─────────────────────────────────────────
  { code: 'HZ-001', name: 'Свитшот-халф-зип Regular',             category: 'halfzips', fit: 'regular',  sewingPrice: 350, mainFabricUsage: 1.40, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Молния до груди, прямой крой, рибана на манжетах и поясе', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  { code: 'HZ-002', name: 'Свитшот-халф-зип Regular без пояса',   category: 'halfzips', fit: 'regular',  sewingPrice: 350, mainFabricUsage: 1.40, trimCode: 'kashkorse', trimUsage: 0.18, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Молния до груди, прямой крой без пояса, рибана на манжетах', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  { code: 'HZ-003', name: 'Свитшот-халф-зип Free Fit',            category: 'halfzips', fit: 'free',     sewingPrice: 350, mainFabricUsage: 1.40, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Молния до груди, свободный крой, рибана на манжетах и поясе', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  { code: 'HZ-004', name: 'Свитшот-халф-зип Free Fit без пояса',  category: 'halfzips', fit: 'free',     sewingPrice: 350, mainFabricUsage: 1.40, trimCode: 'kashkorse', trimUsage: 0.18, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Молния до груди, свободный крой без пояса, рибана на манжетах', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  { code: 'HZ-005', name: 'Свитшот-халф-зип Oversize',            category: 'halfzips', fit: 'oversize', sewingPrice: 350, mainFabricUsage: 1.50, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Молния до груди, oversized крой, спущенное плечо, рибана', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  { code: 'HZ-006', name: 'Свитшот-халф-зип Oversize без пояса',  category: 'halfzips', fit: 'oversize', sewingPrice: 350, mainFabricUsage: 1.50, trimCode: 'kashkorse', trimUsage: 0.20, mockupType: 'half-zip', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Молния до груди, oversized крой без пояса, спущенное плечо', photoUrl: null, sizeChart: SIZE_CHART_SWEAT },
  // ── ХУДИ ──────────────────────────────────────────────
  { code: 'H-001', name: 'Худи Classic',  category: 'hoodies', fit: 'classic',  sewingPrice: 251, mainFabricUsage: 1.30, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'], description: 'Классический крой, капюшон на шнурке, карман-кенгуру, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  { code: 'H-002', name: 'Худи Regular',  category: 'hoodies', fit: 'regular',  sewingPrice: 251, mainFabricUsage: 1.30, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'], description: 'Прямой крой, капюшон на шнурке, карман-кенгуру, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  { code: 'H-003', name: 'Худи Free Fit', category: 'hoodies', fit: 'free',     sewingPrice: 251, mainFabricUsage: 1.50, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'], description: 'Свободный крой, капюшон на шнурке, карман-кенгуру, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  { code: 'H-004', name: 'Худи Oversize', category: 'hoodies', fit: 'oversize', sewingPrice: 282, mainFabricUsage: 1.70, trimCode: 'kashkorse', trimUsage: 0.30, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'], description: 'Oversized крой, капюшон на шнурке, карман-кенгуру, спущенное плечо, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  { code: 'H-005', name: 'Худи Reglan',   category: 'hoodies', fit: 'regular',  sewingPrice: 244, mainFabricUsage: 1.30, trimCode: 'kashkorse', trimUsage: 0.25, mockupType: 'hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'], description: 'Реглан, капюшон на шнурке, карман-кенгуру, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  // ── ЗИП-ХУДИ ──────────────────────────────────────────
  { code: 'ZH-001', name: 'Худи-зип Regular',                    category: 'ziphoodies', fit: 'regular',  sewingPrice: 312, mainFabricUsage: 1.40, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'], description: 'Молния по всей длине, прямой крой, капюшон, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  { code: 'ZH-002', name: 'Худи-зип Free Fit',                   category: 'ziphoodies', fit: 'free',     sewingPrice: 312, mainFabricUsage: 1.50, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'], description: 'Молния по всей длине, свободный крой, капюшон, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  { code: 'ZH-003', name: 'Худи-зип Oversize',                   category: 'ziphoodies', fit: 'oversize', sewingPrice: 312, mainFabricUsage: 1.70, trimCode: 'kashkorse', trimUsage: 0.30, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r','hood'], description: 'Молния по всей длине, oversized крой, спущенное плечо, капюшон, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  { code: 'ZH-004', name: 'Худи-зип Regular с капюшоном стойкой', category: 'ziphoodies', fit: 'regular',  sewingPrice: 312, mainFabricUsage: 1.40, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Молния по всей длине, прямой крой, капюшон-стойка, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  { code: 'ZH-005', name: 'Худи-зип Free Fit с капюшоном стойкой',category: 'ziphoodies', fit: 'free',     sewingPrice: 312, mainFabricUsage: 1.50, trimCode: 'kashkorse', trimUsage: 0.28, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Молния по всей длине, свободный крой, капюшон-стойка, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  { code: 'ZH-006', name: 'Худи-зип Oversize с капюшоном стойкой',category: 'ziphoodies', fit: 'oversize', sewingPrice: 312, mainFabricUsage: 1.70, trimCode: 'kashkorse', trimUsage: 0.30, mockupType: 'zip-hoodie', zones: ['front','back','sleeve-l','sleeve-r'], description: 'Молния по всей длине, oversized крой, капюшон-стойка, спущенное плечо, рибана', photoUrl: null, sizeChart: SIZE_CHART_HOODIE },
  // ── ПОЛО / РЕГБИЙКА / ОЛИМПИЙКА ───────────────────────
  { code: 'PL-001', name: 'Поло Regular',      category: 'polo', fit: 'regular',  sewingPrice: 245, mainFabricUsage: 1.00, trimCode: 'ribana-1x1', trimUsage: 0.15, mockupType: 'polo',        zones: ['front','back','sleeve-l','sleeve-r'], description: 'Рубашка поло, прямой крой, планка на пуговицах', photoUrl: null, sizeChart: SIZE_CHART_POLO },
  { code: 'PL-002', name: 'Поло Oversize',     category: 'polo', fit: 'oversize', sewingPrice: 273, mainFabricUsage: 1.10, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'polo',        zones: ['front','back','sleeve-l','sleeve-r'], description: 'Рубашка поло, oversized крой, спущенное плечо, планка на пуговицах', photoUrl: null, sizeChart: SIZE_CHART_POLO },
  { code: 'RG-001', name: 'Регбийка Regular',  category: 'polo', fit: 'regular',  sewingPrice: 250, mainFabricUsage: 1.40, trimCode: 'ribana-1x1', trimUsage: 0.18, mockupType: 'longsleeve',  zones: ['front','back','sleeve-l','sleeve-r'], description: 'Регбийка, прямой крой, планка на пуговицах, длинный рукав', photoUrl: null, sizeChart: SIZE_CHART_LONGSLEEVE },
  { code: 'RG-002', name: 'Регбийка Oversize', category: 'polo', fit: 'oversize', sewingPrice: 250, mainFabricUsage: 1.60, trimCode: 'ribana-1x1', trimUsage: 0.20, mockupType: 'longsleeve',  zones: ['front','back','sleeve-l','sleeve-r'], description: 'Регбийка, oversized крой, спущенное плечо, длинный рукав', photoUrl: null, sizeChart: SIZE_CHART_LONGSLEEVE },
  // Олимпийка — мокап убран (нет подходящего силуэта)
  { code: 'OL-001', name: 'Олимпийка Free Fit', category: 'polo', fit: 'free',    sewingPrice: 0, mainFabricUsage: 1.50, trimCode: 'kashkorse',  trimUsage: 0.22, mockupType: null,           zones: ['front','back','sleeve-l','sleeve-r'], description: 'Олимпийка, свободный крой, молния, рибана на манжетах и поясе', photoUrl: null, sizeChart: SIZE_CHART_LONGSLEEVE },
  // ── БОМБЕРЫ ───────────────────────────────────────────
  // Мокап убран (нет подходящего силуэта)
  { code: 'BM-001', name: 'Бомбер-basic на кнопках', category: 'bombers', fit: 'regular', sewingPrice: 0, mainFabricUsage: 1.60, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: null, zones: ['front','back','sleeve-l','sleeve-r'], description: 'Бомбер на кнопках, подкладка, рибана на манжетах и поясе', photoUrl: null, sizeChart: SIZE_CHART_BOMBER },
  { code: 'BM-002', name: 'Бомбер-zipped на молнии', category: 'bombers', fit: 'regular', sewingPrice: 0, mainFabricUsage: 1.60, trimCode: 'kashkorse', trimUsage: 0.22, mockupType: null, zones: ['front','back','sleeve-l','sleeve-r'], description: 'Бомбер на молнии, подкладка, рибана на манжетах и поясе', photoUrl: null, sizeChart: SIZE_CHART_BOMBER },
  // ── ШТАНЫ ─────────────────────────────────────────────
  { code: 'P-001', name: 'Штаны Regular woman',          category: 'pants', fit: 'regular', sewingPrice: 184, mainFabricUsage: 1.10, trimCode: 'kashkorse', trimUsage: 0.15, mockupType: 'pants', zones: ['front','back'], description: 'Прямые женские штаны, резинка на поясе, карманы', photoUrl: null, sizeChart: SIZE_CHART_PANTS },
  { code: 'P-002', name: 'Штаны-отрезные Regular woman', category: 'pants', fit: 'regular', sewingPrice: 184, mainFabricUsage: 1.10, trimCode: 'kashkorse', trimUsage: 0.12, mockupType: 'pants', zones: ['front','back'], description: 'Отрезные женские штаны, резинка на поясе, карманы', photoUrl: null, sizeChart: SIZE_CHART_PANTS },
  { code: 'P-003', name: 'Штаны Regular man',            category: 'pants', fit: 'regular', sewingPrice: 184, mainFabricUsage: 1.20, trimCode: 'kashkorse', trimUsage: 0.15, mockupType: 'pants', zones: ['front','back'], description: 'Прямые мужские штаны, резинка на поясе, карманы', photoUrl: null, sizeChart: SIZE_CHART_PANTS },
  { code: 'P-004', name: 'Штаны-отрезные Regular man',   category: 'pants', fit: 'regular', sewingPrice: 184, mainFabricUsage: 1.20, trimCode: 'kashkorse', trimUsage: 0.12, mockupType: 'pants', zones: ['front','back'], description: 'Отрезные мужские штаны, резинка на поясе, карманы', photoUrl: null, sizeChart: SIZE_CHART_PANTS },
  { code: 'P-005', name: 'Штаны Free Fit man',           category: 'pants', fit: 'free',    sewingPrice: 184, mainFabricUsage: 1.40, trimCode: 'kashkorse', trimUsage: 0.18, mockupType: 'pants', zones: ['front','back'], description: 'Свободные мужские штаны, резинка на поясе, карманы', photoUrl: null, sizeChart: SIZE_CHART_PANTS },
  { code: 'P-006', name: 'Штаны-отрезные Free Fit man',  category: 'pants', fit: 'free',    sewingPrice: 184, mainFabricUsage: 1.40, trimCode: 'kashkorse', trimUsage: 0.15, mockupType: 'pants', zones: ['front','back'], description: 'Отрезные свободные мужские штаны, резинка на поясе, карманы', photoUrl: null, sizeChart: SIZE_CHART_PANTS },
  // ── ШОРТЫ ─────────────────────────────────────────────
  { code: 'SH-001', name: 'Шорты man',   category: 'shorts', fit: 'regular', sewingPrice: 162, mainFabricUsage: 0.75, trimCode: 'kashkorse', trimUsage: 0.12, mockupType: 'shorts', zones: ['front','back'], description: 'Мужские шорты до колена, резинка на поясе', photoUrl: null, sizeChart: SIZE_CHART_SHORTS },
  { code: 'SH-002', name: 'Шорты woman', category: 'shorts', fit: 'regular', sewingPrice: 162, mainFabricUsage: 0.70, trimCode: 'kashkorse', trimUsage: 0.10, mockupType: 'shorts', zones: ['front','back'], description: 'Женские шорты до колена, резинка на поясе', photoUrl: null, sizeChart: SIZE_CHART_SHORTS },
  // ── ШОППЕРЫ ───────────────────────────────────────────
  { code: 'BAG-001', name: 'Шоппер Classic Bag',     category: 'accessories', fit: null, sewingPrice: 57, mainFabricUsage: 0.40, trimCode: null, trimUsage: 0, mockupType: 'shopper', zones: ['front','back'], description: 'Классический шоппер, хлопок', photoUrl: null, sizeChart: null },
  { code: 'BAG-002', name: 'Шоппер Composite bag',   category: 'accessories', fit: null, sewingPrice: 63, mainFabricUsage: 0.50, trimCode: null, trimUsage: 0, mockupType: 'shopper', zones: ['front','back'], description: 'Шоппер с составным дном, хлопок', photoUrl: null, sizeChart: null },
  { code: 'BAG-003', name: 'Шоппер Contraction bag', category: 'accessories', fit: null, sewingPrice: 63, mainFabricUsage: 0.60, trimCode: null, trimUsage: 0, mockupType: 'shopper', zones: ['front','back'], description: 'Шоппер на стяжке, хлопок', photoUrl: null, sizeChart: null },
  { code: 'BAG-004', name: 'Шоппер Horizontal bag',  category: 'accessories', fit: null, sewingPrice: 76, mainFabricUsage: 0.70, trimCode: null, trimUsage: 0, mockupType: 'shopper', zones: ['front','back'], description: 'Горизонтальный шоппер, хлопок', photoUrl: null, sizeChart: null },
];
