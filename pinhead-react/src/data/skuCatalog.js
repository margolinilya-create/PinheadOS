// ═══════════════════════════════════════════
// SKU_CATALOG — каталог изделий v2
// 50 артикулов · 11 категорий
// ═══════════════════════════════════════════

export const SKU_CATEGORIES = [
  {id:'tshirts',     name:'Футболки'},
  {id:'longsleeves', name:'Лонгсливы'},
  {id:'tanks',       name:'Майки'},
  {id:'hoodies',     name:'Худи'},
  {id:'sweatshirts', name:'Свитшоты'},
  {id:'ziphoodies',  name:'Зип-худи'},
  {id:'halfzips',    name:'Халф-зипы'},
  {id:'bombers',     name:'Бомберы'},
  {id:'pants',       name:'Брюки'},
  {id:'shorts',      name:'Шорты'},
  {id:'accessories', name:'Аксессуары'},
];

export const SKU_CATALOG_DEFAULT = [
  // ── Футболки (6) ──
  {code:'T-001', name:'Футболка Regular',        category:'tshirts',    fit:'regular',  sewingPrice:200, mainFabricUsage:1.0, trimCode:'ribana-1x1', trimUsage:0.15, mockupType:'tee',        zones:['front','back','sleeve-l','sleeve-r']},
  {code:'T-002', name:'Футболка Free',           category:'tshirts',    fit:'free',     sewingPrice:220, mainFabricUsage:1.1, trimCode:'ribana-1x1', trimUsage:0.15, mockupType:'tee',        zones:['front','back','sleeve-l','sleeve-r']},
  {code:'T-003', name:'Футболка Oversize',       category:'tshirts',    fit:'oversize', sewingPrice:250, mainFabricUsage:1.3, trimCode:'ribana-1x1', trimUsage:0.18, mockupType:'tee',        zones:['front','back','sleeve-l','sleeve-r']},
  {code:'T-004', name:'Футболка Cropped',        category:'tshirts',    fit:'free',     sewingPrice:210, mainFabricUsage:0.9, trimCode:'ribana-1x1', trimUsage:0.12, mockupType:'tee',        zones:['front','back','sleeve-l','sleeve-r']},
  {code:'T-005', name:'Футболка Boxy',           category:'tshirts',    fit:'oversize', sewingPrice:240, mainFabricUsage:1.2, trimCode:'ribana-1x1', trimUsage:0.16, mockupType:'tee',        zones:['front','back','sleeve-l','sleeve-r']},
  {code:'T-006', name:'Футболка Polo',           category:'tshirts',    fit:'regular',  sewingPrice:280, mainFabricUsage:1.1, trimCode:'ribana-1x1', trimUsage:0.18, mockupType:'polo',       zones:['front','back','sleeve-l','sleeve-r']},
  // ── Лонгсливы (4) ──
  {code:'LS-001',name:'Лонгслив Regular',        category:'longsleeves',fit:'regular',  sewingPrice:250, mainFabricUsage:1.3, trimCode:'ribana-1x1', trimUsage:0.18, mockupType:'longsleeve', zones:['front','back','sleeve-l','sleeve-r']},
  {code:'LS-002',name:'Лонгслив Oversize',       category:'longsleeves',fit:'oversize', sewingPrice:280, mainFabricUsage:1.5, trimCode:'ribana-1x1', trimUsage:0.20, mockupType:'longsleeve', zones:['front','back','sleeve-l','sleeve-r']},
  {code:'LS-003',name:'Лонгслив Free',           category:'longsleeves',fit:'free',     sewingPrice:260, mainFabricUsage:1.4, trimCode:'ribana-1x1', trimUsage:0.18, mockupType:'longsleeve', zones:['front','back','sleeve-l','sleeve-r']},
  {code:'LS-004',name:'Лонгслив Boxy',           category:'longsleeves',fit:'oversize', sewingPrice:290, mainFabricUsage:1.5, trimCode:'ribana-1x1', trimUsage:0.20, mockupType:'longsleeve', zones:['front','back','sleeve-l','sleeve-r']},
  // ── Майки (3) ──
  {code:'TK-001',name:'Майка Regular',           category:'tanks',      fit:'regular',  sewingPrice:170, mainFabricUsage:0.8, trimCode:'ribana-1x1', trimUsage:0.12, mockupType:'tank',       zones:['front','back']},
  {code:'TK-002',name:'Майка Oversize',          category:'tanks',      fit:'oversize', sewingPrice:190, mainFabricUsage:0.9, trimCode:'ribana-1x1', trimUsage:0.14, mockupType:'tank',       zones:['front','back']},
  {code:'TK-003',name:'Майка Cropped',           category:'tanks',      fit:'free',     sewingPrice:160, mainFabricUsage:0.7, trimCode:'ribana-1x1', trimUsage:0.10, mockupType:'tank',       zones:['front','back']},
  // ── Худи (5) ──
  {code:'H-001', name:'Худи Regular',            category:'hoodies',    fit:'regular',  sewingPrice:400, mainFabricUsage:1.6, trimCode:'kashkorse',  trimUsage:0.25, mockupType:'hoodie',     zones:['front','back','sleeve-l','sleeve-r','hood']},
  {code:'H-002', name:'Худи Oversize',           category:'hoodies',    fit:'oversize', sewingPrice:450, mainFabricUsage:1.8, trimCode:'kashkorse',  trimUsage:0.30, mockupType:'hoodie',     zones:['front','back','sleeve-l','sleeve-r','hood']},
  {code:'H-003', name:'Худи Free',               category:'hoodies',    fit:'free',     sewingPrice:420, mainFabricUsage:1.7, trimCode:'kashkorse',  trimUsage:0.28, mockupType:'hoodie',     zones:['front','back','sleeve-l','sleeve-r','hood']},
  {code:'H-004', name:'Худи Boxy',               category:'hoodies',    fit:'oversize', sewingPrice:460, mainFabricUsage:1.9, trimCode:'kashkorse',  trimUsage:0.30, mockupType:'hoodie',     zones:['front','back','sleeve-l','sleeve-r','hood']},
  {code:'H-005', name:'Худи Cropped',            category:'hoodies',    fit:'free',     sewingPrice:380, mainFabricUsage:1.4, trimCode:'kashkorse',  trimUsage:0.22, mockupType:'hoodie',     zones:['front','back','sleeve-l','sleeve-r','hood']},
  // ── Свитшоты (5) ──
  {code:'SW-001',name:'Свитшот Regular',         category:'sweatshirts',fit:'regular',  sewingPrice:350, mainFabricUsage:1.4, trimCode:'kashkorse',  trimUsage:0.22, mockupType:'sweat',      zones:['front','back','sleeve-l','sleeve-r']},
  {code:'SW-002',name:'Свитшот Oversize',        category:'sweatshirts',fit:'oversize', sewingPrice:380, mainFabricUsage:1.6, trimCode:'kashkorse',  trimUsage:0.25, mockupType:'sweat',      zones:['front','back','sleeve-l','sleeve-r']},
  {code:'SW-003',name:'Свитшот Free',            category:'sweatshirts',fit:'free',     sewingPrice:360, mainFabricUsage:1.5, trimCode:'kashkorse',  trimUsage:0.23, mockupType:'sweat',      zones:['front','back','sleeve-l','sleeve-r']},
  {code:'SW-004',name:'Свитшот Cropped',         category:'sweatshirts',fit:'free',     sewingPrice:330, mainFabricUsage:1.2, trimCode:'kashkorse',  trimUsage:0.20, mockupType:'sweat',      zones:['front','back','sleeve-l','sleeve-r']},
  {code:'SW-005',name:'Свитшот Boxy',            category:'sweatshirts',fit:'oversize', sewingPrice:390, mainFabricUsage:1.6, trimCode:'kashkorse',  trimUsage:0.25, mockupType:'sweat',      zones:['front','back','sleeve-l','sleeve-r']},
  // ── Зип-худи (4) ──
  {code:'ZH-001',name:'Зип-худи Regular',        category:'ziphoodies', fit:'regular',  sewingPrice:480, mainFabricUsage:1.7, trimCode:'kashkorse',  trimUsage:0.28, mockupType:'zip-hoodie', zones:['front','back','sleeve-l','sleeve-r','hood']},
  {code:'ZH-002',name:'Зип-худи Oversize',       category:'ziphoodies', fit:'oversize', sewingPrice:520, mainFabricUsage:1.9, trimCode:'kashkorse',  trimUsage:0.32, mockupType:'zip-hoodie', zones:['front','back','sleeve-l','sleeve-r','hood']},
  {code:'ZH-003',name:'Зип-худи Free',           category:'ziphoodies', fit:'free',     sewingPrice:500, mainFabricUsage:1.8, trimCode:'kashkorse',  trimUsage:0.30, mockupType:'zip-hoodie', zones:['front','back','sleeve-l','sleeve-r','hood']},
  {code:'ZH-004',name:'Зип-худи Cropped',        category:'ziphoodies', fit:'free',     sewingPrice:460, mainFabricUsage:1.5, trimCode:'kashkorse',  trimUsage:0.25, mockupType:'zip-hoodie', zones:['front','back','sleeve-l','sleeve-r','hood']},
  // ── Халф-зипы (4) ──
  {code:'HZ-001',name:'Халф-зип Regular',        category:'halfzips',   fit:'regular',  sewingPrice:420, mainFabricUsage:1.5, trimCode:'kashkorse',  trimUsage:0.25, mockupType:'half-zip',   zones:['front','back','sleeve-l','sleeve-r']},
  {code:'HZ-002',name:'Халф-зип Oversize',       category:'halfzips',   fit:'oversize', sewingPrice:460, mainFabricUsage:1.7, trimCode:'kashkorse',  trimUsage:0.28, mockupType:'half-zip',   zones:['front','back','sleeve-l','sleeve-r']},
  {code:'HZ-003',name:'Халф-зип Free',           category:'halfzips',   fit:'free',     sewingPrice:440, mainFabricUsage:1.6, trimCode:'kashkorse',  trimUsage:0.26, mockupType:'half-zip',   zones:['front','back','sleeve-l','sleeve-r']},
  {code:'HZ-004',name:'Халф-зип Boxy',           category:'halfzips',   fit:'oversize', sewingPrice:470, mainFabricUsage:1.7, trimCode:'kashkorse',  trimUsage:0.28, mockupType:'half-zip',   zones:['front','back','sleeve-l','sleeve-r']},
  // ── Бомберы (3) ──
  {code:'BM-001',name:'Бомбер Regular',          category:'bombers',    fit:'regular',  sewingPrice:500, mainFabricUsage:1.7, trimCode:'kashkorse',  trimUsage:0.28, mockupType:null,         zones:['front','back','sleeve-l','sleeve-r']},
  {code:'BM-002',name:'Бомбер Oversize',         category:'bombers',    fit:'oversize', sewingPrice:550, mainFabricUsage:1.9, trimCode:'kashkorse',  trimUsage:0.32, mockupType:null,         zones:['front','back','sleeve-l','sleeve-r']},
  {code:'BM-003',name:'Бомбер Cropped',          category:'bombers',    fit:'free',     sewingPrice:480, mainFabricUsage:1.5, trimCode:'kashkorse',  trimUsage:0.25, mockupType:null,         zones:['front','back','sleeve-l','sleeve-r']},
  // ── Брюки (5) ──
  {code:'P-001', name:'Брюки Regular',           category:'pants',      fit:'regular',  sewingPrice:350, mainFabricUsage:1.4, trimCode:'kashkorse',  trimUsage:0.15, mockupType:'pants',      zones:['front','back']},
  {code:'P-002', name:'Брюки Wide',              category:'pants',      fit:'free',     sewingPrice:380, mainFabricUsage:1.6, trimCode:'kashkorse',  trimUsage:0.18, mockupType:'pants',      zones:['front','back']},
  {code:'P-003', name:'Брюки Jogger',            category:'pants',      fit:'regular',  sewingPrice:370, mainFabricUsage:1.5, trimCode:'kashkorse',  trimUsage:0.18, mockupType:'pants',      zones:['front','back']},
  {code:'P-004', name:'Брюки Cargo',             category:'pants',      fit:'free',     sewingPrice:420, mainFabricUsage:1.7, trimCode:'kashkorse',  trimUsage:0.20, mockupType:'pants',      zones:['front','back']},
  {code:'P-005', name:'Брюки Straight',          category:'pants',      fit:'regular',  sewingPrice:360, mainFabricUsage:1.5, trimCode:'kashkorse',  trimUsage:0.16, mockupType:'pants',      zones:['front','back']},
  // ── Шорты (4) ──
  {code:'SH-001',name:'Шорты Regular',           category:'shorts',     fit:'regular',  sewingPrice:250, mainFabricUsage:0.9, trimCode:'kashkorse',  trimUsage:0.12, mockupType:'shorts',     zones:['front','back']},
  {code:'SH-002',name:'Шорты Wide',              category:'shorts',     fit:'free',     sewingPrice:270, mainFabricUsage:1.0, trimCode:'kashkorse',  trimUsage:0.14, mockupType:'shorts',     zones:['front','back']},
  {code:'SH-003',name:'Шорты Cargo',             category:'shorts',     fit:'free',     sewingPrice:300, mainFabricUsage:1.1, trimCode:'kashkorse',  trimUsage:0.15, mockupType:'shorts',     zones:['front','back']},
  {code:'SH-004',name:'Шорты Sport',             category:'shorts',     fit:'regular',  sewingPrice:240, mainFabricUsage:0.8, trimCode:'kashkorse',  trimUsage:0.12, mockupType:'shorts',     zones:['front','back']},
  // ── Аксессуары (7) ──
  {code:'BAG-001',name:'Шоппер',                 category:'accessories',fit:null,       sewingPrice:150, mainFabricUsage:0.6, trimCode:null,         trimUsage:0,    mockupType:'shopper',    zones:['front','back']},
  {code:'BAG-002',name:'Тоут-бэг',               category:'accessories',fit:null,       sewingPrice:180, mainFabricUsage:0.7, trimCode:null,         trimUsage:0,    mockupType:'shopper',    zones:['front','back']},
  {code:'CAP-001',name:'Бейсболка',              category:'accessories',fit:null,       sewingPrice:250, mainFabricUsage:0.3, trimCode:null,         trimUsage:0,    mockupType:'basecap',    zones:['front']},
  {code:'CAP-002',name:'Дэд кэп',               category:'accessories',fit:null,       sewingPrice:270, mainFabricUsage:0.3, trimCode:null,         trimUsage:0,    mockupType:'dad-cap',    zones:['front']},
  {code:'CAP-003',name:'5-панельная',            category:'accessories',fit:null,       sewingPrice:230, mainFabricUsage:0.3, trimCode:null,         trimUsage:0,    mockupType:'5panel',     zones:['front']},
  {code:'BNE-001',name:'Бини',                   category:'accessories',fit:null,       sewingPrice:180, mainFabricUsage:0.25,trimCode:null,         trimUsage:0,    mockupType:null,         zones:['front']},
  {code:'SOX-001',name:'Носки',                  category:'accessories',fit:null,       sewingPrice:120, mainFabricUsage:0.15,trimCode:null,         trimUsage:0,    mockupType:'socks',      zones:[]},
];
