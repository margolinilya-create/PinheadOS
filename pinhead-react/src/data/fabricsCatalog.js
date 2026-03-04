// ═══════════════════════════════════════════
// FABRICS — каталог тканей + отделочные
// ═══════════════════════════════════════════

export const FABRICS_CATALOG_DEFAULT = [
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

export const TRIM_CATALOG_DEFAULT = [
  {code:'ribana-1x1',  name:'Рибана 1×1',    priceUSD:2.50},
  {code:'ribana-2x2',  name:'Рибана 2×2',    priceUSD:2.70},
  {code:'kashkorse',   name:'Кашкорсе',      priceUSD:3.00},
];

// Группировка типов по слою (для фолбэка)
export const LAYER1_TYPES = ['tee','longsleeve','tank'];
export const LAYER2_TYPES = ['hoodie','sweat','zip-hoodie','half-zip','pants','shorts'];

export const FABRICS_LAYER1 = [
  { key:'kulirnaya', name:'Кулирка',   meta:'100% хлопок', sub:'лёгкая',   priceKey:'kulirnaya' },
  { key:'dvunitka',  name:'2-х нитка', meta:'100% хлопок', sub:'плотная',  priceKey:'dvunitka' },
  { key:'interlock', name:'Интерлок',  meta:'100% хлопок', sub:'гладкий',  priceKey:'interlock' }
];

export const FABRICS_LAYER2 = [
  { key:'futher-350-nachers', name:'Футер 3х нитка',  meta:'350 г/м² · Начёс', sub:'100% хлопок',      priceKey:'futher-350-nachers' },
  { key:'futher-350-petlya',  name:'Футер 3х нитка',  meta:'350 г/м² · Петля', sub:'100% хлопок',      priceKey:'futher-350-petlya' },
  { key:'futher-370-nachers', name:'Футер 3х нитка',  meta:'370 г/м² · Начёс', sub:'80/20 хлопок ПЭ', priceKey:'futher-370-nachers' },
  { key:'futher-370-petlya',  name:'Футер 3х нитка',  meta:'370 г/м² · Петля', sub:'80/20 хлопок ПЭ', priceKey:'futher-370-petlya' },
  { key:'futher-470-petlya',  name:'Футер 3х нитка',  meta:'470 г/м² · Петля', sub:'100% хлопок',      priceKey:'futher-470-petlya' }
];
