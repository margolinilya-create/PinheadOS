import { useCatalogEditor } from '../useCatalogEditor';
import CatalogNotice from '../CatalogNotice';
import SaveBar from './SaveBar';
import { packRows, packRowError, packInvalid, parseNumberInput, canEdit } from './rulesForm';
import { PACK_OPTIONS_SEED } from '../../catalog/seeds';
import base from '../../screens/Sales.module.css';
import styles from './RulesTabs.module.css';

const NAME = 'Упаковка';

/** Вид — неизменное имя строки (подпись правится, вид — нет) */
const KIND = Object.fromEntries(PACK_OPTIONS_SEED.map((o) => [o.key, o.name]));

/**
 * Вкладка «Упаковка» (веха 4, задача 5): подпись и цена за штуку четырёх
 * видов упаковки (ключи CHECK ERP: none/bopp/zip/other — набор не меняется,
 * виды не добавляются и не удаляются). Пишется ключ прайса `packOptions`
 * (`prices_patch`); подпись отсюда видят выбор упаковки в заказе и сводка,
 * цена идёт в расчёт позиции.
 */
export default function PackagingTab({ readOnly }) {
  const editor = useCatalogEditor('app_config', 'prices');
  const rows = packRows(editor.value);
  const editable = canEdit(editor, readOnly);

  const update = (key, patch) => editor.setValue((prev) => ({
    ...prev,
    packOptions: packRows(prev).map((r) => (r.key === key ? { ...r, ...patch } : r)),
  }));

  return (
    <section className={base.panel} aria-labelledby="packaging-head">
      <h2 id="packaging-head" className={base.panelTitle}>Упаковка</h2>
      <CatalogNotice editor={editor} name={NAME} />
      <p className={styles.intro}>
        Подпись видит менеджер в заказе, цена за штуку входит в цену позиции. Виды упаковки
        совпадают с производством — их набор не меняется. «Другая» — по договорённости,
        её описывают в требованиях к заказу.
      </p>
      {editor.state !== 'loading' && (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Вид</th>
                <th scope="col">Подпись в заказе</th>
                <th scope="col" className={styles.priceCell}>Цена, ₽ за штуку</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const err = packRowError(r);
                const errId = `pack-${r.key}-error`;
                const badName = r.name.trim() === '';
                const badPrice = !badName && err !== '';
                return (
                  <tr key={r.key}>
                    <th scope="row">
                      {KIND[r.key]}
                      <span className={styles.code}>код в производстве: {r.key}</span>
                    </th>
                    <td>
                      <input
                        className={base.input}
                        value={r.name}
                        aria-label={`Подпись: ${KIND[r.key]}`}
                        aria-invalid={badName ? 'true' : undefined}
                        aria-describedby={err ? errId : undefined}
                        disabled={!editable}
                        maxLength={120}
                        onChange={(e) => update(r.key, { name: e.target.value })}
                      />
                      {err && <p id={errId} className={styles.error}>{err}</p>}
                    </td>
                    <td className={styles.priceCell}>
                      <input
                        className={base.input}
                        type="number"
                        min="0"
                        step="1"
                        inputMode="decimal"
                        value={r.price}
                        aria-label={`Цена: ${KIND[r.key]}, ₽ за штуку`}
                        aria-invalid={badPrice ? 'true' : undefined}
                        aria-describedby={badPrice ? errId : undefined}
                        disabled={!editable}
                        onChange={(e) => update(r.key, { price: parseNumberInput(e.target.value) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <SaveBar
        editor={editor}
        label="Сохранить упаковку"
        done="Упаковка сохранена"
        invalid={packInvalid(rows)}
        readOnly={readOnly}
      />
    </section>
  );
}
