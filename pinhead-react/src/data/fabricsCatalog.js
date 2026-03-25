// ═══════════════════════════════════════════════════════════════
// FABRICS_CATALOG_DEFAULT — полный каталог тканей v3
// Источник: Сайт-конструктор.xlsx → лист «Прайс тканей»
// Поставщики: Медас, ТД Коттон, ТониТекс
// priceUSD — цена за метр в долларах
// ═══════════════════════════════════════════════════════════════
export const FABRICS_CATALOG_DEFAULT = [
  // ── МЕДАС — ЛЁГКИЕ ──────────────────────────────────────────
  { code:'medas-kulirnaya-100-160',    name:'Кулирка',             supplier:'Медас',    composition:'100% хб',              density:160, priceUSD:10.90, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-100-180',    name:'Кулирка',             supplier:'Медас',    composition:'100% хб',              density:180, priceUSD:10.90, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-100-250',    name:'Кулирка',             supplier:'Медас',    composition:'100% хб',              density:250, priceUSD:12.50, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-100-300',    name:'Кулирка',             supplier:'Медас',    composition:'100% хб',              density:300, priceUSD:13.50, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-92-165',     name:'Кулирка',             supplier:'Медас',    composition:'92% хб / 8% лайкра',   density:165, priceUSD:11.90, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-92-200',     name:'Кулирка',             supplier:'Медас',    composition:'92% хб / 8% лайкра',   density:200, priceUSD:11.50, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-92-230',     name:'Кулирка',             supplier:'Медас',    composition:'92% хб / 8% лайкра',   density:230, priceUSD:11.90, forCategories:['tshirts','longsleeves'] },
  { code:'medas-pike-100-190',         name:'Пике',                supplier:'Медас',    composition:'100% хб',              density:190, priceUSD:10.70, forCategories:['tshirts','polo'] },
  { code:'medas-french-92-240',        name:'Френч-терри',         supplier:'Медас',    composition:'92% хб / 8% лайкра',   density:240, priceUSD:11.50, forCategories:['sweatshirts','halfzips'] },
  { code:'medas-french-peach-92-240',  name:'Френч-терри Peach',   supplier:'Медас',    composition:'92% хб / 8% лайкра',   density:240, priceUSD:11.80, forCategories:['sweatshirts','halfzips'] },
  // ── МЕДАС — ТЯЖЁЛЫЕ ─────────────────────────────────────────
  { code:'medas-futher-petlya-65-320', name:'Футер петля',         supplier:'Медас',    composition:'65% хб / 35% ПЭ',     density:320, priceUSD:10.50, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts'] },
  { code:'medas-futher-diag-65-320',   name:'Футер диагональ',     supplier:'Медас',    composition:'65% хб / 35% ПЭ',     density:320, priceUSD:10.50, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts'] },
  { code:'medas-futher-diag-100-350',  name:'Футер диагональ',     supplier:'Медас',    composition:'100% хб',              density:350, priceUSD:12.10, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  { code:'medas-futher-diag-80-320',   name:'Футер диагональ',     supplier:'Медас',    composition:'80% хб / 20% ПЭ',     density:320, priceUSD:10.90, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts'] },
  { code:'medas-futher-diag-excl-335', name:'Футер диагональ эксклюзив', supplier:'Медас', composition:'85% хб / 15% ПЭ',  density:335, priceUSD:12.20, forCategories:['hoodies','sweatshirts','ziphoodies'] },
  { code:'medas-futher-velour-100-350',name:'Футер велюр',          supplier:'Медас',    composition:'100% хб',              density:350, priceUSD:12.90, forCategories:['hoodies','ziphoodies'] },
  { code:'medas-futher-80-400',        name:'Футер',               supplier:'Медас',    composition:'80% хб / 20% ПЭ',     density:400, priceUSD:13.10, forCategories:['hoodies','ziphoodies','pants','bombers'] },
  { code:'medas-futher-barkhat-100-470',name:'Футер бархатный',    supplier:'Медас',    composition:'100% хб',              density:470, priceUSD:14.50, forCategories:['hoodies','ziphoodies'] },
  { code:'medas-futher-diag-100-470',  name:'Футер диагональ',     supplier:'Медас',    composition:'100% хб',              density:470, priceUSD:13.90, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  { code:'medas-futher-nachez-65-320', name:'Футер с начёсом',     supplier:'Медас',    composition:'65% хб / 35% ПЭ',     density:320, priceUSD:10.50, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies'] },
  // ── ТД КОТТОН — ЛЁГКИЕ ──────────────────────────────────────
  { code:'cotton-kulirnaya-100-180',   name:'Кулирка',             supplier:'ТД Коттон', composition:'100% хб',             density:180, priceUSD:10.60, forCategories:['tshirts','longsleeves','polo'] },
  { code:'cotton-kulirnaya-100-230',   name:'Кулирка',             supplier:'ТД Коттон', composition:'100% хб',             density:230, priceUSD:10.90, forCategories:['tshirts','longsleeves','polo'] },
  { code:'cotton-kulirnaya-100-270',   name:'Кулирка',             supplier:'ТД Коттон', composition:'100% хб',             density:270, priceUSD:11.50, forCategories:['tshirts','longsleeves','polo'] },
  { code:'cotton-kulirnaya-90-200',    name:'Кулирка',             supplier:'ТД Коттон', composition:'90% хб / 10% лайкра', density:200, priceUSD:10.60, forCategories:['tshirts','longsleeves','polo'] },
  { code:'cotton-pike-100-215',        name:'Пике',                supplier:'ТД Коттон', composition:'100% хб',             density:215, priceUSD:11.50, forCategories:['tshirts','polo'] },
  { code:'cotton-french-95-250',       name:'Френч-терри',         supplier:'ТД Коттон', composition:'95% хб / 5% лайкра',  density:250, priceUSD:10.60, forCategories:['sweatshirts','halfzips'] },
  // ── ТД КОТТОН — ТЯЖЁЛЫЕ ─────────────────────────────────────
  { code:'cotton-futher-petlya-70-350',name:'Футер петля',         supplier:'ТД Коттон', composition:'70% хб / 30% ПЭ',    density:350, priceUSD:9.60,  forCategories:['hoodies','sweatshirts','ziphoodies','pants','shorts'] },
  { code:'cotton-futher-100-400',      name:'Футер',               supplier:'ТД Коттон', composition:'100% хб',             density:400, priceUSD:11.50, forCategories:['hoodies','sweatshirts','ziphoodies','pants','bombers'] },
  { code:'cotton-futher-100-500',      name:'Футер',               supplier:'ТД Коттон', composition:'100% хб',             density:500, priceUSD:12.90, forCategories:['hoodies','ziphoodies'] },
  { code:'cotton-futher-nachez-70-330',name:'Футер с начёсом',     supplier:'ТД Коттон', composition:'70% хб / 30% ПЭ',    density:330, priceUSD:9.90,  forCategories:['hoodies','sweatshirts','halfzips','ziphoodies'] },
  { code:'cotton-intersoft-65-320',    name:'Интерсофт',           supplier:'ТД Коттон', composition:'65% хб / 35% ПЭ',    density:320, priceUSD:9.50,  forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  // ── ТОНИТЕКС — ЛЁГКИЕ ───────────────────────────────────────
  { code:'tonitex-kulirnaya-100-180',  name:'Кулирка',             supplier:'ТониТекс', composition:'100% хб',              density:180, priceUSD:10.50, forCategories:['tshirts','longsleeves','polo'] },
  { code:'tonitex-kulirnaya-92-200',   name:'Кулирка',             supplier:'ТониТекс', composition:'92% хб / 8% лайкра',   density:200, priceUSD:11.00, forCategories:['tshirts','longsleeves','polo'] },
  // ── ТОНИТЕКС — ТЯЖЁЛЫЕ ──────────────────────────────────────
  { code:'tonitex-futher-100-340',     name:'Футер',               supplier:'ТониТекс', composition:'100% хб',              density:340, priceUSD:11.00, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  { code:'tonitex-futher-90-330',      name:'Футер',               supplier:'ТониТекс', composition:'90% хб / 10% ПЭ',     density:330, priceUSD:10.70, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  { code:'tonitex-futher-100-380',     name:'Футер',               supplier:'ТониТекс', composition:'100% хб',              density:380, priceUSD:11.50, forCategories:['hoodies','sweatshirts','ziphoodies','pants','bombers'] },
  { code:'tonitex-futher-100-430',     name:'Футер',               supplier:'ТониТекс', composition:'100% хб',              density:430, priceUSD:12.50, forCategories:['hoodies','ziphoodies'] },
  { code:'tonitex-futher-100-490',     name:'Футер',               supplier:'ТониТекс', composition:'100% хб',              density:490, priceUSD:13.50, forCategories:['hoodies','ziphoodies'] },
];
// ── ОТДЕЛОЧНЫЕ ТКАНИ (trimCatalog) ──────────────────────────────
export const TRIM_CATALOG_DEFAULT = [
  { code:'ribana-medas',     name:'Рибана',    supplier:'Медас',     priceUSD:13.20 },
  { code:'kashkorse-medas',  name:'Кашкорсе',  supplier:'Медас',     priceUSD:13.20 },
  { code:'ribana-cotton',    name:'Рибана',    supplier:'ТД Коттон', priceUSD:14.20 },
  { code:'kashkorse-cotton', name:'Кашкорсе',  supplier:'ТД Коттон', priceUSD:14.20 },
  // legacy — обратная совместимость
  { code:'ribana-1x1',       name:'Рибана 1×1', supplier:'Медас',    priceUSD:13.20 },
  { code:'ribana-2x2',       name:'Рибана 2×2', supplier:'Медас',    priceUSD:13.20 },
  { code:'kashkorse',        name:'Кашкорсе',   supplier:'Медас',    priceUSD:13.20 },
];
export const FABRIC_SUPPLIERS = ['Медас', 'ТД Коттон', 'ТониТекс'];
// Категории изделий по типу ткани
export const LAYER1_TYPES = ['tshirts','longsleeves','polo'];
export const LAYER2_TYPES = ['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts','bombers'];
