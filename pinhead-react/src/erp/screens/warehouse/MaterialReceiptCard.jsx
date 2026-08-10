import { useState } from 'react';
import { formatDateShort } from '../../utils/time';
import { MATERIAL_ACCEPT_LABELS, MATERIAL_STATUS_LABELS } from '../../types';
import { confirm } from '../../../store/useConfirmStore';
import styles from '../../erp.module.css';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { Button } from '../../components/Button';

/**
 * Задача склада «Приёмка материалов» (правка 4.1.3): сравнение План↔Факт по каждому материалу.
 * План (материал/цвет/артикул/кол-во) заводит закупка и он read-only для склада; кладовщик вносит
 * только факт (что фактически поступило + кол-во) и статус приёмки. Приёмка разблокирует закрой
 * (гейт в routes.ts) и закрывает задачу в warehouseSlice.acceptMaterial.
 */

const KIND_LABELS = {
  fabric: 'Ткань', hardware: 'Фурнитура', labels: 'Бирки/этикетки', packaging: 'Упаковка', other: 'Прочее',
};

const ACCEPT_CHIP = {
  accepted_full: 'chipReady',
  accepted_partial: 'chipProgress',
  shortage: 'chipBlocked',
  mismatch: 'chipBlocked',
  rejected: 'chipBlocked',
};

/** Материал ждёт приёмки: пришёл, но склад ещё не провёл (или отклонил) приёмку */
function awaitsAcceptance(m) {
  if (m.status !== 'received') return false;
  return m.accept_status !== 'accepted_full' && m.accept_status !== 'accepted_partial';
}

/** Приёмка одного материала: план read-only слева, факт (заполняет кладовщик) справа */
function AcceptBlock({ material: m, onAccept, onAddReceipt }) {
  const done = !awaitsAcceptance(m) && m.accept_status;
  // Факт-атрибуты преднаполняются планом — кладовщик правит только при пересорте/расхождении
  const [factName, setFactName] = useState(m.fact_name ?? m.name ?? '');
  const [factColor, setFactColor] = useState(m.fact_color ?? m.color ?? '');
  const [factArticle, setFactArticle] = useState(m.fact_article ?? m.article ?? '');
  // Сумма журнала приходов: считает сервер, карточка её только показывает
  const received = m.qty_received ?? '';
  const [status, setStatus] = useState(m.accept_status ?? 'accepted_full');
  const [comment, setComment] = useState(m.accept_comment ?? '');
  const [saving, setSaving] = useState(false);

  /**
   * Расхождение план↔факт. Статус по умолчанию — «Принято полностью», и недостача
   * уезжала в систему как полная приёмка: гейт закроя открывался, а несоответствие
   * всплывало уже в цехе. Сравнение — только когда обе величины есть.
   */
  const expected = Number(m.qty_expected);
  const factQty = received === '' ? null : Number(received);
  const shortfall = Number.isFinite(expected) && expected > 0 && factQty !== null
    && Number.isFinite(factQty) && factQty < expected
    ? Math.round((expected - factQty) * 100) / 100
    : 0;
  const claimsFull = status === 'accepted_full';

  const accept = async () => {
    if (shortfall > 0 && claimsFull) {
      const ok = await confirm({
        title: 'Принять как полную приёмку?',
        message: `План ${expected}, факт ${factQty} — не хватает ${shortfall}. `
          + 'Полная приёмка откроет закрой на весь план, и расхождение всплывёт уже в цехе. '
          + 'Обычно здесь нужен статус «Недостача» или «Принято частично».',
        confirmLabel: 'Всё равно принять полностью',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setSaving(true);
    await onAccept(m.id, {
      qty_received: received === '' ? null : Number(received),
      accept_status: status,
      accept_comment: comment.trim() || null,
      fact_name: factName.trim() || null,
      fact_color: factColor.trim() || null,
      fact_article: factArticle.trim() || null,
    });
    setSaving(false);
  };

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div className={styles.matSectionHead}>
        <div>
          <strong>{m.name}</strong>
          <div className={styles.subText}>{KIND_LABELS[m.kind]} · {MATERIAL_STATUS_LABELS[m.status]}</div>
        </div>
        {done && (
          <span className={`${styles.chip} ${styles[ACCEPT_CHIP[m.accept_status]]}`}>
            {MATERIAL_ACCEPT_LABELS[m.accept_status]}
            {m.accepted_at ? ` · ${formatDateShort(m.accepted_at)}` : ''}
          </span>
        )}
      </div>
      <ScrollHintBox className={styles.tableWrap} label="Приёмка материалов">
        <table className={styles.table}>
          <thead>
            <tr><th>Поле</th><th>План (закупка)</th><th>Факт (склад)</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Материал</td>
              <td>{m.name || '—'}</td>
              <td>
                <input className={styles.input} value={factName}
                  onChange={(e) => setFactName(e.target.value)} aria-label={`Факт материал ${m.name}`} />
              </td>
            </tr>
            <tr>
              <td>Цвет</td>
              <td>{m.color || '—'}</td>
              <td>
                <input className={styles.input} value={factColor}
                  onChange={(e) => setFactColor(e.target.value)} aria-label={`Факт цвет ${m.name}`} />
              </td>
            </tr>
            <tr>
              <td>Артикул</td>
              <td>{m.article || '—'}</td>
              <td>
                <input className={styles.input} value={factArticle}
                  onChange={(e) => setFactArticle(e.target.value)} aria-label={`Факт артикул ${m.name}`} />
              </td>
            </tr>
            {/* Поставщик — только план (правка 10): выбран закупкой, склад его не меняет;
                расхождение фиксируется комментарием приёмки */}
            <tr>
              <td>Поставщик</td>
              <td>{m.supplier || '—'}</td>
              <td className={styles.subText}>
                расхождение — в комментарий
              </td>
            </tr>
            {/*
              Количество — ЧТЕНИЕ. С волны 3.3 приход вносится частями отдельной
              формой ниже, а `qty_received` стала суммой журнала, которую ведёт
              триггер. Поле ввода здесь означало бы второго писателя одной
              колонки: первый же следующий приход пересчитал бы сумму и затёр
              набранное — молча, потому что оба пути «работают».
            */}
            <tr>
              <td>Количество{m.unit ? `, ${m.unit}` : ''}</td>
              <td>{m.qty_expected ?? '—'}</td>
              <td>
                {received === '' || received === null ? '—' : received}
                {shortfall > 0 && (
                  <div className={styles.overdue}>не хватает {shortfall}</div>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </ScrollHintBox>
      <ReceiptEntry material={m} onAdd={onAddReceipt} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}
          aria-label={`Статус приёмки ${m.name}`}>
          {Object.entries(MATERIAL_ACCEPT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input className={styles.input} style={{ flex: 1, minWidth: 160 }} placeholder="Комментарий"
          value={comment} onChange={(e) => setComment(e.target.value)}
          aria-label={`Комментарий приёмки ${m.name}`} />
        <Button variant="primary" disabled={saving} onClick={accept}>
          {done ? 'Обновить приёмку' : 'Принять'}
        </Button>
      </div>
    </div>
  );
}


/**
 * Приход материала частями (правки заказчика 10.08, волна 3.3).
 *
 * «Пришло 60 из 100, потом ещё 35 — видно, что осталось 5». Каждый приход —
 * строка журнала; сумму по журналу кладёт в карточку триггер. Поэтому здесь
 * вводится СКОЛЬКО ПРИШЛО СЕЙЧАС, а не итог: итог система считает сама,
 * и просить его у человека значило бы просить сложить в уме.
 */
function ReceiptEntry({ material: m, onAdd }) {
  const [qty, setQty] = useState('');
  const [status, setStatus] = useState('accepted_full');
  const [invoice, setInvoice] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const expected = Number(m.qty_expected);
  const already = Number(m.qty_received ?? 0);
  const left = Number.isFinite(expected) && expected > 0
    ? Math.round((expected - already) * 100) / 100
    : null;
  const needsComment = status !== 'accepted_full' && status !== 'accepted_partial';

  const add = async () => {
    setBusy(true);
    const ok = await onAdd(m.id, {
      qty: Number(qty),
      unit: m.unit ?? null,
      acceptStatus: status,
      invoice,
      comment,
    });
    setBusy(false);
    if (ok) { setQty(''); setInvoice(''); setComment(''); }
  };

  return (
    <div className={styles.queueBlockForm}>
      <span className={styles.queueReason}>
        Принято всего: <b>{already || 0}</b>
        {m.unit ? ` ${m.unit}` : ''}
        {left !== null && left > 0 && <span className={styles.dueSoon}> · осталось {left}</span>}
        {left !== null && left <= 0 && <span className={styles.subText}> · план закрыт</span>}
      </span>
      <div className={styles.planFormRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Пришло сейчас{m.unit ? `, ${m.unit}` : ''} *</span>
          <input
            type="number" min="0" step="0.01" className={styles.input}
            value={qty} onChange={(e) => setQty(e.target.value)}
            aria-label={`Сколько пришло сейчас, ${m.name}`}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Что приехало</span>
          <select className={styles.select} value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label={`Статус прихода ${m.name}`}>
            {Object.entries(MATERIAL_ACCEPT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Накладная</span>
          <input className={styles.input} value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
            aria-label={`Накладная прихода ${m.name}`} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Комментарий{needsComment ? ' * (объясните отклонение)' : ''}
          </span>
          <input className={styles.input} value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-label={`Комментарий прихода ${m.name}`} />
        </label>
      </div>
      <Button
        variant="secondary"
        disabled={busy || !(Number(qty) > 0) || (needsComment && !comment.trim())}
        onClick={add}
      >
        Записать приход
      </Button>
    </div>
  );
}

export function MaterialReceiptCard({ order, task, onAccept, onAddReceipt }) {
  const accepted = task.status === 'accepted';
  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Приёмка материалов</span>
          <div><strong>№{order.bitrix_id || '—'} · {order.title}</strong></div>
        </div>
        {accepted && <span className={`${styles.chip} ${styles.chipDone}`}>Материалы приняты</span>}
      </div>
      {order.materials.map((m) => (
        <AcceptBlock key={m.id} material={m} onAccept={onAccept} onAddReceipt={onAddReceipt} />
      ))}
    </section>
  );
}
