import { useState } from 'react';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { SIZES, ZONE_LABELS } from '../../../data/constants';

const TECHS = [
  { key: 'screen', label: 'Шелкография' },
  { key: 'flex', label: 'Flex' },
  { key: 'dtg', label: 'DTG' },
  { key: 'embroidery', label: 'Вышивка' },
  { key: 'dtf', label: 'DTF' },
];

const ALL_ZONES = [
  { id: 'front', name: 'Грудь' },
  { id: 'back', name: 'Спина' },
  { id: 'sleeve-l', name: 'Лев. рукав' },
  { id: 'sleeve-r', name: 'Прав. рукав' },
  { id: 'hood', name: 'Капюшон' },
  { id: 'pocket', name: 'Карман' },
];

export default function CategoryRulesTab({ categoryRules, extrasCatalog, onUpdate }) {
  const [expanded, setExpanded] = useState(null);

  const getRuleForCategory = (catId) =>
    categoryRules.find(r => r.categoryId === catId) || { categoryId: catId };

  const updateRule = (catId, field, value) => {
    const existing = categoryRules.find(r => r.categoryId === catId);
    const updated = existing
      ? categoryRules.map(r => r.categoryId === catId ? { ...r, [field]: value } : r)
      : [...categoryRules, { categoryId: catId, [field]: value }];
    onUpdate(updated);
  };

  const toggleTech = (catId, techKey) => {
    const rule = getRuleForCategory(catId);
    const current = rule.allowedTechs || TECHS.map(t => t.key);
    const next = current.includes(techKey)
      ? current.filter(t => t !== techKey)
      : [...current, techKey];
    updateRule(catId, 'allowedTechs', next.length === TECHS.length ? undefined : next);
  };

  const toggleDefaultExtra = (catId, extraCode) => {
    const rule = getRuleForCategory(catId);
    const current = rule.defaultExtras || [];
    const next = current.includes(extraCode)
      ? current.filter(c => c !== extraCode)
      : [...current, extraCode];
    updateRule(catId, 'defaultExtras', next);
  };

  const toggleSize = (catId, size) => {
    const rule = getRuleForCategory(catId);
    const current = rule.availableSizes || [...SIZES];
    const next = current.includes(size)
      ? current.filter(s => s !== size)
      : [...current, size];
    updateRule(catId, 'availableSizes', next.length === SIZES.length ? undefined : next);
  };

  const setMoq = (catId, value) => {
    const num = Math.max(1, Number(value) || 1);
    updateRule(catId, 'moq', num === 1 ? undefined : num);
  };

  const toggleZoneTech = (catId, zoneId, techKey) => {
    const rule = getRuleForCategory(catId);
    const zoneTechs = rule.allowedZoneTechs || {};
    const current = zoneTechs[zoneId] || TECHS.map(t => t.key);
    const next = current.includes(techKey)
      ? current.filter(t => t !== techKey)
      : [...current, techKey];
    const isAllTechs = next.length === TECHS.length;
    const updated = { ...zoneTechs };
    if (isAllTechs) {
      delete updated[zoneId];
    } else {
      updated[zoneId] = next;
    }
    updateRule(catId, 'allowedZoneTechs', Object.keys(updated).length > 0 ? updated : undefined);
  };

  return (
    <div className="cat-rules-tab">
      <div className="cat-rules-hint">
        Настройте ограничения и умолчания для каждой категории. Не заданные правила = нет ограничений.
      </div>

      <div className="cat-rules-list">
        {SKU_CATEGORIES.map(cat => {
          const rule = getRuleForCategory(cat.id);
          const isExpanded = expanded === cat.id;
          const hasTechRestriction = rule.allowedTechs && rule.allowedTechs.length < TECHS.length;
          const hasExtras = rule.defaultExtras?.length > 0;
          const hasMoq = rule.moq && rule.moq > 1;
          const hasSizeRestriction = rule.availableSizes && rule.availableSizes.length < SIZES.length;
          const hasZoneTechs = rule.allowedZoneTechs && Object.keys(rule.allowedZoneTechs).length > 0;
          const hasRules = hasTechRestriction || hasExtras || hasMoq || hasSizeRestriction || hasZoneTechs;

          return (
            <div key={cat.id} className={`cat-rule-card${isExpanded ? ' expanded' : ''}`}>
              {/* Header row — always visible */}
              <button
                className="cat-rule-header"
                onClick={() => setExpanded(isExpanded ? null : cat.id)}
              >
                <span className="cat-rule-name">{cat.name}</span>
                <span className="cat-rule-badges">
                  {hasTechRestriction && <span className="cat-rule-badge">техники: {rule.allowedTechs.length}/{TECHS.length}</span>}
                  {hasMoq && <span className="cat-rule-badge">MOQ: {rule.moq}</span>}
                  {hasSizeRestriction && <span className="cat-rule-badge">размеры: {rule.availableSizes.length}/{SIZES.length}</span>}
                  {hasExtras && <span className="cat-rule-badge">обработки: {rule.defaultExtras.length}</span>}
                  {hasZoneTechs && <span className="cat-rule-badge">зоны: {Object.keys(rule.allowedZoneTechs).length}</span>}
                  {!hasRules && <span className="cat-rule-badge cat-rule-badge-none">без ограничений</span>}
                </span>
                <span className="cat-rule-chevron">{isExpanded ? '▲' : '▼'}</span>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="cat-rule-body">
                  {/* Techs */}
                  <div className="cat-rule-section">
                    <div className="cat-rule-section-label">ТЕХНИКИ НАНЕСЕНИЯ</div>
                    <div className="cat-rule-chips">
                      {TECHS.map(t => {
                        const allowed = !rule.allowedTechs || rule.allowedTechs.includes(t.key);
                        return (
                          <button
                            key={t.key}
                            className={`cat-rule-chip${allowed ? ' active' : ''}`}
                            onClick={() => toggleTech(cat.id, t.key)}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Zone-Tech matrix */}
                  <div className="cat-rule-section">
                    <div className="cat-rule-section-label">ТЕХНИКИ ПО ЗОНАМ</div>
                    <table className="zone-tech-matrix">
                      <thead>
                        <tr>
                          <th>Зона</th>
                          {TECHS.map(t => <th key={t.key}>{t.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {ALL_ZONES.map(z => {
                          const zoneTechs = rule.allowedZoneTechs?.[z.id];
                          return (
                            <tr key={z.id}>
                              <td>{z.name}</td>
                              {TECHS.map(t => {
                                const checked = !zoneTechs || zoneTechs.includes(t.key);
                                return (
                                  <td key={t.key}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleZoneTech(cat.id, z.id, t.key)}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* MOQ */}
                  <div className="cat-rule-section">
                    <div className="cat-rule-section-label">МИНИМАЛЬНЫЙ ТИРАЖ (MOQ)</div>
                    <input
                      type="number"
                      className="cat-rule-moq-input"
                      min="1"
                      value={rule.moq || 1}
                      onChange={e => setMoq(cat.id, e.target.value)}
                    />
                  </div>

                  {/* Sizes */}
                  <div className="cat-rule-section">
                    <div className="cat-rule-section-label">ДОСТУПНЫЕ РАЗМЕРЫ</div>
                    <div className="cat-rule-sizes">
                      {SIZES.map(s => {
                        const available = !rule.availableSizes || rule.availableSizes.includes(s);
                        return (
                          <label key={s} className={`cat-rule-size${available ? ' active' : ''}`}>
                            <input
                              type="checkbox"
                              checked={available}
                              onChange={() => toggleSize(cat.id, s)}
                            />
                            <span>{s}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Default extras */}
                  <div className="cat-rule-section">
                    <div className="cat-rule-section-label">ОБРАБОТКИ ПО УМОЛЧАНИЮ</div>
                    <div className="cat-rule-extras">
                      {(extrasCatalog || []).map(e => {
                        const selected = (rule.defaultExtras || []).includes(e.code);
                        return (
                          <label key={e.code} className={`cat-rule-extra${selected ? ' active' : ''}`}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleDefaultExtra(cat.id, e.code)}
                            />
                            <span>{e.name}</span>
                          </label>
                        );
                      })}
                      {(!extrasCatalog || extrasCatalog.length === 0) && (
                        <span className="cat-rule-empty">Нет обработок в каталоге</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
