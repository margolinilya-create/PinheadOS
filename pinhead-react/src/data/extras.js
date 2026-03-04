// ═══════════════════════════════════════════
// EXTRAS — обработки, лейблы, фурнитура
// ═══════════════════════════════════════════

export const EXTRAS_CATALOG_DEFAULT = [
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

export const EXTRAS_ICONS = {
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
  'strap-reinforce':'Дополнительное усиление строп и ручек',
  'magnet-snap':    'Скрытая магнитная кнопка-застёжка',
};

export const LABELS_CATALOG_DEFAULT = [
  {code:'patch-woven',   name:'Нашивка тканая (ворот)',  price:30, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','pants','shorts']},
  {code:'patch-jacquard', name:'Нашивка жаккардовая',     price:45, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','pants','shorts']},
  {code:'label-hem',      name:'Лейбл на подоле',         price:20, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies']},
  {code:'tag-size',       name:'Бирка размерная (вшивная)',price:10, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','pants','shorts','accessories']},
  {code:'hang-tag',       name:'Хэнг-тег (картон)',       price:15, forCategories:['tshirts','longsleeves','tanks','hoodies','sweatshirts','ziphoodies','pants','shorts','accessories']},
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
