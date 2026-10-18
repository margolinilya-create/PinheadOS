import { ScrollHintBox } from '../../../erp/components/ScrollHintBox';
import t from './skuTable.module.css';

/**
 * Прокручиваемая таблица вкладки каталога: область с подписью (достижима
 * с клавиатуры, когда есть что прокручивать — `ScrollHintBox`), а закрытый
 * на телефоне набор полей — ВНУТРИ области. Снаружи закрытый `<fieldset>`
 * сделал бы недостижимой и саму область (axe `scrollable-region-focusable`).
 */
export default function ScrollTable({ label, readOnly = false, className, children }) {
  return (
    <ScrollHintBox className={className ?? t.scroll} label={label}>
      <fieldset className={t.fieldset} disabled={readOnly}>
        {children}
      </fieldset>
    </ScrollHintBox>
  );
}
