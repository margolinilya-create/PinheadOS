import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { gridQty } from '../model/factory';
import { itemTitle } from '../model/itemOps';
import PricePanel from '../screens/PricePanel';
import { ISSUE_LABELS, rub, usePackagingOptions, packagingLabel } from '../screens/labels';
import { itemPackaging } from '../pricing/priceOrder';
import ErrorBoundary from '../../components/shared/ErrorBoundary';
import DiscountField from './DiscountField';
import { loadTzEngineOrNull } from '../tz/ui/tzExport';
import { APP_ORIGIN } from '../tz/appOrigin';

/** Оплата, ТЗ и отправка — ленивый чанк (бюджет «Рабочего места») */
const TzSummary = lazy(() => import('../tz/ui/TzSummary'));
import sales from '../screens/Sales.module.css';
import styles from './Workplace.module.css';

/**
 * Вкладка «ТЗ и цена»: позиции таблицей (название, упаковка — подписью
 * из справочника, штук, цена за штуку, сумма), пометки расчёта ссылкой на позицию, живая цена заказа и скидка.
 *
 * Веха 6+7 (задача 5), сверху вниз под ценой: «Оплата» (`PaymentPanel`, общий
 * с «К запуску»), «ТЗ» (группы, предпросмотр в память, черновик всех ТЗ) и
 * «Отправить в работу» (чек-лист и единственная точка отправки, якорь `#send`).
 * Эти три раздела — ленивый чанк `TzSummary`; движок PDF ТЗ — только
 * `import()` через `tzExport` (бюджет «ТЗ PDF»).
 * Дата сборки — сегодня по фабрике; передаёт рабочее место (`today`).
 */
export default function SummaryTab({
  order, price, readOnly, itemHref, onDiscount,
  user, catalogs, catalogsFailed, checklist, today, focusSend, onSendFocused,
}) {
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
        <ErrorBoundary fallback={<p className={sales.empty} role="alert">Оплата и ТЗ не загрузились — обновите страницу</p>}>
          <Suspense fallback={<p className={sales.muted} role="status">Загружаем оплату и ТЗ…</p>}>
            <TzSummary
              order={order}
              price={price}
              user={user}
              catalogs={catalogs}
              catalogsFailed={catalogsFailed}
              checklist={checklist}
              today={today}
              appOrigin={APP_ORIGIN}
              loadEngine={loadTzEngineOrNull}
              focusSend={focusSend}
              onSendFocused={onSendFocused}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <PricePanel order={order} price={price} />
    </div>
  );
}
