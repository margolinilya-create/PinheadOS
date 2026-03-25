// ═══════════════════════════════════════════
// EXTRAS — обработки, лейблы, фурнитура
// ═══════════════════════════════════════════

export const EXTRAS_GROUPS = [
  { id: 'construction', name: 'Конструктивные' },
  { id: 'neck',         name: 'Отделка горловины' },
  { id: 'cords',        name: 'Шнурки и фурнитура' },
  { id: 'zippers',      name: 'Молнии' },
  { id: 'labels',       name: 'Бирки и лейблы' },
  { id: 'bags',         name: 'Аксессуары' },
];

export const EXTRAS_CATALOG_DEFAULT = [
  // Конструктивные
  {code:'hanger-loop',     group:'construction', name:'Петля для вешалки',       price:15, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts']},
  {code:'reinforced-seam', group:'construction', name:'Усиление плечевых швов',  price:40, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers']},
  {code:'double-stitch',   group:'construction', name:'Двойная отстрочка',       price:30, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts']},
  {code:'cuff-ribana',     group:'construction', name:'Подгиб рукавов рибана',   price:25, forCategories:['longsleeves','hoodies','sweatshirts','ziphoodies','halfzips','bombers']},
  // Отделка горловины
  {code:'neck-stitch',     group:'neck', name:'Отстрочка по горловине',    price:10, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers']},
  {code:'neck-flatlock',   group:'neck', name:'Распошив по горловине',     price:10, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers']},
  {code:'neck-twill',      group:'neck', name:'Закрытие киперной тесьмой', price:24, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers']},
  // Шнурки и фурнитура
  {code:'grommet',         group:'cords', name:'Люверсы на капюшон',     price:35, forCategories:['hoodies','ziphoodies','halfzips']},
  {code:'lace-flat',       group:'cords', name:'Шнурок плоский',         price:20, forCategories:['hoodies','ziphoodies','halfzips']},
  {code:'lace-waxed',      group:'cords', name:'Шнурок вощёный',         price:25, forCategories:['hoodies','ziphoodies','halfzips']},
  {code:'lace-lock',       group:'cords', name:'Фиксатор шнурка',        price:15, forCategories:['hoodies','ziphoodies','halfzips']},
  // Молнии
  {code:'zipper-ykk',      group:'zippers', name:'Молния YKK',            price:120, forCategories:['ziphoodies','bombers']},
  {code:'zipper-half',     group:'zippers', name:'Молния полузакрытая',    price:80,  forCategories:['halfzips']},
  // Бирки и лейблы
  {code:'patch-woven',     group:'labels', name:'Нашивка тканая (ворот)',    price:30, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts']},
  {code:'patch-jacquard',  group:'labels', name:'Нашивка жаккардовая',       price:45, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts']},
  {code:'label-hem',       group:'labels', name:'Лейбл на подоле',           price:20, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers']},
  {code:'tag-size',        group:'labels', name:'Бирка размерная (вшивная)', price:10, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts','accessories']},
  {code:'hang-tag',        group:'labels', name:'Хэнг-тег (картон)',         price:15, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts','accessories']},
  {code:'label-seam',      group:'labels', name:'Притачивание бирки (в шов)',price:7,  forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts']},
  {code:'label-sew',       group:'labels', name:'Пришив бирки (не в шов)',   price:35, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts','accessories']},
  // Аксессуары
  {code:'strap-reinforce', group:'bags', name:'Усиление ручек',    price:20, forCategories:['accessories']},
  {code:'magnet-snap',     group:'bags', name:'Кнопка магнитная',  price:30, forCategories:['accessories']},
];

export const EXTRAS_ICONS = {
  'grommet':        '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="8"/><circle cx="18" cy="18" r="4"/><path d="M18 2v6M18 28v6M2 18h6M28 18h6"/></svg>',
  'lace-flat':      '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18c4-6 8 6 12 0s8 6 12 0"/><path d="M6 24c4-6 8 6 12 0s8 6 12 0"/></svg>',
  'lace-waxed':     '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18c4-6 8 6 12 0s8 6 12 0"/><circle cx="8" cy="22" r="2"/><circle cx="28" cy="22" r="2"/></svg>',
  'lace-lock':      '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="13" y="10" width="10" height="16" rx="2"/><path d="M16 4v6M20 4v6M16 26v6M20 26v6"/><line x1="13" y1="18" x2="23" y2="18"/></svg>',
  'zipper-ykk':     '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4v28M22 4v28"/><path d="M14 10l8 4-8 4 8 4-8 4"/><rect x="12" y="2" width="12" height="5" rx="1"/></svg>',
  'zipper-half':    '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14v18M22 14v18"/><path d="M14 18l8 4-8 4 8 4"/><rect x="12" y="10" width="12" height="5" rx="1"/></svg>',
  'hanger-loop':    '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6a4 4 0 0 1 4 4c0 2-4 4-4 4s-4-2-4-4a4 4 0 0 1 4-4z"/><path d="M10 28h16"/><path d="M10 28L18 18l8 10"/></svg>',
  'reinforced-seam':'<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8l20 20"/><path d="M5 14l4-4M10 19l4-4M15 24l4-4M20 29l4-4"/></svg>',
  'double-stitch':  '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h28" stroke-dasharray="3 3"/><path d="M4 22h28" stroke-dasharray="3 3"/><path d="M4 10h28"/><path d="M4 26h28"/></svg>',
  'cuff-ribana':    '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8v20M12 8v20M16 8v20M20 8v20M24 8v20M28 8v20"/><path d="M6 8h24M6 28h24"/></svg>',
  'neck-stitch':    '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14c4-4 12-4 16 0"/><path d="M10 14c4-4 12-4 16 0" stroke-dasharray="3 2" transform="translate(0,3)"/></svg>',
  'neck-flatlock':  '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14c4-4 12-4 16 0"/><path d="M10 18c4-4 12-4 16 0"/><path d="M10 22c4-4 12-4 16 0"/></svg>',
  'neck-twill':     '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14c4-4 12-4 16 0"/><rect x="12" y="18" width="12" height="4" rx="1"/></svg>',
  'patch-woven':    '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="10" width="20" height="16" rx="1"/><path d="M12 14h12M12 18h12M12 22h8"/></svg>',
  'patch-jacquard': '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="10" width="20" height="16" rx="1"/><path d="M14 14l4 4 4-4M14 22l4-4 4 4"/></svg>',
  'label-hem':      '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 28h24"/><rect x="14" y="22" width="8" height="6" rx="1"/></svg>',
  'tag-size':       '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="8" width="16" height="20" rx="1"/><path d="M15 16h6M16 20h4"/></svg>',
  'hang-tag':       '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="10" width="16" height="20" rx="1"/><circle cx="18" cy="14" r="2"/><path d="M18 8v2"/></svg>',
  'label-seam':     '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="12" width="12" height="12" rx="1"/><path d="M6 18h6M24 18h6"/></svg>',
  'label-sew':      '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="12" width="12" height="12" rx="1"/><path d="M12 15h12" stroke-dasharray="2 2"/></svg>',
  'strap-reinforce':'<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8h4v20h-4zM22 8h4v20h-4z"/><path d="M14 14h8M14 22h8"/></svg>',
  'magnet-snap':    '<svg width="24" height="24" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="10"/><circle cx="18" cy="18" r="4"/><path d="M18 8v-4M18 32v-4"/></svg>',
};

export const EXTRAS_DESCS = {
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
  'neck-stitch':    'Отстрочка 1мм по горловине',
  'neck-flatlock':  'Распошивальный шов по горловине',
  'neck-twill':     'Закрытие горловины киперной тесьмой',
  'patch-woven':    'Тканая нашивка на ворот (жаккардовое плетение)',
  'patch-jacquard': 'Жаккардовая нашивка, плотная структура',
  'label-hem':      'Тканый лейбл, пришивается на подол',
  'tag-size':       'Вшивная размерная бирка',
  'hang-tag':       'Картонный хэнг-тег на верёвочке',
  'label-seam':     'Бирка притачивается в шов при пошиве',
  'label-sew':      'Бирка пришивается отдельной операцией (не в шов)',
  'strap-reinforce':'Дополнительное усиление строп и ручек',
  'magnet-snap':    'Скрытая магнитная кнопка-застёжка',
};

export const LABELS_CATALOG_DEFAULT = [
  {code:'patch-woven',   name:'Нашивка тканая (ворот)',  price:30, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts']},
  {code:'patch-jacquard', name:'Нашивка жаккардовая',     price:45, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts']},
  {code:'label-hem',      name:'Лейбл на подоле',         price:20, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers']},
  {code:'tag-size',       name:'Бирка размерная (вшивная)',price:10, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts','accessories']},
  {code:'hang-tag',       name:'Хэнг-тег (картон)',       price:15, forCategories:['tshirts','longsleeves','polo','hoodies','sweatshirts','ziphoodies','halfzips','bombers','pants','shorts','accessories']},
];

export const LABEL_CONFIG = {
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

export const HARDWARE_GROUPS = [
  {id:'zippers', name:'Молнии'},
  {id:'cords', name:'Шнурки и завязки'},
  {id:'elastic', name:'Резинки'},
  {id:'metal', name:'Металлическая фурнитура'},
  {id:'plastic', name:'Пластиковая фурнитура'},
  {id:'labels', name:'Этикетки и бирки'},
];

export const HARDWARE_CATALOG_DEFAULT = [
  {code:'zipper-ykk',     name:'Молния YKK',           price:80,  group:'zippers'},
  {code:'zipper-auto',    name:'Замок автомат',         price:45,  group:'zippers'},
  {code:'zipper-reverse', name:'Молния реверсивная',    price:90,  group:'zippers'},
  {code:'lace-waxed',     name:'Шнурок вощёный',       price:25,  group:'cords'},
  {code:'lace-flat',      name:'Шнурок плоский',       price:20,  group:'cords'},
  {code:'lace-round',     name:'Шнурок круглый',       price:20,  group:'cords'},
  {code:'drawstring',     name:'Кулиска',              price:15,  group:'cords'},
  {code:'elastic-waist',  name:'Резинка в пояс',       price:20,  group:'elastic'},
  {code:'elastic-cuff',   name:'Резинка манжетная',    price:15,  group:'elastic'},
  {code:'elastic-hem',    name:'Резинка подол',         price:15,  group:'elastic'},
  {code:'grommet',        name:'Люверсы',              price:35,  group:'metal'},
  {code:'snap-button',    name:'Кнопка кольцевая',     price:20,  group:'metal'},
  {code:'d-ring',         name:'Полукольцо D',         price:15,  group:'metal'},
  {code:'hook',           name:'Карабин',              price:25,  group:'metal'},
  {code:'cord-stopper',   name:'Фиксатор шнурка',     price:10,  group:'plastic'},
  {code:'buckle',         name:'Фастекс',              price:20,  group:'plastic'},
  {code:'cord-end',       name:'Наконечник шнурка',    price:8,   group:'plastic'},
  {code:'label-woven',    name:'Нашивка тканая',       price:30,  group:'labels'},
  {code:'label-printed',  name:'Бирка печатная',       price:15,  group:'labels'},
  {code:'label-leather',  name:'Кожаная нашивка',      price:40,  group:'labels'},
  {code:'hangtag',        name:'Хенгтег (бирка навес.)', price:10, group:'labels'},
];
