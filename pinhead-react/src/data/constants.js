// ═══════════════════════════════════════════
// CONSTANTS — названия, размеры, зоны
// ═══════════════════════════════════════════

export const SIZES = ['2XS','XS','S','M','L','XL','2XL','3XL'];

export const TYPE_NAMES = {
  tee:'Футболка', hoodie:'Худи', sweat:'Свитшот', longsleeve:'Лонгслив',
  'zip-hoodie':'Зип-худи', 'half-zip':'Халф-зип', tank:'Майка',
  pants:'Штаны', shorts:'Шорты', shopper:'Шоппер', basecap:'Бейсболка',
  'dad-cap':'Дэд кэп', '5panel':'5-панельная', socks:'Носки'
};

export const FABRIC_NAMES = {
  'kulirnaya':'Кулирка · 100% хлопок',
  'dvunitka':'2-х нитка · 100% хлопок',
  'interlock':'Интерлок · 100% хлопок',
  'futher-350-nachers':'Футер 3х нитка 350г Начёс · 100% хлопок',
  'futher-350-petlya':'Футер 3х нитка 350г Петля · 100% хлопок',
  'futher-370-nachers':'Футер 3х нитка 370г Начёс · 80/20 хлопок ПЭ',
  'futher-370-petlya':'Футер 3х нитка 370г Петля · 80/20 хлопок ПЭ',
  'futher-470-petlya':'Футер 3х нитка 470г Петля · 100% хлопок'
};

export const TECH_NAMES = {
  screen:'Шелкография', flex:'Flex', dtg:'DTG', embroidery:'Вышивка', dtf:'DTF Transfer'
};

export const ZONE_LABELS = {
  chest:'Грудь', back:'Спина',
  'left-sleeve':'Лев. рукав', 'right-sleeve':'Прав. рукав',
  front:'Лицевая сторона', 'back-bag':'Обратная сторона',
  'front-panel':'Тулья спереди', 'back-panel':'Тулья сзади',
  'side-panel':'Боковая панель', 'side-a':'Сторона A', 'side-b':'Сторона B',
  hood:'Капюшон', pocket:'Карман',
  'sleeve-l':'Лев. рукав', 'sleeve-r':'Прав. рукав',
  'leg-l':'Лев. штанина', 'leg-r':'Прав. штанина',
  'pants-front':'Штанина перед', 'pants-back':'Штанина зад'
};

export const DEFAULT_USD_RATE = 92;

// Зоны по правке CRM 13.10, п. 11: рукава — без штанов, шорт и сумок; у сумок —
// стороны A/B; у штанов и шорт — штанины (размеры зон согласуются с производством);
// капюшон — только у моделей с капюшоном, карман — если он в конструкции или выбран
const SLEEVE_CATEGORIES = ['tshirts','longsleeves','sweatshirts','halfzips','hoodies','ziphoodies','polo','bombers'];
export const ZONES_CATALOG_DEFAULT = [
  { id: 'front',    name: 'Грудь (перед)',  forCategories: ['tshirts','longsleeves','sweatshirts','halfzips','hoodies','ziphoodies','polo','bombers','shorts'], sortOrder: 1 },
  { id: 'back',     name: 'Спина',          forCategories: ['tshirts','longsleeves','sweatshirts','halfzips','hoodies','ziphoodies','polo','bombers','shorts'], sortOrder: 2 },
  { id: 'sleeve-l', name: 'Левый рукав',    forCategories: SLEEVE_CATEGORIES, sortOrder: 3 },
  { id: 'sleeve-r', name: 'Правый рукав',   forCategories: SLEEVE_CATEGORIES, sortOrder: 4 },
  { id: 'hood',     name: 'Капюшон',        forCategories: null, requiresHood: true, sortOrder: 5 },
  { id: 'pocket',   name: 'Карман',         forCategories: null, requiresPocket: true, sortOrder: 6 },
  { id: 'side-a',   name: 'Сторона A',      forCategories: ['accessories'], sortOrder: 7 },
  { id: 'side-b',   name: 'Сторона B',      forCategories: ['accessories'], sortOrder: 8 },
  { id: 'leg-l',    name: 'Левая штанина',  forCategories: ['pants','shorts'], sortOrder: 9 },
  { id: 'leg-r',    name: 'Правая штанина', forCategories: ['pants','shorts'], sortOrder: 10 },
  // Веха 5а (ответ владельца 17.10): у штанов перед и зад — свои зоны, опора — пояс;
  // «Грудь (перед)» и «Спина» штанам не предлагаются. Живой справочник дописывает миграция H
  { id: 'pants-front', name: 'Штанина перед', forCategories: ['pants'], sortOrder: 11 },
  { id: 'pants-back',  name: 'Штанина зад',   forCategories: ['pants'], sortOrder: 12 },
];
