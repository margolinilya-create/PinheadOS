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
