// ════════════════════════════════════════════════════════════
//   PRICES EDITOR V.2
// ════════════════════════════════════════════════════════════
// Fullscreen editor, tabs, live calc, history, export/import

// ─── INIT ───

// ═══════════════════════════════════════════
// PRICES EDITOR
// ═══════════════════════════════════════════

const DEFAULT_PRICES = {
  type: {tee:480, longsleeve:620, tank:350, hoodie:1200, sweat:900, 'zip-hoodie':1400, 'half-zip':1100, pants:1000, shorts:750, shopper:350, basecap:600, 'dad-cap':650, '5panel':550, socks:280},
  fabric: {'kulirnaya':0,'dvunitka':80,'interlock':120,'futher-350-nachers':0,'futher-350-petlya':0,'futher-370-nachers':30,'futher-370-petlya':30,'futher-470-petlya':80},
  tech: {screen:120, dtg:280, embroidery:350, dtf:180},
  // DTG: надбавка за формат + белая подложка
  dtgFormatAdd: {'A6':0,'A5':30,'A4':60,'A3':120,'A3+':180},
  dtgWhiteUnder: 60,   // +60₽ подложка на цветном текстиле
  // Вышивка: надбавка за размер области
  embAreaAdd: {s:0, m:80, l:180},   // s=до7см, m=до12см, l=до20см
  embColorAdd: 20,     // +20₽ за каждый доп. цвет нити (сверх 1)
  // DTF: надбавка за формат
  dtfFormatAdd: {'A6':0,'A5':20,'A4':50,'A3':100,'A3+':160},
  label:30, pack:15, urgentMult:0.2,
  fit:{ regular:0, free:50, oversize:100 },
};

function loadStoredPrices() {
  try {
    const stored = localStorage.getItem('ph_prices');
    if (stored) {
      const p = JSON.parse(stored);
      if (p.type)            Object.assign(PRICES.type, p.type);
      if (p.fabric)          Object.assign(PRICES.fabric, p.fabric);
      if (p.tech)            Object.assign(PRICES.tech, p.tech);
      if (p.fit)             Object.assign(PRICES.fit, p.fit);
      // Screen matrix
      if (p.screenMatrix) {
        PRICES.screenMatrix = p.screenMatrix;
        // Sync to SCREEN_MATRIX constant
        ['A4','A3','A3+','Max'].forEach(fmt => {
          if (p.screenMatrix[fmt]) {
            if (!SCREEN_MATRIX[fmt]) SCREEN_MATRIX[fmt] = {};
            for (let c = 1; c <= 8; c++) {
              if (p.screenMatrix[fmt][c]) SCREEN_MATRIX[fmt][c] = [...p.screenMatrix[fmt][c]];
            }
          }
        });
      }
      if (p.screenColoredMult !== undefined) { PRICES.screenColoredMult = p.screenColoredMult; }
      if (p.screenFutherMult  !== undefined) { PRICES.screenFutherMult  = p.screenFutherMult; }
      if (p.screenFxMult      !== undefined) { PRICES.screenFxMult = p.screenFxMult; SCREEN_FX.forEach(f => { if (f.mult > 1) f.mult = p.screenFxMult; }); }
      // Flex matrix
      if (p.flexMatrix) {
        ['A6','A5','A4','A3'].forEach(fmt => {
          if (p.flexMatrix[fmt]) {
            if (!FLEX_MATRIX[fmt]) FLEX_MATRIX[fmt] = {};
            for (let c = 1; c <= 3; c++) {
              if (p.flexMatrix[fmt][c]) FLEX_MATRIX[fmt][c] = [...p.flexMatrix[fmt][c]];
            }
          }
        });
      }
      if (p.flexSinglePrice) Object.assign(FLEX_SINGLE_PRICE, p.flexSinglePrice);
      if (p.dtfFormatAdd)    PRICES.dtfFormatAdd    = p.dtfFormatAdd;
      if (p.dtgFormatAdd)    PRICES.dtgFormatAdd    = p.dtgFormatAdd;
      if (p.embAreaAdd)      PRICES.embAreaAdd      = p.embAreaAdd;
      if (p.label      !== undefined) PRICES.label      = p.label;
      if (p.pack       !== undefined) PRICES.pack       = p.pack;
      if (p.urgentMult !== undefined) PRICES.urgentMult = p.urgentMult;
      if (p.embColorAdd      !== undefined) PRICES.embColorAdd      = p.embColorAdd;
      if (p.dtgWhiteUnder    !== undefined) PRICES.dtgWhiteUnder    = p.dtgWhiteUnder;
    }
  } catch(e) {}
}

// ── SCREEN MATRIX IN PRICES EDITOR ──
function peShowSubtab(id, el) {
  document.querySelectorAll('.pe-subpane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.pe-subtab').forEach(t => t.classList.remove('active'));
  const pane = document.getElementById('pesub-' + id);
  if (pane) pane.classList.add('active');
  if (el) el.classList.add('active');
}

function peRenderFlexMatrix() {
  const body = document.getElementById('peFlexMatrixBody');
  if (!body) return;
  const formats = [{k:'A6',l:'A6 · 10×15 см'},{k:'A5',l:'A5 · 15×20 см'},{k:'A4',l:'A4 · 20×30 см'},{k:'A3',l:'A3 · 30×42 см'}];
  const tiers = [1,20,35,50];
  let html = '';
  formats.forEach(fmt => {
    html += `<tr style="background:var(--accent);color:var(--white);font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:900;letter-spacing:.5px;text-transform:uppercase"><td colspan="6" style="padding:6px 8px;text-align:left">${fmt.l}</td></tr>`;
    for (let c = 1; c <= 3; c++) {
      const even = c % 2 === 0;
      const cells = tiers.map((t, ti) => {
        const id = `pfm_${fmt.k}_${c}_${ti}`;
        return `<td style="padding:0;${even?'background:#fafafa':''}"><input class="pe-tt-inp" id="${id}" type="number" min="0" step="1" style="width:100%;height:28px;text-align:center;font-size:11px" oninput="peOnFlexMatrixChange('${fmt.k}',${c},${ti},this)"></td>`;
      }).join('');
      html += `<tr${even?' style="background:#fafafa"':''}>
        <td style="font-size:10px;font-weight:700;color:var(--text-dim);background:var(--bg2);text-align:left;padding-left:8px">${fmt.k}</td>
        <td style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:900;color:var(--text-dim);background:var(--bg2);text-align:center;width:24px">${c}</td>
        ${cells}</tr>`;
    }
  });
  body.innerHTML = html;
}

function pePopulateFlexMatrix() {
  const formats = ['A6','A5','A4','A3'];
  const tiers = [0,1,2,3];
  formats.forEach(fmt => {
    for (let c = 1; c <= 3; c++) {
      tiers.forEach(ti => {
        const id = `pfm_${fmt}_${c}_${ti}`;
        const el = document.getElementById(id);
        if (el && FLEX_MATRIX[fmt] && FLEX_MATRIX[fmt][c]) {
          el.value = FLEX_MATRIX[fmt][c][ti] || 0;
          el.setAttribute('data-pe-orig', el.value);
        }
      });
    }
  });
}

function peOnFlexMatrixChange(fmt, colors, tierIdx, inp) {
  if (!FLEX_MATRIX[fmt]) return;
  if (!FLEX_MATRIX[fmt][colors]) return;
  FLEX_MATRIX[fmt][colors][tierIdx] = parseFloat(inp.value) || 0;
  // Update single price if tier 0
  if (tierIdx === 0) FLEX_SINGLE_PRICE[fmt] = parseFloat(inp.value) || 0;
  const tierLabels = ['1шт','20','35','50'];
  peOnChange(inp, `Flex ${fmt} ${colors}цв ${tierLabels[tierIdx]}`);
}

function peRenderScreenMatrix() {
  const body = document.getElementById('peScreenMatrixBody');
  if (!body) return;
  const formats = [{k:'A4',l:'A4 · 20×29 см'},{k:'A3',l:'A3 · 29×42 см'},{k:'A3plus',l:'A3+ · 36×42 см',display:'A3+'},{k:'Max',l:'Max · 38×54 см'}];
  const tiers = [50,100,300,500,700,1000];
  let html = '';
  formats.forEach(fmt => {
    const label = fmt.display || fmt.k;
    html += `<tr style="background:var(--accent);color:var(--white);font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:900;letter-spacing:.5px;text-transform:uppercase"><td colspan="8" style="padding:6px 8px;text-align:left">${fmt.l}</td></tr>`;
    for (let c = 1; c <= 8; c++) {
      const even = c % 2 === 0;
      const cells = tiers.map((t, ti) => {
        const id = `psm_${fmt.k}_${c}_${ti}`;
        return `<td style="padding:0;${even?'background:#fafafa':''}"><input class="pe-tt-inp" id="${id}" type="number" min="0" step="1" style="width:100%;height:28px;text-align:center;font-size:11px" oninput="peOnScreenMatrixChange('${fmt.k}',${c},${ti},this)"></td>`;
      }).join('');
      html += `<tr${even?' style="background:#fafafa"':''}>
        <td style="font-size:10px;font-weight:700;color:var(--text-dim);background:var(--bg2);text-align:left;padding-left:8px">${label}</td>
        <td style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:900;color:var(--text-dim);background:var(--bg2);text-align:center;width:24px">${c}</td>
        ${cells}</tr>`;
    }
  });
  body.innerHTML = html;
}

function pePopulateScreenMatrix() {
  const matrix = PRICES.screenMatrix || SCREEN_MATRIX;
  const fmtMap = {'A4':'A4','A3':'A3','A3plus':'A3+','Max':'Max'};
  const fmtKeys = ['A4','A3','A3plus','Max'];
  const tiers = [0,1,2,3,4,5];
  fmtKeys.forEach(fk => {
    const matrixKey = fmtMap[fk]; // 'A3+' for actual matrix lookup
    for (let c = 1; c <= 8; c++) {
      tiers.forEach(ti => {
        const id = `psm_${fk}_${c}_${ti}`;
        const el = document.getElementById(id);
        if (el && matrix[matrixKey] && matrix[matrixKey][c]) {
          el.value = matrix[matrixKey][c][ti] || 0;
          el.setAttribute('data-pe-orig', el.value);
        }
      });
    }
  });
}

function peOnScreenMatrixChange(fmtKey, colors, tierIdx, inp) {
  // fmtKey is 'A3plus' for A3+, map to actual key
  const fmtMap = {'A4':'A4','A3':'A3','A3plus':'A3+','Max':'Max'};
  const fmt = fmtMap[fmtKey] || fmtKey;
  if (!SCREEN_MATRIX[fmt]) return;
  if (!SCREEN_MATRIX[fmt][colors]) return;
  SCREEN_MATRIX[fmt][colors][tierIdx] = parseFloat(inp.value) || 0;
  if (!PRICES.screenMatrix) PRICES.screenMatrix = {};
  if (!PRICES.screenMatrix[fmt]) PRICES.screenMatrix[fmt] = {};
  if (!PRICES.screenMatrix[fmt][colors]) PRICES.screenMatrix[fmt][colors] = [...SCREEN_MATRIX[fmt][colors]];
  PRICES.screenMatrix[fmt][colors][tierIdx] = parseFloat(inp.value) || 0;
  const tierLabels = ['50','100','300','500','700','1000'];
  peOnChange(inp, `Шелкография ${fmt} ${colors}цв ${tierLabels[tierIdx]}шт`);
}

// ── ОТКРЫТЬ / ЗАКРЫТЬ ──
function openPrices() {
  document.getElementById('pricesEditor').classList.add('open');
  document.getElementById('pricesBtn').classList.add('active');
  pePopulate();
}
function closePrices() {
  document.getElementById('pricesEditor').classList.remove('open');
  document.getElementById('pricesBtn').classList.remove('active');
}
function togglePrices() {
  document.getElementById('pricesEditor').classList.contains('open') ? closePrices() : openPrices();
}

// ── ВКЛАДКИ ──
function peShowTab(id, el) {
  document.querySelectorAll('.pe-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.pe-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('pep-' + id).classList.add('active');
  el.classList.add('active');
}

// ── ЗАПОЛНИТЬ ФОРМУ ──
function pePopulate() {
  const s = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) {
      el.value = val;
      el.setAttribute('data-pe-orig', val);
      el.classList.remove('changed');
    }
  };
  const h = (id, val) => {
    const el = document.getElementById('ph_' + id);
    if (el) { el.textContent = 'по умолч.: ' + val + ' ₽'; el.classList.remove('was'); }
  };
  // Изделия, Ткани, Лекала — теперь управляются через SKU-каталог (v1.7b)
  // Нанесение — базовые (Screen теперь в матрице)
  s('p_dtf',              PRICES.tech.dtf);
  s('p_dtg',              PRICES.tech.dtg);
  s('p_embroidery',       PRICES.tech.embroidery);
  // Нанесение — форматы DTF/DTG
  const da = PRICES.dtfFormatAdd || {};
  s('p_dtfA6',   da['A6']??0);  s('p_dtfA5',   da['A5']??20);
  s('p_dtfA4',   da['A4']??50); s('p_dtfA3',   da['A3']??100); s('p_dtfA3plus',da['A3+']??160);
  const dga = PRICES.dtgFormatAdd || {};
  s('p_dtgA6',   dga['A6']??0); s('p_dtgA5',   dga['A5']??30);
  s('p_dtgA4',   dga['A4']??60); s('p_dtgA3',  dga['A3']??120); s('p_dtgA3plus',dga['A3+']??180);
  const ea = PRICES.embAreaAdd || {};
  s('p_embS', ea.s??0); s('p_embM', ea.m??80); s('p_embL', ea.l??180);
  // Доп. параметры
  s('p_embColorAdd',      PRICES.embColorAdd??20);
  s('p_dtgWhiteUnder',    PRICES.dtgWhiteUnder??60);
  // Минималки
  s('p_minScreen', 50); s('p_minEmb', 10); s('p_minDtf', 1); s('p_minDtg', 1);
  // Опции
  s('p_label',  PRICES.label);  h('label',  DEFAULT_PRICES.label);
  s('p_pack',   PRICES.pack);   h('pack',   DEFAULT_PRICES.pack);
  s('p_urgent', Math.round((PRICES.urgentMult??0.2)*100)); h('urgent', '20');
  // Screen matrix
  peRenderScreenMatrix();
  pePopulateScreenMatrix();
  // Flex matrix
  peRenderFlexMatrix();
  pePopulateFlexMatrix();
  // Наценки шелкографии
  s('p_screenColoredMult', PRICES.screenColoredMult ?? 1.3);
  s('p_screenFutherMult',  PRICES.screenFutherMult ?? 1.5);
  s('p_screenFxMult',      PRICES.screenFxMult ?? 2.0);
  // Обновляем визуал бара и истории
  peUpdateBar();
  peRenderHistory();
  // Инициализируем калькулятор — тип tee, ткани и зоны
  // Live calc removed in v1.7b
  // Сбрасываем активные кнопки типов
  // removed - live calc
  // removed
  // removed
  // Сбрасываем технику
  // removed
  // removed
  // removed
  // removed
}

// ── ИСТОРИЯ ИЗМЕНЕНИЙ ЦЕН ──
// Простой массив в localStorage. Каждая запись: {field, was, now, inputId, time, date}
// Не хранит ссылки на DOM. Не сбрасывается при открытии/закрытии.

function peGetHistory() {
  try { return JSON.parse(localStorage.getItem('ph_price_history') || '[]'); }
  catch(e) { return []; }
}
function pePutHistory(arr) {
  try { localStorage.setItem('ph_price_history', JSON.stringify(arr.slice(0, 50))); }
  catch(e) {}
}

function peOnChange(inp, fieldName) {
  // orig хранится как data-атрибут
  if (!inp.hasAttribute('data-pe-orig')) inp.setAttribute('data-pe-orig', inp.value);
  const was = parseFloat(inp.getAttribute('data-pe-orig')) || 0;
  const now = parseFloat(inp.value) || 0;

  // Обновляем визуал под инпутом
  const hEl = document.getElementById('ph_' + inp.id.replace('p_',''));

  if (now !== was) {
    inp.classList.add('changed');
    if (hEl) { hEl.textContent = 'было: ' + was + ' ₽ → ' + now + ' ₽'; hEl.classList.add('was'); }

    // Пишем в историю (убираем дубль по inputId)
    const hist = peGetHistory().filter(h => h.inputId !== inp.id);
    hist.unshift({
      field: fieldName, was, now, inputId: inp.id,
      time: new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}),
      date: new Date().toLocaleDateString('ru',{day:'2-digit',month:'2-digit'})
    });
    pePutHistory(hist);
  } else {
    inp.classList.remove('changed');
    if (hEl) { hEl.textContent = ''; hEl.classList.remove('was'); }
    // Вернули к оригиналу — убираем из истории
    const hist = peGetHistory().filter(h => h.inputId !== inp.id);
    pePutHistory(hist);
  }

  peUpdateBar();
  peRenderHistory();
  // removed
}

function peUpdateBar() {
  const count = peGetHistory().length;
  const bar = document.getElementById('peChangedBar');
  const cnt = document.getElementById('peChangedCount');
  const btn = document.getElementById('peSaveBtn');
  if (cnt) cnt.textContent = count;
  if (bar) bar.classList.toggle('show', count > 0);
  if (btn) btn.classList.toggle('changed', count > 0);
}

function peRenderHistory() {
  const list = document.getElementById('peHistList');
  const empty = document.getElementById('peHistEmpty');
  if (!list) return;
  const hist = peGetHistory();
  if (hist.length === 0) {
    list.innerHTML = '';
    if (empty) { empty.style.display = 'block'; list.appendChild(empty); }
    return;
  }
  if (empty) empty.style.display = 'none';
  list.innerHTML = hist.slice(0, 30).map((item, i) =>
    `<div class="pe-hist-row">
      <span class="pe-hist-time">${item.date||''} ${item.time}</span>
      <span class="pe-hist-field">${item.field}</span>
      <span class="pe-hist-was">${item.was} ₽</span>
      <span class="pe-hist-arr">→</span>
      <span class="pe-hist-now">${item.now} ₽</span>
      <button class="pe-hist-undo" onclick="peUndoItem(${i})">↺</button>
    </div>`
  ).join('');
}

function peUndoItem(i) {
  const hist = peGetHistory();
  const item = hist[i];
  if (!item) return;
  const inp = document.getElementById(item.inputId);
  if (inp) {
    inp.value = item.was;
    inp.setAttribute('data-pe-orig', item.was);
    inp.classList.remove('changed');
    const hEl = document.getElementById('ph_' + inp.id.replace('p_',''));
    if (hEl) { hEl.textContent = ''; hEl.classList.remove('was'); }
  }
  hist.splice(i, 1);
  pePutHistory(hist);
  peUpdateBar();
  peRenderHistory();
  // removed
}

function peUndo() { peUndoItem(0); }

function peClearHistory() {
  try { localStorage.removeItem('ph_price_history'); } catch(e) {}
  peUpdateBar();
  peRenderHistory();
}

// ── СОХРАНИТЬ ──
function peSave() {
  const g = id => parseFloat(document.getElementById(id)?.value) || 0;
  // Изделия, Ткани, Лекала — теперь в SKU-каталоге (v1.7b), не трогаем PRICES.type/fabric/fit
  Object.assign(PRICES.tech, {
    screen:0, dtf:g('p_dtf'), dtg:g('p_dtg'), embroidery:g('p_embroidery')
  });
  // Screen matrix — уже обновляется live через peOnScreenMatrixChange
  // Множители шелкографии
  PRICES.screenColoredMult = g('p_screenColoredMult') || 1.3;
  PRICES.screenFutherMult  = g('p_screenFutherMult') || 1.5;
  PRICES.screenFxMult      = g('p_screenFxMult') || 2.0;
  // Обновляем SCREEN_* константы
  SCREEN_FX.forEach(f => { if (f.mult > 1) f.mult = PRICES.screenFxMult; });

  PRICES.dtfFormatAdd     = {'A6':g('p_dtfA6'),'A5':g('p_dtfA5'),'A4':g('p_dtfA4'),'A3':g('p_dtfA3'),'A3+':g('p_dtfA3plus')};
  // Live calc removed in v1.7b
  PRICES.embAreaAdd       = { s:g('p_embS'), m:g('p_embM'), l:g('p_embL') };
  PRICES.embColorAdd      = g('p_embColorAdd');
  PRICES.dtgWhiteUnder    = g('p_dtgWhiteUnder');
  PRICES.label      = g('p_label');
  PRICES.pack       = g('p_pack');
  PRICES.urgentMult = g('p_urgent') / 100;
  // Собираем screenMatrix для сохранения
  const smSave = {};
  ['A4','A3','A3+','Max'].forEach(fmt => { smSave[fmt] = {}; for(let c=1;c<=8;c++) smSave[fmt][c] = [...(SCREEN_MATRIX[fmt]?.[c]||[])]; });
  // Flex matrix
  const fmSave = {};
  ['A6','A5','A4','A3'].forEach(fmt => { fmSave[fmt] = {}; for(let c=1;c<=3;c++) fmSave[fmt][c] = [...(FLEX_MATRIX[fmt]?.[c]||[])]; });
  try {
    localStorage.setItem('ph_prices', JSON.stringify({
      type:PRICES.type, fabric:PRICES.fabric, tech:PRICES.tech, fit:PRICES.fit,
      screenMatrix:smSave, flexMatrix:fmSave, flexSinglePrice:{...FLEX_SINGLE_PRICE},
      screenColoredMult:PRICES.screenColoredMult, screenFutherMult:PRICES.screenFutherMult, screenFxMult:PRICES.screenFxMult,
      dtfFormatAdd:PRICES.dtfFormatAdd,
      dtgFormatAdd:PRICES.dtgFormatAdd, embAreaAdd:PRICES.embAreaAdd,
      label:PRICES.label, pack:PRICES.pack, urgentMult:PRICES.urgentMult,
      embColorAdd:PRICES.embColorAdd, dtgWhiteUnder:PRICES.dtgWhiteUnder
    }));
  } catch(e) {}
  // Сбрасываем визуал changed — все значения стали новым baseline
  document.querySelectorAll('.pe-pc-inp,.pe-tt-inp').forEach(el => {
    el.classList.remove('changed');
    el.setAttribute('data-pe-orig', el.value);
  });
  document.querySelectorAll('.pe-pc-hist.was').forEach(el => { el.textContent = ''; el.classList.remove('was'); });
  peUpdateBar();
  peRenderHistory();
  renderFabricGrid(state.type);
  updateTotal();
  // Обновляем Express-калькулятор если он открыт
  if (typeof expCalc === 'function') {
    const panel = document.getElementById('expressPanel');
    if (panel && panel.classList.contains('open')) expCalc();
  }
  showToast('Цены сохранены ✓');
}

async function peReset() {
  const ok = await showConfirm('Сбросить цены?', 'Цены нанесения и опций вернутся к значениям по умолчанию.', 'Сбросить');
  if (!ok) return;
  // Изделия/Ткани/Лекала теперь в SKU — сбрасываем только нанесение и опции
  Object.assign(PRICES.tech,   DEFAULT_PRICES.tech);
  PRICES.label = DEFAULT_PRICES.label;
  PRICES.pack  = DEFAULT_PRICES.pack;
  PRICES.urgentMult = DEFAULT_PRICES.urgentMult;
  try { localStorage.removeItem('ph_prices'); } catch(e) {}
  pePopulate();
  updateTotal();
}

// ── ЭКСПОРТ / ИМПОРТ JSON ──
function peExport() {
  const data = {};
  document.querySelectorAll('[id^="p_"]').forEach(el => { if (el.id) data[el.id] = el.value; });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pinhead-prices.json';
  a.click();
  showToast('JSON скачан ↑');
}

function peImport() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        let count = 0;
        Object.entries(data).forEach(([key, val]) => {
          const el = document.getElementById(key);
          if (el && !el.disabled) {
            const old = el.value;
            el.value = val;
            if (old !== String(val)) { peOnChange(el, key.replace('p_','')); count++; }
          }
        });
        showToast('Импортировано: ' + count + ' значений ↓');
        // removed
      } catch(err) { alert('Ошибка JSON файла'); }
    };
    reader.readAsText(file);
  };
  inp.click();
}

// ── LIVE КАЛЬКУЛЯТОР v.2 ──
// ── Legacy aliases ──
function markChanged()          { /* no-op — peOnChange handles it */ }
function setPricesStatus()      { }
function populatePricesForm()   { pePopulate(); }
function savePrices()           { peSave(); }
function resetPricesToDefault() { peReset(); }

// ═══ v1.6 UX: Spinner ═══
function showSpinner(text) {
  const el = document.getElementById('spinnerText');
  if (el) el.textContent = text || 'Загрузка...';
  document.getElementById('spinnerOverlay').classList.add('show');
}
function hideSpinner() {
  document.getElementById('spinnerOverlay').classList.remove('show');
}

// ═══ v1.6 UX: Confirm Modal ═══
let _confirmResolve = null;
function showConfirm(title, text, okLabel) {
  document.getElementById('confirmTitle').textContent = title || 'Подтверждение';
  document.getElementById('confirmText').textContent = text || 'Вы уверены?';
  document.getElementById('confirmOkBtn').textContent = okLabel || 'Удалить';
  document.getElementById('confirmOverlay').classList.add('show');
  return new Promise(resolve => { _confirmResolve = resolve; });
}
function confirmOk() {
  document.getElementById('confirmOverlay').classList.remove('show');
  if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
}
function confirmCancel() {
  document.getElementById('confirmOverlay').classList.remove('show');
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
}

// ═══ v1.7: SKU Editor — state ═══
var skuEditorTab = 'items';
var skuSearchQuery = '';
var skuFilterCat = 'all';

function openSkuEditor() {
  document.getElementById('skuEditorPage').classList.add('open');
  document.getElementById('skuBtn').classList.add('active');
  document.getElementById('skuUsdRate').value = USD_RATE;
  skuLoadCbRate();
  if (!_cbRateCache) skuFetchCbRate();
  skuRenderTab();
}
function closeSkuEditor() {
  document.getElementById('skuEditorPage').classList.remove('open');
  document.getElementById('skuBtn').classList.remove('active');
  // Автообновление: если вернулись из SKU-редактора — пересчитываем цены в конструкторе
  if (state.sku && state.sku.article) {
    // Обновляем ссылку на SKU (могли изменить цены/расход в редакторе)
    const fresh = SKU_CATALOG.find(s => s.article === state.sku.article);
    if (fresh) state.sku = fresh;
  }
  renderSkuList();
  renderFabricGrid(state.type);
  updateTotal();
}
function toggleSkuEditor() {
  const p = document.getElementById('skuEditorPage');
  p.classList.contains('open') ? closeSkuEditor() : openSkuEditor();
}
function skuSwitchTab(tab) {
  skuEditorTab = tab;
  document.querySelectorAll('.sku-tab').forEach((t,i) => {
    t.classList.toggle('active', ['items','fabrics','trims','extras','hardware'][i] === tab);
  });
  skuRenderTab();
}
function onUsdRateChange(val) {
  let rate = parseFloat(val) || 92;
  const warn = document.getElementById('skuRateWarn');
  if (rate < 90) {
    rate = 90;
    document.getElementById('skuUsdRate').value = 90;
    if (warn) warn.style.display = 'inline';
    setTimeout(() => { if (warn) warn.style.display = 'none'; }, 2000);
  }
  USD_RATE = rate;
  saveSkuData();
  skuRenderTab();
  showToast('Курс обновлён: ' + rate + ' ₽/$');
}

var _cbRateCache = null;
function skuFetchCbRate() {
  const el = document.getElementById('skuCbRate');
  if (el) el.textContent = '...';
  fetch('https://www.cbr-xml-daily.ru/daily_json.js')
    .then(r => r.json())
    .then(data => {
      const usd = data?.Valute?.USD?.Value;
      if (usd) {
        _cbRateCache = Math.round(usd * 100) / 100;
        if (el) el.textContent = _cbRateCache;
        // Сохраняем в localStorage
        try { localStorage.setItem('ph_cb_rate', JSON.stringify({rate: _cbRateCache, date: new Date().toISOString().slice(0,10)})); } catch(e){}
      } else {
        if (el) el.textContent = 'ошибка';
      }
    })
    .catch(() => { if (el) el.textContent = 'нет связи'; });
}

// Загружаем кешированный курс ЦБ при старте
function skuLoadCbRate() {
  try {
    const cached = JSON.parse(localStorage.getItem('ph_cb_rate') || '{}');
    if (cached.rate) {
      _cbRateCache = cached.rate;
      const el = document.getElementById('skuCbRate');
      if (el) el.textContent = cached.rate + (cached.date ? ' (' + cached.date + ')' : '');
    }
  } catch(e){}
}

function skuRenderTab() {
  const body = document.getElementById('skuEditorBody');
  try {
    if (skuEditorTab === 'items') skuRenderItems(body);
    else if (skuEditorTab === 'fabrics') skuRenderFabrics(body);
    else if (skuEditorTab === 'trims') skuRenderTrims(body);
    else if (skuEditorTab === 'extras') skuRenderExtras(body);
    else if (skuEditorTab === 'hardware') skuRenderHardware(body);
  } catch(err) {
    const debug = {
      tab: skuEditorTab,
      skuLen: SKU_CATALOG.length,
      fabLen: FABRICS_CATALOG.length,
      trimLen: TRIM_CATALOG.length,
      extLen: EXTRAS_CATALOG.length,
      searchQ: typeof skuSearchQuery,
      filterCat: typeof skuFilterCat,
      err: err.message,
      stack: (err.stack||'').split('\n').slice(0,3).join(' | ')
    };
    body.innerHTML = '<div style="padding:20px;color:#c00;font-size:12px;word-break:break-all"><b>Ошибка:</b> ' + err.message + '<br><br><b>Debug:</b> ' + JSON.stringify(debug) + '<br><br><button class="sku-btn" onclick="try{localStorage.removeItem(\'ph_sku\');localStorage.removeItem(\'ph_fabrics\');localStorage.removeItem(\'ph_trims\');localStorage.removeItem(\'ph_extras\');location.reload()}catch(e){}">Сбросить каталог</button></div>';
  }
}

// ── Вкладка: Изделия (SKU) ──
// Все доступные зоны нанесения
const ALL_PRINT_ZONES = [
  {id:'front', name:'Грудь (перед)'}, {id:'back', name:'Спина'},
  {id:'sleeve-l', name:'Левый рукав'}, {id:'sleeve-r', name:'Правый рукав'},
  {id:'hood', name:'Капюшон'}, {id:'pocket', name:'Карман'},
  {id:'side-a', name:'Сторона A'}, {id:'side-b', name:'Сторона B'},
];

function skuRenderItems(body) {
  try {
  const cats = SKU_CATEGORIES;
  const totalSku = SKU_CATALOG.length;
  const catOpts = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const catFilterOpts = cats.map(c => `<option value="${c.id}" ${skuFilterCat===c.id?'selected':''}>${c.name}</option>`).join('');
  const q = skuSearchQuery.toLowerCase();
  let html = `<div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px">
    <div style="display:flex;gap:10px;align-items:center">
      <input class="sku-input" style="width:280px" placeholder="Поиск по названию или артикулу..." value="${skuSearchQuery}" oninput="skuSearchQuery=this.value;skuRenderTab()">
      <select class="sku-input sku-input-md" onchange="skuFilterCat=this.value;skuRenderTab()">
        <option value="all" ${skuFilterCat==='all'?'selected':''}>Все категории</option>
        ${catFilterOpts}
      </select>
      <span class="sku-stat">Всего: ${totalSku} SKU</span>
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      <button class="sku-btn sku-btn-primary" onclick="skuShowAddModal()">+ Добавить</button>
    </div>
  </div>`;
  if (totalSku === 0) {
    html += '<div style="padding:40px;text-align:center;color:#888">Каталог пуст. Нажмите «+ Добавить» или загрузите Excel.</div>';
    body.innerHTML = html;
    return;
  }
  const filteredCats = skuFilterCat === 'all' ? cats : cats.filter(c => c.id === skuFilterCat);
  filteredCats.forEach(cat => {
    let items = SKU_CATALOG.filter(s => s.category === cat.id);
    if (q) items = items.filter(s => (s.name||'').toLowerCase().includes(q) || (s.article||'').toLowerCase().includes(q));
    if (!items.length) return;
    html += `<div class="sku-section-title">${cat.name} (${items.length})</div>`;
    html += `<table class="sku-table">
      <tr>
        <th style="width:20px"></th>
        <th style="width:28px">№</th>
        <th style="width:95px">Артикул</th>
        <th style="min-width:180px">Название</th>
        <th style="width:80px">Fit</th>
        <th style="width:60px">Пошив</th>
        <th style="width:50px">Осн</th>
        <th style="width:50px">Отд</th>
        <th style="width:110px">Отделка</th>
        <th style="width:50px">Зоны</th>
        <th style="width:65px">~Цена</th>
        <th style="width:28px"></th>
      </tr>`;
    items.forEach((s, localIdx) => {
      const idx = SKU_CATALOG.indexOf(s);
      const fabric = FABRICS_CATALOG.find(f => f.forCategories.includes(s.category));
      const fabricCost = fabric ? Math.round(s.mainFabricUsage * fabric.priceUSD * USD_RATE) : 0;
      const trim = getTrimByCode(s.trimCode);
      const trimCost = trim ? Math.round((s.trimUsage||0) * trim.priceUSD * USD_RATE) : 0;
      const est = s.sewingPrice + fabricCost + trimCost;
      const trimOptions = TRIM_CATALOG.map(t =>
        `<option value="${t.code}" ${s.trimCode===t.code?'selected':''}>${t.name}</option>`
      ).join('');
      const catOptions = cats.map(c =>
        `<option value="${c.id}" ${s.category===c.id?'selected':''}>${c.name}</option>`
      ).join('');
      const zoneCount = (s.zones||[]).length;
      const zoneNames = (s.zones||[]).map(z => {
        const found = ALL_PRINT_ZONES.find(pz => pz.id === z);
        return found ? found.name : z;
      }).join(', ');
      html += `<tr draggable="true" data-sku-drag-idx="${idx}" ondragstart="skuDragStart(event,${idx})" ondragover="skuDragOver(event)" ondrop="skuDrop(event,${idx})" ondragend="skuDragEnd(event)" style="transition:background .15s">
        <td class="sku-drag-handle" style="cursor:grab;color:#ccc;font-size:14px;text-align:center;padding:3px 2px;user-select:none" title="Перетащить">⠿</td>
        <td style="font-size:11px;color:#aaa;text-align:center">${localIdx + 1}</td>
        <td style="font-weight:700;font-size:10px;color:#555;letter-spacing:.5px">${s.article || '—'}</td>
        <td><input class="sku-input" value="${s.name}" onchange="skuEditName(${idx},this.value)" style="max-width:320px"></td>
        <td style="width:80px"><select class="sku-input" style="width:80px" onchange="skuEditField(${idx},'fit',this.value||null)">
          <option value="regular" ${s.fit==='regular'?'selected':''}>Regular</option>
          <option value="free" ${s.fit==='free'?'selected':''}>Free</option>
          <option value="oversize" ${s.fit==='oversize'?'selected':''}>Oversize</option>
          <option value="" ${!s.fit?'selected':''}>—</option>
        </select></td>
        <td><input class="sku-input sku-input-xs" type="number" value="${s.sewingPrice}" onchange="skuEditField(${idx},'sewingPrice',+this.value)"></td>
        <td><input class="sku-input sku-input-xs" type="number" step="0.1" value="${s.mainFabricUsage}" onchange="skuEditField(${idx},'mainFabricUsage',+this.value)"></td>
        <td><input class="sku-input sku-input-xs" type="number" step="0.01" value="${s.trimUsage||0}" onchange="skuEditField(${idx},'trimUsage',+this.value)"></td>
        <td style="width:110px"><select class="sku-input" style="width:110px" onchange="skuEditField(${idx},'trimCode',this.value||null)">
          <option value="" ${!s.trimCode?'selected':''}>— нет —</option>
          ${trimOptions}
        </select></td>
        <td><button class="sku-btn" onclick="skuEditZones(${idx})" title="${zoneNames}">${zoneCount} зон</button></td>
        <td class="sku-est">${est.toLocaleString('ru')}₽</td>
        <td><button class="sku-btn sku-btn-danger" onclick="skuDeleteItem(${idx})" title="Удалить">✕</button></td>
      </tr>`;
    });
    html += `</table>`;
  });
  const uncategorized = SKU_CATALOG.filter(s => !cats.find(c => c.id === s.category));
  if (uncategorized.length) {
    html += `<div class="sku-section-title">Без категории (${uncategorized.length})</div>`;
    html += `<table class="sku-table"><tr><th>Код</th><th>Название</th><th>Категория</th><th></th></tr>`;
    uncategorized.forEach(s => {
      const idx = SKU_CATALOG.indexOf(s);
      const catOptions = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      html += `<tr>
        <td>${s.article || '—'}</td><td>${s.name}</td>
        <td><select class="sku-input" onchange="skuEditField(${idx},'category',this.value)">${catOptions}</select></td>
        <td><button class="sku-btn sku-btn-danger" onclick="skuDeleteItem(${idx})">✕</button></td>
      </tr>`;
    });
    html += `</table>`;
  }
  body.innerHTML = html;
  } catch(err) {
    console.error('skuRenderItems error:', err);
    body.innerHTML = '<div style="padding:20px;color:#c00">Ошибка отображения: ' + err.message + '<br><br>SKU в каталоге: ' + SKU_CATALOG.length + '<br><button class="sku-btn" onclick="try{localStorage.removeItem(\'ph_sku\');localStorage.removeItem(\'ph_fabrics\');localStorage.removeItem(\'ph_trims\');localStorage.removeItem(\'ph_extras\');location.reload()}catch(e){}">Сбросить каталог и перезагрузить</button></div>';
  }
}

// ── SKU Drag & Drop ──
var _skuDragIdx = -1;
function skuDragStart(e, idx) {
  _skuDragIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', idx);
  e.target.style.opacity = '0.4';
}
function skuDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Подсветка строки-цели
  const tr = e.target.closest('tr');
  if (tr && tr.dataset.skuDragIdx !== undefined) {
    document.querySelectorAll('tr[data-sku-drag-idx]').forEach(r => r.style.borderTop = '');
    tr.style.borderTop = '2px solid #3B5BFE';
  }
}
function skuDrop(e, targetIdx) {
  e.preventDefault();
  document.querySelectorAll('tr[data-sku-drag-idx]').forEach(r => { r.style.borderTop = ''; r.style.opacity = ''; });
  if (_skuDragIdx < 0 || _skuDragIdx === targetIdx) return;
  // Перемещаем элемент в массиве
  const item = SKU_CATALOG.splice(_skuDragIdx, 1)[0];
  // Пересчитываем targetIdx после splice
  const newTarget = targetIdx > _skuDragIdx ? targetIdx - 1 : targetIdx;
  SKU_CATALOG.splice(newTarget, 0, item);
  _skuDragIdx = -1;
  saveSkuData();
  skuRenderTab();
}
function skuDragEnd(e) {
  _skuDragIdx = -1;
  document.querySelectorAll('tr[data-sku-drag-idx]').forEach(r => { r.style.borderTop = ''; r.style.opacity = ''; });
}

function skuEditField(idx, field, value) {
  if (idx >= 0 && idx < SKU_CATALOG.length) {
    SKU_CATALOG[idx][field] = value;
    saveSkuData();
    skuRenderTab();
    showToast('Сохранено ✓');
  }
}

function skuEditName(idx, newName) {
  if (idx < 0 || idx >= SKU_CATALOG.length) return;
  SKU_CATALOG[idx].name = newName;
  SKU_CATALOG[idx].article = generateArticle(newName);
  saveSkuData();
  skuRenderTab();
  showToast('Сохранено ✓');
}

function skuShowAddModal() {
  const cats = SKU_CATEGORIES;
  const catOpts = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const overlay = document.getElementById('confirmOverlay');
  const box = overlay.querySelector('.confirm-box');
  box.innerHTML = `
    <div class="confirm-title">Новое изделие</div>
    <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0">
      <div>
        <label style="font-size:11px;font-weight:700;letter-spacing:.5px;color:#888;display:block;margin-bottom:4px">НАЗВАНИЕ</label>
        <input class="sku-input" id="skuAddName" placeholder="Например: Худи Oversize" style="font-size:14px;padding:8px 10px">
      </div>
      <div style="display:flex;gap:12px">
        <div style="flex:1">
          <label style="font-size:11px;font-weight:700;letter-spacing:.5px;color:#888;display:block;margin-bottom:4px">КАТЕГОРИЯ</label>
          <select class="sku-input" id="skuAddCat" onchange="document.getElementById('skuAddFitWrap').style.display=this.value==='accessories'?'none':''" style="font-size:13px;padding:8px 10px">${catOpts}</select>
        </div>
        <div style="flex:1" id="skuAddFitWrap">
          <label style="font-size:11px;font-weight:700;letter-spacing:.5px;color:#888;display:block;margin-bottom:4px">FIT</label>
          <select class="sku-input" id="skuAddFit" style="font-size:13px;padding:8px 10px">
            <option value="regular">Regular</option>
            <option value="free">Free</option>
            <option value="oversize">Oversize</option>
          </select>
        </div>
      </div>
    </div>
    <div class="confirm-btns">
      <button class="confirm-btn cancel" onclick="confirmCancel()">Отмена</button>
      <button class="confirm-btn danger" style="background:#000" onclick="skuAddItem()">Добавить</button>
    </div>`;
  overlay.classList.add('show');
  setTimeout(() => document.getElementById('skuAddName')?.focus(), 100);
}

function skuAddItem() {
  const nameEl = document.getElementById('skuAddName');
  const catEl = document.getElementById('skuAddCat');
  const fitEl = document.getElementById('skuAddFit');
  const name = (nameEl?.value || '').trim();
  if (!name) { nameEl?.focus(); return; }
  const cat = catEl?.value || 'tshirts';
  const fit = fitEl?.value || 'regular';
  const isHeavy = ['hoodies','sweatshirts','ziphoodies','pants','shorts'].includes(cat);
  const isAccessory = cat === 'accessories';
  const hasHood = ['hoodies','ziphoodies'].includes(cat);
  const defaultZones = isAccessory ? ['side-a','side-b'] : (hasHood ? ['front','back','sleeve-l','sleeve-r','hood'] : ['front','back','sleeve-l','sleeve-r']);
  const article = generateArticle(name);
  SKU_CATALOG.push({
    article, name, category: cat, fit: isAccessory ? null : fit,
    sewingPrice: isAccessory ? 150 : (isHeavy ? 350 : 200),
    mainFabricUsage: isAccessory ? 0.3 : (isHeavy ? 1.5 : 1.0),
    trimCode: isAccessory ? null : (isHeavy ? 'kashkorse' : 'ribana-1-1'),
    trimUsage: isAccessory ? 0 : 0.15,
    mockupType: 'tee', zones: defaultZones
  });
  saveSkuData();
  // Закрываем модалку
  document.getElementById('confirmOverlay').classList.remove('show');
  // Восстанавливаем confirm
  const box = document.getElementById('confirmOverlay').querySelector('.confirm-box');
  box.innerHTML = `<div class="confirm-title" id="confirmTitle">Подтверждение</div><div class="confirm-text" id="confirmText">Вы уверены?</div><div class="confirm-btns"><button class="confirm-btn cancel" onclick="confirmCancel()">Отмена</button><button class="confirm-btn danger" id="confirmOkBtn" onclick="confirmOk()">Удалить</button></div>`;
  // Переключаем фильтр на категорию новой SKU
  skuFilterCat = cat;
  skuRenderTab();
  showToast('Добавлено: ' + article);
  // Скролл к последней строке
  setTimeout(() => {
    const tables = document.querySelectorAll('.sku-table');
    if (tables.length) {
      const last = tables[tables.length - 1];
      const lastRow = last.querySelector('tr:last-child');
      if (lastRow) lastRow.scrollIntoView({behavior:'smooth', block:'center'});
    }
  }, 100);
}

async function skuDeleteItem(idx) {
  const sku = SKU_CATALOG[idx];
  if (!sku) return;
  const ok = await showConfirm('Удалить SKU?', (sku.article||'') + ' — ' + sku.name + '\nЭто действие нельзя отменить.', 'Удалить');
  if (!ok) return;
  SKU_CATALOG.splice(idx, 1);
  saveSkuData();
  skuRenderTab();
  showToast('SKU удалена');
}

// Редактирование зон нанесения — попап с чекбоксами
function skuEditZones(idx) {
  const sku = SKU_CATALOG[idx];
  if (!sku) return;
  const currentZones = sku.zones || [];
  // Фильтруем зоны по категории: аксессуары — Сторона A/B, одежда — стандартные
  const isAcc = sku.category === 'accessories';
  const accZoneIds = ['side-a','side-b'];
  const clothZoneIds = ['front','back','sleeve-l','sleeve-r','hood','pocket'];
  const availableZones = ALL_PRINT_ZONES.filter(z => isAcc ? accZoneIds.includes(z.id) : clothZoneIds.includes(z.id));
  let zonesHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0">';
  availableZones.forEach(z => {
    const checked = currentZones.includes(z.id) ? 'checked' : '';
    zonesHtml += `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
      <input type="checkbox" value="${z.id}" ${checked} style="width:16px;height:16px"> ${z.name}
    </label>`;
  });
  zonesHtml += '</div>';
  // Используем confirm-модалку с кастомным контентом
  const overlay = document.getElementById('confirmOverlay');
  const box = overlay.querySelector('.confirm-box');
  box.innerHTML = `
    <div class="confirm-title">Зоны нанесения — ${sku.article||sku.name}</div>
    <div class="confirm-text" style="color:#333">${zonesHtml}</div>
    <div class="confirm-btns">
      <button class="confirm-btn cancel" onclick="confirmCancel()">Отмена</button>
      <button class="confirm-btn danger" style="background:#000" onclick="skuSaveZones(${idx})">Сохранить</button>
    </div>`;
  overlay.classList.add('show');
}

function skuSaveZones(idx) {
  const overlay = document.getElementById('confirmOverlay');
  const checkboxes = overlay.querySelectorAll('input[type=checkbox]');
  const zones = [];
  checkboxes.forEach(cb => { if (cb.checked) zones.push(cb.value); });
  SKU_CATALOG[idx].zones = zones;
  saveSkuData();
  overlay.classList.remove('show');
  // Восстанавливаем оригинальный контент confirm-модалки
  const box = overlay.querySelector('.confirm-box');
  box.innerHTML = `
    <div class="confirm-title" id="confirmTitle">Подтверждение</div>
    <div class="confirm-text" id="confirmText">Вы уверены?</div>
    <div class="confirm-btns">
      <button class="confirm-btn cancel" onclick="confirmCancel()">Отмена</button>
      <button class="confirm-btn danger" id="confirmOkBtn" onclick="confirmOk()">Удалить</button>
    </div>`;
  skuRenderTab();
  showToast('Зоны обновлены');
}

// ── Вкладка: Ткани ──
function skuRenderFabrics(body) {
  let html = `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
    <div style="display:flex;gap:8px;align-items:center">
      <button class="sku-btn sku-btn-primary" onclick="skuAddFabric()">+ Добавить ткань</button>
      <span class="sku-stat">Всего: ${FABRICS_CATALOG.length}</span>
    </div>
  </div>`;
  html += `<div class="sku-section-title">Основные ткани (${FABRICS_CATALOG.length})</div>`;
  html += `<table class="sku-table"><tr><th style="width:28px">№</th><th style="width:150px">Код</th><th>Название</th><th style="width:55px">$/м</th><th style="width:55px">₽/м</th><th>Категории</th><th style="width:28px"></th></tr>`;
  FABRICS_CATALOG.forEach((f,i) => {
    const rub = Math.round(f.priceUSD * USD_RATE);
    const catTags = SKU_CATEGORIES.map(c => {
      const active = (f.forCategories||[]).includes(c.id);
      const style = active
        ? 'background:#000;color:#fff;border-color:#000'
        : 'background:#f5f5f5;color:#aaa;border-color:#e0e0e0';
      return `<span onclick="skuToggleFabricCat(${i},'${c.id}',${!active})" style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;cursor:pointer;border:1px solid;margin:1px;transition:all .15s;${style}">${c.name}</span>`;
    }).join('');
    html += `<tr>
      <td style="font-size:11px;color:#aaa;text-align:center">${i + 1}</td>
      <td style="font-size:11px;color:#888;font-family:monospace">${f.code}</td>
      <td><input class="sku-input" value="${f.name}" onchange="skuEditFabricName(${i},this.value)"></td>
      <td><input class="sku-input sku-input-xs" type="number" step="0.01" value="${f.priceUSD}" onchange="skuEditFabric(${i},'priceUSD',+this.value)"></td>
      <td style="color:#888">${rub}₽</td>
      <td style="line-height:1.8">${catTags}</td>
      <td><button class="sku-btn sku-btn-danger" onclick="skuDeleteFabric(${i})">✕</button></td>
    </tr>`;
  });
  html += `</table>`;
  body.innerHTML = html;
}

function skuEditFabric(idx, field, value) {
  FABRICS_CATALOG[idx][field] = value;
  saveSkuData();
  skuRenderTab();
  showToast('Сохранено ✓');
}
function skuEditFabricName(idx, newName) {
  FABRICS_CATALOG[idx].name = newName;
  FABRICS_CATALOG[idx].code = generateCode(newName);
  saveSkuData();
  skuRenderTab();
  showToast('Сохранено ✓');
}
function skuToggleFabricCat(idx, catId, checked) {
  const f = FABRICS_CATALOG[idx];
  if (!f.forCategories) f.forCategories = [];
  if (checked && !f.forCategories.includes(catId)) f.forCategories.push(catId);
  if (!checked) f.forCategories = f.forCategories.filter(c => c !== catId);
  saveSkuData();
  skuRenderTab();
}
function skuAddFabric() {
  const name = 'Новая ткань';
  FABRICS_CATALOG.push({code:generateCode(name), name, priceUSD:3.00, forCategories:['tshirts'], supplier:'—'});
  saveSkuData();
  skuRenderTab();
}
async function skuDeleteFabric(idx) {
  const f = FABRICS_CATALOG[idx];
  const ok = await showConfirm('Удалить ткань?', (f?.name || 'Ткань') + ' будет удалена.', 'Удалить');
  if (!ok) return;
  FABRICS_CATALOG.splice(idx, 1);
  saveSkuData();
  skuRenderTab();
}

// ── Вкладка: Отделка ──
function skuRenderTrims(body) {
  let html = `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
    <div style="display:flex;gap:8px;align-items:center">
      <button class="sku-btn sku-btn-primary" onclick="skuAddTrim()">+ Добавить отделку</button>
      <span class="sku-stat">Всего: ${TRIM_CATALOG.length}</span>
    </div>
  </div>`;
  html += `<div class="sku-section-title">Отделочные ткани (${TRIM_CATALOG.length})</div>`;
  html += `<table class="sku-table"><tr><th style="width:28px">№</th><th style="width:140px">Код</th><th>Название</th><th style="width:55px">$/м</th><th style="width:55px">₽/м</th><th style="width:28px"></th></tr>`;
  TRIM_CATALOG.forEach((t,i) => {
    const rub = Math.round(t.priceUSD * USD_RATE);
    html += `<tr>
      <td style="font-size:11px;color:#aaa;text-align:center">${i + 1}</td>
      <td style="font-size:11px;color:#888;font-family:monospace">${t.code}</td>
      <td><input class="sku-input" value="${t.name}" onchange="skuEditTrimName(${i},this.value)"></td>
      <td><input class="sku-input sku-input-xs" type="number" step="0.01" value="${t.priceUSD}" onchange="skuEditTrim(${i},'priceUSD',+this.value)"></td>
      <td style="color:#888">${rub}₽</td>
      <td><button class="sku-btn sku-btn-danger" onclick="skuDeleteTrim(${i})">✕</button></td>
    </tr>`;
  });
  html += `</table>`;
  body.innerHTML = html;
}
function skuEditTrim(idx, field, value) { TRIM_CATALOG[idx][field] = value; saveSkuData(); skuRenderTab(); showToast('Сохранено ✓'); }
function skuEditTrimName(idx, newName) {
  TRIM_CATALOG[idx].name = newName;
  TRIM_CATALOG[idx].code = generateCode(newName);
  saveSkuData();
  skuRenderTab();
  showToast('Сохранено ✓');
}
function skuAddTrim() { const name='Новая отделка'; TRIM_CATALOG.push({code:generateCode(name), name, priceUSD:2.50}); saveSkuData(); skuRenderTab(); }
async function skuDeleteTrim(idx) {
  const t = TRIM_CATALOG[idx];
  const ok = await showConfirm('Удалить отделку?', (t?.name || 'Отделка') + ' будет удалена.', 'Удалить');
  if (!ok) return;
  TRIM_CATALOG.splice(idx, 1); saveSkuData(); skuRenderTab();
}

// ── Вкладка: Обработки ──
function skuRenderExtras(body) {
  let html = `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
    <div style="display:flex;gap:8px;align-items:center">
      <button class="sku-btn sku-btn-primary" onclick="skuAddExtra()">+ Добавить обработку</button>
      <span class="sku-stat">Всего: ${EXTRAS_CATALOG.length}</span>
    </div>
  </div>`;
  html += `<div class="sku-section-title">Обработки (${EXTRAS_CATALOG.length})</div>`;
  html += `<table class="sku-table"><tr><th style="width:28px">№</th><th style="width:140px">Код</th><th>Название</th><th style="width:65px">Цена ₽</th><th style="width:28px"></th></tr>`;
  EXTRAS_CATALOG.forEach((e,i) => {
    html += `<tr>
      <td style="font-size:11px;color:#aaa;text-align:center">${i + 1}</td>
      <td style="font-size:11px;color:#888;font-family:monospace">${e.code}</td>
      <td><input class="sku-input" value="${e.name}" onchange="skuEditExtraName(${i},this.value)"></td>
      <td><input class="sku-input sku-input-xs" type="number" value="${e.price}" onchange="skuEditExtra(${i},'price',+this.value)"></td>
      <td><button class="sku-btn sku-btn-danger" onclick="skuDeleteExtra(${i})">✕</button></td>
    </tr>`;
  });
  html += `</table>`;
  body.innerHTML = html;
}
function skuEditExtra(idx, field, value) { EXTRAS_CATALOG[idx][field] = value; saveSkuData(); skuRenderTab(); showToast('Сохранено ✓'); }
function skuEditExtraName(idx, newName) {
  EXTRAS_CATALOG[idx].name = newName;
  EXTRAS_CATALOG[idx].code = generateCode(newName);
  saveSkuData();
  skuRenderTab();
  showToast('Сохранено ✓');
}
function skuAddExtra() { const name='Новая обработка'; EXTRAS_CATALOG.push({code:generateCode(name), name, price:30}); saveSkuData(); skuRenderTab(); }
async function skuDeleteExtra(idx) {
  const e = EXTRAS_CATALOG[idx];
  const ok = await showConfirm('Удалить обработку?', (e?.name || 'Обработка') + ' будет удалена.', 'Удалить');
  if (!ok) return;
  EXTRAS_CATALOG.splice(idx, 1); saveSkuData(); skuRenderTab();
}

// ── Вкладка: Фурнитура ──
function skuRenderHardware(body) {
  const groupOpts = HARDWARE_GROUPS.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  let html = `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
    <div style="display:flex;gap:8px;align-items:center">
      <button class="sku-btn sku-btn-primary" onclick="skuShowAddHardwareModal()">+ Добавить фурнитуру</button>
      <span class="sku-stat">Всего: ${HARDWARE_CATALOG.length}</span>
    </div>
  </div>`;
  HARDWARE_GROUPS.forEach(grp => {
    const items = HARDWARE_CATALOG.filter(h => h.group === grp.id);
    if (!items.length) return;
    html += `<div class="sku-section-title">${grp.name} (${items.length})</div>`;
    html += `<table class="sku-table"><tr><th style="width:28px">№</th><th style="width:140px">Код</th><th>Название</th><th style="width:65px">Цена ₽</th><th style="width:28px"></th></tr>`;
    items.forEach((h, localIdx) => {
      const idx = HARDWARE_CATALOG.indexOf(h);
      html += `<tr>
        <td style="font-size:11px;color:#aaa;text-align:center">${localIdx + 1}</td>
        <td style="font-size:11px;color:#888;font-family:monospace">${h.code}</td>
        <td><input class="sku-input" value="${h.name}" onchange="skuEditHardwareName(${idx},this.value)"></td>
        <td><input class="sku-input sku-input-xs" type="number" value="${h.price}" onchange="skuEditHardware(${idx},'price',+this.value)"></td>
        <td><button class="sku-btn sku-btn-danger" onclick="skuDeleteHardware(${idx})">✕</button></td>
      </tr>`;
    });
    html += `</table>`;
  });
  // Без группы
  const ungrouped = HARDWARE_CATALOG.filter(h => !HARDWARE_GROUPS.find(g => g.id === h.group));
  if (ungrouped.length) {
    html += `<div class="sku-section-title">Прочее (${ungrouped.length})</div>`;
    html += `<table class="sku-table"><tr><th style="width:28px">№</th><th style="width:140px">Код</th><th>Название</th><th style="width:65px">Цена ₽</th><th style="width:28px"></th></tr>`;
    ungrouped.forEach((h, localIdx) => {
      const idx = HARDWARE_CATALOG.indexOf(h);
      html += `<tr>
        <td style="font-size:11px;color:#aaa;text-align:center">${localIdx + 1}</td>
        <td style="font-size:11px;color:#888;font-family:monospace">${h.code}</td>
        <td><input class="sku-input" value="${h.name}" onchange="skuEditHardwareName(${idx},this.value)"></td>
        <td><input class="sku-input sku-input-xs" type="number" value="${h.price}" onchange="skuEditHardware(${idx},'price',+this.value)"></td>
        <td><button class="sku-btn sku-btn-danger" onclick="skuDeleteHardware(${idx})">✕</button></td>
      </tr>`;
    });
    html += `</table>`;
  }
  body.innerHTML = html;
}

function skuShowAddHardwareModal() {
  const groupOpts = HARDWARE_GROUPS.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  const overlay = document.getElementById('confirmOverlay');
  const box = overlay.querySelector('.confirm-box');
  box.innerHTML = `
    <div class="confirm-title">Новая фурнитура</div>
    <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0">
      <div>
        <label style="font-size:11px;font-weight:700;letter-spacing:.5px;color:#888;display:block;margin-bottom:4px">НАЗВАНИЕ</label>
        <input class="sku-input" id="hwAddName" placeholder="Например: Люверсы 10мм" style="font-size:14px;padding:8px 10px">
      </div>
      <div style="display:flex;gap:12px">
        <div style="flex:1">
          <label style="font-size:11px;font-weight:700;letter-spacing:.5px;color:#888;display:block;margin-bottom:4px">ГРУППА</label>
          <select class="sku-input" id="hwAddGroup" style="font-size:13px;padding:8px 10px">${groupOpts}</select>
        </div>
        <div style="flex:1">
          <label style="font-size:11px;font-weight:700;letter-spacing:.5px;color:#888;display:block;margin-bottom:4px">ЦЕНА ₽</label>
          <input class="sku-input" id="hwAddPrice" type="number" value="30" style="font-size:14px;padding:8px 10px">
        </div>
      </div>
    </div>
    <div class="confirm-btns">
      <button class="confirm-btn cancel" onclick="confirmCancel()">Отмена</button>
      <button class="confirm-btn danger" style="background:#000" onclick="skuAddHardwareFromModal()">Добавить</button>
    </div>`;
  overlay.classList.add('show');
  setTimeout(() => document.getElementById('hwAddName')?.focus(), 100);
}

function skuAddHardwareFromModal() {
  const name = (document.getElementById('hwAddName')?.value || '').trim();
  if (!name) { document.getElementById('hwAddName')?.focus(); return; }
  const group = document.getElementById('hwAddGroup')?.value || 'metal';
  const price = +(document.getElementById('hwAddPrice')?.value) || 30;
  HARDWARE_CATALOG.push({code: generateCode(name), name, price, group});
  saveSkuData();
  document.getElementById('confirmOverlay').classList.remove('show');
  // Восстанавливаем confirm
  const box = document.getElementById('confirmOverlay').querySelector('.confirm-box');
  box.innerHTML = `<div class="confirm-title" id="confirmTitle">Подтверждение</div><div class="confirm-text" id="confirmText">Вы уверены?</div><div class="confirm-btns"><button class="confirm-btn cancel" onclick="confirmCancel()">Отмена</button><button class="confirm-btn danger" id="confirmOkBtn" onclick="confirmOk()">Удалить</button></div>`;
  skuRenderTab();
  showToast('Добавлено: ' + name);
}
function skuEditHardware(idx, field, value) { HARDWARE_CATALOG[idx][field] = value; saveSkuData(); skuRenderTab(); showToast('Сохранено ✓'); }
function skuEditHardwareName(idx, newName) {
  HARDWARE_CATALOG[idx].name = newName;
  HARDWARE_CATALOG[idx].code = generateCode(newName);
  saveSkuData(); skuRenderTab(); showToast('Сохранено ✓');
}
async function skuDeleteHardware(idx) {
  const h = HARDWARE_CATALOG[idx];
  const ok = await showConfirm('Удалить фурнитуру?', (h?.name || 'Фурнитура') + ' будет удалена.', 'Удалить');
  if (!ok) return;
  HARDWARE_CATALOG.splice(idx, 1); saveSkuData(); skuRenderTab();
}

// ── Excel экспорт/импорт ──
function skuExportExcel() {
  if (typeof XLSX === 'undefined') { showToast('Библиотека Excel не загружена'); return; }
  const wb = XLSX.utils.book_new();

  // Лист 1: SKU
  const skuRows = SKU_CATALOG.map(s => ({
    'Артикул': s.article || '',
    'Название': s.name,
    'Категория': s.category,
    'Fit': s.fit || '',
    'Пошив ₽': s.sewingPrice,
    'Расход осн. м': s.mainFabricUsage,
    'Отделка код': s.trimCode || '',
    'Расход отд. м': s.trimUsage || 0,
    'Мокап': s.mockupType || '',
    'Зоны': (s.zones || []).join(', ')
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(skuRows), 'SKU');

  // Лист 2: Ткани
  const fabRows = FABRICS_CATALOG.map(f => ({
    'Код': f.code,
    'Название': f.name,
    '$ за метр': f.priceUSD,
    'Категории': (f.forCategories || []).join(', '),
    'Поставщик': f.supplier || ''
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fabRows), 'Ткани');

  // Лист 3: Отделка
  const trimRows = TRIM_CATALOG.map(t => ({
    'Код': t.code,
    'Название': t.name,
    '$ за метр': t.priceUSD
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trimRows), 'Отделка');

  // Лист 4: Обработки
  const extRows = EXTRAS_CATALOG.map(e => ({
    'Код': e.code,
    'Название': e.name,
    'Цена ₽': e.price
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(extRows), 'Обработки');

  // Лист 5: Фурнитура
  const hwRows = HARDWARE_CATALOG.map(h => ({
    'Код': h.code,
    'Название': h.name,
    'Цена ₽': h.price
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hwRows), 'Фурнитура');

  // Лист 6: Настройки
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{'Курс $': USD_RATE}]), 'Настройки');

  XLSX.writeFile(wb, 'pinhead-sku-catalog.xlsx');
  showToast('Excel выгружен ✓');
}

function skuImportExcel() {
  if (typeof XLSX === 'undefined') { showToast('Библиотека Excel не загружена'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, {type:'array'});
        let imported = 0;

        // SKU
        if (wb.SheetNames.includes('SKU')) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets['SKU']);
          if (rows.length) {
            SKU_CATALOG.length = 0;
            rows.forEach(r => {
              SKU_CATALOG.push({
                article: r['Артикул'] || generateArticle(r['Название'] || ''),
                name: r['Название'] || '',
                category: r['Категория'] || 'tshirts',
                fit: r['Fit'] || null,
                sewingPrice: +r['Пошив ₽'] || 0,
                mainFabricUsage: +r['Расход осн. м'] || 0,
                trimCode: r['Отделка код'] || null,
                trimUsage: +r['Расход отд. м'] || 0,
                mockupType: r['Мокап'] || 'tee',
                zones: (r['Зоны'] || '').split(',').map(z => z.trim()).filter(Boolean)
              });
            });
            imported += rows.length;
          }
        }

        // Ткани
        if (wb.SheetNames.includes('Ткани')) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets['Ткани']);
          if (rows.length) {
            FABRICS_CATALOG.length = 0;
            rows.forEach(r => {
              FABRICS_CATALOG.push({
                code: r['Код'] || generateCode(r['Название'] || ''),
                name: r['Название'] || '',
                priceUSD: +r['$ за метр'] || 0,
                forCategories: (r['Категории'] || '').split(',').map(c => c.trim()).filter(Boolean),
                supplier: r['Поставщик'] || ''
              });
            });
          }
        }

        // Отделка
        if (wb.SheetNames.includes('Отделка')) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets['Отделка']);
          if (rows.length) {
            TRIM_CATALOG.length = 0;
            rows.forEach(r => {
              TRIM_CATALOG.push({
                code: r['Код'] || generateCode(r['Название'] || ''),
                name: r['Название'] || '',
                priceUSD: +r['$ за метр'] || 0
              });
            });
          }
        }

        // Обработки
        if (wb.SheetNames.includes('Обработки')) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets['Обработки']);
          if (rows.length) {
            EXTRAS_CATALOG.length = 0;
            rows.forEach(r => {
              EXTRAS_CATALOG.push({
                code: r['Код'] || generateCode(r['Название'] || ''),
                name: r['Название'] || '',
                price: +r['Цена ₽'] || 0
              });
            });
          }
        }

        // Фурнитура
        if (wb.SheetNames.includes('Фурнитура')) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets['Фурнитура']);
          if (rows.length) {
            HARDWARE_CATALOG.length = 0;
            rows.forEach(r => {
              HARDWARE_CATALOG.push({
                code: r['Код'] || generateCode(r['Название'] || ''),
                name: r['Название'] || '',
                price: +r['Цена ₽'] || 0
              });
            });
          }
        }

        // Настройки
        if (wb.SheetNames.includes('Настройки')) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets['Настройки']);
          if (rows.length && rows[0]['Курс $']) {
            USD_RATE = +rows[0]['Курс $'];
            document.getElementById('skuUsdRate').value = USD_RATE;
          }
        }

        saveSkuData();
        skuRenderTab();
        showToast('Excel импортирован ✓');
      } catch(err) { showToast('Ошибка импорта: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
  };
  input.click();
}

function skuExportAll() {
  const data = { sku: SKU_CATALOG, fabrics: FABRICS_CATALOG, trims: TRIM_CATALOG, extras: EXTRAS_CATALOG, usdRate: USD_RATE };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pinhead-sku-catalog.json';
  a.click();
}
function skuImportAll() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.sku) SKU_CATALOG = data.sku;
        if (data.fabrics) FABRICS_CATALOG = data.fabrics;
        if (data.trims) TRIM_CATALOG = data.trims;
        if (data.extras) EXTRAS_CATALOG = data.extras;
        if (data.usdRate) { USD_RATE = data.usdRate; document.getElementById('skuUsdRate').value = USD_RATE; }
        saveSkuData();
        skuRenderTab();
        showToast('Каталог импортирован ✓');
      } catch(err) { showToast('Ошибка импорта: ' + err.message); }
    };
    reader.readAsText(file);
  };
  input.click();
}

window.addEventListener('DOMContentLoaded', () => {
  loadStoredPrices();
  const hadDraft = loadDraft();
  renderSkuList();
  buildSizeTable();
  renderSwatches();
  renderFabricGrid(state.type);
  updateTotal();
  updateMockup();
  if (hadDraft) restoreDraftToUI();
  updateStepSections();
  renderZoneTechBlocks();
  // Восстановить выбор в garment list по SKU article
  if (state.sku && state.sku.article) {
    const idx = SKU_CATALOG.findIndex(s => s.article === state.sku.article);
    if (idx >= 0) {
      const row = document.querySelector(`[data-sku-idx="${idx}"]`);
      if (row) row.classList.add('selected');
    }
  } else if (state.type) {
    document.querySelectorAll('.garment-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.type === state.type);
    });
  }
  document.addEventListener('input', e => {
    if (e.target.matches('input,textarea,select') && !saveDraft._blocked) scheduleSave();
  });
  // Supabase auth init — FIRST, then badge
  initAuth().then(() => {
    updateHistoryBadge();
  }).catch(() => {
    updateHistoryBadge();
  });
});





// ════════════════════════════════════════════════════════════
//   EXPRESS CALCULATOR V2.0
// ════════════════════════════════════════════════════════════
// Right panel, quick calc, zone chips

// ═══ EXPRESS CALCULATOR v2 ═══
// Per-zone: каждая зона хранит свою технику, формат, цвета
let expZoneData = {}; // { zoneId: { active:bool, tech:'screen', fmt:'A4', col:1 } }

function expGetZones(type) {
  if (isAccessory(type)) return ACC_ZONES[type] || [];
  return GARMENT_ZONES;
}

function expInitZoneData(zones) {
  expZoneData = {};
  zones.forEach((z, i) => {
    expZoneData[z.id] = { active: i === 0, tech: 'screen', fmt: 'A4', col: 1, textile: 'white', fx: 'none' };
  });
}

function expOnTypeChange() {
  expOnSkuChange();
}

// Populate SKU select from catalog
function expPopulateSkuSelect() {
  var sel = document.getElementById('eType');
  if (!sel) return;
  sel.innerHTML = '';
  // Group by category
  var groups = {};
  var order = [];
  SKU_CATALOG.forEach(function(s, i) {
    var cat = s.category || 'other';
    if (!groups[cat]) { groups[cat] = []; order.push(cat); }
    groups[cat].push({ sku: s, idx: i });
  });
  var CAT_LABELS = {tshirts:'Футболки',longsleeves:'Лонгсливы',tanks:'Майки',hoodies:'Худи',sweatshirts:'Свитшоты',ziphoodies:'Зип-худи','half-zip':'Халф-зип',pants:'Штаны',shorts:'Шорты',accessories:'Аксессуары'};
  order.forEach(function(cat) {
    var og = document.createElement('optgroup');
    og.label = CAT_LABELS[cat] || cat;
    groups[cat].forEach(function(item) {
      var o = document.createElement('option');
      o.value = String(item.idx);
      o.textContent = item.sku.name;
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
}

// Selected SKU reference for Express
var _expSelectedSku = null;
var _expSelectedFabricCode = '';

function expOnSkuChange() {
  var sel = document.getElementById('eType');
  var idx = parseInt(sel.value);
  var sku = SKU_CATALOG[idx] || null;
  _expSelectedSku = sku;

  var fabSel = document.getElementById('eFabric');

  if (sku) {
    // Крой из SKU

    // Заполнить список тканей для категории SKU
    var available = FABRICS_CATALOG.filter(function(f) {
      if (!f.forCategories || f.forCategories.length === 0) return true;
      return f.forCategories.includes(sku.category);
    });
    fabSel.innerHTML = '';
    available.forEach(function(f) {
      var o = document.createElement('option');
      o.value = f.code;
      o.textContent = f.name;
      fabSel.appendChild(o);
    });
    _expSelectedFabricCode = available.length > 0 ? available[0].code : '';

    // Zones
    var type = expGetTypeFromCategory(sku.category);
    var zones = expGetZones(type);
    var noPrint = hasNoPrint(type);
    var wrap = document.getElementById('eZonesWrap');
    var noMsg = document.getElementById('eNoPrint');
    if (noPrint) {
      wrap.innerHTML = ''; noMsg.style.display = 'block';
    } else {
      noMsg.style.display = 'none';
      expInitZoneData(zones);
      expRenderZones();
    }
  } else {
    fabSel.innerHTML = '<option value="">—</option>';
    _expSelectedFabricCode = '';
    document.getElementById('eZonesWrap').innerHTML = '';
  }
  expCalc();
}

function expGetTypeFromCategory(cat) {
  var map = {tshirts:'tee',longsleeves:'longsleeve',tanks:'tank',hoodies:'hoodie',sweatshirts:'sweat',ziphoodies:'zip-hoodie','half-zip':'half-zip',pants:'pants',shorts:'shorts',accessories:'shopper'};
  return map[cat] || 'tee';
}

function expRenderZones() {
  const sku = _expSelectedSku;
  const type = sku ? expGetTypeFromCategory(sku.category) : '';
  const zones = expGetZones(type);
  const wrap = document.getElementById('eZonesWrap');
  if (!wrap) return;
  const qty = parseInt(document.getElementById('eQty').value) || 1;

  wrap.innerHTML = zones.map(z => {
    const d = expZoneData[z.id] || { active:false, tech:'screen', fmt:'A4', col:1 };
    if (!d.active) {
      // Неактивная зона — компактный чип
      return `<div class="exp-zone-chip" onclick="expActivateZone('${z.id}')">
        <div class="exp-zone-dot"></div>${z.label}
      </div>`;
    }
    // Активная зона — раскрытый блок с техникой
    const surcharge = expGetZoneSurcharge(z.id);
    const techs = ['screen','flex','dtf','dtg','embroidery'];
    const techLabels = {screen:'Шелкография',flex:'Flex',dtf:'DTF',dtg:'DTG',embroidery:'Вышивка'};
    const techBtns = techs.map(t =>
      `<div class="exp-zt-tech${d.tech===t?' active':''}" onclick="expSetZoneTech('${z.id}','${t}')">${techLabels[t]}</div>`
    ).join('');
    const params = expRenderZoneParams(z.id, d);
    const screenWarn = (d.tech === 'screen' && qty > 0 && qty < 50)
      ? `<div class="exp-zt-warn">⚠ Шелкография — минимальный тираж от 50 шт</div>` : '';
    return `<div class="exp-zt-block active">
      <div class="exp-zt-header" onclick="expDeactivateZone('${z.id}')">
        <span class="exp-zt-name">${z.label}</span>
        <span class="exp-zt-surcharge">+${surcharge} ₽</span>
      </div>
      <div class="exp-zt-body">
        <div class="exp-zt-techs">${techBtns}</div>
        <div class="exp-zt-params">${params}</div>
        ${screenWarn}
      </div>
    </div>`;
  }).join('');
}

function expRenderZoneParams(zone, d) {
  const tech = d.tech;
  if (tech === 'screen') {
    const sizes = SCREEN_FORMATS;
    const cols = [1,2,3,4,5,6,7,8];
    const textiles = [{k:'white',l:'Белый'},{k:'color',l:'Цвет ×1.3'}];
    const fxBtns = SCREEN_FX.map(f => `<button class="exp-pbtn${(d.fx||'none')===f.key?' active':''}" onclick="expSetZoneParam('${zone}','fx','${f.key}')">${f.label}</button>`).join('');
    return `<span class="exp-plabel">Формат</span>
      <div class="exp-pbtns">${sizes.map(s => `<button class="exp-pbtn${d.fmt===s?' active':''}" onclick="expSetZoneParam('${zone}','fmt','${s}')">${s}</button>`).join('')}</div>
      <span class="exp-plabel" style="margin-left:6px">Цвета</span>
      <div class="exp-pbtns">${cols.map(c => `<button class="exp-pbtn${d.col===c?' active':''}" onclick="expSetZoneParam('${zone}','col',${c})">${c}</button>`).join('')}</div>
      <span class="exp-plabel" style="margin-left:6px">Текстиль</span>
      <div class="exp-pbtns">${textiles.map(t => `<button class="exp-pbtn${(d.textile||'white')===t.k?' active':''}" onclick="expSetZoneParam('${zone}','textile','${t.k}')">${t.l}</button>`).join('')}</div>
      <span class="exp-plabel" style="margin-left:6px">Эффект</span>
      <div class="exp-pbtns">${fxBtns}</div>`;
  }
  if (tech === 'flex') {
    const sizes = FLEX_FORMATS;
    const cols = [1,2,3];
    return `<span class="exp-plabel">Формат</span>
      <div class="exp-pbtns">${sizes.map(s => `<button class="exp-pbtn${d.fmt===s?' active':''}" onclick="expSetZoneParam('${zone}','fmt','${s}')">${s}</button>`).join('')}</div>
      <span class="exp-plabel" style="margin-left:6px">Цвета</span>
      <div class="exp-pbtns">${cols.map(c => `<button class="exp-pbtn${d.col===c?' active':''}" onclick="expSetZoneParam('${zone}','col',${c})">${c}</button>`).join('')}</div>`;
  }
  if (tech === 'dtf' || tech === 'dtg') {
    const sizes = ['A6','A5','A4','A3','A3+'];
    return `<span class="exp-plabel">Формат</span>
      <div class="exp-pbtns">${sizes.map(s => `<button class="exp-pbtn${d.fmt===s?' active':''}" onclick="expSetZoneParam('${zone}','fmt','${s}')">${s}</button>`).join('')}</div>`;
  }
  if (tech === 'embroidery') {
    const areas = [{k:'s',l:'до 7см'},{k:'m',l:'до 12см'},{k:'l',l:'до 20см'}];
    const cols = [1,2,3,4,5];
    return `<span class="exp-plabel">Область</span>
      <div class="exp-pbtns">${areas.map(a => `<button class="exp-pbtn${d.fmt===a.k?' active':''}" onclick="expSetZoneParam('${zone}','fmt','${a.k}')">${a.l}</button>`).join('')}</div>
      <span class="exp-plabel" style="margin-left:6px">Нити</span>
      <div class="exp-pbtns">${cols.map(c => `<button class="exp-pbtn${d.col===c?' active':''}" onclick="expSetZoneParam('${zone}','col',${c})">${c}</button>`).join('')}</div>`;
  }
  return '';
}

function expActivateZone(id) {
  if (!expZoneData[id]) expZoneData[id] = { active:false, tech:'screen', fmt:'A4', col:1, textile:'white', fx:'none' };
  expZoneData[id].active = true;
  expRenderZones();
  expCalc();
}
function expDeactivateZone(id) {
  // Нельзя убрать последнюю зону
  const activeCount = Object.values(expZoneData).filter(d => d.active).length;
  if (activeCount <= 1) return;
  if (expZoneData[id]) expZoneData[id].active = false;
  expRenderZones();
  expCalc();
}
function expSetZoneTech(zone, tech) {
  if (!expZoneData[zone]) return;
  expZoneData[zone].tech = tech;
  if (tech === 'embroidery') { expZoneData[zone].fmt = 's'; expZoneData[zone].col = 1; }
  else if (tech === 'screen') { expZoneData[zone].fmt = 'A4'; expZoneData[zone].col = 1; expZoneData[zone].textile = 'white'; expZoneData[zone].fx = 'none'; }
  else if (tech === 'flex') { expZoneData[zone].fmt = 'A4'; expZoneData[zone].col = 1; }
  else { expZoneData[zone].fmt = 'A4'; expZoneData[zone].col = 1; }
  expRenderZones();
  expCalc();
}
function expSetZoneParam(zone, key, val) {
  if (!expZoneData[zone]) return;
  expZoneData[zone][key] = val;
  expRenderZones();
  expCalc();
}

function expGetZoneSurcharge(zone) {
  const d = expZoneData[zone];
  if (!d || !d.active) return 0;
  const tech = d.tech;
  const qty = parseInt(document.getElementById('eQty').value) || 1;
  if (tech === 'screen') {
    let base = screenLookup(d.fmt, d.col, qty);
    if (d.textile === 'color') base = Math.round(base * SCREEN_TEXTILE_MULT);
    // Футер не учитываем в Express (нет выбора ткани)
    const fx = SCREEN_FX.find(f => f.key === (d.fx||'none'));
    if (fx && fx.mult > 1) base = Math.round(base * fx.mult);
    return base;
  }
  if (tech === 'flex') {
    return flexLookup(d.fmt, d.col, qty);
  }
  if (tech === 'dtf')    return (PRICES.tech.dtf||180) + (PRICES.dtfFormatAdd?.[d.fmt]||0);
  if (tech === 'dtg')    return (PRICES.tech.dtg||280) + (PRICES.dtgFormatAdd?.[d.fmt]||0);
  if (tech === 'embroidery') return (PRICES.tech.embroidery||350) + (PRICES.embAreaAdd?.[d.fmt]||0) + Math.max(0, d.col-1) * (PRICES.embColorAdd||20);
  return 0;
}

function expCalc() {
  const sku = _expSelectedSku;
  const qty = parseInt(document.getElementById('eQty').value) || 1;
  const type = sku ? expGetTypeFromCategory(sku.category) : '';
  const noPrint = type ? hasNoPrint(type) : false;
  const fabricCode = document.getElementById('eFabric')?.value || '';

  // Base price from SKU + selected fabric
  let base = 0;
  if (sku) {
    const fb = FABRICS_CATALOG.find(function(f){return f.code === fabricCode});
    const fabricPriceRub = fb ? fb.priceUSD * (window.DOLLAR_RATE || 100) : 0;
    const fabricCost = Math.round(fabricPriceRub * (sku.mainFabricUsage || 1));
    const trimEntry = TRIMS_CATALOG ? TRIMS_CATALOG.find(function(t){return t.code === sku.trimCode}) : null;
    const trimCost = trimEntry ? Math.round(trimEntry.priceUSD * (window.DOLLAR_RATE || 100) * (sku.trimUsage || 0)) : 0;
    base = (sku.sewingPrice || 0) + fabricCost + trimCost;
  }

  const activeZones = Object.entries(expZoneData).filter(([,d]) => d.active);
  const zoneCount = activeZones.length;
  let techTotal = 0;
  if (!noPrint) {
    activeZones.forEach(([id]) => { techTotal += expGetZoneSurcharge(id); });
  }

  const unit = base + techTotal;
  const total = unit * qty;

  document.getElementById('eRBase').textContent = base.toLocaleString('ru') + ' ₽ / шт';
  document.getElementById('eRTech').textContent = noPrint ? '—' : techTotal.toLocaleString('ru') + ' ₽ / шт';
  document.getElementById('eRTechLbl').textContent = noPrint ? 'Нанесение' : `Нанесение × ${zoneCount} зон${zoneCount===1?'а':'ы'}`;
  document.getElementById('eRUnit').textContent = unit.toLocaleString('ru') + ' ₽ × ' + qty + ' шт';
  document.getElementById('eRTotal').textContent = total.toLocaleString('ru') + ' ₽';

  const w = document.getElementById('eWarn');
  if (w) w.style.display = 'none';
}

function openExpress() {
  document.getElementById('expressOverlay').classList.add('open');
  document.getElementById('expressPanel').classList.add('open');
  document.getElementById('expressBtn').classList.add('active');
  expPopulateSkuSelect();
  // Auto-select first SKU
  var sel = document.getElementById('eType');
  if (sel.options.length > 1) sel.selectedIndex = 1;
  expOnSkuChange();
}
function closeExpress() {
  document.getElementById('expressOverlay').classList.remove('open');
  document.getElementById('expressPanel').classList.remove('open');
  document.getElementById('expressBtn').classList.remove('active');
}
function toggleExpress() {
  const panel = document.getElementById('expressPanel');
  if (panel.classList.contains('open')) closeExpress(); else openExpress();
}
function expReset() {
  var sel = document.getElementById('eType');
  if (sel.options.length > 1) sel.selectedIndex = 1;
  document.getElementById('eQty').value = 30;
  expOnSkuChange();
}
function expCreateOrder() {
  var idx = parseInt(document.getElementById('eType').value);
  var sku = SKU_CATALOG[idx];
  closeExpress();
  if (sku) {
    selectSkuItem(idx);
    var row = document.querySelector('[data-sku-idx="' + idx + '"]');
    if (row) row.scrollIntoView({behavior:'smooth', block:'center'});
  }
  goToStep(0);
}



