import { useEffect, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { formatDateShort } from '../../utils/time';
import { MATERIAL_ACCEPT_LABELS } from '../../types';
import { fmtM, sourceLabel } from '../../utils/fabricMetres';
import styles from '../../styles';

/**
 * ИСТОРИЯ ПОСТАВОК И РУЛОНОВ МАТЕРИАЛА (правка заказчика 05.10, п. 4).
 *
 * «Закупка 100 кг: принять 40, потом 60 — после первой частичная, после
 * второй полная, обе поставки и все рулоны в истории». Поставка — строка
 * журнала приходов (`erp_material_receipts`, грузится точечно: в выборку
 * заказа журнал не кладётся), рулон — `erp_material_rolls` со ссылкой
 * `receipt_id` на свой приход. Номер рулона — серверный и сохраняется:
 * повторное открытие показывает те же рулоны, а не копии.
 *
 * Рулоны без прихода (принятые до связи «приход → рулон») показываются
 * отдельной группой — пропасть из истории они не должны.
 */
export function ReceiptHistory({ material: m, unitLabel = '' }) {
  const loadMaterialReceipts = useErpStore((s) => s.loadMaterialReceipts);
  const [receipts, setReceipts] = useState(null);
  // Сумма журнала меняется с каждой приёмкой — она и есть сигнал перечитать
  const total = m.qty_received;

  useEffect(() => {
    let alive = true;
    loadMaterialReceipts([m.id]).then((rows) => { if (alive) setReceipts(rows ?? []); });
    return () => { alive = false; };
  }, [m.id, total, loadMaterialReceipts]);

  const rolls = [...(m.rolls ?? [])].sort((a, b) => a.seq - b.seq);
  const ids = new Set((receipts ?? []).map((r) => r.id));
  const loose = rolls.filter((r) => !r.receipt_id || !ids.has(r.receipt_id));
  const u = unitLabel ? ` ${unitLabel}` : '';

  const rollLine = (r) => (
    <li key={r.id}>
      {r.label}
      {r.qty != null ? ` — ${r.qty}${u}` : ' — вес не указан'}
      {r.length_m != null ? ` · ${fmtM(r.length_m)} (${sourceLabel(r.length_source)})` : ''}
      {r.length_calc_m != null && r.length_source !== 'calc' ? ` · расчёт ${fmtM(r.length_calc_m)}` : ''}
      {r.width_cm != null ? ` · ${r.width_cm} см` : ''}
      {r.density_gsm != null ? ` · ${r.density_gsm} г/м²` : ''}
    </li>
  );

  if (receipts === null) return <p className={styles.subText} role="status">Загружаем историю поставок…</p>;
  if (receipts.length === 0 && rolls.length === 0) {
    return <p className={styles.subText}>Поставок по этой позиции ещё не было.</p>;
  }
  return (
    <div className={styles.queueBlockForm}>
      {receipts.map((rc, i) => {
        const own = rolls.filter((r) => r.receipt_id === rc.id);
        return (
          <div key={rc.id}>
            <span className={styles.fieldLabel}>
              Поставка {i + 1} · {formatDateShort(rc.received_on ?? rc.created_at)} · {rc.qty}{u}
              {' '}· {MATERIAL_ACCEPT_LABELS[rc.accept_status] ?? rc.accept_status}
              {rc.invoice ? ` · накладная ${rc.invoice}` : ''}
              {own.length > 0 ? ` · рулонов ${own.length}` : ''}
            </span>
            {own.length > 0 && <ul className={styles.subText}>{own.map(rollLine)}</ul>}
          </div>
        );
      })}
      {loose.length > 0 && (
        <div>
          <span className={styles.fieldLabel}>Рулоны без привязки к поставке</span>
          <ul className={styles.subText}>{loose.map(rollLine)}</ul>
        </div>
      )}
    </div>
  );
}
