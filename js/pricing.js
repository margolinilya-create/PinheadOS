// ════════════════════════════════════════════════════════════
//   PRICING ENGINE
// ════════════════════════════════════════════════════════════
// calcTotal, updateTotal, screen surcharge, tech minimums, per-zone calc

// ─── TECH MINIMUMS ───
const TECH_MIN_QTY = {
  screen:     50,   // Шелкография — мин 50 шт
  embroidery: 10,   // Вышивка — мин 10 шт
  dtf:        1,    // DTF — от 1 шт
  dtg:        1,    // DTG — от 1 шт
};
const TECH_MIN_MSG = {
  screen:     'Шелкография рентабельна от 50 шт — при меньшем тираже рекомендуем DTF',
  embroidery: 'Вышивка рентабельна от 10 шт — при меньшем тираже рекомендуем DTF',
};

function getTotalQty() {
  return getActiveTotalQty();
}

function renderTechWarnings() {
  const wrap = document.getElementById('techWarningsWrap');
  if (!wrap) return;
  const qty = getTotalQty();
  const usedTechs = new Set((state.zones||[]).map(z => state.zoneTechs?.[z] || 'screen'));
  let html = '';

  // Предупреждение только при выбранной шелкографии и тираже < 50
  if (usedTechs.has('screen') && qty > 0 && qty < 50) {
    html += `<div class="tech-warning">
      <span class="tech-warn-icon">⚠</span>
      <span>Шелкография — минимальный тираж от 50 шт. Сейчас: ${qty} шт</span>
    </div>`;
  }

  wrap.innerHTML = html;
  wrap.style.display = html ? 'flex' : 'none';
}



// ─── SCREEN SURCHARGE HELPER ───
// ─── SCREEN SURCHARGE (per-zone) ───
const FORMATS = ['A6','A5','A4','A3','A3+'];
const FORMAT_SURCHARGE = {'A6':0,'A5':20,'A4':40,'A3':80,'A3+':120}; // надбавка к базе

function getZonePrint(zone) {
  if (!state.zonePrints) state.zonePrints = {};
  if (!state.zonePrints[zone]) state.zonePrints[zone] = {colors:1, size:'A4'};
  return state.zonePrints[zone];
}

function getZoneSurcharge(zone) {
  const p = getZonePrint(zone);
  const base   = PRICES.tech.screen || 120;
  const colors = p.colors || 1;
  const colorAdd = colors >= 5
    ? (PRICES.screenColorAdd5 || 80)
    : (colors - 1) * (PRICES.screenColorAdd || 40);
  const fmtAdd   = (PRICES.screenFormatAdd || FORMAT_SURCHARGE)[p.size] ?? FORMAT_SURCHARGE[p.size] ?? 40;
  const underAdd = state.textileColor === 'color' ? (PRICES.screenWhiteUnder || 50) : 0;
  return base + colorAdd + fmtAdd + underAdd;
}


// ═══════════════════════════════════════════════════════
// PER-ZONE TECH SELECTION
// ═══════════════════════════════════════════════════════

const ZONE_NAMES = {chest:'Грудь', back:'Спина', 'left-sleeve':'Лев. рукав', 'right-sleeve':'Прав. рукав', front:'Лицевая сторона', 'back-bag':'Обратная сторона', 'front-panel':'Тулья спереди', 'back-panel':'Тулья сзади', 'side-panel':'Боковая панель'};
const ZONE_ICONS = {chest:'⬛', back:'🔳', 'left-sleeve':'◼', 'right-sleeve':'◼'};
// ─── SCREEN PRICE MATRIX ───
// SCREEN_MATRIX[format][colors][qtyTier] = price per unit
// qtyTiers: [50, 100, 300, 500, 700, 1000]
const SCREEN_QTY_TIERS = [50, 100, 300, 500, 700, 1000];
const SCREEN_FORMATS = ['A4','A3','A3+','Max'];
const SCREEN_MAX_COLORS = 8;
const SCREEN_FX = [
  {key:'none',     label:'Нет',      mult:1},
  {key:'stone',    label:'К. база',  mult:2},
  {key:'puff',     label:'PUFF',     mult:2},
  {key:'metallic', label:'Металлик', mult:2},
  {key:'fluor',    label:'Флюр',     mult:2},
];
const SCREEN_MATRIX = {
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
};
// Multipliers
const SCREEN_TEXTILE_MULT = 1.3;  // цветной текстиль
const SCREEN_FUTHER_MULT  = 1.5;  // футер 3-нитка
// Футер ткани (для определения наценки)
const FUTHER_FABRICS = ['futher-350-nachers','futher-350-petlya','futher-370-nachers','futher-370-petlya','futher-470-petlya'];

function screenLookup(format, colors, qty) {
  const fmt = SCREEN_MATRIX[format];
  if (!fmt) return 0;
  const c = Math.max(1, Math.min(SCREEN_MAX_COLORS, colors));
  const row = fmt[c];
  if (!row) return 0;
  // Найти ближайший меньший тиражный порог
  let tierIdx = 0;
  for (let i = SCREEN_QTY_TIERS.length - 1; i >= 0; i--) {
    if (qty >= SCREEN_QTY_TIERS[i]) { tierIdx = i; break; }
  }
  return row[tierIdx] || row[0];
}

function screenCalcZone(zone) {
  const p = state.zonePrints?.[zone] || {colors:1, size:'A4', textile:'white', fx:'none'};
  const qty = getTotalQty() || 1;
  let base = screenLookup(p.size, parseInt(p.colors)||1, qty);
  // Multipliers
  if (p.textile === 'color') base = Math.round(base * SCREEN_TEXTILE_MULT);
  if (FUTHER_FABRICS.includes(state.fabric)) base = Math.round(base * SCREEN_FUTHER_MULT);
  const fx = SCREEN_FX.find(f => f.key === (p.fx||'none'));
  if (fx && fx.mult > 1) base = Math.round(base * fx.mult);
  return base;
}

// ─── FLEX PRICE MATRIX ───
// FLEX_MATRIX[format][colors][tierIdx] = price per unit
// Тиражные пороги: 1, 20, 35, 50
// При тираже 1-19 → цена за 1 (без цветности), 20-34 → 20, 35-49 → 35, 50+ → 50
const FLEX_QTY_TIERS = [1, 20, 35, 50];
const FLEX_FORMATS = ['A6','A5','A4','A3'];
const FLEX_MAX_COLORS = 3;
// Цена за 1шт — одна для всех цветностей (колонка "1 шт" не зависит от цветности)
const FLEX_SINGLE_PRICE = {'A6':450, 'A5':600, 'A4':750, 'A3':850};
const FLEX_MATRIX = {
  'A6': {
    1:[450,159,141,128], 2:[450,206,177,148], 3:[450,238,203,188]
  },
  'A5': {
    1:[600,238,203,172], 2:[600,285,244,204], 3:[600,316,270,227]
  },
  'A4': {
    1:[750,316,270,227], 2:[750,405,345,291], 3:[750,475,405,341]
  },
  'A3': {
    1:[850,423,352,296], 2:[850,519,443,374], 3:[850,632,540,454]
  }
};

function flexLookup(format, colors, qty) {
  const fmt = FLEX_MATRIX[format];
  if (!fmt) return 0;
  const c = Math.max(1, Math.min(FLEX_MAX_COLORS, colors));
  // При qty < 20 → используем цену за 1шт (tierIdx=0), которая не зависит от цветности
  if (qty < 20) return FLEX_SINGLE_PRICE[format] || fmt[1][0];
  const row = fmt[c];
  if (!row) return 0;
  let tierIdx = 0;
  for (let i = FLEX_QTY_TIERS.length - 1; i >= 0; i--) {
    if (qty >= FLEX_QTY_TIERS[i]) { tierIdx = i; break; }
  }
  return row[tierIdx] || row[0];
}

function flexCalcZone(zone) {
  const p = state.flexZones?.[zone] || {colors:1, size:'A4'};
  const qty = getTotalQty() || 1;
  return flexLookup(p.size, parseInt(p.colors)||1, qty);
}

const TECH_TABS = [
  {key:'screen',    label:'Шелкография'},
  {key:'flex',      label:'Flex'},
  {key:'dtg',       label:'DTG'},
  {key:'embroidery',label:'Вышивка'},
  {key:'dtf',       label:'DTF'},
];

function getZoneTech(zone) {
  if (!state.zoneTechs) state.zoneTechs = {};
  if (!state.zoneTechs[zone]) state.zoneTechs[zone] = 'screen';
  return state.zoneTechs[zone];
}

function setZoneTech(zone, tech) {
  if (!state.zoneTechs) state.zoneTechs = {};
  state.zoneTechs[zone] = tech;
  // init defaults
  if (tech === 'screen')     { if (!state.zonePrints) state.zonePrints = {}; if (!state.zonePrints[zone]) state.zonePrints[zone] = {colors:1, size:'A4', textile:'white', fx:'none'}; }
  if (tech === 'flex')       { if (!state.flexZones)  state.flexZones  = {}; if (!state.flexZones[zone])  state.flexZones[zone]  = {colors:1, size:'A4'}; }
  if (tech === 'dtg')        { if (!state.dtgZones)   state.dtgZones   = {}; if (!state.dtgZones[zone])   state.dtgZones[zone]   = {size:'A4', textile:'white'}; }
  if (tech === 'embroidery') { if (!state.embZones)   state.embZones   = {}; if (!state.embZones[zone])   state.embZones[zone]   = {colors:3, area:'s'}; }
  if (tech === 'dtf')        { if (!state.dtfZones)   state.dtfZones   = {}; if (!state.dtfZones[zone])   state.dtfZones[zone]   = {size:'A4'}; }
  // also keep legacy state.tech = most common tech
  state.tech = tech;
  renderZoneTechBlocks();
  updateTotal();
  scheduleSave();
}

function getZoneSurchargeNew(zone) {
  const tech = getZoneTech(zone);
  if (tech === 'screen') {
    return screenCalcZone(zone);
  }
  if (tech === 'flex') {
    return flexCalcZone(zone);
  }
  if (tech === 'dtg') {
    const p = state.dtgZones?.[zone] || {size:'A4', textile:'white'};
    const base = PRICES.tech.dtg || 280;
    const fmt = PRICES.dtgFormatAdd?.[p.size] || 0;
    const textile = p.textile === 'color' ? (PRICES.dtgWhiteUnder||60) : 0;
    return base + fmt + textile;
  }
  if (tech === 'embroidery') {
    const p = state.embZones?.[zone] || {colors:3, area:'s'};
    const base = PRICES.tech.embroidery || 350;
    const area = PRICES.embAreaAdd?.[p.area] || 0;
    const colors = parseInt(p.colors)||3;
    const extra = PRICES.embColorAdd ? Math.max(0,colors-1)*PRICES.embColorAdd : Math.max(0,colors-1)*20;
    return base + area + extra;
  }
  if (tech === 'dtf') {
    const p = state.dtfZones?.[zone] || {size:'A4'};
    const base = PRICES.tech.dtf || 180;
    const fmt = PRICES.dtfFormatAdd?.[p.size] || 0;
    return base + fmt;
  }
  return 0;
}

function getTotalSurcharge() {
  if (!state.zones || state.zones.length === 0) return 0;
  return state.zones.reduce((sum, z) => sum + getZoneSurchargeNew(z), 0);
}

function renderParamsForTech(zone, tech) {
  if (tech === 'screen') {
    const p = state.zonePrints?.[zone] || {colors:1, size:'A4', textile:'white', fx:'none'};
    const sizes = SCREEN_FORMATS;
    const textiles = [{k:'white',l:'Белый'},{k:'color',l:'Цветной ×1.3'}];
    const qty = getTotalQty() || 1;
    const basePrice = screenLookup(p.size, parseInt(p.colors)||1, qty);
    // Build multiplier breakdown
    const mults = [];
    mults.push({label:`${p.size} · ${p.colors||1}цв · ${qty}шт → ${basePrice}₽`, active:true});
    let total = basePrice;
    if (p.textile === 'color') { total = Math.round(total * SCREEN_TEXTILE_MULT); mults.push({label:`Цветной ${SCREEN_TEXTILE_MULT}`, active:true}); }
    if (FUTHER_FABRICS.includes(state.fabric)) { total = Math.round(total * SCREEN_FUTHER_MULT); mults.push({label:`Футер ${SCREEN_FUTHER_MULT}`, active:true}); }
    const fx = SCREEN_FX.find(f => f.key === (p.fx||'none'));
    if (fx && fx.mult > 1) { total = Math.round(total * fx.mult); mults.push({label:`${fx.label} ${fx.mult}.0`, active:true}); }
    const breakdownHtml = mults.length > 1
      ? mults.map((m,i) => (i>0?'<span class="zone-mult-eq">×</span>':'') + `<span class="zone-mult-chip${m.active?' active':''}">${m.label}</span>`).join('') + `<span class="zone-mult-eq">=</span><span class="zone-mult-result">${total} ₽/шт</span>`
      : `<span class="zone-mult-chip active">${mults[0].label}</span><span class="zone-mult-result" style="margin-left:auto">${total} ₽/шт</span>`;
    return `
      <div class="zone-param-row">
        <div class="zone-param-label">Формат</div>
        <div class="zone-param-btns">${sizes.map(s=>`<button class="zone-param-btn${p.size===s?' active':''}" onclick="setZoneParam('${zone}','screen','size','${s}')">${s}</button>`).join('')}</div>
      </div>
      <div class="zone-param-row">
        <div class="zone-param-label">Цвета</div>
        <div class="zone-colors-wrap">
          <button class="zone-param-btn" style="border:1.5px solid var(--black)" onclick="changeZoneColors('${zone}',-1)">−</button>
          <input class="zone-colors-input" type="number" min="1" max="${SCREEN_MAX_COLORS}" value="${p.colors||1}"
            onchange="setZoneParam('${zone}','screen','colors',Math.min(${SCREEN_MAX_COLORS},Math.max(1,parseInt(this.value)||1)))"
            oninput="setZoneParam('${zone}','screen','colors',Math.min(${SCREEN_MAX_COLORS},Math.max(1,parseInt(this.value)||1)))">
          <button class="zone-param-btn" style="border:1.5px solid var(--black)" onclick="changeZoneColors('${zone}',1)">+</button>
          <span style="font-size:10px;color:var(--text-dim)">/ макс. ${SCREEN_MAX_COLORS}</span>
        </div>
      </div>
      <div class="zone-param-row">
        <div class="zone-param-label">Текстиль</div>
        <div class="zone-param-btns">${textiles.map(t=>`<button class="zone-param-btn${(p.textile||'white')===t.k?' active':''}" onclick="setZoneParam('${zone}','screen','textile','${t.k}')">${t.l}</button>`).join('')}</div>
      </div>
      <div class="zone-param-row">
        <div class="zone-param-label">Спецэффект</div>
        <div class="zone-fx-btns">${SCREEN_FX.map(f=>`<button class="zone-fx-btn${(p.fx||'none')===f.key?' active':''}" onclick="setZoneParam('${zone}','screen','fx','${f.key}')">${f.label}${f.mult>1?' <span class=fx-mult>×'+f.mult+'</span>':''}</button>`).join('')}</div>
      </div>
      </div><div class="zone-mults">${breakdownHtml}</div><div>`;
  }
  if (tech === 'flex') {
    const p = state.flexZones?.[zone] || {colors:1, size:'A4'};
    const sizes = FLEX_FORMATS;
    const qty = getTotalQty() || 1;
    const price = flexLookup(p.size, parseInt(p.colors)||1, qty);
    const isSingle = qty < 20;
    return `
      <div class="zone-param-row">
        <div class="zone-param-label">Формат</div>
        <div class="zone-param-btns">${sizes.map(s=>`<button class="zone-param-btn${p.size===s?' active':''}" onclick="setZoneParam('${zone}','flex','size','${s}')">${s}</button>`).join('')}</div>
      </div>
      <div class="zone-param-row">
        <div class="zone-param-label">Цвета</div>
        <div class="zone-colors-wrap">
          <button class="zone-param-btn" style="border:1.5px solid var(--black)" onclick="changeFlexColors('${zone}',-1)">−</button>
          <input class="zone-colors-input" type="number" min="1" max="${FLEX_MAX_COLORS}" value="${p.colors||1}"
            onchange="setZoneParam('${zone}','flex','colors',Math.min(${FLEX_MAX_COLORS},Math.max(1,parseInt(this.value)||1)))"
            oninput="setZoneParam('${zone}','flex','colors',Math.min(${FLEX_MAX_COLORS},Math.max(1,parseInt(this.value)||1)))">
          <button class="zone-param-btn" style="border:1.5px solid var(--black)" onclick="changeFlexColors('${zone}',1)">+</button>
          <span style="font-size:10px;color:var(--text-dim)">/ макс. ${FLEX_MAX_COLORS}</span>
        </div>
      </div>
      ${isSingle ? '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;font-weight:600">Тираж &lt; 20 шт — фиксированная цена за 1 шт (цветность не влияет)</div>' : ''}
      </div><div class="zone-mults"><span class="zone-mult-chip active">${p.size} · ${isSingle?'1шт':p.colors+'цв · '+qty+'шт'} → ${price}₽</span><span class="zone-mult-result" style="margin-left:auto">${price} ₽/шт</span></div><div>`;
  }
  if (tech === 'dtg') {
    const p = state.dtgZones?.[zone] || {size:'A4', textile:'white'};
    const sizes = ['A6','A5','A4','A3','A3+'];
    const textiles = [{k:'white',l:'Белый'},{k:'color',l:'Цветной'}];
    return `
      <div class="zone-param-row">
        <div class="zone-param-label">Размер</div>
        <div class="zone-param-btns">${sizes.map(s=>`<button class="zone-param-btn${p.size===s?' active':''}" onclick="setZoneParam('${zone}','dtg','size','${s}')">${s}</button>`).join('')}</div>
      </div>
      <div class="zone-param-row">
        <div class="zone-param-label">Текстиль</div>
        <div class="zone-param-btns">${textiles.map(t=>`<button class="zone-param-btn${(p.textile||'white')===t.k?' active':''}" onclick="setZoneParam('${zone}','dtg','textile','${t.k}')">${t.l}</button>`).join('')}</div>
      </div>`;
  }
  if (tech === 'embroidery') {
    const p = state.embZones?.[zone] || {colors:3, area:'s'};
    const areas = [{k:'s',l:'S до 7см'},{k:'m',l:'M до 12см'},{k:'l',l:'L до 20см'}];
    return `
      <div class="zone-param-row">
        <div class="zone-param-label">Область</div>
        <div class="zone-param-btns">${areas.map(a=>`<button class="zone-param-btn${p.area===a.k?' active':''}" onclick="setZoneParam('${zone}','embroidery','area','${a.k}')">${a.l}</button>`).join('')}</div>
      </div>
      <div class="zone-param-row">
        <div class="zone-param-label">Цветов нити</div>
        <div class="zone-colors-wrap">
          <button class="zone-param-btn" style="border:1.5px solid var(--black)" onclick="changeZoneColors('${zone}',-1)">−</button>
          <input class="zone-colors-input" type="number" min="1" max="20" value="${p.colors||3}"
            onchange="setZoneParam('${zone}','embroidery','colors',parseInt(this.value)||1)"
            oninput="setZoneParam('${zone}','embroidery','colors',parseInt(this.value)||1)">
          <button class="zone-param-btn" style="border:1.5px solid var(--black)" onclick="changeZoneColors('${zone}',1)">+</button>
          <span style="font-size:10px;color:var(--text-dim)">цв.</span>
        </div>
      </div>`;
  }
  if (tech === 'dtf') {
    const p = state.dtfZones?.[zone] || {size:'A4'};
    const sizes = ['A6','A5','A4','A3','A3+'];
    return `
      <div class="zone-param-row">
        <div class="zone-param-label">Размер</div>
        <div class="zone-param-btns">${sizes.map(s=>`<button class="zone-param-btn${p.size===s?' active':''}" onclick="setZoneParam('${zone}','dtf','size','${s}')">${s}</button>`).join('')}</div>
      </div>`;
  }
  return '';
}

function setZoneParam(zone, tech, key, value) {
  if (tech === 'screen')     { if (!state.zonePrints) state.zonePrints = {}; if (!state.zonePrints[zone]) state.zonePrints[zone] = {colors:1,size:'A4',textile:'white'}; state.zonePrints[zone][key] = value; }
  if (tech === 'flex')       { if (!state.flexZones)  state.flexZones  = {}; if (!state.flexZones[zone])  state.flexZones[zone]  = {colors:1,size:'A4'}; state.flexZones[zone][key] = value; }
  if (tech === 'dtg')        { if (!state.dtgZones)   state.dtgZones   = {}; if (!state.dtgZones[zone])   state.dtgZones[zone]   = {size:'A4',textile:'white'}; state.dtgZones[zone][key] = value; }
  if (tech === 'embroidery') { if (!state.embZones)   state.embZones   = {}; if (!state.embZones[zone])   state.embZones[zone]   = {colors:3,area:'s'}; state.embZones[zone][key] = value; }
  if (tech === 'dtf')        { if (!state.dtfZones)   state.dtfZones   = {}; if (!state.dtfZones[zone])   state.dtfZones[zone]   = {size:'A4'}; state.dtfZones[zone][key] = value; }
  renderZoneTechBlocks();
  updateTotal();
  scheduleSave();
}

function changeZoneColors(zone, delta) {
  const tech = getZoneTech(zone);
  if (tech === 'screen') {
    if (!state.zonePrints) state.zonePrints = {};
    if (!state.zonePrints[zone]) state.zonePrints[zone] = {colors:1,size:'A4',textile:'white'};
    state.zonePrints[zone].colors = Math.max(1, Math.min(SCREEN_MAX_COLORS, (parseInt(state.zonePrints[zone].colors)||1) + delta));
  }
  if (tech === 'embroidery') {
    if (!state.embZones) state.embZones = {};
    if (!state.embZones[zone]) state.embZones[zone] = {colors:3,area:'s'};
    state.embZones[zone].colors = Math.max(1, Math.min(20, (parseInt(state.embZones[zone].colors)||3) + delta));
  }
  renderZoneTechBlocks();
  updateTotal();
  scheduleSave();
}

function changeFlexColors(zone, delta) {
  if (!state.flexZones) state.flexZones = {};
  if (!state.flexZones[zone]) state.flexZones[zone] = {colors:1,size:'A4'};
  state.flexZones[zone].colors = Math.max(1, Math.min(FLEX_MAX_COLORS, (parseInt(state.flexZones[zone].colors)||1) + delta));
  renderZoneTechBlocks();
  updateTotal();
  scheduleSave();
}


function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderZoneTechBlocks() {
  const container = document.getElementById('zoneTechBlocks');
  if (!container) return;
  // Скрываем общий wrap — предупреждения теперь внутри блоков
  const warnWrap = document.getElementById('techWarningsWrap');
  if (warnWrap) { warnWrap.innerHTML = ''; warnWrap.style.display = 'none'; }

  if (!state.zones || state.zones.length === 0) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase">Выберите хотя бы одну зону нанесения</div>';
    return;
  }
  const qty = getTotalQty();
  container.innerHTML = state.zones.map(zone => {
    const tech = getZoneTech(zone);
    const surcharge = getZoneSurchargeNew(zone);
    const tabs = TECH_TABS.map(t => `
      <button class="zone-tech-tab${tech===t.key?' active':''}" onclick="setZoneTech('${zone}','${t.key}')">
        <span>${t.label}</span>
      </button>`).join('');
    const params = renderParamsForTech(zone, tech);
    // Предупреждение о минималке шелкографии — только в этом блоке
    const screenWarn = (tech === 'screen' && qty > 0 && qty < 50)
      ? `<div class="tech-warning" style="margin-top:8px">
          <span class="tech-warn-icon">⚠</span>
          <span>Шелкография — минимальный тираж от 50 шт. Сейчас: ${qty} шт</span>
        </div>`
      : '';
    // Ссылка на макет для этой зоны
    const zoneLink = state.zoneArtworks?.[zone] || '';
    const zoneLinkHtml = `<div style="margin-top:8px;padding:8px 10px;background:var(--bg2);border:1.5px solid var(--border-light)">
        <div style="font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Ссылка на макет</div>
        <input type="text" value="${escAttr(zoneLink)}" placeholder="\\server\projects\order-name\ или https://..." 
          style="width:100%;height:28px;border:1.5px solid var(--border-light);padding:0 8px;font-size:11px;font-family:'Roboto Condensed',sans-serif"
          oninput="setZoneArtwork('${zone}',this.value)">
      </div>`;
    return `
      <div class="zone-tech-block">
        <div class="zone-tech-header">
          <span>${ZONE_NAMES[zone]||zone}</span>
          <span class="zone-surcharge">+${surcharge} ₽/шт</span>
        </div>
        <div class="zone-tech-tabs">${tabs}</div>
        <div class="zone-tech-params">${params}</div>
        ${screenWarn}
        ${zoneLinkHtml}
      </div>`;
  }).join('');
}

function getScreenSurcharge() {
  // Теперь считает per-zone технику
  return getTotalSurcharge();
}

function selectTech(el, tech) {
  const grid = document.getElementById('techGrid');
  if (grid) grid.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  state.tech = tech;
  showTechOptions(tech);
  updateTotal();
  scheduleSave();
}

function showTechOptions(tech) {
  // Теперь рендерим per-zone блоки
  renderZoneTechBlocks();
}

function setTextileColor(col) {
  state.textileColor = col;
  const wb = document.getElementById('texWhiteBtn');
  const cb = document.getElementById('texColorBtn');
  if (wb) { wb.style.background = col==='white'?'var(--black)':'var(--white)'; wb.style.color = col==='white'?'var(--white)':'var(--black)'; }
  if (cb) { cb.style.background = col==='color'?'var(--black)':'var(--white)'; cb.style.color = col==='color'?'var(--white)':'var(--black)'; }
  const hint = document.getElementById('textileColorHint');
  if (hint) hint.textContent = col === 'color' ? `Цветной — наценка ×${PRICES.screenColoredMult||1.3} для шелкографии` : 'Белый — без наценки';
  // update all zone surcharge displays
  state.zones.forEach(z => updateZoneSurchargeDisplay(z));
  updateScreenSurchargeDisplay();
  updateTotal();
  scheduleSave();
}

function setZoneColors(zone, n) {
  getZonePrint(zone).colors = n;
  // update buttons for this zone
  const group = document.getElementById(`clr_${zone}`);
  if (group) group.querySelectorAll('.clr-btn').forEach((btn, i) => {
    const active = (i + 1) === n;
    btn.classList.toggle('active', active);
    btn.style.background = active ? 'var(--black)' : 'var(--white)';
    btn.style.color      = active ? 'var(--white)' : 'var(--black)';
  });
  updateZoneSurchargeDisplay(zone);
  updateScreenSurchargeDisplay();
  updateTotal();
  scheduleSave();
}

function setZoneFormat(zone, fmt) {
  getZonePrint(zone).size = fmt;
  // update buttons for this zone
  const group = document.getElementById(`fmt_${zone}`);
  if (group) group.querySelectorAll('.fmt-btn').forEach(btn => {
    const active = btn.dataset.fmt === fmt;
    btn.classList.toggle('active', active);
    btn.style.background = active ? 'var(--black)' : 'var(--white)';
    btn.style.color      = active ? 'var(--white)' : 'var(--black)';
  });
  updateZoneSurchargeDisplay(zone);
  updateScreenSurchargeDisplay();
  updateTotal();
  scheduleSave();
}

function updateZoneSurchargeDisplay(zone) {
  const el = document.getElementById(`zsurcharge_${zone}`);
  if (el) el.textContent = `+${getZoneSurcharge(zone)} ₽/шт`;
}

function updateScreenSurchargeDisplay() {
  const el  = document.getElementById('screenSurchargeDisplay');
  const lbl = document.getElementById('screenPriceLabel');
  if (state.tech === 'screen') {
    const s = getScreenSurcharge();
    if (el)  el.textContent  = `+${s} ₽/шт`;
    if (lbl) lbl.textContent = `от ${s} ₽/шт`;
  } else {
    if (el) el.textContent = '—';
    const t = PRICES.tech[state.tech] || 0;
    if (lbl) lbl.textContent = `от ${t} ₽/шт`;
  }
}

function renderZonePrintCards() {
  const container = document.getElementById('zonePrintCards');
  if (!container) return;
  if (state.tech !== 'screen') { container.innerHTML = ''; return; }

  const zoneNames = {chest:'Грудь',back:'Спина','left-sleeve':'Лев. рукав','right-sleeve':'Прав. рукав'};
  const zoneIcons = {chest:'⬛',back:'🔳','left-sleeve':'◼','right-sleeve':'◼'};

  if (state.zones.length === 0) {
    container.innerHTML = '<div style="padding:16px 20px;border:1.5px solid var(--black);border-top:none;color:var(--text-dim);font-size:12px;">Выберите хотя бы одну зону нанесения</div>';
    return;
  }

  container.innerHTML = state.zones.map((zone, idx) => {
    const p = getZonePrint(zone);
    const fmts = ['A6','A5','A4','A3','A3+'];
    const fmtBtns = fmts.map(f => {
      const active = p.size === f;
      return `<button class="fmt-btn${active?' active':''}" data-fmt="${f}"
        onclick="setZoneFormat('${zone}','${f}')"
        style="background:${active?'var(--black)':'var(--white)'};color:${active?'var(--white)':'var(--black)'}">${f}</button>`;
    }).join('');

    const clrBtns = [1,2,3,4,5].map(n => {
      const active = (p.colors||1) === n;
      return `<button class="clr-btn${active?' active':''}"
        onclick="setZoneColors('${zone}',${n})"
        style="background:${active?'var(--black)':'var(--white)'};color:${active?'var(--white)':'var(--black)'}">${n < 5 ? n : '5+'}</button>`;
    }).join('');

    return `<div class="zone-print-card">
      <div class="zone-print-header">
        <div class="zone-print-num">${idx+1}</div>
        <div style="font-size:18px;line-height:1">${zoneIcons[zone]}</div>
        <div class="zone-print-zone-name">${zoneNames[zone]}</div>
      </div>
      <div class="zone-print-body">
        <div class="zone-print-field">
          <div class="zone-print-label">Формат принта</div>
          <div class="fmt-btn-group" id="fmt_${zone}">${fmtBtns}</div>
        </div>
        <div class="zone-print-field">
          <div class="zone-print-label">Количество цветов</div>
          <div class="clr-btn-group" id="clr_${zone}">${clrBtns}</div>
        </div>
        <div class="zone-print-field" style="margin-left:auto">
          <div class="zone-print-surcharge">
            <div class="zone-print-surcharge-label">Надбавка</div>
            <div class="zone-print-surcharge-val" id="zsurcharge_${zone}">+${getZoneSurcharge(zone)} ₽/шт</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}


// ════════════════════════════════════════
// DTG
// ════════════════════════════════════════
function getDtgZone(zone) {
  if (!state.dtgZones) state.dtgZones = {};
  if (!state.dtgZones[zone]) state.dtgZones[zone] = {size:'A4'};
  return state.dtgZones[zone];
}
function getDtgZoneSurcharge(zone) {
  const p   = getDtgZone(zone);
  const base = PRICES.tech.dtg || 280;
  const fmtAdd  = (PRICES.dtgFormatAdd||{'A6':0,'A5':30,'A4':60,'A3':120,'A3+':180})[p.size] ?? 60;
  const under   = state.dtgTextile === 'color' ? (PRICES.dtgWhiteUnder||60) : 0;
  return base + fmtAdd + under;
}
function getDtgTotal() {
  if (!state.zones||!state.zones.length) return PRICES.tech.dtg||280;
  return state.zones.reduce((s,z)=>s+getDtgZoneSurcharge(z),0);
}
function setDtgTextile(col) {
  state.dtgTextile = col;
  const wb = document.getElementById('dtgWhiteBtn');
  const cb = document.getElementById('dtgColorBtn');
  if (wb) { wb.style.background=col==='white'?'var(--black)':'var(--white)'; wb.style.color=col==='white'?'var(--white)':'var(--black)'; }
  if (cb) { cb.style.background=col==='color'?'var(--black)':'var(--white)'; cb.style.color=col==='color'?'var(--white)':'var(--black)'; }
  const hint = document.getElementById('dtgTextileHint');
  if (hint) hint.textContent = col==='color'?`Цветной — подложка +${PRICES.dtgWhiteUnder||60} ₽ за зону`:'Белый — без подложки';
  state.zones.forEach(z=>updateDtgZoneDisplay(z));
  renderDtgTotal();
  updateTotal();
  scheduleSave();
}
function setDtgFormat(zone, fmt) {
  getDtgZone(zone).size = fmt;
  const g = document.getElementById(`dtgfmt_${zone}`);
  if (g) g.querySelectorAll('.fmt-btn').forEach(b=>{
    const a=b.dataset.fmt===fmt;
    b.classList.toggle('active',a);
    b.style.background=a?'var(--black)':'var(--white)';
    b.style.color=a?'var(--white)':'var(--black)';
  });
  updateDtgZoneDisplay(zone);
  renderDtgTotal();
  updateTotal();
  scheduleSave();
}
function updateDtgZoneDisplay(zone) {
  const el = document.getElementById(`dtgz_${zone}`);
  if (el) el.textContent = `+${getDtgZoneSurcharge(zone)} ₽/шт`;
}
function renderDtgTotal() {
  const el = document.getElementById('dtgTotalDisplay');
  if (el) el.textContent = `+${getDtgTotal()} ₽/шт`;
  const lbl = document.getElementById('dtgPriceLabel');
  if (lbl) lbl.textContent = `от ${getDtgTotal()} ₽/шт`;
}
function renderDtgZoneCards() {
  const c = document.getElementById('dtgZoneCards');
  if (!c) return;
  if (!state.zones||!state.zones.length) { c.innerHTML='<div style="padding:16px 20px;border:1.5px solid var(--black);border-top:none;color:var(--text-dim);font-size:12px;">Выберите хотя бы одну зону нанесения</div>'; return; }
  const zn={chest:'Грудь',back:'Спина','left-sleeve':'Лев. рукав','right-sleeve':'Прав. рукав'};
  const zi={chest:'⬛',back:'🔳','left-sleeve':'◼','right-sleeve':'◼'};
  c.innerHTML = state.zones.map((zone,idx)=>{
    const p=getDtgZone(zone);
    const fmts=['A6','A5','A4','A3','A3+'];
    const fbtns=fmts.map(f=>{const a=p.size===f;return `<button class="fmt-btn${a?' active':''}" data-fmt="${f}" onclick="setDtgFormat('${zone}','${f}')" style="background:${a?'var(--black)':'var(--white)'};color:${a?'var(--white)':'var(--black)'}">${f}</button>`;}).join('');
    return `<div class="zone-print-card">
      <div class="zone-print-header">
        <div class="zone-print-num">${idx+1}</div>
        <div style="font-size:18px;line-height:1">${zi[zone]}</div>
        <div class="zone-print-zone-name">${zn[zone]}</div>
      </div>
      <div class="zone-print-body">
        <div class="zone-print-field">
          <div class="zone-print-label">Формат принта</div>
          <div class="fmt-btn-group" id="dtgfmt_${zone}">${fbtns}</div>
          <div style="margin-top:6px;font-size:10px;color:var(--text-dim)">Полноцветная печать · без ограничений по цветам</div>
        </div>
        <div class="zone-print-field" style="margin-left:auto">
          <div class="zone-print-surcharge">
            <div class="zone-print-surcharge-label">Надбавка</div>
            <div class="zone-print-surcharge-val" id="dtgz_${zone}">+${getDtgZoneSurcharge(zone)} ₽/шт</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════
// ВЫШИВКА
// ════════════════════════════════════════
const EMB_AREAS = [
  {key:'s', label:'S — до 7×7 см',   hint:'Небольшой логотип'},
  {key:'m', label:'M — до 12×12 см', hint:'Средний принт'},
  {key:'l', label:'L — до 20×20 см', hint:'Крупный элемент'}
];
function getEmbZone(zone) {
  if (!state.embZones) state.embZones = {};
  if (!state.embZones[zone]) state.embZones[zone] = {colors:3, area:'s'};
  return state.embZones[zone];
}
function getEmbZoneSurcharge(zone) {
  const p = getEmbZone(zone);
  const base    = PRICES.tech.embroidery || 350;
  const areaAdd = (PRICES.embAreaAdd||{s:0,m:80,l:180})[p.area] ?? 0;
  const colAdd  = Math.max(0,(p.colors||1)-1) * (PRICES.embColorAdd||20);
  return base + areaAdd + colAdd;
}
function getEmbTotal() {
  if (!state.zones||!state.zones.length) return PRICES.tech.embroidery||350;
  return state.zones.reduce((s,z)=>s+getEmbZoneSurcharge(z),0);
}
function setEmbColors(zone, n) {
  getEmbZone(zone).colors = n;
  const g = document.getElementById(`embclr_${zone}`);
  if (g) g.querySelectorAll('.clr-btn').forEach((b,i)=>{
    const a=(i+1)===n;
    b.classList.toggle('active',a);
    b.style.background=a?'var(--black)':'var(--white)';
    b.style.color=a?'var(--white)':'var(--black)';
  });
  updateEmbZoneDisplay(zone);
  renderEmbTotal();
  updateTotal();
  scheduleSave();
}
function setEmbArea(zone, area) {
  getEmbZone(zone).area = area;
  const g = document.getElementById(`embarea_${zone}`);
  if (g) g.querySelectorAll('.fmt-btn').forEach(b=>{
    const a=b.dataset.area===area;
    b.classList.toggle('active',a);
    b.style.background=a?'var(--black)':'var(--white)';
    b.style.color=a?'var(--white)':'var(--black)';
  });
  updateEmbZoneDisplay(zone);
  renderEmbTotal();
  updateTotal();
  scheduleSave();
}
function updateEmbZoneDisplay(zone) {
  const el = document.getElementById(`embz_${zone}`);
  if (el) el.textContent = `+${getEmbZoneSurcharge(zone)} ₽/шт`;
}
function renderEmbTotal() {
  const el = document.getElementById('embTotalDisplay');
  if (el) el.textContent = `+${getEmbTotal()} ₽/шт`;
  const lbl = document.getElementById('embPriceLabel');
  if (lbl) lbl.textContent = `от ${getEmbTotal()} ₽/шт`;
}
function renderEmbZoneCards() {
  const c = document.getElementById('embZoneCards');
  if (!c) return;
  if (!state.zones||!state.zones.length) { c.innerHTML='<div style="padding:16px 20px;border:1.5px solid var(--black);border-top:none;color:var(--text-dim);font-size:12px;">Выберите хотя бы одну зону нанесения</div>'; return; }
  const zn={chest:'Грудь',back:'Спина','left-sleeve':'Лев. рукав','right-sleeve':'Прав. рукав'};
  const zi={chest:'⬛',back:'🔳','left-sleeve':'◼','right-sleeve':'◼'};
  c.innerHTML = state.zones.map((zone,idx)=>{
    const p=getEmbZone(zone);
    const abtns=EMB_AREAS.map(a=>{const act=p.area===a.key;return `<button class="fmt-btn${act?' active':''}" data-area="${a.key}" onclick="setEmbArea('${zone}','${a.key}')" style="background:${act?'var(--black)':'var(--white)'};color:${act?'var(--white)':'var(--black)'};">${a.label}</button>`;}).join('');
    const cbtns=[1,2,3,4,5,6].map(n=>{const a=(p.colors||3)===n;return `<button class="clr-btn${a?' active':''}" onclick="setEmbColors('${zone}',${n})" style="background:${a?'var(--black)':'var(--white)'};color:${a?'var(--white)':'var(--black)'}">${n}</button>`;}).join('');
    return `<div class="zone-print-card">
      <div class="zone-print-header">
        <div class="zone-print-num">${idx+1}</div>
        <div style="font-size:18px;line-height:1">${zi[zone]}</div>
        <div class="zone-print-zone-name">${zn[zone]}</div>
      </div>
      <div class="zone-print-body">
        <div class="zone-print-field" style="flex:1;min-width:200px">
          <div class="zone-print-label">Размер области вышивки</div>
          <div class="fmt-btn-group" id="embarea_${zone}" style="flex-wrap:wrap">${abtns}</div>
        </div>
        <div class="zone-print-field">
          <div class="zone-print-label">Цветов нити</div>
          <div class="clr-btn-group" id="embclr_${zone}">${cbtns}</div>
          <div style="margin-top:6px;font-size:10px;color:var(--text-dim)">+${PRICES.embColorAdd||20} ₽ за каждый доп. цвет</div>
        </div>
        <div class="zone-print-field" style="margin-left:auto">
          <div class="zone-print-surcharge">
            <div class="zone-print-surcharge-label">Надбавка</div>
            <div class="zone-print-surcharge-val" id="embz_${zone}">+${getEmbZoneSurcharge(zone)} ₽/шт</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════
// DTF
// ════════════════════════════════════════
function getDtfZone(zone) {
  if (!state.dtfZones) state.dtfZones = {};
  if (!state.dtfZones[zone]) state.dtfZones[zone] = {size:'A4'};
  return state.dtfZones[zone];
}
function getDtfZoneSurcharge(zone) {
  const p = getDtfZone(zone);
  const base   = PRICES.tech.dtf || 180;
  const fmtAdd = (PRICES.dtfFormatAdd||{'A6':0,'A5':20,'A4':50,'A3':100,'A3+':160})[p.size] ?? 50;
  return base + fmtAdd;
}
function getDtfTotal() {
  if (!state.zones||!state.zones.length) return PRICES.tech.dtf||180;
  return state.zones.reduce((s,z)=>s+getDtfZoneSurcharge(z),0);
}
function setDtfFormat(zone, fmt) {
  getDtfZone(zone).size = fmt;
  const g = document.getElementById(`dtffmt_${zone}`);
  if (g) g.querySelectorAll('.fmt-btn').forEach(b=>{
    const a=b.dataset.fmt===fmt;
    b.classList.toggle('active',a);
    b.style.background=a?'var(--black)':'var(--white)';
    b.style.color=a?'var(--white)':'var(--black)';
  });
  updateDtfZoneDisplay(zone);
  renderDtfTotal();
  updateTotal();
  scheduleSave();
}
function updateDtfZoneDisplay(zone) {
  const el = document.getElementById(`dtfz_${zone}`);
  if (el) el.textContent = `+${getDtfZoneSurcharge(zone)} ₽/шт`;
}
function renderDtfTotal() {
  const el = document.getElementById('dtfTotalDisplay');
  if (el) el.textContent = `+${getDtfTotal()} ₽/шт`;
  const lbl = document.getElementById('dtfPriceLabel');
  if (lbl) lbl.textContent = `от ${getDtfTotal()} ₽/шт`;
}
function renderDtfZoneCards() {
  const c = document.getElementById('dtfZoneCards');
  if (!c) return;
  if (!state.zones||!state.zones.length) { c.innerHTML='<div style="padding:16px 20px;border:1.5px solid var(--black);border-top:none;color:var(--text-dim);font-size:12px;">Выберите хотя бы одну зону нанесения</div>'; return; }
  const zn={chest:'Грудь',back:'Спина','left-sleeve':'Лев. рукав','right-sleeve':'Прав. рукав'};
  const zi={chest:'⬛',back:'🔳','left-sleeve':'◼','right-sleeve':'◼'};
  c.innerHTML = state.zones.map((zone,idx)=>{
    const p=getDtfZone(zone);
    const fmts=['A6','A5','A4','A3','A3+'];
    const fbtns=fmts.map(f=>{const a=p.size===f;return `<button class="fmt-btn${a?' active':''}" data-fmt="${f}" onclick="setDtfFormat('${zone}','${f}')" style="background:${a?'var(--black)':'var(--white)'};color:${a?'var(--white)':'var(--black)'}">${f}</button>`;}).join('');
    return `<div class="zone-print-card">
      <div class="zone-print-header">
        <div class="zone-print-num">${idx+1}</div>
        <div style="font-size:18px;line-height:1">${zi[zone]}</div>
        <div class="zone-print-zone-name">${zn[zone]}</div>
      </div>
      <div class="zone-print-body">
        <div class="zone-print-field">
          <div class="zone-print-label">Формат принта</div>
          <div class="fmt-btn-group" id="dtffmt_${zone}">${fbtns}</div>
          <div style="margin-top:6px;font-size:10px;color:var(--text-dim)">Неограниченное количество цветов</div>
        </div>
        <div class="zone-print-field" style="margin-left:auto">
          <div class="zone-print-surcharge">
            <div class="zone-print-surcharge-label">Надбавка</div>
            <div class="zone-print-surcharge-val" id="dtfz_${zone}">+${getDtfZoneSurcharge(zone)} ₽/шт</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// setScreenColors kept as alias (used in restore logic)
function setScreenColors(n) { /* no-op, handled per-zone now */ }



// ─── TOTAL ───
function calcTotal() {
  const total = Object.values(getActiveSizes()).reduce((a,b)=>a+b,0)
    + (state.customSizes||[]).reduce((a,c)=>a+(+c.qty||0),0);
  if (total===0) return 0;
  // Если выбран SKU — берём ~Цену из SKU
  let base;
  if (state.sku) {
    base = getSkuEstPrice(state.sku);
  } else {
    // Фолбэк — старая логика
    base = (PRICES.type[state.type]||480)
      + ((!isAccessory(state.type) && PRICES.fit) ? (PRICES.fit[state.fit||'regular']||0) : 0)
      + (PRICES.fabric[state.fabric]||0);
  }
  // Доп. обработки
  const extrasCost = (state.extras||[]).reduce((s,code) => {
    const ex = EXTRAS_CATALOG.find(e => e.code === code);
    return s + (ex ? ex.price : 0);
  }, 0);
  // Лейблы и бирки (v2 конфигуратор)
  const labelsCost = getLabelConfigPrice();
  const tech = getScreenSurcharge();
  let unitPrice = Math.round(base + extrasCost + labelsCost + tech);
  const pack  = document.getElementById('togglePack')?.checked  ? (PRICES.pack||0)  : 0;
  const urgent= document.getElementById('toggleUrgent')?.checked? (PRICES.urgentMult||0) : 0;
  unitPrice += pack;
  return Math.round(total*unitPrice*(1+urgent));
}
function updateTotal() {
  updateScreenSurchargeDisplay();
  const sum = calcTotal();
  const el = document.getElementById('headerTotal');
  if (el) {
    const formatted = sum>0 ? sum.toLocaleString('ru')+' ₽' : '— ₽';
    const prev = el.textContent;
    el.textContent = formatted;
    if (prev!==formatted && sum>0) { el.classList.add('price-flash'); setTimeout(()=>el.classList.remove('price-flash'),350); }
  }
  refreshPrices();
  setTimeout(updateNextBtns, 0);
}




