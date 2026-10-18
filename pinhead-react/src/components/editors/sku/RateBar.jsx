import { useId, useState } from 'react';
import { Icon } from '../../../erp/components/Icon';
import { factoryToday } from '../../../utils/date';
import { storageGet, storageSet } from '../../../lib/storage';
import { toast } from '../../../store/useToastStore';
import styles from '../SkuEditor.module.css';

const CB_KEY = 'ph_cb_rate';
const CB_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';

const fmtRate = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/**
 * Курс доллара каталога (`/sku`): внутренний — поле прайса `usdRate` (пишется
 * вместе с каталогом), курс ЦБ — справка рядом, хранится только в браузере.
 *
 * Было (до вехи 8): `<input type=number>` без подписи (провал axe `label`),
 * «↻» только с `title`, капс «КУРС ЦБ:» / «ВНУТРЕННИЙ:».
 */
export default function RateBar({ usdRate, onRateChange, readOnly }) {
  const id = useId();
  const [cb, setCb] = useState(() => storageGet(CB_KEY, {}) || {});

  const refresh = async () => {
    try {
      const r = await fetch(CB_URL);
      const data = await r.json();
      const usd = data?.Valute?.USD?.Value;
      if (!usd) throw new Error('нет курса в ответе');
      const next = { rate: Math.round(usd * 100) / 100, date: factoryToday() };
      setCb(next);
      storageSet(CB_KEY, next);
    } catch (err) {
      console.error('[RateBar]', err);
      toast.error('Курс ЦБ не обновился — попробуйте позже');
    }
  };

  return (
    <div className={styles.rateBar}>
      <div className={styles.rateField}>
        <label htmlFor={id} className={styles.rateLabel}>Внутренний курс, ₽/$</label>
        <input
          id={id}
          type="number"
          min="1"
          className={styles.rateInput}
          value={usdRate}
          disabled={readOnly}
          onChange={(e) => onRateChange(Math.max(1, Number(e.target.value) || 1))}
        />
      </div>
      <p className={styles.rateCb}>
        {cb.rate ? `Курс ЦБ: ${fmtRate(cb.rate)} ₽/$${cb.date ? ` (${cb.date})` : ''}` : 'Курс ЦБ ещё не загружен'}
      </p>
      <button type="button" className={styles.iconBtn} onClick={refresh} aria-label="Обновить курс ЦБ" title="Обновить курс ЦБ">
        <Icon name="refresh" size={16} />
      </button>
    </div>
  );
}
