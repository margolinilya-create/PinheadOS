// ════════════════════════════════════════════════════════════
//   MOCKUP
// ════════════════════════════════════════════════════════════
// SVG garment mockup, shade helper, updateMockup

// ─── SHADE HELPER ───
function shade(hex, amt) {
  const n = parseInt(hex.replace('#',''),16);
  const r = Math.min(255,Math.max(0,(n>>16)+amt));
  const g = Math.min(255,Math.max(0,((n>>8)&0xff)+amt));
  const b = Math.min(255,Math.max(0,(n&0xff)+amt));
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}

// ─── GARMENT SVG MOCKUP (все 11 типов) ───
function getGarmentSVG(type, colorCode) {
  const colorEntry = findColorEntry(colorCode);
  const c   = colorEntry ? colorEntry.hex : '#ccc';
  const mid = shade(c, 18);
  const dk  = shade(c, -28);
  const str = shade(c, -55);
  const W = 220, S = `style="width:220px;filter:drop-shadow(0 6px 24px rgba(0,0,0,.13))"`;

  // contrast color for raglan sleeves (always opposite)
  const isLight = parseInt(c.replace('#',''),16) > 0x888888;
  const rag = isLight ? shade(c,-70) : shade(c,80);
  const ragStr = shade(rag,-40);

  const svgs = {

    // ── ФУТБОЛКА ──
    tee:`<svg viewBox="0 0 220 250" fill="none" ${S}>
      <path d="M60 44 L16 68 L34 88 L30 206 L190 206 L186 88 L204 68 L160 44 L140 32 Q110 54 80 32Z" fill="${c}" stroke="${str}" stroke-width="1.5"/>
      <path d="M30 90 L34 206 L62 206 L60 98Z" fill="${dk}" opacity=".25"/>
      <path d="M186 90 L190 206 L158 206 L160 98Z" fill="${dk}" opacity=".25"/>
      <path d="M80 32 Q110 54 140 32 Q130 50 110 52 Q90 50 80 32Z" fill="${mid}" stroke="${str}" stroke-width="1"/>
      <path d="M60 44 L16 68 L34 88 L64 68Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <path d="M160 44 L204 68 L186 88 L156 68Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <line x1="30" y1="202" x2="190" y2="202" stroke="${str}" stroke-width="1" opacity=".4"/>
    </svg>`,

    // ── ХУДИ ──
    hoodie:`<svg viewBox="0 0 220 280" fill="none" ${S}>
      <path d="M54 64 L14 90 L32 112 L28 232 L192 232 L188 112 L206 90 L166 64 L146 46 Q110 36 74 46Z" fill="${c}" stroke="${str}" stroke-width="1.5"/>
      <path d="M28 112 L32 232 L60 232 L56 120Z" fill="${dk}" opacity=".25"/>
      <path d="M188 112 L192 232 L160 232 L164 120Z" fill="${dk}" opacity=".25"/>
      <path d="M74 46 Q110 36 146 46 L146 26 Q128 10 110 8 Q92 10 74 26Z" fill="${mid}" stroke="${str}" stroke-width="1.3"/>
      <path d="M84 44 Q110 38 136 44 L136 28 Q110 18 84 28Z" fill="${c}" stroke="${str}" stroke-width="0.9"/>
      <path d="M74 46 L84 44 L84 28 L74 26Z" fill="${dk}" opacity=".2"/>
      <path d="M146 46 L136 44 L136 28 L146 26Z" fill="${dk}" opacity=".2"/>
      <path d="M74 158 Q110 154 146 158 L146 186 Q110 190 74 186Z" fill="${dk}" opacity=".18" stroke="${str}" stroke-width="0.8"/>
      <line x1="110" y1="158" x2="110" y2="186" stroke="${str}" stroke-width="0.8" opacity=".35"/>
      <path d="M54 64 L14 90 L32 112 L56 88Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <path d="M166 64 L206 90 L188 112 L164 88Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <line x1="54" y1="54" x2="48" y2="74" stroke="${str}" stroke-width="1" opacity=".4"/>
      <line x1="166" y1="54" x2="172" y2="74" stroke="${str}" stroke-width="1" opacity=".4"/>
      <line x1="28" y1="228" x2="192" y2="228" stroke="${str}" stroke-width="1" opacity=".4"/>
    </svg>`,

    // ── СВИТШОТ ──
    sweat:`<svg viewBox="0 0 220 255" fill="none" ${S}>
      <path d="M58 48 L16 72 L34 92 L30 208 L190 208 L186 92 L204 72 L162 48 L142 36 Q110 54 78 36Z" fill="${c}" stroke="${str}" stroke-width="1.5"/>
      <path d="M30 94 L34 208 L60 208 L58 102Z" fill="${dk}" opacity=".25"/>
      <path d="M186 94 L190 208 L160 208 L162 102Z" fill="${dk}" opacity=".25"/>
      <rect x="80" y="26" width="60" height="18" rx="9" fill="${mid}" stroke="${str}" stroke-width="1.3"/>
      <line x1="86" y1="26" x2="86" y2="44" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <line x1="93" y1="26" x2="93" y2="44" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <line x1="100" y1="26" x2="100" y2="44" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <line x1="107" y1="26" x2="107" y2="44" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <line x1="114" y1="26" x2="114" y2="44" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <line x1="121" y1="26" x2="121" y2="44" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <line x1="128" y1="26" x2="128" y2="44" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <line x1="134" y1="26" x2="134" y2="44" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <path d="M58 48 L16 72 L34 92 L62 70Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <path d="M162 48 L204 72 L186 92 L158 70Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <rect x="16" y="200" width="188" height="10" fill="none" stroke="${str}" stroke-width="1"/>
      <line x1="16" y1="205" x2="204" y2="205" stroke="${str}" stroke-width="0.6" opacity=".35"/>
      <rect x="16" y="88" width="18" height="9" rx="1" fill="${mid}" stroke="${str}" stroke-width="0.9"/>
      <rect x="186" y="88" width="18" height="9" rx="1" fill="${mid}" stroke="${str}" stroke-width="0.9"/>
    </svg>`,

    // ── ЛОНГСЛИВ ──
    longsleeve:`<svg viewBox="0 0 220 270" fill="none" ${S}>
      <path d="M72 50 L72 208 L148 208 L148 50 Q110 64 72 50Z" fill="${c}" stroke="${str}" stroke-width="1.5"/>
      <path d="M72 50 L20 64 L22 226 L50 226 L52 96 L72 76Z" fill="${mid}" stroke="${str}" stroke-width="1.4"/>
      <path d="M148 50 L200 64 L198 226 L170 226 L168 96 L148 76Z" fill="${mid}" stroke="${str}" stroke-width="1.4"/>
      <path d="M72 76 L52 96 L52 106 L72 88Z" fill="${dk}" opacity=".2"/>
      <path d="M148 76 L168 96 L168 106 L148 88Z" fill="${dk}" opacity=".2"/>
      <path d="M78 50 Q110 64 142 50 Q132 62 110 64 Q88 62 78 50Z" fill="${dk}" stroke="${str}" stroke-width="1"/>
      <rect x="22" y="218" width="28" height="10" rx="1" fill="${mid}" stroke="${str}" stroke-width="1.1"/>
      <rect x="170" y="218" width="28" height="10" rx="1" fill="${mid}" stroke="${str}" stroke-width="1.1"/>
      <line x1="72" y1="204" x2="148" y2="204" stroke="${str}" stroke-width="0.8" opacity=".4"/>
    </svg>`,

    // ── ЗИП-ХУДИ ──
    'zip-hoodie':`<svg viewBox="0 0 220 280" fill="none" ${S}>
      <path d="M54 64 L14 90 L32 112 L28 232 L108 232 L108 54 Q82 44 54 64Z" fill="${c}" stroke="${str}" stroke-width="1.5"/>
      <path d="M166 64 L206 90 L188 112 L192 232 L112 232 L112 54 Q138 44 166 64Z" fill="${c}" stroke="${str}" stroke-width="1.5"/>
      <path d="M28 112 L32 232 L60 232 L56 120Z" fill="${dk}" opacity=".25"/>
      <path d="M188 112 L192 232 L160 232 L164 120Z" fill="${dk}" opacity=".25"/>
      <path d="M74 46 Q110 36 146 46 L146 26 Q128 10 110 8 Q92 10 74 26Z" fill="${mid}" stroke="${str}" stroke-width="1.3"/>
      <path d="M84 44 Q110 38 136 44 L136 28 Q110 18 84 28Z" fill="${c}" stroke="${str}" stroke-width="0.9"/>
      <line x1="110" y1="24" x2="110" y2="232" stroke="${str}" stroke-width="1.4"/>
      <rect x="107" y="30" width="6" height="4" rx="0.5" fill="${mid}" stroke="${str}" stroke-width="0.7"/>
      <rect x="107" y="38" width="6" height="4" rx="0.5" fill="${mid}" stroke="${str}" stroke-width="0.7"/>
      <rect x="107" y="46" width="6" height="4" rx="0.5" fill="${mid}" stroke="${str}" stroke-width="0.7"/>
      <rect x="107" y="54" width="6" height="4" rx="0.5" fill="${mid}" stroke="${str}" stroke-width="0.7"/>
      <rect x="107" y="62" width="6" height="4" rx="0.5" fill="${mid}" stroke="${str}" stroke-width="0.7"/>
      <rect x="106" y="76" width="8" height="6" rx="1" fill="${dk}" stroke="${str}" stroke-width="0.9"/>
      <path d="M54 64 L14 90 L32 112 L56 88Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <path d="M166 64 L206 90 L188 112 L164 88Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <path d="M28 96 Q42 94 52 100 L52 114 Q40 116 28 112Z" fill="none" stroke="${str}" stroke-width="0.9"/>
      <path d="M168 100 Q178 94 192 96 L192 112 Q180 116 168 114Z" fill="none" stroke="${str}" stroke-width="0.9"/>
      <line x1="28" y1="228" x2="192" y2="228" stroke="${str}" stroke-width="1" opacity=".4"/>
    </svg>`,

    // ── ХАЛФ-ЗИП ──
    'half-zip':`<svg viewBox="0 0 220 255" fill="none" ${S}>
      <path d="M58 48 L16 72 L34 92 L30 208 L190 208 L186 92 L204 72 L162 48 L142 36 Q110 54 78 36Z" fill="${c}" stroke="${str}" stroke-width="1.5"/>
      <path d="M30 94 L34 208 L60 208 L58 102Z" fill="${dk}" opacity=".25"/>
      <path d="M186 94 L190 208 L160 208 L162 102Z" fill="${dk}" opacity=".25"/>
      <path d="M78 36 Q110 54 142 36 L142 18 Q128 10 110 8 Q92 10 78 18Z" fill="${mid}" stroke="${str}" stroke-width="1.3"/>
      <path d="M86 34 Q110 28 134 34 L134 20 Q110 14 86 20Z" fill="${c}" stroke="${str}" stroke-width="0.9"/>
      <line x1="110" y1="10" x2="110" y2="68" stroke="${str}" stroke-width="1.3"/>
      <rect x="107" y="18" width="6" height="3.5" rx="0.4" fill="${mid}" stroke="${str}" stroke-width="0.7"/>
      <rect x="107" y="25" width="6" height="3.5" rx="0.4" fill="${mid}" stroke="${str}" stroke-width="0.7"/>
      <rect x="107" y="32" width="6" height="3.5" rx="0.4" fill="${mid}" stroke="${str}" stroke-width="0.7"/>
      <rect x="107" y="39" width="6" height="3.5" rx="0.4" fill="${mid}" stroke="${str}" stroke-width="0.7"/>
      <rect x="106" y="52" width="8" height="6" rx="1" fill="${dk}" stroke="${str}" stroke-width="0.9"/>
      <path d="M58 48 L16 72 L34 92 L62 70Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <path d="M162 48 L204 72 L186 92 L158 70Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/>
      <rect x="16" y="200" width="188" height="10" fill="none" stroke="${str}" stroke-width="1"/>
      <rect x="16" y="88" width="18" height="9" rx="1" fill="${mid}" stroke="${str}" stroke-width="0.9"/>
      <rect x="186" y="88" width="18" height="9" rx="1" fill="${mid}" stroke="${str}" stroke-width="0.9"/>
    </svg>`,

    // ── МАЙКА ──
    tank:`<svg viewBox="0 0 220 250" fill="none" ${S}>
      <path d="M56 36 L32 60 L50 76 L46 206 L174 206 L170 76 L188 60 L164 36 L140 20 Q110 36 80 20Z" fill="${c}" stroke="${str}" stroke-width="1.5"/>
      <path d="M46 78 L50 206 L72 206 L70 86Z" fill="${dk}" opacity=".25"/>
      <path d="M170 78 L174 206 L148 206 L150 86Z" fill="${dk}" opacity=".25"/>
      <path d="M80 20 Q110 36 140 20 Q130 34 110 36 Q90 34 80 20Z" fill="${mid}" stroke="${str}" stroke-width="1"/>
      <path d="M56 36 Q38 52 32 60 L50 76 Q46 62 52 48Z" fill="${mid}" stroke="${str}" stroke-width="1.1"/>
      <path d="M164 36 Q182 52 188 60 L170 76 Q174 62 168 48Z" fill="${mid}" stroke="${str}" stroke-width="1.1"/>
      <line x1="46" y1="202" x2="174" y2="202" stroke="${str}" stroke-width="1" opacity=".4"/>
    </svg>`,

    // ── ШТАНЫ ──
    pants:`<svg viewBox="0 0 220 290" fill="none" ${S}>
      <rect x="30" y="14" width="160" height="22" rx="2" fill="${mid}" stroke="${str}" stroke-width="1.4"/>
      <line x1="30" y1="25" x2="190" y2="25" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <path d="M64 14 Q110 22 156 14" fill="none" stroke="${str}" stroke-width="1.2" opacity=".7"/>
      <circle cx="64" cy="14" r="3.5" fill="${mid}" stroke="${str}" stroke-width="1"/>
      <circle cx="156" cy="14" r="3.5" fill="${mid}" stroke="${str}" stroke-width="1"/>
      <path d="M30 34 L20 274 L100 274 L110 148 Z" fill="${c}" stroke="${str}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M190 34 L200 274 L120 274 L110 148 Z" fill="${c}" stroke="${str}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M30 34 L26 86 L54 86 L56 40Z" fill="${dk}" opacity=".2"/>
      <path d="M190 34 L194 86 L166 86 L164 40Z" fill="${dk}" opacity=".2"/>
      <line x1="110" y1="36" x2="110" y2="148" stroke="${str}" stroke-width="1.1" stroke-dasharray="3 2" opacity=".45"/>
      <rect x="20" y="264" width="80" height="12" rx="1" fill="${mid}" stroke="${str}" stroke-width="1"/>
      <rect x="120" y="264" width="80" height="12" rx="1" fill="${mid}" stroke="${str}" stroke-width="1"/>
      <path d="M28 48 Q34 72 30 88" fill="none" stroke="${str}" stroke-width="1" opacity=".4"/>
    </svg>`,

    // ── ШОРТЫ ──
    shorts:`<svg viewBox="0 0 220 200" fill="none" ${S}>
      <rect x="30" y="14" width="160" height="22" rx="2" fill="${mid}" stroke="${str}" stroke-width="1.4"/>
      <line x1="30" y1="25" x2="190" y2="25" stroke="${str}" stroke-width="0.7" opacity=".4"/>
      <path d="M64 14 Q110 22 156 14" fill="none" stroke="${str}" stroke-width="1.2" opacity=".7"/>
      <circle cx="64" cy="14" r="3.5" fill="${mid}" stroke="${str}" stroke-width="1"/>
      <circle cx="156" cy="14" r="3.5" fill="${mid}" stroke="${str}" stroke-width="1"/>
      <path d="M30 34 L24 164 L106 164 L110 98Z" fill="${c}" stroke="${str}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M190 34 L196 164 L114 164 L110 98Z" fill="${c}" stroke="${str}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M30 34 L26 70 L54 70 L54 40Z" fill="${dk}" opacity=".2"/>
      <path d="M190 34 L194 70 L166 70 L166 40Z" fill="${dk}" opacity=".2"/>
      <line x1="110" y1="36" x2="110" y2="98" stroke="${str}" stroke-width="1.1" stroke-dasharray="3 2" opacity=".45"/>
      <line x1="24" y1="158" x2="106" y2="158" stroke="${str}" stroke-width="0.9" opacity=".4"/>
      <line x1="114" y1="158" x2="196" y2="158" stroke="${str}" stroke-width="0.9" opacity=".4"/>
      <path d="M28 46 Q34 60 30 72" fill="none" stroke="${str}" stroke-width="1" opacity=".4"/>
    </svg>`,
  };

  return svgs[type] || svgs.tee;
}

function updateMockup() {
  const wrap = document.getElementById('mockupWrap');
  if (!wrap) return;
  wrap.innerHTML = getGarmentSVG(state.type, state.color);
  const label = document.getElementById('mockupLabel');
  if (label) label.textContent = TYPE_NAMES[state.type] || '';
  // re-apply zones
  state.zones.forEach(z => {
    const el = document.getElementById('zone-'+z);
    if (el) el.classList.add('active');
  });
}




// ════════════════════════════════════════════════════════════
//   SUMMARY & OUTPUT
// ════════════════════════════════════════════════════════════
// buildSummary, copyTZ, PDF generation, upload

// ─── SUMMARY ───
function buildSummary() {
  state.name     = document.getElementById('clientName')?.value||'';
  state.phone     = document.getElementById('clientPhone')?.value||'';
  state.messenger = document.getElementById('clientMessenger')?.value||'';
  state.email    = document.getElementById('clientEmail')?.value||'';
  state.deadline = document.getElementById('clientDeadline')?.value||'';
  state.address  = document.getElementById('clientAddress')?.value||'';
  state.notes    = document.getElementById('clientNotes')?.value||'';
  state.designNotes = document.getElementById('designNotes')?.value||'';
  state.packOption   = !!document.getElementById('togglePack')?.checked;
  state.urgentOption = !!document.getElementById('toggleUrgent')?.checked;
  saveDraft();

  const totalQty = getActiveTotalQty();
  const baseSizes = SIZES.filter(s=>state.sizes[s]>0).map(s=>`${s}×${state.sizes[s]}`);
  const custSizes = (state.customSizes||[]).filter(c=>c.qty>0).map(c=>`${c.label}×${c.qty}`);
  const sizeStr = [...baseSizes,...custSizes].join(', ');
  const colorEntry = findColorEntry(state.color);
  const colorLabel = colorEntry ? `${state.color} — ${colorEntry.name}` : state.color;


  // Таблица размеров
  let unitBase;
  if (state.sku) {
    unitBase = getSkuEstPrice(state.sku);
  } else {
    const basePrice = PRICES.type[state.type]||480;
    const fabricPrice = PRICES.fabric[state.fabric]||0;
    unitBase = basePrice + fabricPrice;
  }
  const techPrice = getScreenSurcharge();
  const extrasCost = (state.extras||[]).reduce((s,code) => {
    const ex = EXTRAS_CATALOG.find(e => e.code === code);
    return s + (ex ? ex.price : 0);
  }, 0);
  const labelsCostST = getLabelConfigPrice();
  const pkgPrice = state.packOption?15:0;
  const unitPrice = Math.round(unitBase + extrasCost + labelsCostST + techPrice + pkgPrice);

  const allSizeRows = [
    ...SIZES.filter(s=>(state.sizes[s]||0)>0).map(s=>({label:s, qty:state.sizes[s]})),
    ...(state.customSizes||[]).filter(c=>c.qty>0).map(c=>({label:c.label, qty:c.qty}))
  ];

  const isAcc = isAccessory(state.type);
  let sizeTableHTML = '';
  if (isAcc) {
    const qty = state.sizes?.['ONE SIZE'] || 1;
    sizeTableHTML = `
      <table class="summary-size-table">
        <thead><tr><th>Размер</th><th>Кол-во</th><th>Цена/шт</th><th>Сумма</th></tr></thead>
        <tbody>
          <tr><td>ONE SIZE</td><td>${qty} шт</td><td>${unitPrice} ₽</td><td>${(qty*unitPrice).toLocaleString('ru')} ₽</td></tr>
        </tbody>
        <tfoot><tr class="total-row"><td colspan="2">ИТОГО</td><td>${qty} шт</td><td>${(qty*unitPrice).toLocaleString('ru')} ₽</td></tr></tfoot>
      </table>`;
    if (state.sizeComment) sizeTableHTML += `<div style="margin-top:8px;font-size:11px;color:var(--text-dim);font-weight:600">Комментарий: ${state.sizeComment}</div>`;
  } else if (allSizeRows.length > 0) {
    const rows = allSizeRows.map(r=>`<tr><td>${r.label}</td><td>${r.qty} шт</td><td>${unitPrice} ₽</td><td>${(r.qty*unitPrice).toLocaleString('ru')} ₽</td></tr>`).join('');
    sizeTableHTML = `
      <table class="summary-size-table">
        <thead><tr><th>Размер</th><th>Кол-во</th><th>Цена/шт</th><th>Сумма</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="total-row"><td colspan="2">ИТОГО</td><td>${totalQty} шт</td><td>${(totalQty*unitPrice).toLocaleString('ru')} ₽</td></tr></tfoot>
      </table>`;
    if (state.sizeComment) sizeTableHTML += `<div style="margin-top:8px;font-size:11px;color:var(--text-dim);font-weight:600">Комментарий: ${state.sizeComment}</div>`;
  } else {
    sizeTableHTML = '<div style="font-size:11px;color:var(--text-dim);padding:8px 0">Размеры не указаны</div>';
  }

  document.getElementById('summaryGrid').innerHTML = `
    <div class="summary-block"><div class="summary-block-title">Изделие</div>
      <div class="summary-row"><span class="key">Тип</span><span class="val">${TYPE_NAMES[state.type]}</span></div>
      <div class="summary-row"><span class="key">Лекала</span><span class="val">${({'regular':'Regular Fit','free':'Free Fit','oversize':'Oversize Fit'})[state.fit]||'Regular Fit'}</span></div>
      <div class="summary-row"><span class="key">Ткань</span><span class="val">${FABRIC_NAMES[state.fabric]}</span></div>
      <div class="summary-row"><span class="key">Цвет базы</span><span class="val">${colorLabel}</span></div>
      <div class="summary-row"><span class="key">Тираж</span><span class="val">${totalQty} шт</span></div>
    </div>
    <div class="summary-block" style="grid-column:1/-1"><div class="summary-block-title">Разбивка по размерам</div>
      ${sizeTableHTML}
    </div>
    <div class="summary-block"><div class="summary-block-title">Печать</div>
      <div class="summary-row"><span class="key">Техника</span><span class="val">${TECH_NAMES[state.tech]}${(state.tech==='screen'||state.tech==='dtg')&&state.textileColor?' · '+(state.textileColor==='color'?'цветной':'белый')+' текстиль':''}</span></div>
      ${state.zones.map(z=>{
        const zn={chest:'Грудь',back:'Спина','left-sleeve':'Лев. рукав','right-sleeve':'Прав. рукав'}[z];
        let det='';
        if(state.tech==='screen'){const p=getZonePrint(z);const fxObj=SCREEN_FX.find(f=>f.key===(p.fx||'none'));const fxLabel=fxObj&&fxObj.mult>1?' · '+fxObj.label:'';const txtLabel=p.textile==='color'?' · цветной':'';det=p.size+' · '+p.colors+' цв.'+txtLabel+fxLabel+' → '+screenCalcZone(z)+'₽';}
        else if(state.tech==='dtg'){const p=getDtgZone(z);det=p.size+' · полноцвет';}
        else if(state.tech==='embroidery'){const p=getEmbZone(z);det=({s:'S до 7см',m:'M до 12см',l:'L до 20см'})[p.area]+' · '+(p.colors||3)+' цв. нити';}
        else if(state.tech==='dtf'){const p=getDtfZone(z);det=p.size+' · неогранич. цвета';}
        return det?'<div class="summary-row" style="padding-left:16px"><span class="key" style="color:var(--text-dim)">'+zn+'</span><span class="val">'+det+'</span></div>':'';
      }).join('')}
      <div class="summary-row"><span class="key">Зоны</span><span class="val">${state.zones.map(z=>ZONE_LABELS[z]).join(', ')||'—'}</span></div>
      ${(()=>{const ex=(state.extras||[]).map(c=>{const e=EXTRAS_CATALOG.find(x=>x.code===c);return e?e.name:c}).join(', ');return ex?'<div class="summary-row"><span class="key">Обработки</span><span class="val">'+ex+'</span></div>':'';})()}
      ${(()=>{
        const cfg=state.labelConfig||{};const parts=[];
        if(cfg.careLabel&&cfg.careLabel.enabled){const optN={'my-logo':'Мой логотип','no-logo':'Без логотипа','standard':'Стандартный'}[cfg.careLabel.logoOption]||'';parts.push('Составник'+(optN?' ('+optN+')':''));}
        if(cfg.mainLabel&&cfg.mainLabel.option!=='none'){const optN={'send-own':'Пришлю свои','standard':'Стандартная','custom':'Кастомная'}[cfg.mainLabel.option]||'';parts.push('Бирка'+(optN?' ('+optN+')':''));}
        if(cfg.hangTag&&cfg.hangTag.option!=='none'){const optN={'standard':'Стандартный','custom':'Кастомный'}[cfg.hangTag.option]||'';parts.push('Хэнг-тег'+(optN?' ('+optN+')':''));}
        return parts.length?'<div class="summary-row"><span class="key">Бирки</span><span class="val">'+parts.join(', ')+'</span></div>':'';
      })()}
      <div class="summary-row"><span class="key">Общий макет</span><span class="val">${state.generalFile||state.file||'Не загружен'}</span></div>
      ${(()=>{const zf=state.zoneFiles||{};const entries=Object.entries(zf).filter(([z])=>state.zones.includes(z));if(!entries.length)return '';return entries.map(([z,f])=>'<div class="summary-row" style="padding-left:16px"><span class="key" style="color:var(--text-dim)">'+ZONE_LABELS[z]+'</span><span class="val">'+f+'</span></div>').join('');})()}
      <div class="summary-row"><span class="key">ТЗ</span><span class="val">${state.designNotes?'✓ Есть':'—'}</span></div>
    </div>
    <div class="summary-block"><div class="summary-block-title">Клиент</div>
      <div class="summary-row"><span class="key">Имя</span><span class="val">${state.name||'—'}</span></div>
      <div class="summary-row"><span class="key">Телефон</span><span class="val">${state.phone||'—'}</span></div>
      <div class="summary-row"><span class="key">Мессенджер</span><span class="val">${state.messenger?'@'+state.messenger:'—'}</span></div>
      <div class="summary-row"><span class="key">Email</span><span class="val">${state.email||'—'}</span></div>
      <div class="summary-row"><span class="key">Дедлайн</span><span class="val">${state.deadline||'—'}</span></div>
      <div class="summary-row"><span class="key">Роль</span><span class="val">${state.role==='manager'?'Менеджер':state.role==='client'?'Клиент':'Партнёр'}</span></div>
    </div>
    <div class="summary-block"><div class="summary-block-title">Опции & Доставка</div>
      <div class="summary-row"><span class="key">Бирки</span><span class="val">${getLabelConfigPrice()>0?'✓ +'+getLabelConfigPrice()+'₽/шт':'—'}</span></div>
      <div class="summary-row"><span class="key">OPP упаковка</span><span class="val">${state.packOption?'✓ +15₽/шт':'—'}</span></div>
      <div class="summary-row"><span class="key">Срочность</span><span class="val">${state.urgentOption?'⚡ +20%':'—'}</span></div>
      <div class="summary-row"><span class="key">Адрес</span><span class="val">${state.address||'—'}</span></div>
    </div>`;

  let unitBefore;
  let baseDisplay, fabricDisplay, techDisplay, lblDisplay, pkgDisplay, extrasDisplay;
  const _tp2 = getScreenSurcharge();
  const _lp2 = 0;
  const _pp2 = state.packOption?15:0;
  const extCost = (state.extras||[]).reduce((s,c)=>{const e=EXTRAS_CATALOG.find(x=>x.code===c);return s+(e?e.price:0)},0);
  const lblCost = getLabelConfigPrice();

  if (state.sku) {
    baseDisplay = getSkuEstPrice(state.sku);
    fabricDisplay = 0; // уже включена в SKU
    techDisplay = _tp2;
    lblDisplay = _lp2;
    pkgDisplay = _pp2;
    extrasDisplay = extCost;
    unitBefore = baseDisplay + extCost + lblCost + _tp2 + _lp2 + _pp2;
  } else {
    baseDisplay = PRICES.type[state.type]||480;
    fabricDisplay = PRICES.fabric[state.fabric]||0;
    techDisplay = _tp2;
    lblDisplay = _lp2;
    pkgDisplay = _pp2;
    extrasDisplay = extCost;
    unitBefore = Math.round(baseDisplay+fabricDisplay+_tp2+_lp2+_pp2+extCost+lblCost);
  }
  const urgentAdd  = state.urgentOption ? Math.round(unitBefore*totalQty*0.2) : 0;
  const finalTotal = unitBefore*totalQty+urgentAdd;

  const skuLabel = state.sku ? state.sku.name : TYPE_NAMES[state.type];
  const extrasNames = (state.extras||[]).map(c=>{const e=EXTRAS_CATALOG.find(x=>x.code===c);return e?e.name:c}).join(', ');
  const labelsNames = (()=>{const cfg=state.labelConfig||{};const p=[];if(cfg.careLabel&&cfg.careLabel.enabled)p.push('Составник');if(cfg.mainLabel&&cfg.mainLabel.option!=='none')p.push('Бирка');if(cfg.hangTag&&cfg.hangTag.option!=='none')p.push('Хэнг-тег');return p.join(', ');})();

  document.getElementById('priceBreakdown').innerHTML = `
    <div class="summary-block-title">Расчёт стоимости</div>
    <div class="price-line"><span class="name">Базовое изделие (${skuLabel})</span><span class="amount">${baseDisplay} ₽</span></div>
    ${fabricDisplay>0?`<div class="price-line"><span class="name">Ткань (${FABRIC_NAMES[state.fabric]})</span><span class="amount">+${fabricDisplay} ₽</span></div>`:''}
    ${extrasDisplay>0?`<div class="price-line"><span class="name">Обработки (${extrasNames})</span><span class="amount">+${extrasDisplay} ₽</span></div>`:''}
    ${lblCost>0?`<div class="price-line"><span class="name">Бирки (${labelsNames})</span><span class="amount">+${lblCost} ₽</span></div>`:''}
    <div class="price-line"><span class="name">Печать (${TECH_NAMES[state.tech]})</span><span class="amount">+${techDisplay} ₽</span></div>
    ${pkgDisplay>0?`<div class="price-line"><span class="name">Упаковка</span><span class="amount">+${pkgDisplay} ₽</span></div>`:''}
    <div class="price-line"><span class="name">Цена за единицу</span><span class="amount">${unitBefore} ₽ × ${totalQty} шт</span></div>
    ${urgentAdd>0?`<div class="price-line"><span class="name">Срочность (+20%)</span><span class="amount">+${urgentAdd.toLocaleString('ru')} ₽</span></div>`:''}
    <div class="price-total"><span class="name">ИТОГО</span><span class="amount">${finalTotal.toLocaleString('ru')} ₽</span></div>`;
}


// ─── COPY TZ ───
function copyTZ() {
  const totalQty = getActiveTotalQty();
  const baseSizesT = SIZES.filter(s=>state.sizes[s]>0).map(s=>`${s} — ${state.sizes[s]} шт`);
  const custSizesT = (state.customSizes||[]).filter(c=>c.qty>0).map(c=>`${c.label} — ${c.qty} шт`);
  const sizeStr = [...baseSizesT,...custSizesT].join('\n');
  const colorEntry = findColorEntry(state.color);
  const text = `━━━━━━━━━━━━━━━━━━━━
✳ PINHEAD ORDER STUDIO
ТЗ #${state._editingOrderNumber || state._lastSavedOrderNum || generateId()}
━━━━━━━━━━━━━━━━━━━━

ИЗДЕЛИЕ
Тип: ${state.sku ? state.sku.name + ' [' + state.sku.article + ']' : TYPE_NAMES[state.type]}
Ткань: ${FABRIC_NAMES[state.fabric]}
Цвет: ${state.color}${colorEntry?' — '+colorEntry.name:''}
Тираж: ${totalQty} шт

РАЗМЕРЫ
${sizeStr||'—'}

ПЕЧАТЬ
Техника: ${TECH_NAMES[state.tech]}${(state.tech==='screen'||state.tech==='dtg')&&state.textileColor?' · '+(state.textileColor==='color'?'цветной':'белый')+' текстиль':''}
${state.zones.map(z=>{const zn={chest:'Грудь',back:'Спина','left-sleeve':'Лев. рукав','right-sleeve':'Прав. рукав'}[z];let det='';if(state.tech==='screen'){const p=getZonePrint(z);det=p.size+', '+(p.colors>=5?'5+':p.colors)+' цв.';}else if(state.tech==='dtg'){const p=getDtgZone(z);det=p.size+', полноцвет';}else if(state.tech==='embroidery'){const p=getEmbZone(z);det=({s:'S до 7см',m:'M до 12см',l:'L до 20см'})[p.area]+', '+(p.colors||3)+' цв. нити';}else if(state.tech==='dtf'){const p=getDtfZone(z);det=p.size+', неогр. цвета';}return '  '+zn+': '+det;}).join('\n')}
Зоны: ${state.zones.map(z=>ZONE_LABELS[z]).join(', ')}
Общий макет: ${document.getElementById('artworkLink')?.value || '—'}
${(()=>{const za=state.zoneArtworks||{};const entries=Object.entries(za).filter(([z])=>state.zones.includes(z)&&za[z]);if(!entries.length)return '';return 'Макеты по зонам:\n'+entries.map(([z,u])=>'  '+ZONE_LABELS[z]+': '+u).join('\n');})()}
ТЗ дизайнера: ${state.designNotes||'—'}

КЛИЕНТ
Имя: ${state.name||'—'}
Контакт: ${state.contact||'—'}
Email: ${state.email||'—'}
Дедлайн: ${state.deadline||'—'}
Адрес: ${state.address||'—'}

ОПЦИИ
Бирки: ${getLabelConfigPrice()>0?'Да (+'+getLabelConfigPrice()+'₽/шт)':'Нет'}
Упаковка: ${state.packOption?'Да':'Нет'}
Срочно: ${state.urgentOption?'Да':'Нет'}

ИТОГО: ${calcTotal().toLocaleString('ru')} ₽
━━━━━━━━━━━━━━━━━━━━`.trim();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = event.target;
      const prev = btn.textContent;
      btn.textContent = '✓ Скопировано!';
      setTimeout(() => btn.textContent = prev, 2000);
    }).catch(() => {});
  } else {
    // fallback для старых браузеров / file://
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    const btn = event.target;
    const prev = btn.textContent;
    btn.textContent = '✓ Скопировано!';
    setTimeout(() => btn.textContent = prev, 2000);
  }
}

function generateId() { return 'PH-'+Date.now().toString(36).toUpperCase(); }

function newOrder() { clearDraft(); location.reload(); }


// ─── PDF ───

function generatePDF() {
  var orderId = state._editingOrderNumber || state._lastSavedOrderNum || generateId();
  var now = new Date().toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric'});
  var deadline = state.deadline || '—';
  var totalQty = getActiveTotalQty();
  var total = calcTotal();
  var colorEntry = findColorEntry(state.color);
  var colorName = colorEntry ? colorEntry.name : (state.color || '—');
  var fabricName = getFabricLabel(state.fabric);
  var typeName = state.sku ? state.sku.name + ' [' + state.sku.article + ']' : (TYPE_NAMES[state.type] || state.type || '—');

  // ── Размеры ──
  var baseSizes = SIZES.filter(function(s){return state.sizes[s]>0});
  var custSizes = (state.customSizes||[]).filter(function(c){return c.qty>0});
  var sizeRows = '';
  var unitPrice = totalQty > 0 ? Math.round(total / totalQty) : 0;
  baseSizes.forEach(function(s) {
    var qty = state.sizes[s];
    sizeRows += '<tr><td>'+s+'</td><td>'+qty+' шт</td><td>'+unitPrice.toLocaleString("ru")+' ₽</td><td>'+(qty*unitPrice).toLocaleString("ru")+' ₽</td></tr>';
  });
  custSizes.forEach(function(c) {
    sizeRows += '<tr><td>'+c.label+'</td><td>'+c.qty+' шт</td><td>'+unitPrice.toLocaleString("ru")+' ₽</td><td>'+(c.qty*unitPrice).toLocaleString("ru")+' ₽</td></tr>';
  });

  // ── Зоны нанесения (per-zone техники) ──
  var zonesHtml = '';
  (state.zones||[]).forEach(function(z) {
    var zn = ZONE_NAMES[z] || z;
    var tech = (state.zoneTechs && state.zoneTechs[z]) ? state.zoneTechs[z] : (state.tech || 'screen');
    var techName = TECH_NAMES[tech] || tech;
    var det = '';
    var artLink = (state.zoneArtworks && state.zoneArtworks[z]) ? state.zoneArtworks[z] : '';
    if (tech==='screen'){var p=getZonePrint(z); var fx=(p.fx&&p.fx!=='none')?' · спецэффект':''; det=p.size+', '+(p.colors>=5?'5+':p.colors)+' цв.'+((p.textile&&p.textile!=='white')?' · цвет. текстиль':'')+fx;}
    else if (tech==='flex'){var p=state.flexZones&&state.flexZones[z]||{size:'A4',colors:1}; det=p.size+', '+p.colors+' цв.';}
    else if (tech==='dtg'){var p=getDtgZone(z); det=p.size+', полноцвет'+((p.textile&&p.textile!=='white')?' · цвет. текстиль':'');}
    else if (tech==='embroidery'){var p=getEmbZone(z); det=({s:'S до 7см',m:'M до 12см',l:'L до 20см'})[p.area]+', '+(p.colors||3)+' цв. нити';}
    else if (tech==='dtf'){var p=getDtfZone(z); det=p.size+', полноцвет';}
    zonesHtml += '<tr><td>'+zn+'</td><td>'+techName+'</td><td>'+det+'</td><td>'+(artLink||'—')+'</td></tr>';
  });

  // ── Обработки ──
  var extrasHtml = '';
  (state.extras||[]).forEach(function(code) {
    var ex = EXTRAS_CATALOG.find(function(e){return e.code===code});
    if (ex) extrasHtml += '<tr><td>'+ex.name+'</td><td>'+ex.price+' ₽/шт</td></tr>';
  });

  // ── Лейблы и бирки (v2) ──
  var labelsHtml = '';
  var lcfg = state.labelConfig || {};
  if (lcfg.careLabel && lcfg.careLabel.enabled) {
    var cOptName = {'my-logo':'Мой логотип','no-logo':'Без логотипа','standard':'Стандартный'}[lcfg.careLabel.logoOption] || '—';
    var cPrice = LABEL_CONFIG.careLabel.basePrice + (LABEL_CONFIG.careLabel.options.find(function(o){return o.key===lcfg.careLabel.logoOption})||{priceDelta:0}).priceDelta;
    labelsHtml += '<tr><td>Бирка по уходу</td><td>'+cOptName+'</td><td>'+cPrice+' ₽/шт</td></tr>';
    if (lcfg.careLabel.composition) labelsHtml += '<tr><td style="padding-left:16px;color:#777">Состав</td><td colspan="2">'+lcfg.careLabel.composition+'</td></tr>';
    if (lcfg.careLabel.country) labelsHtml += '<tr><td style="padding-left:16px;color:#777">Страна</td><td colspan="2">'+lcfg.careLabel.country+'</td></tr>';
    if (lcfg.careLabel.uploadData) labelsHtml += '<tr><td style="padding-left:16px;color:#777">Макет</td><td colspan="2">'+lcfg.careLabel.uploadData.name+'</td></tr>';
    if (lcfg.careLabel.comments) labelsHtml += '<tr><td style="padding-left:16px;color:#777">Комментарий</td><td colspan="2">'+lcfg.careLabel.comments+'</td></tr>';
  }
  if (lcfg.mainLabel && lcfg.mainLabel.option !== 'none') {
    var mOptName = {'send-own':'Клиент пришлёт','standard':'Стандартная','custom':'Кастомная'}[lcfg.mainLabel.option] || '—';
    var mOpt2 = LABEL_CONFIG.mainLabel.options.find(function(o){return o.key===lcfg.mainLabel.option});
    labelsHtml += '<tr><td>Основная бирка</td><td>'+mOptName+'</td><td>'+(mOpt2?mOpt2.price:0)+' ₽/шт</td></tr>';
    if (lcfg.mainLabel.option !== 'send-own') {
      var plcName = lcfg.mainLabel.placement === 'neck' ? 'На воротнике' : 'Петля вшивная';
      var matName2 = {'woven':'Тканая','polyester':'Полиэстер','canvas':'Хлопковый канвас'}[lcfg.mainLabel.material] || '—';
      var colName2 = lcfg.mainLabel.color === 'white' ? 'Белая' : 'Чёрная';
      labelsHtml += '<tr><td style="padding-left:16px;color:#777">Размещение</td><td colspan="2">'+plcName+'</td></tr>';
      labelsHtml += '<tr><td style="padding-left:16px;color:#777">Материал</td><td colspan="2">'+matName2+'</td></tr>';
      labelsHtml += '<tr><td style="padding-left:16px;color:#777">Цвет</td><td colspan="2">'+colName2+'</td></tr>';
      labelsHtml += '<tr><td style="padding-left:16px;color:#777">Размер</td><td colspan="2">'+LABEL_CONFIG.mainLabel.dimensions.width+'×'+LABEL_CONFIG.mainLabel.dimensions.height+' '+LABEL_CONFIG.mainLabel.dimensions.unit+'</td></tr>';
      if (lcfg.mainLabel.uploadData) labelsHtml += '<tr><td style="padding-left:16px;color:#777">Макет</td><td colspan="2">'+lcfg.mainLabel.uploadData.name+'</td></tr>';
    }
  }
  if (lcfg.hangTag && lcfg.hangTag.option !== 'none') {
    var hOptName = {'standard':'Стандартный','custom':'Кастомный'}[lcfg.hangTag.option] || '—';
    var hOpt2 = LABEL_CONFIG.hangTag.options.find(function(o){return o.key===lcfg.hangTag.option});
    labelsHtml += '<tr><td>Хэнг-тег</td><td>'+hOptName+'</td><td>'+(hOpt2?hOpt2.price:0)+' ₽/шт</td></tr>';
    if (lcfg.hangTag.uploadData) labelsHtml += '<tr><td style="padding-left:16px;color:#777">Макет</td><td colspan="2">'+lcfg.hangTag.uploadData.name+'</td></tr>';
    if (lcfg.hangTag.comments) labelsHtml += '<tr><td style="padding-left:16px;color:#777">Комментарий</td><td colspan="2">'+lcfg.hangTag.comments+'</td></tr>';
  }

  // ── Опции ──
  var optsArr = [];
  if (state.packOption) optsArr.push('Инд. упаковка');
  if (state.urgentOption) optsArr.push('Срочный заказ');
  if (state.noPrint) optsArr.push('Без нанесения');

  var css = '@import url("https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=Roboto+Condensed:wght@300;400;500;700&display=swap");'+
  '*{margin:0;padding:0;box-sizing:border-box}'+
  'body{font-family:"Roboto Condensed",Arial,sans-serif;padding:28mm 24mm;color:#000;font-size:10pt;background:#fff}'+
  '@media print{body{padding:12mm}.no-print{display:none!important}@page{size:A4;margin:12mm}}'+

  /* Header */
  '.hdr{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:12px;border-bottom:3px solid #000;margin-bottom:6px}'+
  '.logo{font-family:"Barlow Condensed",sans-serif;font-size:32pt;font-weight:900;letter-spacing:4px;line-height:1}'+
  '.logo-sub{font-family:"Barlow Condensed",sans-serif;font-size:9pt;font-weight:700;letter-spacing:3px;color:#888;text-transform:uppercase;margin-top:2px}'+
  '.ctn{font-size:8pt;color:#666;text-align:right;line-height:1.5}'+

  /* Title row */
  '.title-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0 16px;border-bottom:1.5px solid #000;margin-bottom:16px}'+
  '.title-row h1{font-family:"Barlow Condensed",sans-serif;font-size:20pt;font-weight:900;letter-spacing:2px;text-transform:uppercase;margin:0}'+
  '.onum{font-family:"Barlow Condensed",sans-serif;font-size:16pt;font-weight:900;color:#1D19EA}'+

  /* Sections */
  '.sec{margin-bottom:18px;page-break-inside:avoid}'+
  '.st{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #000}'+
  '.sn{font-family:"Barlow Condensed",sans-serif;width:24px;height:24px;border:2px solid #000;display:inline-flex;align-items:center;justify-content:center;font-size:9pt;font-weight:700;flex-shrink:0}'+
  '.st-text{font-family:"Barlow Condensed",sans-serif;font-size:12pt;font-weight:900;text-transform:uppercase;letter-spacing:2px}'+

  /* Field rows */
  '.fr{display:flex;margin-bottom:4px;min-height:22px}'+
  '.fl{width:140px;font-weight:700;color:#555;font-size:9pt;padding:3px 0;flex-shrink:0}'+
  '.fv{flex:1;font-size:9pt;padding:3px 8px;background:#f7f7f7;border-bottom:1px solid #eee}'+

  /* Tables */
  'table{width:100%;border-collapse:collapse;margin-bottom:8px}'+
  'td,th{border:1px solid #ddd;padding:6px 10px;font-size:9pt;text-align:left}'+
  'th{background:#000;color:#fff;font-family:"Barlow Condensed",sans-serif;font-size:9pt;font-weight:700;letter-spacing:1px;text-transform:uppercase}'+
  'tr:nth-child(even) td{background:#fafafa}'+
  'tr.total-row td{font-weight:700;background:#f0f0f0;border-top:2px solid #000}'+

  /* Tags */
  '.tag{display:inline-block;padding:4px 12px;font-family:"Barlow Condensed",sans-serif;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;border:1.5px solid #000;margin:3px 6px 3px 0}'+
  '.tag-active{background:#000;color:#fff}'+

  /* Total */
  '.tot{display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding:12px 16px;border:3px solid #000;background:#f7f7f7}'+
  '.tot-label{font-family:"Barlow Condensed",sans-serif;font-size:12pt;font-weight:900;text-transform:uppercase;letter-spacing:2px}'+
  '.tot-val{font-family:"Barlow Condensed",sans-serif;font-size:22pt;font-weight:900;color:#1D19EA}'+

  /* Actions */
  '.acts{position:fixed;top:0;left:0;right:0;display:flex;justify-content:center;gap:8px;padding:10px;background:#000;z-index:1000}'+
  '.acts button{padding:8px 24px;font-family:"Barlow Condensed",sans-serif;font-size:12pt;font-weight:700;letter-spacing:1px;text-transform:uppercase;border:2px solid #fff;cursor:pointer;transition:all .12s}'+
  '.bp{background:#1D19EA;color:#fff;border-color:#1D19EA}.bp:hover{background:#1510c0}'+
  '.bc{background:transparent;color:#fff;border-color:rgba(255,255,255,.4)}.bc:hover{border-color:#fff}'+

  /* Note & footer */
  '.note{font-size:8pt;color:#888;margin-top:3px}'+
  '.footer{margin-top:24px;padding-top:8px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:7pt;color:#aaa}';

  var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>ТЗ '+orderId+'</title><style>'+css+'</style></head><body>'+
  '<div class="acts no-print"><button class="bp" onclick="window.print()">ПЕЧАТЬ / PDF</button><button class="bc" onclick="window.close()">ЗАКРЫТЬ</button></div>'+

  // Шапка
  '<div class="hdr"><div><div class="logo">PINHEAD</div><div class="logo-sub">Order Studio</div></div><div class="ctn">PNHD.RU / HELLO@PNHD.RU<br>+7 (812) 407-27-14</div></div>'+
  '<div class="title-row"><h1>Техническое задание</h1><span class="onum">'+orderId+'</span></div>'+

  // 1. Изделие
  '<div class="sec"><div class="st"><span class="sn">01</span><span class="st-text">Изделие</span></div>'+
  '<div class="fr"><div class="fl">Тип</div><div class="fv">'+typeName+'</div></div>'+
  '<div class="fr"><div class="fl">Ткань</div><div class="fv">'+fabricName+'</div></div>'+
  '<div class="fr"><div class="fl">Цвет</div><div class="fv">'+colorName+'</div></div>'+
  '<div class="fr"><div class="fl">Дата</div><div class="fv">'+now+'</div></div>'+
  '<div class="fr"><div class="fl">Дедлайн</div><div class="fv">'+deadline+'</div></div>'+
  (state.sizeComment?'<div class="fr"><div class="fl">Комментарий</div><div class="fv">'+state.sizeComment+'</div></div>':'')+
  '</div>'+

  // 2. Размеры и тираж
  '<div class="sec"><div class="st"><span class="sn">02</span><span class="st-text">Размеры и тираж</span></div>'+
  '<table><tr><th>Размер</th><th>Кол-во</th><th>Цена/шт</th><th>Сумма</th></tr>'+sizeRows+
  '<tr class="total-row"><td>ИТОГО</td><td>'+totalQty+' шт</td><td></td><td>'+total.toLocaleString("ru")+' ₽</td></tr></table></div>'+

  // 3. Нанесение
  '<div class="sec"><div class="st"><span class="sn">03</span><span class="st-text">Нанесение</span></div>'+
  (state.noPrint?'<div class="fr"><div class="fv" style="text-align:center;font-weight:600">Без нанесения</div></div>':
    (zonesHtml?'<table><tr><th>Зона</th><th>Техника</th><th>Параметры</th><th>Макет</th></tr>'+zonesHtml+'</table>':'<div class="note">Зоны не выбраны</div>'))+
  (state.designNotes?'<div class="fr" style="margin-top:6px"><div class="fl">ТЗ дизайнера</div><div class="fv">'+state.designNotes+'</div></div>':'')+
  '</div>'+

  // 4. Обработки
  (extrasHtml?'<div class="sec"><div class="st"><span class="sn">04</span><span class="st-text">Обработки</span></div>'+
  '<table><tr><th>Обработка</th><th>Цена</th></tr>'+extrasHtml+'</table></div>':'')+

  // 5. Бирки и лейблы
  (labelsHtml?'<div class="sec"><div class="st"><span class="sn">05</span><span class="st-text">Бирки и лейблы</span></div>'+
  '<table><tr><th>Элемент</th><th>Опция</th><th>Цена</th></tr>'+labelsHtml+'</table>'+
  '</div>':'')+

  // 6. Опции
  '<div class="sec"><div class="st"><span class="sn">06</span><span class="st-text">Опции</span></div>'+
  (optsArr.length>0?optsArr.map(function(o){return '<span class="tag tag-active">'+o+'</span>'}).join(''):'<div class="note">Стандартные условия</div>')+
  '</div>'+

  // 7. Клиент
  '<div class="sec"><div class="st"><span class="sn">07</span><span class="st-text">Клиент</span></div>'+
  '<div class="fr"><div class="fl">Имя</div><div class="fv">'+(state.name||'—')+'</div></div>'+
  '<div class="fr"><div class="fl">Телефон</div><div class="fv">'+(state.contact||'—')+'</div></div>'+
  '<div class="fr"><div class="fl">Email</div><div class="fv">'+(state.email||'—')+'</div></div>'+
  (state.messenger?'<div class="fr"><div class="fl">Мессенджер</div><div class="fv">@'+state.messenger+'</div></div>':'')+
  (state.address?'<div class="fr"><div class="fl">Адрес</div><div class="fv">'+state.address+'</div></div>':'')+
  (state.notes?'<div class="fr"><div class="fl">Примечания</div><div class="fv">'+state.notes+'</div></div>':'')+
  '</div>'+

  // Итого
  '<div class="tot"><span class="tot-label">Итого</span><span class="tot-val">'+total.toLocaleString("ru")+' ₽</span></div>'+

  // Footer
  '<div class="footer no-print"><span>PINHEAD ORDER STUDIO v1.7</span><span>Сформировано: '+now+'</span></div>'+
  '</body></html>';

  var win = window.open('', '_blank');
  if (win) { win.document.write(h); win.document.close(); showToast('ТЗ открыто — нажмите Печать / PDF'); }
  else { showToast('Разрешите всплывающие окна'); }
}




// ─── UPLOAD ───
// ─── ZONE FILE UPLOAD ───
function handleZoneUpload(zone, input) {
  if (input.files[0]) {
    if (!state.zoneFiles) state.zoneFiles = {};
    state.zoneFiles[zone] = input.files[0].name;
    renderZoneTechBlocks();
    scheduleSave();
  }
}
function removeZoneFile(zone) {
  if (state.zoneFiles) delete state.zoneFiles[zone];
  renderZoneTechBlocks();
  scheduleSave();
}

function setZoneArtwork(zone, url) {
  if (!state.zoneArtworks) state.zoneArtworks = {};
  state.zoneArtworks[zone] = url.trim();
  scheduleSave();
}

// ─── GENERAL FILE UPLOAD ───
function handleGeneralUpload(input) {
  if (input.files[0]) {
    state.generalFile = input.files[0].name;
    // legacy compat
    state.file = state.generalFile;
    const textEl = document.getElementById('generalUploadText');
    const infoEl = document.getElementById('generalFileInfo');
    if (textEl) textEl.textContent = '✓ Файл загружен';
    if (infoEl) infoEl.innerHTML = `<div class="general-upload-file">
      <span class="general-upload-filename">${state.generalFile}</span>
      <button class="zone-upload-remove" title="Удалить" onclick="event.stopPropagation();removeGeneralFile()" style="margin-left:4px">✕</button>
    </div>`;
    scheduleSave();
  }
}
function removeGeneralFile() {
  state.generalFile = null;
  state.file = null;
  const textEl = document.getElementById('generalUploadText');
  const infoEl = document.getElementById('generalFileInfo');
  if (textEl) textEl.textContent = 'Загрузить общий макет';
  if (infoEl) infoEl.innerHTML = '';
  scheduleSave();
}

// legacy alias
function handleUpload(input) { handleGeneralUpload(input); }




