import { Link } from 'react-router-dom';
import { gridQty } from '../model/factory';
import { itemTitle } from '../model/itemOps';
import PricePanel from '../screens/PricePanel';
import { ISSUE_LABELS, rub, usePackagingOptions, packagingLabel } from '../screens/labels';
import { itemPackaging } from '../pricing/priceOrder';
import DiscountField from './DiscountField';
import sales from '../screens/Sales.module.css';
import styles from './Workplace.module.css';

/**
 * Вкладка «ТЗ и цена»: позиции таблицей (название, упаковка — подписью
 * из справочника, штук, цена за штуку, сумма), пометки расчёта ссылкой на позицию, живая цена заказа и скидка.
 * PDF ТЗ — следующие вехи.
 */
export default function SummaryTab({ order, price, readOnly, itemHref, onDiscount }) {
  const packOptions = usePackagingOptions();
  const byKey = new Map((price?.items ?? []).map((p) => [p.key, p]));
  return (
    <div className={sales.layout}>
      <div>
        <section className={sales.panel} aria-labelledby="wp-summary-head">
          <h2 id="wp-summary-head" className={sales.panelTitle}>Позиции</h2>
          {order.items.length === 0 ? (
            <p className={sales.muted}>Изделий пока нет.</p>
          ) : (
            <table className={styles.summaryTable}>
              <thead>
                <tr>
                  <th scope="col">Изделие</th>
                  <th scope="col" className={sales.right}>Штук</th>
                  <th scope="col" className={sales.right}>Цена за шт</th>
                  <th scope="col" className={sales.right}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((it) => {
                  const p = byKey.get(it.key);
                  const pack = itemPackaging(it, order.packaging);
                  return (
                    <tr key={it.key}>
                      <td data-label="Изделие">
                        <Link className={styles.summaryLink} to={itemHref(it.key)}>{itemTitle(it)}</Link>
                        {pack !== 'none' && (
                          <div className={sales.muted}>Упаковка: {packagingLabel(packOptions, pack)}</div>
                        )}
                        {(p?.issues ?? []).map((iss) => (
                          <div key={iss}>
                            <Link className={styles.issueLink} to={itemHref(it.key)}>{ISSUE_LABELS[iss]}</Link>
                          </div>
                        ))}
                      </td>
                      <td data-label="Штук" className={`${sales.num} ${sales.right}`}>{gridQty(it.size_grid)}</td>
                      <td data-label="Цена за шт" className={`${sales.num} ${sales.right}`}>{rub(p?.unit)}{p?.manual ? ' · ручная' : ''}</td>
                      <td data-label="Сумма" className={`${sales.num} ${sales.right}`}>{rub(p?.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <section className={sales.panel} aria-label="Скидка">
          <fieldset className={styles.fieldset} disabled={readOnly}>
            <DiscountField discount={order.discount} onChange={onDiscount} />
          </fieldset>
        </section>
      </div>
      <PricePanel order={order} price={price} />
    </div>
  );
}
