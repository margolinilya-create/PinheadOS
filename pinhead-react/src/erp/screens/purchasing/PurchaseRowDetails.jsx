import { useEffect, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { MATERIAL_ACCEPT_LABELS } from '../../types';
import { formatDateShort } from '../../utils/time';
import {
  ArticleField, CostValue, FabricParamsFields, ManagerNote, MaterialSizes,
  OrderedOnField, ResponsibleField,
} from './PurchaseFields';
import { SOURCE_LABELS } from './purchaseLabels';
import styles from '../../styles';

/**
 * ПОДРОБНОСТИ СТРОКИ ЗАКУПКИ (правка 05.10, п. 6): «артикул, источник,
 * параметры ткани, документы, сумму и историю — в деталях строки».
 *
 * Таблица из четырнадцати колонок держала всё это в одном ряду, и до статуса
 * и действия приходилось двигать её по горизонтали. В ряду осталось то,
 * по чему решают, — материал, поставщик, количества, цена, срок, статус
 * и действие; остальное раскрывается по требованию. Поля те же, что были
 * в колонках (`PurchaseFields`), — второй реализации инлайн-правки нет.
 */
export function PurchaseRowDetails({ m, onUpdate }) {
  const field = (label, content) => (
    <span className={styles.dataCardField}>
      <span className={styles.dataCardFieldLabel}>{label}</span>
      <span>{content}</span>
    </span>
  );
  return (
    <div className={styles.purchaseDetails}>
      <div className={styles.dataCardFields}>
        {field('Артикул', <ArticleField m={m} onUpdate={onUpdate} />)}
        {field('Источник', SOURCE_LABELS[m.source] ?? m.source)}
        {field('Комментарий менеджера', <ManagerNote m={m} />)}
        {field('Дата заказа', <OrderedOnField m={m} onUpdate={onUpdate} />)}
        {field('Ответственный', <ResponsibleField m={m} onUpdate={onUpdate} />)}
        {field('Сумма, ₽', <CostValue m={m} />)}
        {m.kind === 'fabric' && field('Параметры ткани', <FabricParamsFields m={m} onUpdate={onUpdate} />)}
      </div>
      <MaterialSizes m={m} onUpdate={onUpdate} />
      <MaterialReceiptsList m={m} />
    </div>
  );
}

/**
 * ПОСТАВКИ ПОЗИЦИИ — КОРОТКИМ СПИСКОМ (правка 05.10, п. 7): «если поставок
 * несколько — короткий список: дата, количество, статус». Это и есть
 * «документы и история» строки: у каждого прихода накладная и автор.
 *
 * Журнал читается ТОЧЕЧНО и только у раскрытой строки: в выборку заказов
 * он не кладётся (`loadMaterialReceipts`), растёт быстрее всего, а нужен
 * ровно здесь и в окне приёмки. Подробности монтируются при раскрытии —
 * значит, возврат со склада после приёмки читает журнал заново.
 */
function MaterialReceiptsList({ m }) {
  const loadMaterialReceipts = useErpStore((s) => s.loadMaterialReceipts);
  const [receipts, setReceipts] = useState(null);
  // Число принятого — часть ключа: пришёл новый приход (realtime или
  // возврат со склада) — журнал перечитывается, а не показывает прежний
  const received = m.qty_received ?? 0;

  useEffect(() => {
    let alive = true;
    loadMaterialReceipts([m.id]).then((rows) => { if (alive) setReceipts(rows); });
    return () => { alive = false; };
  }, [loadMaterialReceipts, m.id, received]);

  const unit = m.unit ? ` ${m.unit}` : '';
  return (
    <div>
      <div className={styles.dataCardFieldLabel}>Поставки</div>
      {receipts === null && <div className={styles.subText}>Загрузка…</div>}
      {receipts?.length === 0 && (
        <div className={styles.subText}>Поставок ещё не было — принятое появится после приёмки склада.</div>
      )}
      {receipts?.length > 0 && (
        <ul className={styles.receiptList} aria-label={`Поставки: ${m.name}`}>
          {receipts.map((r) => (
            <li key={r.id}>
              {formatDateShort(r.received_on)} · {r.qty}{r.unit ? ` ${r.unit}` : unit}
              {' · '}{MATERIAL_ACCEPT_LABELS[r.accept_status] ?? r.accept_status}
              {r.invoice ? ` · накладная ${r.invoice}` : ''}
              {r.author ? <span className={styles.subText}> · {r.author}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
