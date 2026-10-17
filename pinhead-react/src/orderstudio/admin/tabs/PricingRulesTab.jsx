import { useCatalogEditor } from '../useCatalogEditor';
import CatalogNotice from '../CatalogNotice';
import SaveBar from './SaveBar';
import {
  marginOf, marginError, prepOf, prepError, withPrep, parseNumberInput, canEdit,
} from './rulesForm';
import { SALES_PRINT_METHODS } from '../../model/types';
import { METHOD_LABELS } from '../../screens/labels';
import base from '../../screens/Sales.module.css';
import styles from './RulesTabs.module.css';

const NAME = 'Правила цены';

/**
 * Вкладка «Правила цены» (веха 4, задача 5): порог маржи (`minMarginPct`,
 * процент; пусто — не предупреждать) и подготовка по технике нанесения
 * (`prepFees`, ₽ на заказ; пусто — 0). Пишутся ключи прайса через
 * `prices_patch`; расчёт заказа читает их в `rulesFromPrices`.
 */
export default function PricingRulesTab({ readOnly }) {
  const editor = useCatalogEditor('app_config', 'prices');
  const editable = canEdit(editor, readOnly);
  const margin = marginOf(editor.value);
  const prep = prepOf(editor.value);
  const mErr = marginError(margin);
  const pErr = Object.fromEntries(SALES_PRINT_METHODS.map((m) => [m, prepError(prep[m])]));
  const invalid = mErr !== '' || Object.values(pErr).some(Boolean);

  const setMargin = (raw) => {
    const v = parseNumberInput(raw);
    editor.setValue((prev) => ({ ...prev, minMarginPct: v === '' ? null : v }));
  };
  const setPrep = (m, raw) => {
    const v = parseNumberInput(raw);
    editor.setValue((prev) => ({ ...prev, prepFees: withPrep(prev, m, v) }));
  };

  return (
    <section className={base.panel} aria-labelledby="pricing-rules-head">
      <h2 id="pricing-rules-head" className={base.panelTitle}>Правила цены</h2>
      <CatalogNotice editor={editor} name={NAME} />
      {editor.state !== 'loading' && (
        <fieldset className={styles.fieldset} disabled={!editable}>
          <legend className={styles.srOnly}>Правила цены</legend>
          <h3 className={base.sectionTitle}>Маржа</h3>
          <label className={`${base.field} ${styles.marginField}`}>
            Предупреждать, если маржа ниже, %
            <input
              className={base.input}
              type="number"
              min="0"
              max="100"
              step="0.1"
              inputMode="decimal"
              value={margin}
              placeholder="не предупреждать"
              aria-invalid={mErr ? 'true' : undefined}
              aria-describedby={mErr ? 'margin-error margin-hint' : 'margin-hint'}
              onChange={(e) => setMargin(e.target.value)}
            />
          </label>
          <p id="margin-hint" className={styles.hint}>
            Пусто — не предупреждать. Порог сравнивается с маржой заказа после скидки.
          </p>
          {mErr && <p id="margin-error" className={styles.error}>{mErr}</p>}

          <h3 className={base.sectionTitle}>Подготовка, ₽ на заказ</h3>
          <p className={styles.intro}>
            Формы, программа вышивки и прочая подготовка — одна сумма на заказ за каждую
            технику нанесения, которая в нём есть. Пусто — 0 ₽.
          </p>
          <div className={base.grid2}>
            {SALES_PRINT_METHODS.map((m) => (
              <div key={m}>
                <label className={base.field}>
                  {METHOD_LABELS[m]}
                  <input
                    className={base.input}
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={prep[m] ?? ''}
                    placeholder="0"
                    aria-invalid={pErr[m] ? 'true' : undefined}
                    aria-describedby={pErr[m] ? `prep-${m}-error` : undefined}
                    onChange={(e) => setPrep(m, e.target.value)}
                  />
                </label>
                {pErr[m] && <p id={`prep-${m}-error`} className={styles.error}>{pErr[m]}</p>}
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <SaveBar
        editor={editor}
        label="Сохранить правила цены"
        done="Правила цены сохранены"
        invalid={invalid}
        readOnly={readOnly}
      />
    </section>
  );
}
