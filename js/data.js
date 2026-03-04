// ════════════════════════════════════════════════════════════
//   DATA — PRICES
// ════════════════════════════════════════════════════════════
// Price tables, surcharges, multipliers

// ─── PRICES (редактируется через prices.json) ───
const PRICES = {
  // Базовые цены по типам изделий
  type: {
    tee:480, longsleeve:620, tank:350,          // 1-й слой
    hoodie:1200, sweat:900, 'zip-hoodie':1400,  // 2-й слой
    'half-zip':1100, pants:1000, shorts:750,
    shopper:350, basecap:600, 'dad-cap':650, '5panel':550, socks:280
  },
  // Надбавки по тканям (сверх базовой цены изделия)
  fabric: {
    'kulirnaya':0, 'dvunitka':80, 'interlock':120,
    'futher-350-nachers':0, 'futher-350-petlya':0,
    'futher-370-nachers':30, 'futher-370-petlya':30,
    'futher-470-petlya':80
  },
  tech:   {screen:0, flex:0, dtg:280, embroidery:350, dtf:180},

  // ═══ SCREEN MATRIX ═══
  // screenMatrix[format][colors][qtyTier] = price per unit
  // Тиражные пороги: 50, 100, 300, 500, 700, 1000
  screenTiers: [50, 100, 300, 500, 700, 1000],
  screenFormats: ['A4','A3','A3+','Max'],
  screenMaxColors: 8,
  screenMatrix: {
    'A4': {
      1:[128,115,109,103,95,90], 2:[167,150,142,133,124,117], 3:[205,185,174,164,152,144],
      4:[244,219,207,195,181,171], 5:[289,260,245,231,214,203], 6:[333,300,283,267,247,235],
      7:[378,341,322,303,280,266], 8:[423,381,360,339,314,298]
    },
    'A3': {
      1:[141,127,120,113,105,99], 2:[183,165,156,147,136,129], 3:[226,203,192,181,167,159],
      4:[268,241,228,214,199,189], 5:[329,296,280,263,235,223], 6:[380,342,323,304,272,258],
      7:[432,388,367,345,308,293], 8:[483,435,410,386,345,328]
    },
    'A3+': {
      1:[172,155,147,138,115,109], 2:[224,202,191,179,149,142], 3:[276,248,234,221,184,175],
      4:[328,295,278,262,218,207], 5:[388,349,330,310,259,246], 6:[448,403,381,359,299,284],
      7:[509,458,432,407,339,322], 8:[569,512,484,455,379,360]
    },
    'Max': {
      1:[212,190,180,169,132,126], 2:[275,247,234,220,172,163], 3:[338,305,288,271,212,201],
      4:[402,362,342,321,251,239], 5:[476,428,405,381,297,283], 6:[550,495,467,440,344,327],
      7:[624,562,530,499,390,370], 8:[698,628,593,558,436,414]
    }
  },
  screenColoredMult: 1.3,   // наценка за цветной текстиль
  screenFutherMult: 1.5,    // наценка за футер 3-нитку
  screenFxMult: 2.0,        // наценка за спецэффект (К. база, PUFF, Металлик, Флюр)
  screenFxOptions: ['none','stone','puff','metallic','fluor'],

  // DTG: надбавка за формат + белая подложка
  dtgFormatAdd: {'A6':0,'A5':30,'A4':60,'A3':120,'A3+':180},
  dtgWhiteUnder: 60,   // +60₽ подложка на цветном текстиле
  // Вышивка: надбавка за размер области
  embAreaAdd: {s:0, m:80, l:180},   // s=до7см, m=до12см, l=до20см
  embColorAdd: 20,     // +20₽ за каждый доп. цвет нити (сверх 1)
  // DTF: надбавка за формат
  dtfFormatAdd: {'A6':0,'A5':20,'A4':50,'A3':100,'A3+':160},
  label:30, pack:15, urgentMult:0.2,
  fit:{ regular:0, free:50, oversize:100 }
};


// ════════════════════════════════════════════════════════════
//   v1.7: SKU + ТКАНИ + ОБРАБОТКИ + КУРС $
// ════════════════════════════════════════════════════════════

// Курс доллара (вводится вручную через настройки)
let USD_RATE = 92;
try {
  const stored = localStorage.getItem('ph_usd_rate');
  if (stored) USD_RATE = parseFloat(stored) || 92;
} catch(e){}

// ── Категории для фильтра ──
const SKU_CATEGORIES = [
  {id:'tshirts',    name:'Футболки'},
  {id:'longsleeves',name:'Лонгсливы'},
  {id:'tanks',      name:'Майки'},
  {id:'hoodies',    name:'Худи'},
  {id:'sweatshirts',name:'Свитшоты'},
  {id:'ziphoodies', name:'Зип-худи'},
  {id:'pants',      name:'Брюки'},
  {id:'shorts',     name:'Шорты'},
  {id:'accessories',name:'Аксессуары'},
];

// ── Каталог основных тканей (цены в $/м) ──
let FABRICS_CATALOG = [
  // Лёгкие (для футболок, лонгсливов, маек)
  {code:'kulirnaya',       name:'Кулирная гладь 190 г/м²',  priceUSD:2.80, forCategories:['tshirts','longsleeves','tanks'], supplier:'Medastex'},
  {code:'dvunitka',        name:'Двунитка 240 г/м²',        priceUSD:3.40, forCategories:['tshirts','longsleeves','tanks'], supplier:'Medastex'},
  {code:'interlock',       name:'Интерлок 220 г/м²',        priceUSD:3.10, forCategories:['tshirts','longsleeves','tanks'], supplier:'Medastex'},
  // Тяжёлые (для худи, свитшотов, брюк)
  {code:'futher-350-petlya',  name:'Футер петля 350 г/м²',       priceUSD:3.80, forCategories:['hoodies','sweatshirts','ziphoodies','pants','shorts'], supplier:'Medastex'},
  {code:'futher-350-nachers', name:'Футер начёс 350 г/м²',       priceUSD:3.80, forCategories:['hoodies','sweatshirts','ziphoodies','pants','shorts'], supplier:'Medastex'},
  {code:'futher-370-petlya',  name:'Футер петля 370 г/м²',       priceUSD:4.20, forCategories:['hoodies','sweatshirts','ziphoodies','pants','shorts'], supplier:'Medastex'},
  {code:'futher-370-nachers', name:'Футер начёс 370 г/м²',       priceUSD:4.20, forCategories:['hoodies','sweatshirts','ziphoodies','pants','shorts'], supplier:'Medastex'},
  {code:'futher-470-petlya',  name:'Футер петля 470 г/м²',       priceUSD:5.10, forCategories:['hoodies','sweatshirts','ziphoodies','pants','shorts'], supplier:'Medastex'},
];
try {
  const sf = localStorage.getItem('ph_fabrics');
  if (sf) {
    const parsed = JSON.parse(sf);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && parsed[0].name) {
      FABRICS_CATALOG = parsed.filter(f => f && f.name);
    }
  }
} catch(e){}

// ── Каталог отделочных тканей (фиксированы в SKU, не выбираются) ──
let TRIM_CATALOG = [
  {code:'ribana-1x1',  name:'Рибана 1×1',    priceUSD:2.50},
  {code:'ribana-2x2',  name:'Рибана 2×2',    priceUSD:2.70},
  {code:'kashkorse',   name:'Кашкорсе',      priceUSD:3.00},
];
try {
  const st = localStorage.getItem('ph_trims');
  if (st) {
    const parsed = JSON.parse(st);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && parsed[0].name) {
      TRIM_CATALOG = parsed.filter(t => t && t.name);
    }
  }
} catch(e){}

// ── Транслитерация + генерация артикула (нужна ДО загрузки каталога) ──
const _translit = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ы':'y','э':'e','ю':'yu','я':'ya'};
function _tr(str) { return str.toLowerCase().split('').map(c => _translit[c] || c).join(''); }
function generateArticle(name, catalog) {
  const list = catalog || SKU_CATALOG;
  const words = (name||'').trim().split(/[\s\-]+/).filter(w => w.length > 0);
  const parts = words.map(w => _tr(w).substring(0, 3).toUpperCase());
  const base = parts.join('-') || 'NEW';
  const existing = list.map(s => s.article || '');
  let num = 1;
  while (existing.includes(base + '-' + String(num).padStart(3, '0'))) num++;
  return base + '-' + String(num).padStart(3, '0');
}

function generateCode(name) {
  return (name||'').toLowerCase().split('').map(c => _translit[c] || c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new';
}

// ── Каталог SKU ──
let SKU_CATALOG = [
  // Футболки
  {code:'T-001', name:'Футболка Regular',     category:'tshirts',    fit:'regular',  sewingPrice:200, mainFabricUsage:1.0, trimCode:'ribana-1x1', trimUsage:0.15, mockupType:'tee',        zones:['front','back','sleeve-l','sleeve-r']},
  {code:'T-002', name:'Футболка Free',        category:'tshirts',    fit:'free',     sewingPrice:220, mainFabricUsage:1.1, trimCode:'ribana-1x1', trimUsage:0.15, mockupType:'tee',        zones:['front','back','sleeve-l','sleeve-r']},
  {code:'T-003', name:'Футболка Oversize',    category:'tshirts',    fit:'oversize', sewingPrice:250, mainFabricUsage:1.3, trimCode:'ribana-1x1', trimUsage:0.18, mockupType:'tee',        zones:['front','back','sleeve-l','sleeve-r']},
  // Лонгсливы
  {code:'LS-001',name:'Лонгслив Regular',     category:'longsleeves',fit:'regular',  sewingPrice:250, mainFabricUsage:1.3, trimCode:'ribana-1x1', trimUsage:0.18, mockupType:'longsleeve', zones:['front','back','sleeve-l','sleeve-r']},
  {code:'LS-002',name:'Лонгслив Oversize',    category:'longsleeves',fit:'oversize', sewingPrice:280, mainFabricUsage:1.5, trimCode:'ribana-1x1', trimUsage:0.20, mockupType:'longsleeve', zones:['front','back','sleeve-l','sleeve-r']},
  // Майки
  {code:'TK-001',name:'Майка Regular',        category:'tanks',      fit:'regular',  sewingPrice:170, mainFabricUsage:0.8, trimCode:'ribana-1x1', trimUsage:0.12, mockupType:'tank',       zones:['front','back']},
  // Худи
  {code:'H-001', name:'Худи Regular',         category:'hoodies',    fit:'regular',  sewingPrice:400, mainFabricUsage:1.6, trimCode:'kashkorse',  trimUsage:0.25, mockupType:'hoodie',     zones:['front','back','sleeve-l','sleeve-r','hood']},
  {code:'H-002', name:'Худи Oversize',        category:'hoodies',    fit:'oversize', sewingPrice:450, mainFabricUsage:1.8, trimCode:'kashkorse',  trimUsage:0.30, mockupType:'hoodie',     zones:['front','back','sleeve-l','sleeve-r','hood']},
  // Свитшоты
  {code:'SW-001',name:'Свитшот Regular',      category:'sweatshirts',fit:'regular',  sewingPrice:350, mainFabricUsage:1.4, trimCode:'kashkorse',  trimUsage:0.22, mockupType:'sweat',      zones:['front','back','sleeve-l','sleeve-r']},
  {code:'SW-002',name:'Свитшот Oversize',     category:'sweatshirts',fit:'oversize', sewingPrice:380, mainFabricUsage:1.6, trimCode:'kashkorse',  trimUsage:0.25, mockupType:'sweat',      zones:['front','back','sleeve-l','sleeve-r']},
  // Зип-худи
  {code:'ZH-001',name:'Зип-худи Regular',     category:'ziphoodies', fit:'regular',  sewingPrice:480, mainFabricUsage:1.7, trimCode:'kashkorse',  trimUsage:0.28, mockupType:'zip-hoodie', zones:['front','back','sleeve-l','sleeve-r','hood']},
  // Брюки
  {code:'P-001', name:'Брюки Regular',        category:'pants',      fit:'regular',  sewingPrice:350, mainFabricUsage:1.4, trimCode:'kashkorse',  trimUsage:0.15, mockupType:'pants',      zones:['front','back']},
  {code:'P-002', name:'Брюки Wide',           category:'pants',      fit:'free',     sewingPrice:380, mainFabricUsage:1.6, trimCode:'kashkorse',  trimUsage:0.18, mockupType:'pants',      zones:['front','back']},
  // Шорты
  {code:'SH-001',name:'Шорты Regular',        category:'shorts',     fit:'regular',  sewingPrice:250, mainFabricUsage:0.9, trimCode:'kashkorse',  trimUsage:0.12, mockupType:'shorts',     zones:['front','back']},
  // Аксессуары (без отделки)
  {code:'BAG-001',name:'Шоппер',              category:'accessories',fit:null,       sewingPrice:150, mainFabricUsage:0.6, trimCode:null,         trimUsage:0,    mockupType:'shopper',    zones:['front','back']},
  {code:'CAP-001',name:'Бейсболка',           category:'accessories',fit:null,       sewingPrice:250, mainFabricUsage:0.3, trimCode:null,         trimUsage:0,    mockupType:'basecap',    zones:['front']},
  {code:'CAP-002',name:'Дэд кэп',            category:'accessories',fit:null,       sewingPrice:270, mainFabricUsage:0.3, trimCode:null,         trimUsage:0,    mockupType:'dad-cap',    zones:['front']},
  {code:'CAP-003',name:'5-панельная',         category:'accessories',fit:null,       sewingPrice:230, mainFabricUsage:0.3, trimCode:null,         trimUsage:0,    mockupType:'5panel',     zones:['front']},
  {code:'SOX-001',name:'Носки',               category:'accessories',fit:null,       sewingPrice:120, mainFabricUsage:0.15,trimCode:null,         trimUsage:0,    mockupType:'socks',      zones:[]},
];
try {
  const ss = localStorage.getItem('ph_sku');
  if (ss) {
    const parsed = JSON.parse(ss);
    // Валидация: проверяем что массив и элементы имеют нужные поля
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) {
      SKU_CATALOG = parsed;
    }
  }
} catch(e){ console.warn('ph_sku parse error', e); }
// v1.7: миграция — генерируем article/code из названий
SKU_CATALOG = SKU_CATALOG.filter(s => s && s.name);
SKU_CATALOG.forEach(s => {
  if (!s.article) s.article = generateArticle(s.name);
  if (!s.category) s.category = 'tshirts';
  // Миграция зон: убираем устаревшие
  if (s.zones) s.zones = s.zones.map(z => z === 'front-leg' ? 'front' : z === 'back-leg' ? 'back' : z);
});
// Строим маппинг старый код → новый код для отделки
var _oldTrimCodes = {};
TRIM_CATALOG = TRIM_CATALOG.filter(t => t && t.name);
TRIM_CATALOG.forEach(t => { const oldCode = t.code; t.code = generateCode(t.name); if (oldCode) _oldTrimCodes[oldCode] = t.code; });
// Обновляем trimCode в SKU
SKU_CATALOG.forEach(s => {
  if (s.trimCode && _oldTrimCodes[s.trimCode]) s.trimCode = _oldTrimCodes[s.trimCode];
});
FABRICS_CATALOG = FABRICS_CATALOG.filter(f => f && f.name);
FABRICS_CATALOG.forEach(f => { f.code = generateCode(f.name); });

// ── Доп. обработки (единый чек-лист) ──
var EXTRAS_ICONS = {
  'grommet':        '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="18" r="8"/><circle cx="18" cy="18" r="4"/><path d="M18 2v6M18 28v6M2 18h6M28 18h6"/></svg>',
  'lace-flat':      '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 18c4-6 8 6 12 0s8 6 12 0"/><path d="M6 24c4-6 8 6 12 0s8 6 12 0"/></svg>',
  'lace-waxed':     '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 18c4-6 8 6 12 0s8 6 12 0" stroke-width="2.5"/><circle cx="8" cy="22" r="2" fill="currentColor"/><circle cx="28" cy="22" r="2" fill="currentColor"/></svg>',
  'lace-lock':      '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="13" y="10" width="10" height="16" rx="2"/><path d="M16 4v6M20 4v6M16 26v6M20 26v6"/><line x1="13" y1="18" x2="23" y2="18"/></svg>',
  'zipper-ykk':     '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 4v28M22 4v28"/><path d="M14 10l8 4-8 4 8 4-8 4"/><rect x="12" y="2" width="12" height="5" rx="1"/></svg>',
  'zipper-half':    '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 14v18M22 14v18"/><path d="M14 18l8 4-8 4 8 4"/><rect x="12" y="10" width="12" height="5" rx="1"/></svg>',
  'hanger-loop':    '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 6a4 4 0 0 1 4 4c0 2-4 4-4 4s-4-2-4-4a4 4 0 0 1 4-4z"/><path d="M10 28h16"/><path d="M10 28L18 18l8 10"/></svg>',
  'reinforced-seam':'<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 8l20 20" stroke-width="2.5"/><path d="M5 14l4-4M10 19l4-4M15 24l4-4M20 29l4-4"/></svg>',
  'double-stitch':  '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 14h28" stroke-dasharray="3 3"/><path d="M4 22h28" stroke-dasharray="3 3"/><path d="M4 10h28"/><path d="M4 26h28"/></svg>',
  'cuff-ribana':    '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 8v20M12 8v20M16 8v20M20 8v20M24 8v20M28 8v20"/><path d="M6 8h24M6 28h24"/></svg>',
  'strap-reinforce':'<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 8h4v20h-4zM22 8h4v20h-4z"/><path d="M14 14h8M14 22h8" stroke-width="2"/></svg>',
  'magnet-snap':    '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="18" r="10"/><circle cx="18" cy="18" r="4" fill="currentColor"/><path d="M18 8v-4M18 32v-4"/></svg>',
};
var EXTRAS_DESCS = {
  'grommet':        'Металлические люверсы для продевания шнурка',
  'lace-flat':      'Плоский хлопковый шнурок в капюшон',
  'lace-waxed':     'Вощёный шнурок с наконечниками',
  'lace-lock':      'Пластиковый/металлический фиксатор шнурка',
  'zipper-ykk':     'Японская молния YKK, полноразмерная',
  'zipper-half':    'Молния 1/4 длины для полузипа',
  'hanger-loop':    'Петля на воротнике для хранения на вешалке',
  'reinforced-seam':'Двойной шов на плечах для прочности',
  'double-stitch':  'Декоративная двойная строчка по краям',
  'cuff-ribana':    'Трикотажный подгиб рукавов рибаной',
  'strap-reinforce':'Дополнительное усиление строп и ручек',
  'magnet-snap':    'Скрытая магнитная кнопка-застёжка',
};
let EXTRAS_CATALOG = [
  // Для худи / зип-худи / халф-зип
  {code:'grommet',        name:'Люверсы на капюшон',     price:35, forCategories:['hoodies','ziphoodies','half-zip']},
  {code:'lace-flat',      name:'Шнурок плоский',         price:20, forCategories:['hoodies','ziphoodies','half-zip']},
  {code:'lace-waxed',     name:'Шнурок вощёный',         price:25, forCategories:['hoodies','ziphoodies','half-zip']},
  {code:'lace-lock',      name:'Фиксатор шнурка',        price:15, forCategories:['hoodies','ziphoodies','half-zip']},
  {code:'zipper-ykk',     name:'Молния YKK',             price:120, forCategories:['ziphoodies']},
  {code:'zipper-half',    name:'Молния полузакрытая',     price:80, forCategories:['half-zip']},
  // Для всей одежды
  {code:'hanger-loop',    name:'Петля для вешалки',       price:15, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','half-zip','pants','shorts']},
  {code:'reinforced-seam',name:'Усиление плечевых швов',  price:40, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','half-zip']},
  {code:'double-stitch',  name:'Двойная отстрочка',       price:30, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','half-zip','pants','shorts']},
  {code:'cuff-ribana',    name:'Подгиб рукавов рибана',   price:25, forCategories:['longsleeves','hoodies','sweatshirts','ziphoodies','half-zip']},
  // Для аксессуаров
  {code:'strap-reinforce',name:'Усиление ручек',          price:20, forCategories:['accessories']},
  {code:'magnet-snap',    name:'Кнопка магнитная',        price:30, forCategories:['accessories']},
];
try {
  const se = localStorage.getItem('ph_extras');
  if (se) {
    const parsed = JSON.parse(se);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && parsed[0].name) {
      EXTRAS_CATALOG = parsed.filter(e => e && e.name);
    }
  }
} catch(e){}
EXTRAS_CATALOG = EXTRAS_CATALOG.filter(e => e && e.name);
EXTRAS_CATALOG.forEach(e => { if (!e.code) e.code = generateCode(e.name); });

// ── Лейблы и бирки ──
let LABELS_CATALOG = [
  {code:'patch-woven',   name:'Нашивка тканая (ворот)',  price:30, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','pants','shorts']},
  {code:'patch-jacquard', name:'Нашивка жаккардовая',     price:45, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','pants','shorts']},
  {code:'label-hem',      name:'Лейбл на подоле',         price:20, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies']},
  {code:'tag-size',       name:'Бирка размерная (вшивная)',price:10, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','pants','shorts','accessories']},
  {code:'hang-tag',       name:'Хэнг-тег (картон)',       price:15, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','pants','shorts','accessories']},
];
try {
  const sl = localStorage.getItem('ph_labels');
  if (sl) {
    const parsed = JSON.parse(sl);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && parsed[0].name) {
      LABELS_CATALOG = parsed.filter(e => e && e.name);
    }
  }
} catch(e){}
LABELS_CATALOG = LABELS_CATALOG.filter(e => e && e.name);
LABELS_CATALOG.forEach(e => { if (!e.code) e.code = generateCode(e.name); });

// ── Конфигуратор бирок v2 ──
const LABEL_CONFIG = {
  careLabel: {
    id:'care-label', name:'Бирка по уходу', nameShort:'Составник', basePrice:10,
    options:[
      {key:'my-logo', name:'Мой логотип бренда', priceDelta:20},
      {key:'no-logo', name:'Без логотипа', priceDelta:0},
      {key:'standard', name:'Стандартный', priceDelta:0}
    ]
  },
  mainLabel: {
    id:'main-label', name:'Основная бирка', nameShort:'Нашивка',
    options:[
      {key:'none', name:'Без бирки', price:0},
      {key:'send-own', name:'Пришлю свои', price:0},
      {key:'standard', name:'Стандартная', price:30},
      {key:'custom', name:'Кастомная', price:45}
    ],
    placements:[
      {key:'neck', name:'На воротнике (спина)'},
      {key:'inseam', name:'Петля вшивная (шов)'}
    ],
    materials:[
      {key:'woven', name:'Тканая', priceDelta:0},
      {key:'polyester', name:'Полиэстер', priceDelta:-5},
      {key:'canvas', name:'Хлопковый канвас', priceDelta:10}
    ],
    colors:[
      {key:'white', name:'Белая', hex:'#FFFFFF'},
      {key:'black', name:'Чёрная', hex:'#000000'}
    ],
    dimensions:{width:3, height:6, unit:'см'}
  },
  hangTag: {
    id:'hang-tag', name:'Хэнг-тег (картон)', nameShort:'Хэнг-тег',
    options:[
      {key:'none', name:'Без хэнг-тега', price:0},
      {key:'standard', name:'Стандартный', price:15},
      {key:'custom', name:'Кастомный', price:25}
    ]
  }
};

function getDefaultLabelConfig() {
  return {
    careLabel: {enabled:false, logoOption:'no-logo', composition:'', country:'', uploadData:null, comments:''},
    mainLabel: {option:'none', placement:'neck', material:'woven', color:'white', uploadData:null, comments:''},
    hangTag:   {option:'none', uploadData:null, comments:''}
  };
}

function migrateLabelData(data) {
  if (data.labelConfig) return JSON.parse(JSON.stringify(data.labelConfig));
  var config = getDefaultLabelConfig();
  var oldLabels = data.labels || [];
  if (oldLabels.includes('patch-woven') || oldLabels.includes('patch-jacquard')) {
    config.mainLabel.option = oldLabels.includes('patch-jacquard') ? 'custom' : 'standard';
    config.mainLabel.material = 'woven';
    config.mainLabel.placement = 'neck';
  }
  if (oldLabels.includes('label-hem')) {
    config.mainLabel.option = config.mainLabel.option === 'none' ? 'standard' : config.mainLabel.option;
    config.mainLabel.placement = 'inseam';
  }
  if (oldLabels.includes('tag-size')) {
    config.careLabel.enabled = true;
    config.careLabel.logoOption = 'no-logo';
  }
  if (oldLabels.includes('hang-tag')) {
    config.hangTag.option = 'standard';
  }
  if (data.labelOption) {
    config.careLabel.enabled = true;
    config.careLabel.logoOption = 'my-logo';
  }
  return config;
}

function getLabelConfigPrice() {
  var cfg = state.labelConfig;
  if (!cfg) return 0;
  var total = 0;
  // Care label
  if (cfg.careLabel && cfg.careLabel.enabled) {
    var base = LABEL_CONFIG.careLabel.basePrice;
    var opt = LABEL_CONFIG.careLabel.options.find(function(o){return o.key === cfg.careLabel.logoOption});
    total += base + (opt ? opt.priceDelta : 0);
  }
  // Main label
  if (cfg.mainLabel && cfg.mainLabel.option !== 'none' && cfg.mainLabel.option !== 'send-own') {
    var mOpt = LABEL_CONFIG.mainLabel.options.find(function(o){return o.key === cfg.mainLabel.option});
    var mMat = LABEL_CONFIG.mainLabel.materials.find(function(m){return m.key === cfg.mainLabel.material});
    total += (mOpt ? mOpt.price : 0) + (mMat ? mMat.priceDelta : 0);
  }
  // Hang tag
  if (cfg.hangTag && cfg.hangTag.option !== 'none') {
    var hOpt = LABEL_CONFIG.hangTag.options.find(function(o){return o.key === cfg.hangTag.option});
    total += (hOpt ? hOpt.price : 0);
  }
  return total;
}

// ── Фурнитура (молнии, шнурки, люверсы) ──
const HARDWARE_GROUPS = [
  {id:'zippers', name:'Молнии'},
  {id:'cords', name:'Шнурки и завязки'},
  {id:'elastic', name:'Резинки'},
  {id:'metal', name:'Металлическая фурнитура'},
  {id:'plastic', name:'Пластиковая фурнитура'},
  {id:'labels', name:'Этикетки и бирки'},
];
let HARDWARE_CATALOG = [
  // Молнии
  {code:'zipper-ykk',     name:'Молния YKK',           price:80,  group:'zippers'},
  {code:'zipper-auto',    name:'Замок автомат',         price:45,  group:'zippers'},
  {code:'zipper-reverse', name:'Молния реверсивная',    price:90,  group:'zippers'},
  // Шнурки и завязки
  {code:'lace-waxed',     name:'Шнурок вощёный',       price:25,  group:'cords'},
  {code:'lace-flat',      name:'Шнурок плоский',       price:20,  group:'cords'},
  {code:'lace-round',     name:'Шнурок круглый',       price:20,  group:'cords'},
  {code:'drawstring',     name:'Кулиска',              price:15,  group:'cords'},
  // Резинки
  {code:'elastic-waist',  name:'Резинка в пояс',       price:20,  group:'elastic'},
  {code:'elastic-cuff',   name:'Резинка манжетная',    price:15,  group:'elastic'},
  {code:'elastic-hem',    name:'Резинка подол',         price:15,  group:'elastic'},
  // Металлическая фурнитура
  {code:'grommet',        name:'Люверсы',              price:35,  group:'metal'},
  {code:'snap-button',    name:'Кнопка кольцевая',     price:20,  group:'metal'},
  {code:'d-ring',         name:'Полукольцо D',         price:15,  group:'metal'},
  {code:'hook',           name:'Карабин',              price:25,  group:'metal'},
  // Пластиковая фурнитура
  {code:'cord-stopper',   name:'Фиксатор шнурка',     price:10,  group:'plastic'},
  {code:'buckle',         name:'Фастекс',              price:20,  group:'plastic'},
  {code:'cord-end',       name:'Наконечник шнурка',    price:8,   group:'plastic'},
  // Этикетки и бирки
  {code:'label-woven',    name:'Нашивка тканая',       price:30,  group:'labels'},
  {code:'label-printed',  name:'Бирка печатная',       price:15,  group:'labels'},
  {code:'label-leather',  name:'Кожаная нашивка',      price:40,  group:'labels'},
  {code:'hangtag',        name:'Хенгтег (бирка навес.)', price:10, group:'labels'},
];
try {
  const sh = localStorage.getItem('ph_hardware');
  if (sh) {
    const parsed = JSON.parse(sh);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && parsed[0].name) {
      HARDWARE_CATALOG = parsed.filter(h => h && h.name);
    }
  }
} catch(e){}
HARDWARE_CATALOG = HARDWARE_CATALOG.filter(h => h && h.name);
HARDWARE_CATALOG.forEach(h => {
  h.code = generateCode(h.name);
  if (!h.group) {
    // Автоопределение группы по названию
    const n = (h.name||'').toLowerCase();
    if (n.includes('молни') || n.includes('замок') || n.includes('zipper')) h.group = 'zippers';
    else if (n.includes('шнур') || n.includes('кулис') || n.includes('завяз')) h.group = 'cords';
    else if (n.includes('резинк') || n.includes('elastic')) h.group = 'elastic';
    else if (n.includes('люверс') || n.includes('кнопк') || n.includes('кольц') || n.includes('караб') || n.includes('крюч')) h.group = 'metal';
    else if (n.includes('фиксат') || n.includes('фастекс') || n.includes('наконечн') || n.includes('пряжк')) h.group = 'plastic';
    else if (n.includes('нашивк') || n.includes('бирк') || n.includes('этикет') || n.includes('хенг') || n.includes('label')) h.group = 'labels';
    else h.group = 'metal';
  }
});

// ── Хелперы SKU ──

function getSkuByArticle(article) { return SKU_CATALOG.find(s => s.article === article) || null; }
// Обратная совместимость
function getSkuByCode(code) { return SKU_CATALOG.find(s => (s.article || s.code) === code) || null; }
function getFabricByCode(code) { return FABRICS_CATALOG.find(f => f.code === code) || null; }
function getTrimByCode(code) { return TRIM_CATALOG.find(t => t.code === code) || null; }
function getFabricsForCategory(cat) { return FABRICS_CATALOG.filter(f => f.forCategories.includes(cat)); }

function calcSkuUnitPrice(skuCode, fabricCode, selectedExtras) {
  const sku = getSkuByCode(skuCode);
  if (!sku) return 0;
  const fabric = getFabricByCode(fabricCode);
  const fabricCost = fabric ? Math.round(sku.mainFabricUsage * fabric.priceUSD * USD_RATE) : 0;
  let trimCost = 0;
  if (sku.trimCode && sku.trimUsage > 0) {
    const trim = getTrimByCode(sku.trimCode);
    trimCost = trim ? Math.round(sku.trimUsage * trim.priceUSD * USD_RATE) : 0;
  }
  const extrasCost = (selectedExtras || []).reduce((sum, code) => {
    const ex = EXTRAS_CATALOG.find(e => e.code === code);
    return sum + (ex ? ex.price : 0);
  }, 0);
  return sku.sewingPrice + fabricCost + trimCost + extrasCost;
}

function saveSkuData() {
  try {
    localStorage.setItem('ph_sku', JSON.stringify(SKU_CATALOG));
    localStorage.setItem('ph_fabrics', JSON.stringify(FABRICS_CATALOG));
    localStorage.setItem('ph_trims', JSON.stringify(TRIM_CATALOG));
    localStorage.setItem('ph_extras', JSON.stringify(EXTRAS_CATALOG));
    localStorage.setItem('ph_labels', JSON.stringify(LABELS_CATALOG));
    localStorage.setItem('ph_hardware', JSON.stringify(HARDWARE_CATALOG));
    localStorage.setItem('ph_usd_rate', String(USD_RATE));
  } catch(e){}
}

// ════════════════════════════════════════════════════════════
//   DATA — FABRICS
// ════════════════════════════════════════════════════════════
// Fabric types, layers, getFabricsForType

// Группировка типов по слою
const LAYER1_TYPES = ['tee','longsleeve','tank'];
const LAYER2_TYPES = ['hoodie','sweat','zip-hoodie','half-zip','pants','shorts'];

// Ткани по слоям
const FABRICS_LAYER1 = [
  { key:'kulirnaya', name:'Кулирка',   meta:'100% хлопок', sub:'лёгкая',   priceKey:'kulirnaya' },
  { key:'dvunitka',  name:'2-х нитка', meta:'100% хлопок', sub:'плотная',  priceKey:'dvunitka' },
  { key:'interlock', name:'Интерлок',  meta:'100% хлопок', sub:'гладкий',  priceKey:'interlock' }
];
const FABRICS_LAYER2 = [
  { key:'futher-350-nachers', name:'Футер 3х нитка',  meta:'350 г/м² · Начёс', sub:'100% хлопок',      priceKey:'futher-350-nachers' },
  { key:'futher-350-petlya',  name:'Футер 3х нитка',  meta:'350 г/м² · Петля', sub:'100% хлопок',      priceKey:'futher-350-petlya' },
  { key:'futher-370-nachers', name:'Футер 3х нитка',  meta:'370 г/м² · Начёс', sub:'80/20 хлопок ПЭ', priceKey:'futher-370-nachers' },
  { key:'futher-370-petlya',  name:'Футер 3х нитка',  meta:'370 г/м² · Петля', sub:'80/20 хлопок ПЭ', priceKey:'futher-370-petlya' },
  { key:'futher-470-petlya',  name:'Футер 3х нитка',  meta:'470 г/м² · Петля', sub:'100% хлопок',      priceKey:'futher-470-petlya' }
];

function getFabricsForType(type) {
  // SKU accessories — ткань не нужна
  if (state.sku && state.sku.category === 'accessories') return [];
  if (isAccessory(type)) return [];
  // Если выбран SKU — берём ткани по категории SKU из FABRICS_CATALOG
  if (state.sku && state.sku.category) {
    const catFabrics = FABRICS_CATALOG.filter(f => (f.forCategories||[]).includes(state.sku.category));
    if (catFabrics.length > 0) {
      return catFabrics.map(f => ({
        key: f.code,
        name: f.name,
        meta: Math.round(f.priceUSD * USD_RATE) + ' ₽/м',
        sub: '$' + f.priceUSD + '/м'
      }));
    }
  }
  // Фолбэк — старая логика
  if (LAYER1_TYPES.includes(type)) return FABRICS_LAYER1;
  return FABRICS_LAYER2;
}


// ── ОБРАБОТКИ (ШАГ 1) ──
function getExtrasForSku() {
  if (!state.sku) return [];
  const cat = state.sku.category;
  return EXTRAS_CATALOG.filter(e => {
    if (!e.forCategories || e.forCategories.length === 0) return true;
    return e.forCategories.includes(cat);
  });
}

function renderExtrasStep() {
  const container = document.getElementById('extrasContainer');
  if (!container) return;
  if (!state.sku) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px;font-family:var(--font)">Сначала выберите изделие на предыдущем шаге</div>';
    return;
  }
  const available = getExtrasForSku();
  if (available.length === 0) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px;font-family:var(--font)">Для «' + state.sku.name + '» нет доступных обработок — можно пропустить этот шаг</div>';
    return;
  }
  const selectedCodes = state.extras || [];
  const selectedCount = selectedCodes.length;
  const totalCost = selectedCodes.reduce(function(s,c) {
    const e = EXTRAS_CATALOG.find(function(x){return x.code === c});
    return s + (e ? e.price : 0);
  }, 0);

  let html = '<div class="extras-grid">';
  available.forEach(function(e) {
    const sel = selectedCodes.includes(e.code);
    const icon = EXTRAS_ICONS[e.code] || '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="8" y="8" width="20" height="20" rx="3"/><path d="M14 18h8M18 14v8"/></svg>';
    const desc = EXTRAS_DESCS[e.code] || '';
    html += '<div class="extra-card' + (sel ? ' selected' : '') + '" onclick="toggleExtra(\'' + e.code + '\')">';
    html += '<div class="extra-check" style="position:absolute;top:8px;right:8px">' + (sel ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '') + '</div>';
    html += '<div class="extra-icon">' + icon + '</div>';
    html += '<div class="extra-name">' + e.name + '</div>';
    if (desc) html += '<div class="extra-desc">' + desc + '</div>';
    html += '<span class="extra-price">+' + e.price + ' ₽</span>';
    html += '</div>';
  });
  html += '</div>';
  
  // Итоговая плашка
  if (selectedCount > 0) {
    html += '<div class="extras-summary">';
    html += '<div class="extras-summary-left">Выбрано: <b>' + selectedCount + '</b></div>';
    html += '<div class="extras-summary-right">+' + totalCost.toLocaleString('ru') + ' ₽ <span style="color:var(--text-dim);font-weight:400">/ шт</span></div>';
    html += '</div>';
  }
  
  container.innerHTML = html;
}

function toggleExtra(code) {
  if (!state.extras) state.extras = [];
  const idx = state.extras.indexOf(code);
  if (idx >= 0) state.extras.splice(idx, 1);
  else state.extras.push(code);
  renderExtrasStep();
  updateTotal();
  scheduleSave();
}

// ── ЛЕЙБЛЫ И БИРКИ (ШАГ 2 — ДИЗАЙН) ──
function getLabelsForSku() {
  if (!state.sku) return [];
  const cat = state.sku.category;
  return LABELS_CATALOG.filter(function(e) {
    if (!e.forCategories || e.forCategories.length === 0) return true;
    return e.forCategories.includes(cat);
  });
}

function renderLabelsBlock() { renderLabelConfigurator(); }

// ── КОНФИГУРАТОР БИРОК v2 ──
var _labelCfgArrowSvg = '<svg class="label-cfg-arrow" viewBox="0 0 18 18" fill="none"><path d="M4 7l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function _labelUploadHtml(type, data) {
  if (data && data.dataUrl) {
    var isImg = data.dataUrl.startsWith('data:image');
    return '<div class="label-cfg-upload-preview">' +
      (isImg ? '<img src="'+data.dataUrl+'" alt="preview">' : '<div style="width:44px;height:44px;border:1.5px solid var(--border-light);display:flex;align-items:center;justify-content:center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>') +
      '<span class="upl-fname">'+data.name+'</span>' +
      '<button class="upl-remove" onclick="removeLabelUpload(\''+type+'\')" title="Удалить">✕</button>' +
      '</div>';
  }
  return '<div class="label-cfg-upload" id="labelDrop_'+type+'" onclick="document.getElementById(\'labelFile_'+type+'\').click()">' +
    '<div class="upl-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>' +
    '<div class="upl-info"><div class="upl-text">Загрузить дизайн</div>' +
    '<div class="upl-hint">PNG, JPG, SVG, PDF — макс. 2 МБ</div></div>' +
    '<input type="file" id="labelFile_'+type+'" accept=".png,.jpg,.jpeg,.svg,.pdf" style="display:none" onchange="handleLabelUpload(\''+type+'\',this)">' +
    '</div>';
}

function _careLabelIcons() {
  var icons = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5"><path d="M12 3c-4 3-8 6-8 11a8 8 0 0016 0c0-5-4-8-8-11z"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5"><path d="M3 21h18M8 21V10l4-7 4 7v11"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5"><path d="M12 2L2 22h20L12 2z"/><line x1="12" y1="9" x2="12" y2="15"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>'
  ];
  return '<div class="label-cfg-care-icons">' +
    icons.map(function(svg){ return '<div class="care-icon-card">'+svg+'</div>'; }).join('') +
    '</div>';
}

function _neckSvg() {
  return '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">' +
    '<path d="M12 44V16c0-6 5-12 12-12s12 6 12 12v28"/>' +
    '<path d="M16 16h16" opacity=".3"/>' +
    '<rect x="18" y="14" width="12" height="6" rx="1" fill="currentColor" opacity=".2" stroke="currentColor"/>' +
    '</svg>';
}

function _inseamSvg() {
  return '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">' +
    '<path d="M10 4h28v40H10z" opacity=".15" fill="currentColor"/>' +
    '<path d="M10 4h28v40H10z"/>' +
    '<path d="M10 24h6v8H10z" fill="currentColor" opacity=".3"/>' +
    '<rect x="10" y="24" width="6" height="8" rx="0.5" stroke="currentColor"/>' +
    '</svg>';
}

function renderLabelConfigurator() {
  var container = document.getElementById('labelsContainer');
  if (!container) return;
  if (!state.sku) { container.innerHTML = ''; return; }
  if (!state.labelConfig) state.labelConfig = getDefaultLabelConfig();
  var cfg = state.labelConfig;
  var totalPrice = getLabelConfigPrice();

  var html = '<div class="section-label">Бирки и лейблы' + (totalPrice > 0 ? ' <span style="font-weight:900;color:var(--accent);font-family:Barlow Condensed,sans-serif;font-size:12px;letter-spacing:0">+' + totalPrice + ' ₽/шт</span>' : '') + '</div>';

  // ── 1. CARE LABEL ──
  var careOpen = cfg.careLabel.enabled ? ' open' : '';
  var carePrice = 0;
  if (cfg.careLabel.enabled) {
    var cOpt = LABEL_CONFIG.careLabel.options.find(function(o){return o.key === cfg.careLabel.logoOption});
    carePrice = LABEL_CONFIG.careLabel.basePrice + (cOpt ? cOpt.priceDelta : 0);
  }
  html += '<div class="label-cfg-section' + careOpen + '" id="lcfg-care">';
  html += '<div class="label-cfg-header" onclick="toggleCareLabel()">';
  html += '<div class="label-cfg-title">' + LABEL_CONFIG.careLabel.name + '</div>';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  if (cfg.careLabel.enabled) html += '<span class="label-cfg-badge">+' + carePrice + ' ₽</span>';
  html += _labelCfgArrowSvg + '</div></div>';
  html += '<div class="label-cfg-body">';

  // Logo option pills
  html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Логотип на бирке</div>';
  html += '<div class="label-cfg-pills">';
  LABEL_CONFIG.careLabel.options.forEach(function(o) {
    html += '<div class="label-cfg-pill' + (cfg.careLabel.logoOption === o.key ? ' active' : '') + '" onclick="setCareLabelOption(\'' + o.key + '\')">' + o.name + (o.priceDelta > 0 ? '<span class="pill-price">+' + o.priceDelta + '₽</span>' : '') + '</div>';
  });
  html += '</div></div>';

  // Care symbols preview
  html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Символы ухода (стандарт)</div>';
  html += _careLabelIcons();
  html += '</div>';

  // Composition + Country
  html += '<div class="label-cfg-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  html += '<div><div class="label-cfg-row-label">Состав ткани</div>';
  html += '<input type="text" class="label-cfg-input" value="' + (cfg.careLabel.composition || '') + '" placeholder="100% хлопок" onchange="state.labelConfig.careLabel.composition=this.value;scheduleSave()"></div>';
  html += '<div><div class="label-cfg-row-label">Страна</div>';
  html += '<input type="text" class="label-cfg-input" value="' + (cfg.careLabel.country || '') + '" placeholder="Россия" onchange="state.labelConfig.careLabel.country=this.value;scheduleSave()"></div>';
  html += '</div>';

  // Upload
  html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Дизайн бирки</div>';
  html += _labelUploadHtml('careLabel', cfg.careLabel.uploadData);
  html += '</div>';

  // Comments
  html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Комментарий</div>';
  html += '<textarea class="label-cfg-textarea" placeholder="Особые требования..." onchange="state.labelConfig.careLabel.comments=this.value;scheduleSave()">' + (cfg.careLabel.comments || '') + '</textarea>';
  html += '</div>';

  html += '</div></div>'; // close body + section

  // ── 2. MAIN LABEL ──
  var mainOpen = (cfg.mainLabel.option !== 'none') ? ' open' : '';
  var mainPrice = 0;
  if (cfg.mainLabel.option !== 'none' && cfg.mainLabel.option !== 'send-own') {
    var mOpt = LABEL_CONFIG.mainLabel.options.find(function(o){return o.key === cfg.mainLabel.option});
    var mMat = LABEL_CONFIG.mainLabel.materials.find(function(m){return m.key === cfg.mainLabel.material});
    mainPrice = (mOpt ? mOpt.price : 0) + (mMat ? mMat.priceDelta : 0);
  }
  html += '<div class="label-cfg-section' + mainOpen + '" id="lcfg-main">';
  html += '<div class="label-cfg-header" onclick="toggleLabelSection(\'lcfg-main\')">';
  html += '<div class="label-cfg-title">' + LABEL_CONFIG.mainLabel.name + '</div>';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  if (mainPrice > 0) html += '<span class="label-cfg-badge">+' + mainPrice + ' ₽</span>';
  html += _labelCfgArrowSvg + '</div></div>';
  html += '<div class="label-cfg-body">';

  // Option pills
  html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Тип бирки</div>';
  html += '<div class="label-cfg-pills">';
  LABEL_CONFIG.mainLabel.options.forEach(function(o) {
    html += '<div class="label-cfg-pill' + (cfg.mainLabel.option === o.key ? ' active' : '') + '" onclick="setMainLabelOption(\'' + o.key + '\')">' + o.name + (o.price > 0 ? '<span class="pill-price">+' + o.price + '₽</span>' : '') + '</div>';
  });
  html += '</div></div>';

  // Show details only for standard/custom
  if (cfg.mainLabel.option === 'standard' || cfg.mainLabel.option === 'custom') {
    // Placement
    html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Размещение</div>';
    html += '<div class="label-cfg-placement">';
    LABEL_CONFIG.mainLabel.placements.forEach(function(p) {
      var sel = cfg.mainLabel.placement === p.key;
      html += '<div class="label-cfg-placement-card' + (sel ? ' selected' : '') + '" onclick="setMainLabelPlacement(\'' + p.key + '\')">';
      html += '<div class="plc-icon">' + (p.key === 'neck' ? _neckSvg() : _inseamSvg()) + '</div>';
      html += '<div class="plc-name">' + p.name + '</div>';
      html += '</div>';
    });
    html += '</div></div>';

    // Dimensions
    var dim = LABEL_CONFIG.mainLabel.dimensions;
    html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Размер бирки</div>';
    html += '<div class="label-cfg-dims">' + dim.width + ' × ' + dim.height + ' ' + dim.unit + '</div>';
    html += '</div>';

    // Material
    html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Материал</div>';
    html += '<div class="label-cfg-pills">';
    LABEL_CONFIG.mainLabel.materials.forEach(function(m) {
      html += '<div class="label-cfg-pill' + (cfg.mainLabel.material === m.key ? ' active' : '') + '" onclick="setMainLabelMaterial(\'' + m.key + '\')">' + m.name + (m.priceDelta !== 0 ? '<span class="pill-price">' + (m.priceDelta > 0 ? '+' : '') + m.priceDelta + '₽</span>' : '') + '</div>';
    });
    html += '</div></div>';

    // Color
    html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Цвет бирки</div>';
    html += '<div class="label-cfg-colors">';
    LABEL_CONFIG.mainLabel.colors.forEach(function(c) {
      html += '<div class="label-cfg-color-swatch' + (cfg.mainLabel.color === c.key ? ' selected' : '') + '" style="background:' + c.hex + (c.key === 'white' ? ';border-color:#ccc' : '') + '" onclick="setMainLabelColor(\'' + c.key + '\')" title="' + c.name + '"></div>';
    });
    html += '</div></div>';

    // Upload
    html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Дизайн бирки</div>';
    html += _labelUploadHtml('mainLabel', cfg.mainLabel.uploadData);
    html += '</div>';
  }

  html += '</div></div>'; // close body + section

  // ── 3. HANG TAG ──
  var hangOpen = (cfg.hangTag.option !== 'none') ? ' open' : '';
  var hangPrice = 0;
  if (cfg.hangTag.option !== 'none') {
    var hOpt = LABEL_CONFIG.hangTag.options.find(function(o){return o.key === cfg.hangTag.option});
    hangPrice = hOpt ? hOpt.price : 0;
  }
  html += '<div class="label-cfg-section' + hangOpen + '" id="lcfg-hang">';
  html += '<div class="label-cfg-header" onclick="toggleLabelSection(\'lcfg-hang\')">';
  html += '<div class="label-cfg-title">' + LABEL_CONFIG.hangTag.name + '</div>';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  if (hangPrice > 0) html += '<span class="label-cfg-badge">+' + hangPrice + ' ₽</span>';
  html += _labelCfgArrowSvg + '</div></div>';
  html += '<div class="label-cfg-body">';

  // Option pills
  html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Тип</div>';
  html += '<div class="label-cfg-pills">';
  LABEL_CONFIG.hangTag.options.forEach(function(o) {
    html += '<div class="label-cfg-pill' + (cfg.hangTag.option === o.key ? ' active' : '') + '" onclick="setHangTagOption(\'' + o.key + '\')">' + o.name + (o.price > 0 ? '<span class="pill-price">+' + o.price + '₽</span>' : '') + '</div>';
  });
  html += '</div></div>';

  // Upload (for standard/custom)
  if (cfg.hangTag.option !== 'none') {
    html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Дизайн</div>';
    html += _labelUploadHtml('hangTag', cfg.hangTag.uploadData);
    html += '</div>';

    // Comments
    html += '<div class="label-cfg-row"><div class="label-cfg-row-label">Комментарий</div>';
    html += '<textarea class="label-cfg-textarea" placeholder="Размер, бумага, отделка..." onchange="state.labelConfig.hangTag.comments=this.value;scheduleSave()">' + (cfg.hangTag.comments || '') + '</textarea>';
    html += '</div>';
  }

  html += '</div></div>'; // close body + section

  // Summary
  if (totalPrice > 0) {
    html += '<div class="extras-summary">';
    html += '<div class="extras-summary-left">Бирки</div>';
    html += '<div class="extras-summary-right">+' + totalPrice.toLocaleString('ru') + ' ₽ <span style="color:var(--text-dim);font-weight:400">/ шт</span></div>';
    html += '</div>';
  }

  container.innerHTML = html;

  // Setup drop zones
  setTimeout(function() {
    ['careLabel','mainLabel','hangTag'].forEach(function(type) {
      var dz = document.getElementById('labelDrop_' + type);
      if (dz) setupLabelDropZone(dz, type);
    });
  }, 0);
}

// ── Label configurator handlers ──
function toggleCareLabel() {
  if (!state.labelConfig) state.labelConfig = getDefaultLabelConfig();
  state.labelConfig.careLabel.enabled = !state.labelConfig.careLabel.enabled;
  renderLabelConfigurator();
  updateTotal();
  scheduleSave();
}

function toggleLabelSection(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

function setCareLabelOption(key) {
  if (!state.labelConfig) state.labelConfig = getDefaultLabelConfig();
  state.labelConfig.careLabel.logoOption = key;
  renderLabelConfigurator();
  updateTotal();
  scheduleSave();
}

function setMainLabelOption(key) {
  if (!state.labelConfig) state.labelConfig = getDefaultLabelConfig();
  state.labelConfig.mainLabel.option = key;
  renderLabelConfigurator();
  updateTotal();
  scheduleSave();
}

function setMainLabelPlacement(key) {
  if (!state.labelConfig) state.labelConfig = getDefaultLabelConfig();
  state.labelConfig.mainLabel.placement = key;
  renderLabelConfigurator();
  scheduleSave();
}

function setMainLabelMaterial(key) {
  if (!state.labelConfig) state.labelConfig = getDefaultLabelConfig();
  state.labelConfig.mainLabel.material = key;
  renderLabelConfigurator();
  updateTotal();
  scheduleSave();
}

function setMainLabelColor(key) {
  if (!state.labelConfig) state.labelConfig = getDefaultLabelConfig();
  state.labelConfig.mainLabel.color = key;
  renderLabelConfigurator();
  scheduleSave();
}

function setHangTagOption(key) {
  if (!state.labelConfig) state.labelConfig = getDefaultLabelConfig();
  state.labelConfig.hangTag.option = key;
  renderLabelConfigurator();
  updateTotal();
  scheduleSave();
}

function handleLabelUpload(type, inputEl) {
  var file = inputEl.files ? inputEl.files[0] : null;
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Файл слишком большой (макс. 2 МБ)'); return; }
  var allowed = ['image/png','image/jpeg','image/svg+xml','application/pdf'];
  if (!allowed.includes(file.type)) { showToast('Поддерживаются: PNG, JPG, SVG, PDF'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    if (!state.labelConfig) state.labelConfig = getDefaultLabelConfig();
    state.labelConfig[type].uploadData = { name: file.name, dataUrl: e.target.result };
    renderLabelConfigurator();
    scheduleSave();
  };
  reader.readAsDataURL(file);
}

function removeLabelUpload(type) {
  if (!state.labelConfig || !state.labelConfig[type]) return;
  state.labelConfig[type].uploadData = null;
  renderLabelConfigurator();
  scheduleSave();
}

function setupLabelDropZone(element, type) {
  element.addEventListener('dragover', function(e) { e.preventDefault(); element.classList.add('drag-active'); });
  element.addEventListener('dragleave', function() { element.classList.remove('drag-active'); });
  element.addEventListener('drop', function(e) {
    e.preventDefault();
    element.classList.remove('drag-active');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleLabelUpload(type, { files: e.dataTransfer.files });
    }
  });
}

function toggleLabel(code) {
  // Legacy compatibility
  if (!state.labels) state.labels = [];
  var idx = state.labels.indexOf(code);
  if (idx >= 0) state.labels.splice(idx, 1);
  else state.labels.push(code);
  renderLabelConfigurator();
  updateTotal();
  scheduleSave();
}

function renderFabricGrid(type) {
  const grid = document.getElementById('fabricGrid');
  if (!grid) return;
  const fabrics = getFabricsForType(type);
  // Аксессуары — ткань не нужна, grid скрыт через updateAccessoryUI
  if (!fabrics || fabrics.length === 0) {
    grid.innerHTML = '';
    return;
  }
  const validKeys = fabrics.map(f => f.key);
  // Не перезаписываем пустой fabric — пустой означает «ещё не выбрано»
  // Перезаписываем только если fabric задан, но невалиден для нового типа
  if (state.fabric && !validKeys.includes(state.fabric)) {
    state.fabric = '';
  }
  grid.innerHTML = fabrics.map(f => {
    const sel = state.fabric === f.key;
    return `<div class="fit-option${sel?' selected':''}" data-fabric="${f.key}" onclick="selectFabric('${f.key}')" title="${f.name} · ${f.meta} · ${f.sub}">
      <div class="fit-check">${sel?'✓':''}</div>
      <div class="fit-info">
        <div class="fit-name">${f.name}</div>
        <div class="fit-desc">${f.meta} · ${f.sub}</div>
      </div>
    </div>`;
  }).join('');
}




// ════════════════════════════════════════════════════════════
//   DATA — COLORS (MEDASTEX)
// ════════════════════════════════════════════════════════════
// Medastex palette — full (all groups)

// ─── MEDASTEX PALETTE ───
const MEDASTEX_COLORS = [
  {code:'01-01',name:'Белый',            hex:'#F8F7F2'},{code:'01-02',name:'Молочный',          hex:'#F0EAD6'},
  {code:'02-01',name:'Кремовый',         hex:'#E8DABB'},{code:'02-02',name:'Бежевый',            hex:'#D9C9A3'},
  {code:'03-01',name:'Ванильный',        hex:'#F5E6A0'},{code:'03-02',name:'Светло-жёлтый',      hex:'#F0D060'},
  {code:'04-01',name:'Лимонный',         hex:'#F5E020'},{code:'04-02',name:'Жёлтый',             hex:'#F0C800'},
  {code:'04-03',name:'Золотистый',       hex:'#D4A017'},{code:'04-04',name:'Горчица',            hex:'#C8920A'},
  {code:'05-01',name:'Персик',           hex:'#F5C095'},{code:'05-02',name:'Оранжевый',          hex:'#F07020'},
  {code:'05-03',name:'Тёмно-оранжевый', hex:'#D05010'},{code:'06-01',name:'Пудровый',            hex:'#EFB8C0'},
  {code:'06-02',name:'Нежно-розовый',   hex:'#E0789A'},{code:'06-03',name:'Розовый яркий',       hex:'#E0305A'},
  {code:'07-01',name:'Коралловый',       hex:'#E84040'},{code:'07-02',name:'Красный',             hex:'#C81010'},
  {code:'08-01',name:'Бордо',            hex:'#901828'},{code:'08-02',name:'Марсала',             hex:'#6E1520'},
  {code:'09-01',name:'Лиловый',          hex:'#CC70A0'},{code:'09-02',name:'Фуксия',              hex:'#B81870'},
  {code:'09-19',name:'Пыльная фуксия',  hex:'#8C4060'},{code:'10-01',name:'Голубой',             hex:'#90C8E8'},
  {code:'10-02',name:'Васильковый',      hex:'#4890D0'},{code:'10-03',name:'Синий',               hex:'#1858A8'},
  {code:'11-01',name:'Небесный',         hex:'#60A8E0'},{code:'11-02',name:'Электрик',            hex:'#2050C8'},
  {code:'11-03',name:'Ярко-синий',       hex:'#1030A0'},{code:'12-01',name:'Синий тёмный',        hex:'#183080'},
  {code:'12-02',name:'Navy',             hex:'#101C58'},{code:'13-01',name:'Индиго',              hex:'#1C1848'},
  {code:'13-02',name:'Тёмный индиго',   hex:'#120E30'},{code:'14-01',name:'Лаванда',             hex:'#C8A8DC'},
  {code:'14-02',name:'Сиреневый',        hex:'#9060B8'},{code:'15-01',name:'Светло-фиолетовый',  hex:'#B080D0'},
  {code:'15-02',name:'Фиолетовый',       hex:'#7030A0'},{code:'15-03',name:'Тёмно-фиолетовый',  hex:'#501880'},
  {code:'16-01',name:'Мятный',           hex:'#90D8C0'},{code:'16-02',name:'Бирюзовый',          hex:'#30B090'},
  {code:'16-03',name:'Тёмная бирюза',   hex:'#188068'},{code:'17-01',name:'Светло-зелёный',     hex:'#70C870'},
  {code:'17-05',name:'Зелёный',          hex:'#208820'},{code:'18-01',name:'Изумрудный',          hex:'#107050'},
  {code:'18-02',name:'Тёмно-зелёный',   hex:'#0C5030'},{code:'18-03',name:'Хаки зелёный',       hex:'#4A6040'},
  {code:'18-04',name:'Оливковый',        hex:'#6A6830'},{code:'18-05',name:'Тёмная олива',       hex:'#484020'},
  {code:'19-01',name:'Светлый хаки',    hex:'#B0A878'},{code:'19-02',name:'Хаки',               hex:'#8A7848'},
  {code:'19-4151',name:'Милитари',       hex:'#505830'},{code:'20-01',name:'Светло-коричневый',  hex:'#A06838'},
  {code:'20-02',name:'Коричневый',       hex:'#784020'},{code:'20-04',name:'Тёмно-коричневый',   hex:'#502810'},
  {code:'20-05',name:'Шоколадный',       hex:'#381808'},{code:'21-01',name:'Кэмел',              hex:'#C89050'},
  {code:'21-02',name:'Тёмный кэмел',    hex:'#A87030'},{code:'21-03',name:'Терракота',          hex:'#C05030'},
  {code:'21-04',name:'Кирпичный',        hex:'#A03820'},{code:'22-01',name:'Светлый песок',      hex:'#E0D0A8'},
  {code:'22-02',name:'Песок',            hex:'#C8B880'},{code:'23-01',name:'Светлый тауп',       hex:'#C0A888'},
  {code:'23-02',name:'Тауп',             hex:'#9A8060'},{code:'23-03',name:'Мокко',              hex:'#785840'},
  {code:'24-01',name:'Светлый камень',  hex:'#C8C0B0'},{code:'24-02',name:'Камень',             hex:'#A09880'},
  {code:'24-03',name:'Тёмный камень',   hex:'#807870'},{code:'25-01',name:'Пепельно-розовый',   hex:'#D4C0B8'},
  {code:'25-02',name:'Серо-розовый',    hex:'#BCA8A0'},{code:'26-01',name:'Тёмно-серый',        hex:'#585858'},
  {code:'26-02',name:'Антрацит',         hex:'#3A3A3A'},{code:'27-01',name:'Угольный',            hex:'#2E2E2E'},
  {code:'28-01',name:'Тёмный уголь',    hex:'#242424'},{code:'28-02',name:'Графит',             hex:'#1E1E1E'},
  {code:'28-05',name:'Тёмный графит',   hex:'#181818'},{code:'29-01',name:'Глубокий серый',     hex:'#202020'},
  {code:'29-02',name:'Почти чёрный',    hex:'#161616'},{code:'29-03',name:'Navy-Black',         hex:'#101820'},
  {code:'30-01',name:'Тёмный navy',     hex:'#0C1428'},{code:'30-02',name:'Ночной синий',       hex:'#101830'},
  {code:'30-03',name:'Тёмный navy-2',   hex:'#141E40'},{code:'40-01',name:'Чёрный',             hex:'#0F0F0F'},
  {code:'40-02',name:'Глубокий чёрный', hex:'#080808'},{code:'50-01',name:'Белый меланж',        hex:'#EEEEEC'},
  {code:'50-03',name:'Светлый меланж',  hex:'#E2E2E0'},{code:'50-04',name:'Серый меланж св.',    hex:'#D0D0CE'},
  {code:'50-05',name:'Серый меланж',    hex:'#BCBCBA'},{code:'50-07',name:'Серебро меланж',      hex:'#ABABAA'},
  {code:'50-08',name:'Средний меланж',  hex:'#9A9A98'},{code:'51-01',name:'Розовый меланж',      hex:'#D8AABA'},
  {code:'51-02',name:'Голубой меланж',  hex:'#A8C0D8'},{code:'51-03',name:'Зелёный меланж',      hex:'#A0B898'},
  {code:'51-04',name:'Бежевый меланж',  hex:'#D0C0A8'},{code:'51-05',name:'Navy меланж',         hex:'#5A6070'},
  {code:'51-06',name:'Синий меланж',    hex:'#7080A0'},{code:'51-07',name:'Серо-синий меланж',   hex:'#8090A8'},
  {code:'51-08',name:'Тёмный меланж',   hex:'#686868'},
];

const COLOR_GROUPS = [
  {label:'Белые / Кремовые',   codes:['01-01','01-02','02-01','02-02']},
  {label:'Жёлтые / Оранжевые',codes:['03-01','03-02','04-01','04-02','04-03','04-04','05-01','05-02','05-03']},
  {label:'Розовые / Красные',  codes:['06-01','06-02','06-03','07-01','07-02','08-01','08-02','09-01','09-02','09-19']},
  {label:'Синие / Фиолетовые', codes:['10-01','10-02','10-03','11-01','11-02','11-03','12-01','12-02','13-01','13-02','14-01','14-02','15-01','15-02','15-03']},
  {label:'Зелёные / Хаки',     codes:['16-01','16-02','16-03','17-01','17-05','18-01','18-02','18-03','18-04','18-05','19-01','19-02','19-4151']},
  {label:'Коричневые / Земля', codes:['20-01','20-02','20-04','20-05','21-01','21-02','21-03','21-04','22-01','22-02','23-01','23-02','23-03','24-01','24-02','24-03','25-01','25-02']},
  {label:'Серые / Чёрные',     codes:['26-01','26-02','27-01','28-01','28-02','28-05','29-01','29-02','29-03','30-01','30-02','30-03','40-01','40-02']},
  {label:'Меланжи',            codes:['50-01','50-03','50-04','50-05','50-07','50-08','51-01','51-02','51-03','51-04','51-05','51-06','51-07','51-08']},
];



// ════════════════════════════════════════════════════════════
//   DATA — COLORS (COTTONPROM)
// ════════════════════════════════════════════════════════════
// CottonProm palette v1 (96 colors, 5001–5096)

// ─── COTTONPROM COLORS ───
const COTTONPROM_COLORS = [
  {code:'5001',name:'Белый',              hex:'#FFFFFF'},
  {code:'5002',name:'Молочный',           hex:'#FAF6F0'},
  {code:'5003',name:'Слоновая кость',     hex:'#F5EDE0'},
  {code:'5004',name:'Бежевый светлый',    hex:'#C9A882'},
  {code:'5005',name:'Бежевый',            hex:'#BE9470'},
  {code:'5006',name:'Бежево-коричневый',  hex:'#AA8060'},
  {code:'5007',name:'Тауп',               hex:'#7D6960'},
  {code:'5008',name:'Пудровый розовый',   hex:'#D4A898'},
  {code:'5009',name:'Пыльная роза',       hex:'#C08878'},
  {code:'5010',name:'Серо-бежевый',       hex:'#8A7870'},
  {code:'5011',name:'Серо-лиловый',       hex:'#705870'},
  {code:'5012',name:'Сливовый',           hex:'#685068'},
  {code:'5013',name:'Нежно-розовый',      hex:'#F2C8D0'},
  {code:'5014',name:'Светло-розовый',     hex:'#EEC4CC'},
  {code:'5015',name:'Розовый',            hex:'#E8A8BC'},
  {code:'5016',name:'Розово-лиловый',     hex:'#D898C8'},
  {code:'5017',name:'Лиловый',            hex:'#C888C0'},
  {code:'5018',name:'Фуксия',             hex:'#960880'},
  {code:'5019',name:'Лососевый',          hex:'#EE6878'},
  {code:'5020',name:'Коралловый красный', hex:'#E84858'},
  {code:'5021',name:'Малиновый',          hex:'#B01858'},
  {code:'5022',name:'Красный',            hex:'#C01838'},
  {code:'5023',name:'Светло-малиновый',   hex:'#C05878'},
  {code:'5024',name:'Алый',               hex:'#C81030'},
  {code:'5025',name:'Бордо',              hex:'#8C0020'},
  {code:'5026',name:'Тёмное бордо',       hex:'#780018'},
  {code:'5027',name:'Пурпурно-коричневый',hex:'#582838'},
  {code:'5028',name:'Коричнево-серый',    hex:'#5A4A40'},
  {code:'5029',name:'Тёмный шоколад',     hex:'#2C1818'},
  {code:'5030',name:'Чёрно-коричневый',   hex:'#200C0C'},
  {code:'5031',name:'Светлый оранжевый',  hex:'#F87840'},
  {code:'5032',name:'Оранжевый',          hex:'#F07000'},
  {code:'5033',name:'Карамельный',        hex:'#C87830'},
  {code:'5034',name:'Тёмно-коричневый',   hex:'#983800'},
  {code:'5035',name:'Лососево-розовый',   hex:'#F07868'},
  {code:'5036',name:'Ярко-оранжевый',     hex:'#F05800'},
  {code:'5037',name:'Кремово-жёлтый',     hex:'#F5E098'},
  {code:'5038',name:'Лаймово-жёлтый',     hex:'#D8E000'},
  {code:'5039',name:'Жёлтый',             hex:'#F0D030'},
  {code:'5040',name:'Янтарный',           hex:'#F0B000'},
  {code:'5041',name:'Золотистый',         hex:'#C89800'},
  {code:'5042',name:'Лайм',               hex:'#D0E038'},
  {code:'5043',name:'Салатовый',          hex:'#B8D028'},
  {code:'5044',name:'Светло-зелёный',     hex:'#60C038'},
  {code:'5045',name:'Зелёный',            hex:'#40A828'},
  {code:'5046',name:'Изумрудный',         hex:'#187838'},
  {code:'5047',name:'Тёмно-зелёный',      hex:'#0C6838'},
  {code:'5048',name:'Хвойный',            hex:'#084830'},
  {code:'5049',name:'Голубой ледяной',    hex:'#CCE8F8'},
  {code:'5050',name:'Мятный',             hex:'#A8F0D8'},
  {code:'5051',name:'Бирюзово-мятный',    hex:'#70E8C0'},
  {code:'5052',name:'Бирюзовый',          hex:'#30C8A0'},
  {code:'5053',name:'Изумрудно-морской',  hex:'#009870'},
  {code:'5054',name:'Тёмно-морской',      hex:'#004030'},
  {code:'5055',name:'Лавандово-голубой',  hex:'#A8B8E8'},
  {code:'5056',name:'Ярко-голубой',       hex:'#28C0E8'},
  {code:'5057',name:'Небесно-голубой',    hex:'#48A8E8'},
  {code:'5058',name:'Синевато-голубой',   hex:'#4870C0'},
  {code:'5059',name:'Ледяной',            hex:'#C8F0F8'},
  {code:'5060',name:'Циановый',           hex:'#00C8E0'},
  {code:'5061',name:'Ярко-синий',         hex:'#0090D0'},
  {code:'5062',name:'Тёмно-бирюзовый',    hex:'#008898'},
  {code:'5063',name:'Серо-синий',         hex:'#507080'},
  {code:'5064',name:'Стальной голубой',   hex:'#8098B8'},
  {code:'5065',name:'Серо-голубой',       hex:'#6880A0'},
  {code:'5066',name:'Электрик',           hex:'#1848D8'},
  {code:'5067',name:'Морской синий',      hex:'#0050A8'},
  {code:'5068',name:'Тёмно-синий',        hex:'#003888'},
  {code:'5069',name:'Морская волна',      hex:'#1C5878'},
  {code:'5070',name:'Тёмно-стальной',     hex:'#283848'},
  {code:'5071',name:'Ночной',             hex:'#101828'},
  {code:'5072',name:'Индиго',             hex:'#202870'},
  {code:'5073',name:'Светло-серый',       hex:'#C8D0D4'},
  {code:'5074',name:'Тёплый серый',       hex:'#A09890'},
  {code:'5075',name:'Голубовато-серый',   hex:'#98B4C0'},
  {code:'5076',name:'Сине-серый',         hex:'#7890A0'},
  {code:'5077',name:'Тёмно-серый',        hex:'#3C4448'},
  {code:'5078',name:'Антрацит',           hex:'#2C3440'},
  {code:'5079',name:'Нежно-розово-лиловый',hex:'#E8D0D8'},
  {code:'5080',name:'Сиреневый',          hex:'#B0A8C8'},
  {code:'5081',name:'Светло-сиреневый',   hex:'#D0B8DC'},
  {code:'5082',name:'Лавандовый',         hex:'#B890C8'},
  {code:'5083',name:'Ярко-фиолетовый',    hex:'#5048B8'},
  {code:'5084',name:'Фиолетовый',         hex:'#7830A0'},
  {code:'5085',name:'Лилово-серый',       hex:'#7C6898'},
  {code:'5086',name:'Тёмно-фиолетовый',   hex:'#502870'},
  {code:'5087',name:'Оливковый',          hex:'#A8A848'},
  {code:'5088',name:'Хаки-зелёный',       hex:'#608858'},
  {code:'5089',name:'Хаки',               hex:'#685E30'},
  {code:'5090',name:'Тёмное хаки',        hex:'#545020'},
  {code:'5091',name:'Тёмно-полночный',    hex:'#181C30'},
  {code:'5092',name:'Чёрный',             hex:'#141010'},
  {code:'5093',name:'Меланж светлый',     hex:'#D0D0CC'},
  {code:'5094',name:'Меланж серый',       hex:'#B0B0A8'},
  {code:'5095',name:'Меланж тёмный',      hex:'#909088'},
  {code:'5096',name:'Меланж тёмно-серый', hex:'#707068'},
];

const COTTONPROM_GROUPS = [
  {label:'Белые / Кремовые',       codes:['5001','5002','5003']},
  {label:'Бежевые / Коричневые',   codes:['5004','5005','5006','5007','5008','5009','5010','5011','5012']},
  {label:'Розовые / Малиновые',    codes:['5013','5014','5015','5016','5017','5018','5019','5020','5021','5022','5023','5024']},
  {label:'Бордо / Тёмные',         codes:['5025','5026','5027','5028','5029','5030']},
  {label:'Оранжевые',              codes:['5031','5032','5033','5034','5035','5036']},
  {label:'Жёлтые',                 codes:['5037','5038','5039','5040','5041','5042']},
  {label:'Зелёные',                codes:['5043','5044','5045','5046','5047','5048']},
  {label:'Бирюзовые / Мятные',     codes:['5049','5050','5051','5052','5053','5054']},
  {label:'Голубые',                codes:['5055','5056','5057','5058','5059','5060']},
  {label:'Синие',                  codes:['5061','5062','5063','5064','5065','5066','5067','5068','5069','5070','5071','5072']},
  {label:'Серые / Антрацит',       codes:['5073','5074','5075','5076','5077','5078']},
  {label:'Сиреневые / Фиолетовые', codes:['5079','5080','5081','5082','5083','5084','5085','5086']},
  {label:'Оливковые / Хаки',       codes:['5087','5088','5089','5090']},
  {label:'Тёмные / Чёрные',        codes:['5091','5092']},
  {label:'Меланж',                 codes:['5093','5094','5095','5096']},
];

let activeColorSupplier = 'medastex';

// v1.6 fix: глобальный поиск цвета в обеих палитрах (Medastex + CottonProm)
function findColorEntry(code) {
  return MEDASTEX_COLORS.find(x => x.code === code)
      || COTTONPROM_COLORS.find(x => x.code === code)
      || null;
}







// ════════════════════════════════════════════════════════════
//   DATA — CONSTANTS
// ════════════════════════════════════════════════════════════
// Type names, fabric names, tech names, zone labels, sizes

const SIZES = ['2XS','XS','S','M','L','XL','2XL','3XL'];
const TYPE_NAMES   = {tee:'Футболка',hoodie:'Худи',sweat:'Свитшот',longsleeve:'Лонгслив','zip-hoodie':'Зип-худи','half-zip':'Халф-зип',tank:'Майка',pants:'Штаны',shorts:'Шорты',shopper:'Шоппер',basecap:'Бейсболка','dad-cap':'Дэд кэп','5panel':'5-панельная',socks:'Носки'};
const FABRIC_NAMES = {
  'kulirnaya':'Кулирка · 100% хлопок',
  'dvunitka':'2-х нитка · 100% хлопок',
  'interlock':'Интерлок · 100% хлопок',
  'futher-350-nachers':'Футер 3х нитка 350г Начёс · 100% хлопок',
  'futher-350-petlya':'Футер 3х нитка 350г Петля · 100% хлопок',
  'futher-370-nachers':'Футер 3х нитка 370г Начёс · 80/20 хлопок ПЭ',
  'futher-370-petlya':'Футер 3х нитка 370г Петля · 80/20 хлопок ПЭ',
  'futher-470-petlya':'Футер 3х нитка 470г Петля · 100% хлопок'
};
const TECH_NAMES   = {screen:'Шелкография',dtg:'DTG',embroidery:'Вышивка',dtf:'DTF Transfer'};
const ZONE_LABELS  = {chest:'Грудь',back:'Спина','left-sleeve':'Лев. рукав','right-sleeve':'Прав. рукав',front:'Лицевая сторона','back-bag':'Обратная сторона','front-panel':'Тулья спереди','back-panel':'Тулья сзади','side-panel':'Боковая панель','side-a':'Сторона A','side-b':'Сторона B',hood:'Капюшон',pocket:'Карман','sleeve-l':'Лев. рукав','sleeve-r':'Прав. рукав'};
const STATUS_LABELS= {draft:'Черновик',review:'Согласование',approved:'Одобрен',production:'В работе',done:'Готов'};




