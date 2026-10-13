import { useState } from 'react';
import styles from './PriceBreakdown.module.css';

const rub = (v) => Math.round(v).toLocaleString('ru-RU');

function Row({ name, val, sign = '', cls = '' }) {
  return (
    <div className={`${styles['pb-row']}${cls ? ` ${styles[cls]}` : ''}`}>
      <span className={styles['pb-name']}>{name}</span>
      <span className={styles['pb-val']}>{sign}{rub(val)} ₽</span>
    </div>
  );
}

export default function PriceBreakdown({ breakdown, defaultOpen = false, compact = false }) {
  const [open, setOpen] = useState(defaultOpen);

  if (!breakdown || breakdown.qty === 0) return null;

  const { cost, markup, markupPct, markedBase, base, extras, labels, print, pack, urgent, unitPrice, total, qty,
    fabric, trim, sewing, extraMaterials, overhead, overheadPct, urgentPct, fabricMissing } = breakdown;

  return (
    <div className={`${styles['pb-wrap']}${compact ? ` ${styles['pb-compact']}` : ''}`}>
      {fabricMissing && (
        <div className={styles['pb-error']} role="alert">Ткань не найдена или без цены — цена изделия неполная. Выберите ткань из каталога.</div>
      )}
      <button className={styles['pb-toggle']} onClick={() => setOpen(!open)}>
        Детализация цены {open ? '\u25B2' : '\u25BC'}
      </button>
      {open && (
        <div className={styles['pb-body']} data-testid="pb-body">
          {fabric > 0 && <Row name="Основная ткань" val={fabric} />}
          {trim > 0 && <Row name="Отделка" val={trim} />}
          {sewing > 0 && <Row name="Пошив" val={sewing} />}
          {extraMaterials > 0 && <Row name="Доп. материалы" val={extraMaterials} />}
          {extras > 0 && <Row name="Обработки" val={extras} />}
          {(cost + extras) > 0 && <Row name="Себестоимость" val={cost + extras} cls="pb-row-sum" />}
          {overhead > 0 && <Row name={`Накладные ${Math.round((overheadPct ?? 0) * 100)}%`} val={overhead} sign="+" />}
          {markup > 0 && <Row name={`Наценка +${Math.round((markupPct ?? 0) * 100)}%`} val={markup} sign="+" cls="pb-row-markup" />}
          {urgent > 0 && <Row name={`Срочный пошив +${Math.round((urgentPct ?? 0) * 100)}%`} val={urgent} sign="+" cls="pb-row-urgent" />}
          <Row name="Изделие" val={(markedBase ?? base) + (urgent || 0)} />
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
