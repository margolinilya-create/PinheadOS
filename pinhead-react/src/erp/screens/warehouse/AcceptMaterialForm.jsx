import { useRef, useState } from 'react';
import { formatDateShort } from '../../utils/time';
import { MATERIAL_ACCEPT_LABELS, MATERIAL_STATUS_LABELS } from '../../types';
import { confirm } from '../../../store/useConfirmStore';
import { qtyLeftToAccept } from '../../utils/receiptLink';
import styles from '../../styles';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { useCompactLayout } from '../../layout/useCompactLayout';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { createAttemptKeeper } from '../../utils/attemptKey';
import { SizeResultTable } from '../../components/SizeResultTable';
import { isGarmentPurchase } from '../../utils/garmentPurchase';
import { cellsToGrid, gridCells, gridRowsTotal } from '../../utils/sizeGrid';
import { materialTracksRolls, unitShortLabel } from '../../utils/materialUnit';
import { useDictionary } from '../../store/useDictionary';
import { STATUS_VARIANT, statusChipClass } from '../../utils/statusUi';
import { fmtM } from '../../utils/fabricMetres';
import { RollParamsFields, LegacyRollParams, AddRollsBlock } from './RollParamsFields';
import { LegacyRollWeights } from './LegacyRollWeights';
import { ReceiptHistory } from './ReceiptHistory';
import {
  newRollRow, rollParamsPayload, rollParamsSignature, rollRowsSummary, weightsFilled, weightsSum,
} from '../../utils/rollParams';

/**
 * ФОРМА ПРИЁМКИ ОДНОГО МАТЕРИАЛА (правка 4.1.3; вынесена из
 * `MaterialReceiptCard` и перекомпонована по правке заказчика 05.10, пп. 4, 8).
 *
 * «Форма узкая. Параметры рулона разбиты на две строки, у полей нет
 * отдельных подписей. Сведения закупки занимают слишком много места.
 * Сверху оставить материал, цвет, поставщика, заказанное количество, ранее
 * принятое и вес новой поставки. Один рулон – одна строка… внизу закреплены
 * итог и сохранение; таблица рулонов между ними; сравнение план/факт,
 * документы и история — свернуть».
 *
 * Действие одно и уходит одной транзакцией (`erp_material_accept`): форм
 * здесь когда-то было две, и на бою это дало девять принятых материалов при
 * пустом журнале приходов.
 */

const KIND_LABELS = {
  fabric: 'Ткань', hardware: 'Фурнитура', labels: 'Бирки/этикетки', packaging: 'Упаковка',
  other: 'Прочее', finished_good: 'Готовое изделие',
};

/* Ключи берутся у СЛОВАРЯ, а не у подписей: сторож `materialReceipts.test.ts`
   считает селекты статуса приёмки по `MATERIAL_ACCEPT_LABELS).map` — ровно один */
const ACCEPT_CHIP = Object.fromEntries(
  Object.keys(STATUS_VARIANT.materialAccept).map((a) => [a, statusChipClass('materialAccept', a)]),
);

/**
 * СТАТУС ВЫВОДИТСЯ ИЗ ЧИСЕЛ (§3.4 обхода 04.09; 05.10, п. 4: «полную
 * и частичную приёмку считать по всем поставкам»). Вручную выбирается
 * только то, чего из чисел не вывести: недостача, пересорт, не принято.
 */
const DERIVED = new Set(['accepted_full', 'accepted_partial']);

/** Материал ждёт приёмки: пришёл, но склад ещё не провёл (или отклонил) приёмку */
function awaitsAcceptance(m) {
  if (m.status !== 'received') return false;
  return m.accept_status !== 'accepted_full' && m.accept_status !== 'accepted_partial';
}

const round2 = (n) => Math.round(n * 100) / 100;

export function AcceptMaterialForm({ material: m, onAccept, onSetRollWeights, onSetRollParams, onAddRolls }) {
  // Приёмка — цеховой экран, и открывают её со склада, то есть с планшета
  const compact = useCompactLayout();
  const done = !awaitsAcceptance(m) && m.accept_status;
  /**
   * Следующая поставка частично принятой позиции (обход QA 09.10): это новый
   * приход, а не правка прежнего — кнопка «Обновить приёмку» читалась как
   * «исправить записанное».
   */
  const nextDelivery = m.accept_status === 'accepted_partial' && (qtyLeftToAccept(m) ?? 0) > 0;
  const units = useDictionary('unit');
  /**
   * УЧИТЫВАЕТСЯ ЛИ МАТЕРИАЛ РУЛОНАМИ (правка 16.09, п. 5) — решает справочник
   * единиц, а не сравнение строки; ткань без единицы — как ткань в кг (01.10).
   */
  const byRolls = materialTracksRolls(m, units);
  const unitLabel = unitShortLabel(m.unit, units);
  const u = unitLabel ? ` ${unitLabel}` : '';
  // Факт-атрибуты преднаполняются планом — кладовщик правит только при пересорте
  const [factName, setFactName] = useState(m.fact_name ?? m.name ?? '');
  const [factColor, setFactColor] = useState(m.fact_color ?? m.color ?? '');
  const [factArticle, setFactArticle] = useState(m.fact_article ?? m.article ?? '');
  const [qty, setQty] = useState('');
  /**
   * СТРОКИ РУЛОНОВ (правка 05.10, п. 4) — строками ввода (`utils/rollParams`):
   * число рулонов = число строк. Новая поставка стартует с одной строкой,
   * ширина и плотность подставлены из закупки.
   */
  const [rollRows, setRollRows] = useState(() => (byRolls && !done ? [newRollRow(m)] : []));
  const [invoice, setInvoice] = useState('');
  const [deviation, setDeviation] = useState(DERIVED.has(m.accept_status) ? '' : (m.accept_status ?? ''));
  const [comment, setComment] = useState(m.accept_comment ?? '');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  /** Ключ идемпотентности: обрыв ответа при закоммиченной приёмке не удвоит приход */
  const attempt = useRef(null);
  if (attempt.current == null) { attempt.current = createAttemptKeeper(); }

  /**
   * ПРИЁМКА ГОТОВОГО ИЗДЕЛИЯ ИДЁТ ПО РАЗМЕРАМ (правка 16.09, п. 2): число
   * прихода — СУММА таблицы, второго писателя того же количества нет.
   */
  const bySize = isGarmentPurchase(m) && gridCells(m.size_grid).length > 0;
  const [sizeEdits, setSizeEdits] = useState({});
  const sizeRows = (bySize ? gridCells(m.size_grid) : []).map((cell) => ({
    key: `${cell.color}\u0000${cell.size}`,
    color: cell.color,
    size: cell.size,
    label: cell.color === '—' ? cell.size : `${cell.size} · ${cell.color}`,
    expected: cell.qty,
  }));
  const sizeValues = Object.fromEntries(sizeRows.map((r) => [r.key, { arrived: sizeEdits[r.key] ?? '' }]));
  const arrivedGrid = cellsToGrid(sizeRows.map((r) => ({
    color: r.color, size: r.size, qty: Number(sizeEdits[r.key]) || 0,
  })));

  // Сумма журнала приходов: считает сервер, форма её только показывает
  const already = Number(m.qty_received ?? 0);
  const expected = Number(m.qty_expected);
  const hasPlan = Number.isFinite(expected) && expected > 0;
  const arriving = bySize ? gridRowsTotal(arrivedGrid) : (qty === '' ? 0 : Number(qty));
  /** Сколько будет принято после этой поставки — по ВСЕМ поставкам */
  const totalAfter = round2(already + (Number.isFinite(arriving) ? arriving : 0));
  const shortfall = hasPlan && totalAfter < expected ? round2(expected - totalAfter) : 0;
  const surplus = hasPlan && totalAfter > expected ? round2(totalAfter - expected) : 0;
  /** План неизвестен — судить не о чем: предложение «полностью», как и было */
  const derivedStatus = hasPlan && shortfall > 0 ? 'accepted_partial' : 'accepted_full';
  const status = deviation || derivedStatus;
  const claimsFull = status === 'accepted_full';
  const needsComment = !DERIVED.has(status);
  /** Сервер не даст объявить приёмку без записанного прихода (`erp_material_accept`) */
  const needsQty = DERIVED.has(status) && already <= 0 && !(arriving > 0);

  /**
   * РУЛОНЫ И ВЕСА ОБЯЗАТЕЛЬНЫ ТАМ ЖЕ, ГДЕ ИХ ТРЕБУЕТ СЕРВЕР (22023): пришёл
   * приход по рулонной единице — нужен хотя бы один рулон, вес каждого,
   * а сумма весов совпадает с весом ЭТОЙ поставки (допуск 0.01, как
   * на сервере). Иначе — ошибка рядом с кнопкой, и запись не уходит.
   */
  const rollCount = byRolls ? rollRows.length : 0;
  const rollsSummary = rollRowsSummary(rollRows, m);
  const needsRolls = byRolls && arriving > 0 && rollCount === 0;
  const filled = weightsFilled(rollRows, rollCount);
  const sum = weightsSum(rollRows, rollCount);
  const weightsMismatch = rollCount > 0 && filled && arriving > 0 && Math.abs(sum - arriving) > 0.01;
  const needsWeights = rollCount > 0 && arriving > 0 && (!filled || weightsMismatch);

  const errors = [
    needsQty && 'Укажите вес новой поставки: приёмка без записанного прихода не сохранится.',
    needsRolls && 'Добавьте рулоны: по ним закрой отчитывается о расходе ткани.',
    needsWeights && (weightsMismatch
      ? `Сумма весов рулонов ${sum}${u} против поставки ${arriving}${u} — `
        + `${sum > arriving ? 'лишние' : 'не хватает'} ${round2(Math.abs(sum - arriving))}${u}`
      : 'Укажите вес каждого рулона: по нему считаются метраж, расход и остаток ткани.'),
    needsComment && !comment.trim() && 'Объясните отклонение в комментарии.',
  ].filter(Boolean);

  const accept = async () => {
    if (inFlight.current) return;
    if (shortfall > 0 && claimsFull) {
      const ok = await confirm({
        title: 'Принять как полную приёмку?',
        message: `План ${expected}, принято ${totalAfter} — не хватает ${shortfall}. `
          + 'Полная приёмка откроет закрой на весь план, и расхождение всплывёт уже в цехе.',
        confirmLabel: 'Всё равно принять полностью',
        variant: 'danger',
      });
      if (!ok) return;
    }
    inFlight.current = true;
    setSaving(true);
    const withRolls = rollCount > 0 && arriving > 0;
    // Подпись ввода: не менял — та же попытка, тот же ключ
    const signature = JSON.stringify([
      m.id, arriving, status, comment.trim(), invoice.trim(),
      factName.trim(), factColor.trim(), factArticle.trim(),
      bySize ? JSON.stringify(arrivedGrid) : null,
      withRolls ? rollParamsSignature(rollRows, rollCount) : null,
    ]);
    const ok = await onAccept(m.id, {
      clientKey: attempt.current.keyFor(signature),
      qty: arriving > 0 ? arriving : null,
      accept_status: status,
      accept_comment: comment.trim() || null,
      invoice: invoice.trim() || null,
      fact_name: factName.trim() || null,
      fact_color: factColor.trim() || null,
      fact_article: factArticle.trim() || null,
      sizeGrid: bySize && arriving > 0 ? arrivedGrid : null,
      // Число рулонов — число строк; параметры — в порядке строк, номера даёт сервер
      rolls: withRolls ? rollCount : null,
      rollParams: withRolls ? rollParamsPayload(rollRows, rollCount) : null,
    });
    inFlight.current = false;
    setSaving(false);
    if (ok) {
      attempt.current.reset(); setQty(''); setInvoice(''); setSizeEdits({});
      // Следующая поставка — новые рулоны, а не правка этих (их хранит сервер)
      setRollRows(byRolls ? [newRollRow(m)] : []);
    }
  };

  /** Сравнение план/факт — свёрнуто (п. 8): нужно при пересорте, а не всегда */
  const factRows = [
    ['name', 'Материал', m.name, factName, setFactName],
    ['color', 'Цвет', m.color, factColor, setFactColor],
    ['article', 'Артикул', m.article, factArticle, setFactArticle],
  ];
  const factLabel = { name: 'материал', color: 'цвет', article: 'артикул' };

  return (
    <div className={`${styles.queueBlockForm} ${styles.acceptForm}`}>
      <div className={styles.matSectionHead}>
        <div>
          <strong>{m.name}</strong>
          <div className={styles.subText}>{KIND_LABELS[m.kind]} · {MATERIAL_STATUS_LABELS[m.status]}</div>
        </div>
        {/* «Ожидается» — закупщик перевёл позицию «В пути» (правка 12.09, п. 8) */}
        {m.status === 'in_transit' && !done && (
          <span className={`${styles.chip} ${styles.chipProgress}`}>Ожидается</span>
        )}
        {done && (
          <span className={`${styles.chip} ${styles[ACCEPT_CHIP[m.accept_status]]}`}>
            {MATERIAL_ACCEPT_LABELS[m.accept_status]}
            {m.accepted_at ? ` · ${formatDateShort(m.accepted_at)}` : ''}
          </span>
        )}
      </div>

      {/* Сверху — главное о поставке (05.10, п. 4): что, какого цвета, от кого, сколько ждём и сколько уже есть */}
      <dl className={styles.receiptSummary}>
        {[
          ['Материал', m.fact_name || m.name || '—'],
          ['Цвет', m.fact_color || m.color || '—'],
          ['Поставщик', m.supplier || '—'],
          ['Заказано', m.qty_expected != null ? `${m.qty_expected}${u}` : '—'],
          ['Ранее принято', `${already}${u}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className={styles.dataCardFieldLabel}>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {bySize ? (
        <SizeResultTable
          rows={sizeRows}
          columns={[{ code: 'arrived', label: `Пришло сейчас, ${m.unit || 'шт'}` }]}
          values={sizeValues}
          onChange={(key, _code, value) => setSizeEdits((v) => ({ ...v, [key]: value }))}
          expectedLabel="Заказано"
          caption={`Приёмка по размерам, ${m.name}`}
          disabled={saving}
        />
      ) : (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            {byRolls ? 'Вес новой поставки' : 'Пришло сейчас'}{unitLabel ? `, ${unitLabel}` : ''}{needsQty ? ' *' : ''}
          </span>
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            className={`${styles.input} ${styles.qtySmallInput}`}
            value={qty} onChange={(e) => setQty(e.target.value)} disabled={saving}
            aria-label={`Сколько пришло сейчас, ${m.name}`}
          />
        </label>
      )}

      {byRolls && (
        <RollParamsFields
          rows={rollRows} onChange={setRollRows} material={m} disabled={saving} compact={compact}
        />
      )}

      <div className={styles.planFormRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Отклонение</span>
          <select className={styles.select} value={deviation} disabled={saving}
            onChange={(e) => setDeviation(e.target.value)}
            aria-label={`Статус приёмки ${m.name}`}>
            <option value="">Нет — по количеству ({MATERIAL_ACCEPT_LABELS[derivedStatus]})</option>
            {Object.entries(MATERIAL_ACCEPT_LABELS).map(([v, l]) => (
              DERIVED.has(v) ? null : <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.fieldLabel}>
            Комментарий{needsComment ? ' * (объясните отклонение)' : ''}
          </span>
          <input className={styles.input} value={comment} disabled={saving}
            onChange={(e) => setComment(e.target.value)}
            aria-label={`Комментарий приёмки ${m.name}`} />
        </label>
      </div>

      <details className={styles.matSection}>
        <summary>Сравнение с закупкой (план / факт)</summary>
        {compact ? (
          <div className={styles.receiptFields}>
            {factRows.map(([key, label, plan, value, setValue]) => (
              <label key={key} className={styles.receiptField}>
                <span className={styles.dataCardFieldLabel}>{label}</span>
                <span className={styles.subText}>План (закупка): {plan || '—'}</span>
                <input className={styles.input} value={value} disabled={saving}
                  onChange={(e) => setValue(e.target.value)} aria-label={`Факт ${factLabel[key]} ${m.name}`} />
              </label>
            ))}
          </div>
        ) : (
          <ScrollHintBox className={styles.tableWrap} label="Сравнение с закупкой">
            <table className={styles.table}>
              <thead><tr><th>Поле</th><th>План (закупка)</th><th>Факт (склад)</th></tr></thead>
              <tbody>
                {factRows.map(([key, label, plan, value, setValue]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>{plan || '—'}</td>
                    <td>
                      <input className={styles.input} value={value} disabled={saving}
                        onChange={(e) => setValue(e.target.value)} aria-label={`Факт ${factLabel[key]} ${m.name}`} />
                    </td>
                  </tr>
                ))}
                {/* Поставщик выбран закупкой, склад его не меняет — расхождение в комментарий */}
                <tr><td>Поставщик</td><td>{m.supplier || '—'}</td><td className={styles.subText}>расхождение — в комментарий</td></tr>
              </tbody>
            </table>
          </ScrollHintBox>
        )}
      </details>

      <details className={styles.matSection}>
        <summary>Документы</summary>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Накладная</span>
          <input className={styles.input} value={invoice} disabled={saving}
            onChange={(e) => setInvoice(e.target.value)}
            aria-label={`Накладная прихода ${m.name}`} />
        </label>
      </details>

      <details className={styles.matSection}>
        <summary>История поставок и рулонов</summary>
        <ReceiptHistory material={m} unitLabel={unitLabel} />
      </details>

      {byRolls && onSetRollWeights && (
        <LegacyRollWeights material={m} unitLabel={unitLabel} onSave={onSetRollWeights} />
      )}
      {byRolls && onSetRollParams && <LegacyRollParams material={m} onSave={onSetRollParams} />}
      {byRolls && done && onAddRolls && (
        <AddRollsBlock material={m} unitLabel={unitLabel} onAdd={onAddRolls} compact={compact} />
      )}

      {/*
        ЗАКРЕПЛЁННЫЙ НИЗ (правка 05.10, п. 8): итог, ошибки и сохранение
        видны без прокрутки при любом числе рулонов. Разница с заказанным —
        отдельной фразой, числом и в ту сторону, в какую её исправлять.
      */}
      <div className={styles.drawerFooter}>
        <div role="status" aria-label="Итог приёмки" className={styles.queueBlockForm}>
          {byRolls && rollCount > 0 && (
            <span className={styles.queueReason}>
              Рулонов: <b>{rollCount}</b> · вес <b>{sum}</b>{u}
              {arriving > 0 ? ` из ${arriving}${u}` : ''}
              {rollsSummary.metres > 0 && (
                <> · метраж <b>{fmtM(rollsSummary.metres)}</b>{rollsSummary.hasCalc ? ' (есть расчётный)' : ''}</>
              )}
            </span>
          )}
          {hasPlan ? (
            <span className={styles.queueReason}>
              Будет принято {totalAfter} из {expected}{u}
              {shortfall > 0 && <span className={styles.overdue}> — не хватает {shortfall}</span>}
              {surplus > 0 && <span className={styles.dueSoon}> — сверх заказа {surplus}</span>}
              {shortfall === 0 && surplus === 0 && ' — план закрыт'}
              {' → '}<b>{MATERIAL_ACCEPT_LABELS[status]}</b>
            </span>
          ) : (
            <span className={styles.queueReason}>→ <b>{MATERIAL_ACCEPT_LABELS[status]}</b></span>
          )}
          {errors.map((text) => (
            <span key={text} className={styles.overdue}><Icon name="alert" size={13} /> {text}</span>
          ))}
        </div>
        <Button variant="primary" loading={saving} disabled={saving || errors.length > 0} onClick={accept}>
          {nextDelivery ? 'Принять поставку' : done ? 'Обновить приёмку' : 'Принять'}
        </Button>
      </div>
    </div>
  );
}
