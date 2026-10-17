import { rub, pct } from './labels';
import styles from './Sales.module.css';

/** Живая цена заказа v4: позиции, подготовка, скидка, итог, маржа и порог */
export default function PricePanel({ order, price }) {
  if (!price) return null;
  return (
    <aside className={`${styles.panel} ${styles.sticky}`} aria-label="Цена заказа">
      <div className={styles.panelTitle}>Цена</div>
      {price.items.map((p, i) => {
        const item = order.items.find((it) => it.key === p.key);
        return (
          <div key={p.key} className={styles.priceLine}>
            <span>
              {i + 1}. {item?.product_type || 'Позиция'}
              <div className={styles.muted}>
                {p.qty} шт. × {rub(p.unit)}{p.manual ? ' · ручная' : ''}
              </div>
              {!p.manual && (p.labels_unit > 0 || p.pack_unit > 0) && (
                <div className={styles.muted}>
                  в т. ч. за штуку:{p.labels_unit > 0 ? ` бирки ${rub(p.labels_unit)}` : ''}{p.pack_unit > 0 ? ` упаковка ${rub(p.pack_unit)}` : ''}
                </div>
              )}
            </span>
            <span className={styles.num}>{rub(p.total)}</span>
          </div>
        );
      })}
      {price.prep_total > 0 && (
        <div className={styles.priceLine}><span>Подготовка (формы, программа)</span><span className={styles.num}>{rub(price.prep_total)}</span></div>
      )}
      {price.discount_amount > 0 && (
        <div className={styles.priceLine}><span>Скидка</span><span className={styles.num}>− {rub(price.discount_amount)}</span></div>
      )}
      <div className={styles.priceTotal}>
        <span>Итого</span>
        <span className={styles.num} data-testid="order-total">{rub(price.total)}</span>
      </div>
      <div className={styles.priceLine}>
        <span className={styles.muted}>Маржа</span>
        <span className={`${styles.num} ${styles.muted}`}>{rub(price.margin)} · {pct(price.margin_pct)}</span>
      </div>
      {order.urgent && <div className={styles.muted}>Срочный пошив включён в цену изделия; нанесения — без надбавки</div>}
      {price.below_threshold && (
        <div className={styles.alert} role="status">Маржа ниже порога — проверьте скидку и ручные цены</div>
      )}
      {price.incomplete && (
        <div className={styles.alert} role="status">Не все позиции посчитаны — задайте ручную цену</div>
      )}
    </aside>
  );
}
