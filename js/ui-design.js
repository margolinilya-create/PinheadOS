// ════════════════════════════════════════════════════════════
//   UI — COLORS
// ════════════════════════════════════════════════════════════
// renderSwatches, makeSwatch, selectSwatch, filterColors, switchColorSupplier

function renderSwatches(filter) {
  const grid = document.getElementById('swatchGrid');
  if (!grid) return;
  const isCp   = activeColorSupplier === 'cottonprom';
  const colors = isCp ? COTTONPROM_COLORS : MEDASTEX_COLORS;
  const groups = isCp ? COTTONPROM_GROUPS : COLOR_GROUPS;
  const q = (filter||'').toLowerCase().trim();
  grid.innerHTML = '';
  if (q) {
    colors.forEach(c => {
      if (c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) grid.appendChild(makeSwatch(c));
    });
    return;
  }
  groups.forEach(group => {
    const groupColors = group.codes.map(code => colors.find(c => c.code === code)).filter(Boolean);
    if (!groupColors.length) return;
    const lbl = document.createElement('div');
    lbl.style.cssText = 'grid-column:1/-1;font-size:9px;font-weight:700;letter-spacing:2px;color:#888;text-transform:uppercase;padding:8px 0 4px;border-top:1px solid #ddd;margin-top:4px';
    lbl.textContent = group.label;
    grid.appendChild(lbl);
    groupColors.forEach(c => grid.appendChild(makeSwatch(c)));
  });
}

function switchColorSupplier(supplier) {
  activeColorSupplier = supplier;
  state.color = '';
  // Обновляем кнопки
  ['medastex','cottonprom'].forEach(s => {
    const btn = document.getElementById('supplierBtn-' + s);
    if (btn) btn.classList.toggle('supplier-btn-active', s === supplier);
  });
  // Сбрасываем поиск
  const search = document.getElementById('colorSearch');
  if (search) search.value = '';
  const info = document.getElementById('colorSelectedInfo');
  if (info) info.textContent = '';
  renderSwatches();
  updateStepSections();
  updateTotal();
}

function makeSwatch(c) {
  const el = document.createElement('div');
  el.className = 'swatch' + (c.code === state.color ? ' selected' : '');
  el.dataset.color = c.code;
  el.onclick = function() { selectSwatch(this); };
  el.innerHTML = `<div class="swatch-circle" style="background:${c.hex}"></div><div class="swatch-code">${c.code}</div><div class="swatch-label">${c.name}</div>`;
  return el;
}

function filterColors(q) { renderSwatches(q); }

function selectSwatch(el) {
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  state.color = el.dataset.color;
  const _allColors = [...MEDASTEX_COLORS, ...COTTONPROM_COLORS];
  const c = _allColors.find(x => x.code === state.color);
  const info = document.getElementById('colorSelectedInfo');
  if (info && c) info.textContent = `Выбран: ${c.code} — ${c.name}`;
  updateMockup();
  updateStepSections();
  updateTotal();
  scheduleSave();
}




