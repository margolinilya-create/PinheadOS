// ════════════════════════════════════════════════════════════
//   UI — FABRIC & FIT
// ════════════════════════════════════════════════════════════
// selectFabric, selectFit

// ─── FABRIC SELECT ───
function selectFabric(key) {
  const prevFabric = state.fabric;
  state.fabric = key;
  // При смене ткани — сброс цвета
  if (prevFabric !== key) {
    state.color = '';
    const info = document.getElementById('colorSelectedInfo');
    if (info) info.textContent = '';
    renderSwatches();
  }
  renderFabricGrid(state.type);
  updateStepSections();
  updateTotal();
  scheduleSave();
}

// ─── FIT ───
function selectFit(fit) {
  const prevFit = state.fit;
  state.fit = fit;
  state.fitChosen = true;
  // При смене лекал — сброс ткани и цвета
  if (prevFit !== fit) {
    state.fabric = '';
    state.color = '';
    const info = document.getElementById('colorSelectedInfo');
    if (info) info.textContent = '';
    renderFabricGrid(state.type);
    renderSwatches();
  }
  ['regular','free','oversize'].forEach(f => {
    const opt   = document.getElementById('fit-'+f);
    const check = document.getElementById('fitcheck-'+f);
    if (!opt || !check) return;
    const active = f === fit;
    opt.classList.toggle('selected', active);
    check.textContent = active ? '✓' : '';
  });
  updateStepSections();
  scheduleSave();
}

// ─── ZONES ───
function toggleZone(el, zone) {
  // Если «Без нанесения» был активен — снимаем его
  if (state.noPrint) {
    state.noPrint = false;
    updateNoPrintBtn();
  }
  el.classList.toggle('selected');
  if (el.classList.contains('selected')) {
    if (!state.zones.includes(zone)) state.zones.push(zone);
    if (!state.zoneTechs) state.zoneTechs = {};
    if (!state.zoneTechs[zone]) state.zoneTechs[zone] = 'screen';
    if (!state.zonePrints) state.zonePrints = {};
    if (!state.zonePrints[zone]) state.zonePrints[zone] = {colors:1, size:'A4', textile:'white'};
  } else {
    state.zones = state.zones.filter(z => z !== zone);
  }
  const mockEl = document.getElementById('zone-'+zone);
  if (mockEl) mockEl.classList.toggle('active', el.classList.contains('selected'));
  renderZoneTechBlocks();
  updateDesignSections();
  updateTotal();
  updateNextBtns();
  scheduleSave();
}

function toggleNoPrint() {
  state.noPrint = !state.noPrint;
  if (state.noPrint) {
    // Снять все зоны
    state.zones = [];
    document.querySelectorAll('.zone-card').forEach(c => {
      c.classList.remove('selected');
      const zId = c.dataset.zone;
      const mockEl = document.getElementById('zone-' + zId);
      if (mockEl) mockEl.classList.remove('active');
    });
    renderZoneTechBlocks();
    updateDesignSections();
    updateTotal();
  }
  updateNoPrintBtn();
  updateNextBtns();
  scheduleSave();
}

function updateNoPrintBtn() {
  const btn = document.getElementById('noPrintBtn');
  const check = document.getElementById('noPrintCheck');
  if (!btn || !check) return;
  if (state.noPrint) {
    btn.style.borderColor = 'var(--black)';
    btn.style.background = 'var(--black)';
    btn.style.color = '#fff';
    check.innerHTML = '✓';
    check.style.borderColor = '#fff';
    check.style.color = '#fff';
  } else {
    btn.style.borderColor = 'var(--border-light)';
    btn.style.background = 'var(--white)';
    btn.style.color = 'var(--text-dim)';
    check.innerHTML = '';
    check.style.borderColor = 'var(--border-light)';
    check.style.color = 'var(--text-dim)';
  }
}

// ─── ROLE ───
function selectRole(el, role) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  state.role = role;
  scheduleSave();
}




// ════════════════════════════════════════════════════════════
//   UI — ZONES
// ════════════════════════════════════════════════════════════
// toggleZone, renderZonesGrid, role select (from UI_SELECTORS remainder)



// ════════════════════════════════════════════════════════════
//   UI — SIZE TABLE
// ════════════════════════════════════════════════════════════
// buildSizeTable, size inputs, custom sizes, ONE SIZE

// ─── ONE SIZE (accessories) ───
function changeOneSizeQty(delta) {
  const inp = document.getElementById('oneSizeQty');
  if (!inp) return;
  inp.value = Math.max(1, (parseInt(inp.value)||1) + delta);
  onOneSizeChange();
}
function onOneSizeChange() {
  const qty = parseInt(document.getElementById('oneSizeQty')?.value)||1;
  state.sizes = { 'ONE SIZE': qty };
  updateTotal();
  updateNextBtns();
}
function syncOneSizeInput() {
  const inp = document.getElementById('oneSizeQty');
  if (!inp) return;
  const qty = state.sizes?.['ONE SIZE'] || 1;
  inp.value = qty;
}



// ─── SIZE TABLE ───
// ─── VALIDATE qty input: только 1-999, без ведущих нулей ───
function validateQtyInput(input) {
  let v = input.value.replace(/[^0-9]/g, '');       // только цифры
  if (v.length > 1 && v[0] === '0') v = v.replace(/^0+/, ''); // убрать ведущие нули
  if (v === '') { input.value = ''; return; }
  const n = parseInt(v);
  if (n > 999) v = '999';
  input.value = v;
}

// Порядок всех известных размеров
function sizeOrder(label) {
  const ORDER = ['4XS','3XS','2XS','XXS','XS','S','M','L','XL','2XL','XXL','3XL','XXXL','4XL','5XL','6XL'];
  const idx = ORDER.indexOf(label.toUpperCase());
  // Числовые размеры (30, 32, 34…) — сортируем как числа со смещением
  if (idx >= 0) return idx;
  const num = parseInt(label);
  if (!isNaN(num)) return 100 + num;
  // Всё остальное в конец по алфавиту
  return 200 + label.charCodeAt(0);
}

function buildSizeTable() {
  const tbody = document.getElementById('sizeTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!state.customSizes) state.customSizes = [];

  // Объединяем базовые и кастомные в единый отсортированный список
  const baseItems = SIZES.map(size => ({ label: size, qty: state.sizes[size]||0, isCustom: false, customIdx: null }));
  const customItems = state.customSizes.map((cs, idx) => ({ label: cs.label, qty: cs.qty||0, isCustom: true, customIdx: idx }));
  const allItems = [...baseItems, ...customItems].sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));

  allItems.forEach(item => {
    tbody.appendChild(makeSizeRow(item.label, item.qty, item.isCustom, item.customIdx));
  });
  refreshPrices();
}

function makeSizeRow(size, qty, isCustom, customIdx) {
  const tr = document.createElement('tr');
  const safeId = size.replace(/[^a-zA-Z0-9]/g, '_');
  tr.id = 'row-' + safeId;
  tr.innerHTML = `
    <td><strong>${size}</strong></td>
    <td><div class="qty-control">
      <button class="qty-btn" onclick="changeQty('${size}',${isCustom?'true':'false'},-1)">−</button>
      <input class="qty-input" type="text" inputmode="numeric" maxlength="3"
        value="${qty > 0 ? qty : ''}" placeholder="0" id="qty-${safeId}"
        oninput="validateQtyInput(this);setQty('${size}',${isCustom},this.value)"
        onblur="if(!this.value||this.value==='0')this.value=''">
      <button class="qty-btn" onclick="changeQty('${size}',${isCustom},1)">+</button>
    </div></td>
    <td><span style="font-size:12px;font-weight:700;color:#888" id="unitprice-${safeId}">— ₽</span></td>
    <td><span id="lineprice-${safeId}" style="font-size:13px;font-weight:700">—</span></td>
    <td>${isCustom ? `<button class="size-remove-btn" onclick="removeCustomSize(${customIdx})" title="Удалить">×</button>` : ''}</td>`;
  return tr;
}

function changeQty(size, isCustom, delta) {
  if (isCustom === true || isCustom === 'true') {
    const cs = state.customSizes.find(c => c.label === size);
    if (cs) cs.qty = Math.min(999, Math.max(0, (cs.qty||0) + delta));
  } else {
    state.sizes[size] = Math.min(999, Math.max(0, (state.sizes[size]||0) + delta));
  }
  const safeId = size.replace(/[^a-zA-Z0-9]/g, '_');
  const inp = document.getElementById('qty-'+safeId);
  const val = isCustom === true || isCustom === 'true'
    ? (state.customSizes.find(c=>c.label===size)||{}).qty||0
    : state.sizes[size]||0;
  if (inp) inp.value = val > 0 ? val : '';
  refreshPrices(); updateTotal(); scheduleSave();
}

function setQty(size, isCustom, val) {
  let n = parseInt(String(val).replace(/[^0-9]/g,'')) || 0;
  n = Math.min(999, Math.max(0, n));
  if (isCustom === true || isCustom === 'true') {
    const cs = state.customSizes.find(c => c.label === size);
    if (cs) cs.qty = n;
  } else {
    state.sizes[size] = n;
  }
  refreshPrices(); updateTotal(); scheduleSave();
}


// ─── CUSTOM SIZES ───
function showAddSizeRow() {
  const row = document.getElementById('addSizeRow');
  if (row) { row.style.display = 'block'; document.getElementById('customSizeLabel').focus(); }
}
function hideAddSizeRow() {
  const row = document.getElementById('addSizeRow');
  if (row) row.style.display = 'none';
  const lbl = document.getElementById('customSizeLabel');
  const qty = document.getElementById('customSizeQty');
  if (lbl) lbl.value = '';
  if (qty) qty.value = '';
}
function confirmAddSize() {
  const lbl = (document.getElementById('customSizeLabel')?.value || '').trim().toUpperCase();
  const qtyRaw = document.getElementById('customSizeQty')?.value || '0';
  if (!lbl) { document.getElementById('customSizeLabel').focus(); return; }
  // Запретить дубли
  const allLabels = [...SIZES, ...state.customSizes.map(c=>c.label)];
  if (allLabels.includes(lbl)) {
    document.getElementById('customSizeLabel').style.borderColor = 'var(--accent)';
    setTimeout(()=>document.getElementById('customSizeLabel').style.borderColor='', 1200);
    return;
  }
  let qty = parseInt(qtyRaw.replace(/[^0-9]/g,'')) || 0;
  qty = Math.min(999, Math.max(0, qty));
  if (!state.customSizes) state.customSizes = [];
  state.customSizes.push({ label: lbl, qty });
  // Сортируем customSizes по порядку размеров
  state.customSizes.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
  hideAddSizeRow();
  buildSizeTable();
  updateTotal(); scheduleSave();
}
function removeCustomSize(idx) {
  state.customSizes.splice(idx, 1);
  buildSizeTable();
  updateTotal(); scheduleSave();
}
function refreshPrices() {
  const baseTotal = Object.values(getActiveSizes()).reduce((a,b)=>a+b,0);
  const customTotal = (state.customSizes||[]).reduce((a,c)=>a+(c.qty||0),0);
  const total = baseTotal + customTotal;
  let unitBase;
  if (state.sku) {
    unitBase = getSkuEstPrice(state.sku);
  } else {
    const base = PRICES.type[state.type]||480;
    const fabric = PRICES.fabric[state.fabric]||0;
    unitBase = base + fabric;
  }
  const tech = getScreenSurcharge();
  const extrasCost = (state.extras||[]).reduce((s,code) => {
    const ex = EXTRAS_CATALOG.find(e => e.code === code);
    return s + (ex ? ex.price : 0);
  }, 0);
  const labelsCost = getLabelConfigPrice();
  const unitPrice = Math.round(unitBase + extrasCost + labelsCost + tech);
  // базовые размеры
  SIZES.forEach(size => {
    const safeId = size.replace(/[^a-zA-Z0-9]/g, '_');
    const q = state.sizes[size]||0;
    const el = document.getElementById('unitprice-'+safeId);
    const lp = document.getElementById('lineprice-'+safeId);
    if (el) el.textContent = unitPrice+' ₽';
    if (lp) lp.textContent = q>0 ? (q*unitPrice).toLocaleString('ru')+' ₽' : '—';
  });
  // кастомные
  (state.customSizes||[]).forEach(cs => {
    const safeId = cs.label.replace(/[^a-zA-Z0-9]/g, '_');
    const el = document.getElementById('unitprice-'+safeId);
    const lp = document.getElementById('lineprice-'+safeId);
    if (el) el.textContent = unitPrice+' ₽';
    if (lp) lp.textContent = (cs.qty||0)>0 ? ((cs.qty||0)*unitPrice).toLocaleString('ru')+' ₽' : '—';
  });
  const tq = document.getElementById('totalQtyCell');
  const tp = document.getElementById('totalPriceCell');
  if (tq) tq.textContent = total+' шт';
  if (tp) tp.textContent = (total*unitPrice).toLocaleString('ru')+' ₽';
}


// ─── HELPER: считать только нужные размеры ───
function getActiveSizes() {
  if (isAccessory(state.type)) return state.sizes;
  return Object.fromEntries(Object.entries(state.sizes||{}).filter(([k]) => k !== 'ONE SIZE'));
}
function getActiveTotalQty() {
  return Object.values(getActiveSizes()).reduce((a,b)=>a+(+b||0),0)
    + (state.customSizes||[]).reduce((a,c)=>a+(+c.qty||0),0);
}




