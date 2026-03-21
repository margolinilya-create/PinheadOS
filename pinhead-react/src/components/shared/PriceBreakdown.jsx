import { useState } from 'react';
import styles from './PriceBreakdown.module.css';

export default function PriceBreakdown({ breakdown, defaultOpen = false, compact = false }) {
  const [open, setOpen] = useState(defaultOpen);

  if (!breakdown || breakdown.qty === 0) return null;

  const { base, extras, labels, print, pack, discount, urgent, unitPrice, total, qty } = breakdown;

  return (
    <div className={`${styles['pb-wrap']}${compact ? ` ${styles['pb-compact']}` : ''}`}>
      <button className={styles['pb-toggle']} onClick={() => setOpen(!open)}>
        Детализация цены {open ? '\u25B2' : '\u25BC'}
      </button>
      {open && (
        <div className={styles['pb-body']} data-testid="pb-body">
          <div className={styles['pb-row']}>
            <span className={styles['pb-name']}>Базовая цена</span>
            <span className={styles['pb-val']}>{base.toLocaleString('ru-RU')} ₽</span>
          </div>
          {extras > 0 && (
            <div className={styles['pb-row']}>
              <span className={styles['pb-name']}>Обработки</span>
              <span className={styles['pb-val']}>+{extras.toLocaleString('ru-RU')} ₽</span>
            </div>
          )}
          {labels > 0 && (
            <div className={styles['pb-row']}>
              <span className={styles['pb-name']}>Этикетки</span>
              <span className={styles['pb-val']}>+{labels.toLocaleString('ru-RU')} ₽</span>
            </div>
          )}
          {print > 0 && (
            <div className={styles['pb-row']}>
              <span className={styles['pb-name']}>Нанесение</span>
              <span className={styles['pb-val']}>+{print.toLocaleString('ru-RU')} ₽</span>
            </div>
          )}
          {pack > 0 && (
            <div className={styles['pb-row']}>
              <span className={styles['pb-name']}>Упаковка</span>
              <span className={styles['pb-val']}>+{pack.toLocaleString('ru-RU')} ₽</span>
            </div>
          )}
          {discount > 0 && (
            <div className={`${styles['pb-row']} ${styles['pb-row-discount']}`}>
              <span className={styles['pb-name']}>Скидка</span>
              <span className={styles['pb-val']}>-{discount.toLocaleString('ru-RU')} ₽</span>
            </div>
          )}
          {urgent > 0 && (
            <div className={`${styles['pb-row']} ${styles['pb-row-urgent']}`}>
              <span className={styles['pb-name']}>Срочность</span>
              <span className={styles['pb-val']}>+{urgent.toLocaleString('ru-RU')} ₽</span>
            </div>
          )}
          <div className={styles['pb-divider']} />
          <div className={`${styles['pb-row']} ${styles['pb-row-unit']}`}>
            <span className={styles['pb-name']}>Итого за шт.</span>
            <span className={styles['pb-val']}>{unitPrice.toLocaleString('ru-RU')} ₽</span>
          </div>
          <div className={styles['pb-row']}>
            <span className={styles['pb-name']}>Кол-во</span>
            <span className={styles['pb-val']}>{qty} шт</span>
          </div>
          <div className={`${styles['pb-row']} ${styles['pb-row-total']}`}>
            <span className={styles['pb-name']}>ИТОГО</span>
            <span className={styles['pb-val']}>{total.toLocaleString('ru-RU')} ₽</span>
          </div>
        </div>
      )}
    </div>
  );
}
