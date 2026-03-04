import { useStore } from '../../store/useStore';
import { LABEL_CONFIG } from '../../data/extras';

// SVG иконки для размещения бирки
const NeckSvg = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 14c0-6 4-10 8-10s8 4 8 10" />
    <rect x="13" y="10" width="6" height="8" rx="1" fill="var(--bg3)" stroke="currentColor" />
    <path d="M4 28c0-6 4-10 12-10s12 4 12 10" strokeDasharray="3 2" />
  </svg>
);

const InseamSvg = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6 4v24M26 4v24" />
    <rect x="9" y="10" width="6" height="8" rx="1" fill="var(--bg3)" stroke="currentColor" />
    <path d="M6 14h3M15 14h11" strokeDasharray="3 2" />
  </svg>
);

export default function LabelConfigurator() {
  const { labelConfig, setLabelConfig, toggleCareLabel } = useStore();
  const { careLabel, mainLabel, hangTag } = labelConfig;

  return (
    <div className="label-configurator">
      {/* ── Бирка по уходу ── */}
      <div className="label-section">
        <div className="label-section-header" onClick={toggleCareLabel}>
          <div className="label-section-toggle">
            <span className={`label-toggle-check${careLabel.enabled ? ' active' : ''}`}>
              {careLabel.enabled ? '✓' : ''}
            </span>
            <span className="label-section-name">{LABEL_CONFIG.careLabel.name}</span>
          </div>
          <span className="label-section-price">
            {careLabel.enabled ? `+${LABEL_CONFIG.careLabel.basePrice + (LABEL_CONFIG.careLabel.options.find(o => o.key === careLabel.logoOption)?.priceDelta || 0)} ₽/шт` : ''}
          </span>
        </div>

        {careLabel.enabled && (
          <div className="label-section-body">
            <div className="label-options-row">
              {LABEL_CONFIG.careLabel.options.map(opt => (
                <button
                  key={opt.key}
                  className={`label-option-pill${careLabel.logoOption === opt.key ? ' active' : ''}`}
                  onClick={() => setLabelConfig('careLabel', 'logoOption', opt.key)}
                >
                  {opt.name}
                  {opt.priceDelta > 0 && <span className="pill-price">+{opt.priceDelta}₽</span>}
                </button>
              ))}
            </div>

            <div className="label-fields">
              <div className="label-field">
                <label>Состав ткани</label>
                <input
                  type="text"
                  placeholder="напр. 100% хлопок"
                  value={careLabel.composition}
                  onChange={e => setLabelConfig('careLabel', 'composition', e.target.value)}
                />
              </div>
              <div className="label-field">
                <label>Страна производства</label>
                <input
                  type="text"
                  placeholder="напр. Россия"
                  value={careLabel.country}
                  onChange={e => setLabelConfig('careLabel', 'country', e.target.value)}
                />
              </div>
            </div>

            <div className="label-field full">
              <label>Комментарий</label>
              <textarea
                placeholder="Дополнительные пожелания..."
                value={careLabel.comments}
                onChange={e => setLabelConfig('careLabel', 'comments', e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Основная бирка (Нашивка) ── */}
      <div className="label-section">
        <div className="label-section-header">
          <span className="label-section-name">{LABEL_CONFIG.mainLabel.name}</span>
          <span className="label-section-price">
            {mainLabel.option !== 'none'
              ? `+${LABEL_CONFIG.mainLabel.options.find(o => o.key === mainLabel.option)?.price || 0} ₽/шт`
              : ''}
          </span>
        </div>

        <div className="label-section-body">
          <div className="label-options-row">
            {LABEL_CONFIG.mainLabel.options.map(opt => (
              <button
                key={opt.key}
                className={`label-option-pill${mainLabel.option === opt.key ? ' active' : ''}`}
                onClick={() => setLabelConfig('mainLabel', 'option', opt.key)}
              >
                {opt.name}
                {opt.price > 0 && <span className="pill-price">{opt.price}₽</span>}
              </button>
            ))}
          </div>

          {mainLabel.option !== 'none' && mainLabel.option !== 'send-own' && (
            <>
              <div className="label-param-row">
                <span className="label-param-label">Размещение</span>
                <div className="label-placement-btns">
                  {LABEL_CONFIG.mainLabel.placements.map(p => (
                    <button
                      key={p.key}
                      className={`label-placement-btn${mainLabel.placement === p.key ? ' active' : ''}`}
                      onClick={() => setLabelConfig('mainLabel', 'placement', p.key)}
                    >
                      {p.key === 'neck' ? <NeckSvg /> : <InseamSvg />}
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="label-param-row">
                <span className="label-param-label">Материал</span>
                <div className="label-options-row">
                  {LABEL_CONFIG.mainLabel.materials.map(m => (
                    <button
                      key={m.key}
                      className={`label-option-pill${mainLabel.material === m.key ? ' active' : ''}`}
                      onClick={() => setLabelConfig('mainLabel', 'material', m.key)}
                    >
                      {m.name}
                      {m.priceDelta !== 0 && (
                        <span className="pill-price">{m.priceDelta > 0 ? '+' : ''}{m.priceDelta}₽</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="label-param-row">
                <span className="label-param-label">Цвет</span>
                <div className="label-color-btns">
                  {LABEL_CONFIG.mainLabel.colors.map(c => (
                    <button
                      key={c.key}
                      className={`label-color-btn${mainLabel.color === c.key ? ' active' : ''}`}
                      onClick={() => setLabelConfig('mainLabel', 'color', c.key)}
                    >
                      <span className="label-color-swatch" style={{ background: c.hex }} />
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="label-field full">
            <label>Комментарий</label>
            <textarea
              placeholder="Дополнительные пожелания..."
              value={mainLabel.comments}
              onChange={e => setLabelConfig('mainLabel', 'comments', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Хэнг-тег ── */}
      <div className="label-section">
        <div className="label-section-header">
          <span className="label-section-name">{LABEL_CONFIG.hangTag.name}</span>
          <span className="label-section-price">
            {hangTag.option !== 'none'
              ? `+${LABEL_CONFIG.hangTag.options.find(o => o.key === hangTag.option)?.price || 0} ₽/шт`
              : ''}
          </span>
        </div>

        <div className="label-section-body">
          <div className="label-options-row">
            {LABEL_CONFIG.hangTag.options.map(opt => (
              <button
                key={opt.key}
                className={`label-option-pill${hangTag.option === opt.key ? ' active' : ''}`}
                onClick={() => setLabelConfig('hangTag', 'option', opt.key)}
              >
                {opt.name}
                {opt.price > 0 && <span className="pill-price">{opt.price}₽</span>}
              </button>
            ))}
          </div>

          {hangTag.option !== 'none' && (
            <div className="label-field full">
              <label>Комментарий</label>
              <textarea
                placeholder="Дополнительные пожелания..."
                value={hangTag.comments}
                onChange={e => setLabelConfig('hangTag', 'comments', e.target.value)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
