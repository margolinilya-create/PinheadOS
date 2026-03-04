// ═══════════════════════════════════════════
// SKU_CATALOG — каталог изделий
// ═══════════════════════════════════════════

export const SKU_CATEGORIES = [
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

export const SKU_CATALOG_DEFAULT = [
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
  // Аксессуары
  {code:'BAG-001',name:'Шоппер',              category:'accessories',fit:null,       sewingPrice:150, mainFabricUsage:0.6, trimCode:null,         trimUsage:0,    mockupType:'shopper',    zones:['front','back']},
  {code:'CAP-001',name:'Бейсболка',           category:'accessories',fit:null,       sewingPrice:250, mainFabricUsage:0.3, trimCode:null,         trimUsage:0,    mockupType:'basecap',    zones:['front']},
  {code:'CAP-002',name:'Дэд кэп',            category:'accessories',fit:null,       sewingPrice:270, mainFabricUsage:0.3, trimCode:null,         trimUsage:0,    mockupType:'dad-cap',    zones:['front']},
  {code:'CAP-003',name:'5-панельная',         category:'accessories',fit:null,       sewingPrice:230, mainFabricUsage:0.3, trimCode:null,         trimUsage:0,    mockupType:'5panel',     zones:['front']},
  {code:'SOX-001',name:'Носки',               category:'accessories',fit:null,       sewingPrice:120, mainFabricUsage:0.15,trimCode:null,         trimUsage:0,    mockupType:'socks',      zones:[]},
];
