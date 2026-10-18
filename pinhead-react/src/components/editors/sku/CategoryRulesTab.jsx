import { useState } from 'react';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { SIZES } from '../../../data/constants';
import { getAvailableZonesForSku } from '../../../utils/skuRules';
import { TECH_TABS } from '../../../utils/pricing';
import { Icon } from '../../../erp/components/Icon';
import ScrollTable from './ScrollTable';
import t from './skuTable.module.css';
import r from './CategoryRules.module.css';

/** Вкладка «Правила категорий»: техники, техники по зонам, MOQ, размеры, обработки по умолчанию */
export default function CategoryRulesTab({ categoryRules, extrasCatalog, zonesCatalog, onUpdate, readOnly = false }) {
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
    const current = rule.allowedTechs || TECH_TABS.map(t => t.key);
    const next = current.includes(techKey)
      ? current.filter(t => t !== techKey)
      : [...current, techKey];
    updateRule(catId, 'allowedTechs', next.length === TECH_TABS.length ? undefined : next);
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
    const current = zoneTechs[zoneId] || TECH_TABS.map(t => t.key);
    const next = current.includes(techKey)
      ? current.filter(t => t !== techKey)
      : [...current, techKey];
    const isAllTechs = next.length === TECH_TABS.length;
    const updated = { ...zoneTechs };
    if (isAllTechs) {
      delete updated[zoneId];
    } else {
      updated[zoneId] = next;
    }
    updateRule(catId, 'allowedZoneTechs', Object.keys(updated).length > 0 ? updated : undefined);
  };

  return (
    <div className={r.root}>
      <p className={r.hint}>
        Ограничения и умолчания для каждой категории. Не заданное правило — ограничений нет.
      </p>

      <ul className={r.list}>
        {SKU_CATEGORIES.map(cat => {
          const rule = getRuleForCategory(cat.id);
          const isExpanded = expanded === cat.id;
          const hasTechRestriction = rule.allowedTechs && rule.allowedTechs.length < TECH_TABS.length;
          const hasExtras = rule.defaultExtras?.length > 0;
          const hasMoq = rule.moq && rule.moq > 1;
          const hasSizeRestriction = rule.availableSizes && rule.availableSizes.length < SIZES.length;
          const hasZoneTechs = rule.allowedZoneTechs && Object.keys(rule.allowedZoneTechs).length > 0;
          const hasRules = hasTechRestriction || hasExtras || hasMoq || hasSizeRestriction || hasZoneTechs;
          const bodyId = `cat-rule-${cat.id}`;

          return (
            <li key={cat.id} className={r.card} data-expanded={isExpanded || undefined}>
              <button
                type="button"
                className={r.header}
                aria-expanded={isExpanded}
                aria-controls={bodyId}
                onClick={() => setExpanded(isExpanded ? null : cat.id)}
              >
                <span className={r.name}>{cat.name}</span>
                <span className={r.badges}>
                  {hasTechRestriction && <span className={r.badge}>техники: {rule.allowedTechs.length}/{TECH_TABS.length}</span>}
                  {hasMoq && <span className={r.badge}>MOQ: {rule.moq}</span>}
                  {hasSizeRestriction && <span className={r.badge}>размеры: {rule.availableSizes.length}/{SIZES.length}</span>}
                  {hasExtras && <span className={r.badge}>обработки: {rule.defaultExtras.length}</span>}
                  {hasZoneTechs && <span className={r.badge}>зоны: {Object.keys(rule.allowedZoneTechs).length}</span>}
                  {!hasRules && <span className={r.badgeNone}>без ограничений</span>}
                </span>
                <Icon name={isExpanded ? 'chevronUp' : 'chevronDown'} size={16} />
              </button>

              {isExpanded && (
                <div id={bodyId} className={r.body}>
                  <div className={r.section}>
                    <h3 className={r.sectionTitle}>Техники нанесения</h3>
                    <div className={t.chips} role="group" aria-label={`Техники нанесения: ${cat.name}`}>
                      {TECH_TABS.map(tt => (
                        <button key={tt.key} type="button" className={t.chip} disabled={readOnly}
                          aria-pressed={!rule.allowedTechs || rule.allowedTechs.includes(tt.key)}
                          onClick={() => toggleTech(cat.id, tt.key)}>
                          {tt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={r.section}>
                    <h3 className={r.sectionTitle}>Техники по зонам</h3>
                    <ScrollTable className={r.scroll} label={`Техники по зонам: ${cat.name}`} readOnly={readOnly}>
                      <table className={r.matrix} aria-label={`Техники по зонам: ${cat.name}`}>
                        <thead>
                          <tr>
                            <th scope="col">Зона</th>
                            {TECH_TABS.map(tt => <th key={tt.key} scope="col">{tt.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {getAvailableZonesForSku(zonesCatalog, cat.id).map(z => {
                            const zoneTechs = rule.allowedZoneTechs?.[z.id];
                            return (
                              <tr key={z.id}>
                                <th scope="row">{z.name}</th>
                                {TECH_TABS.map(tt => (
                                  <td key={tt.key}>
                                    <input
                                      type="checkbox"
                                      aria-label={`${z.name}: ${tt.label}`}
                                      checked={!zoneTechs || zoneTechs.includes(tt.key)}
                                      onChange={() => toggleZoneTech(cat.id, z.id, tt.key)}
                                    />
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </ScrollTable>
                  </div>

                  <div className={r.section}>
                    <label htmlFor={`${bodyId}-moq`} className={r.sectionTitle}>Минимальный тираж (MOQ)</label>
                    <input
                      id={`${bodyId}-moq`}
                      type="number"
                      className={r.moq}
                      disabled={readOnly}
                      min="1"
                      value={rule.moq || 1}
                      onChange={e => setMoq(cat.id, e.target.value)}
                    />
                  </div>

                  <div className={r.section}>
                    <h3 className={r.sectionTitle}>Доступные размеры</h3>
                    <div className={r.checks} role="group" aria-label={`Доступные размеры: ${cat.name}`}>
                      {SIZES.map(s => (
                        <label key={s} className={r.check}>
                          <input type="checkbox" disabled={readOnly} checked={!rule.availableSizes || rule.availableSizes.includes(s)}
                            onChange={() => toggleSize(cat.id, s)} />
                          <span>{s}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className={r.section}>
                    <h3 className={r.sectionTitle}>Обработки по умолчанию</h3>
                    <div className={r.checks} role="group" aria-label={`Обработки по умолчанию: ${cat.name}`}>
                      {(extrasCatalog || []).map(e => (
                        <label key={e.code} className={r.check}>
                          <input type="checkbox" disabled={readOnly} checked={(rule.defaultExtras || []).includes(e.code)}
                            onChange={() => toggleDefaultExtra(cat.id, e.code)} />
                          <span>{e.name}</span>
                        </label>
                      ))}
                      {(!extrasCatalog || extrasCatalog.length === 0) && (
                        <span className={r.hint}>Нет обработок в каталоге</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
