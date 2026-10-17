import BufferedInput from '../screens/BufferedInput';
import { formatMoney, parseMoney } from '../screens/fieldParse';
import sales from '../screens/Sales.module.css';

/**
 * Скидка на заказ: сумма и вид (% или ₽). Ставит менеджер сам (решение
 * владельца 17.10, п. 6); ниже порога маржи — предупреждение в цене.
 * Вид хранится и при нулевой сумме: `null` на пустом поле сбрасывал «₽»
 * обратно на «%», и набранные 1000 ₽ превращались в 1000 %.
 */
export default function DiscountField({ discount, onChange }) {
  const d = discount ?? { mode: 'pct', value: 0 };
  const set = (patch) => {
    const next = { ...d, ...patch };
    const cap = next.mode === 'pct' ? 100 : Infinity;
    onChange({ mode: next.mode, value: Math.min(cap, Math.max(0, next.value || 0)) });
  };
  return (
    <div className={sales.field}>Скидка на заказ
      <div className={sales.row}>
        <BufferedInput
          className={sales.input}
          aria-label="Размер скидки"
          inputMode="decimal"
          value={d.value || null}
          format={formatMoney}
          parse={parseMoney}
          onCommit={(v) => set({ value: v ?? 0 })}
        />
        <select className={sales.select} aria-label="Вид скидки" value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="pct">%</option>
          <option value="sum">₽</option>
        </select>
      </div>
    </div>
  );
}
