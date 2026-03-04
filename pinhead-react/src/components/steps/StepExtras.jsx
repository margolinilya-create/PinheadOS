import { useStore } from '../../store/useStore';
import { EXTRAS_ICONS, EXTRAS_DESCS } from '../../data';

export default function StepExtras() {
  const { sku, extras, extrasCatalog, toggleExtra, nextStep, prevStep } = useStore();

  const available = sku
    ? extrasCatalog.filter(e => !e.forCategories?.length || e.forCategories.includes(sku.category))
    : [];

  const totalCost = extras.reduce((s, code) => {
    const e = extrasCatalog.find(x => x.code === code);
    return s + (e ? e.price : 0);
  }, 0);

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 02 — Обработки</div>
        <h1 className="step-header-title">ОБРАБОТКИ</h1>
        <p className="step-header-desc">Выберите дополнительные обработки изделия</p>
      </div>
      <div className="section-label">Обработки{totalCost > 0 && <span className="section-badge">+{totalCost} ₽/шт</span>}</div>

      {!sku && (
        <div className="empty-state">Сначала выберите изделие на предыдущем шаге</div>
      )}

      {sku && available.length === 0 && (
        <div className="empty-state">Для «{sku.name}» нет доступных обработок — можно пропустить</div>
      )}

      {available.length > 0 && (
        <div className="extras-grid">
          {available.map(e => {
            const sel = extras.includes(e.code);
            return (
              <div key={e.code} className={`extra-card${sel ? ' selected' : ''}`} onClick={() => toggleExtra(e.code)}>
                <div className="extra-check">{sel && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}</div>
                {EXTRAS_ICONS[e.code] && <div className="extra-icon" dangerouslySetInnerHTML={{ __html: EXTRAS_ICONS[e.code] }} />}
                <div className="extra-name">{e.name}</div>
                {EXTRAS_DESCS[e.code] && <div className="extra-desc">{EXTRAS_DESCS[e.code]}</div>}
                <span className="extra-price">+{e.price} ₽</span>
              </div>
            );
          })}
        </div>
      )}

      {extras.length > 0 && (
        <div className="extras-summary">
          <div className="extras-summary-left">Выбрано: <b>{extras.length}</b></div>
          <div className="extras-summary-right">+{totalCost.toLocaleString('ru-RU')} ₽ <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>/ шт</span></div>
        </div>
      )}

      <div className="btn-row">
        <button className="btn-prev" onClick={prevStep}>← Назад</button>
        <button className="btn-next" onClick={nextStep}>Далее — Дизайн →</button>
      </div>
    </div>
  );
}
