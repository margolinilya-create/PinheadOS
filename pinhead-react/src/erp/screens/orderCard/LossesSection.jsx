import { useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { Button } from '../../components/Button';
import { formatDateShort } from '../../utils/time';
import { fmtM, fmtKg, sourceLabel } from '../../utils/fabricMetres';
import {
  money, moneyOrNot, sizeRowsText, unitCostText, NOT_CALCULATED_TEXT, NO_ASSEMBLY_MARK,
} from '../../utils/itemEconomics';
import styles from '../../styles';

/**
 * «ОСТАТКИ И ПОТЕРИ ПО ЗАКАЗУ» (правка заказчика 27.09, п. 8).
 *
 * «Он должен показывать, какая часть материала и изделий осталась в запасах,
 * какая находится в работе и какая потеряна. Считать отдельно по каждой
 * позиции заказа». Пять частей документа — пять раскрывающихся блоков:
 * пригодные остатки ткани, годные плюсы, окончательный брак, непригодные
 * остатки, в работе и переделке. Каждая сумма раскрывается до исходных
 * записей (рулон, партия, этап, документ) — `<details>`: свернутый блок
 * называет число, развёрнутый — из чего оно сложилось.
 *
 * Расчётные оценки подписаны отдельно («расчёт»), а неизвестная стоимость
 * названа словами «Не рассчитано», а не нулём — прямое требование документа.
 * Суммы здесь НЕ складываются в «дополнительные расходы»: брак, переделка,
 * плюсы и отходы уже внутри учтённых затрат позиции.
 */
function Block({ title, summary, count, open = false, children }) {
  return (
    <details className={styles.dataCard} open={open}>
      <summary>
        <strong>{title}</strong>
        <span className={styles.subText}> — {summary}</span>
      </summary>
      {count === 0 ? <p className={styles.subText}>Записей нет.</p> : children}
    </details>
  );
}

export function LossesSection({ losses, clientQty, orderId, itemId, noAssembly = false }) {
  if (!losses) return null;
  const usable = losses.leftovers_usable ?? [];
  const scrap = losses.leftovers_scrap ?? [];
  const defects = losses.defects ?? [];
  const wip = losses.wip ?? [];
  const extras = losses.extras;
  const adjustments = losses.adjustments ?? [];

  return (
    <section className={styles.matSection} aria-label="Остатки и потери по заказу">
      <div className={styles.matSectionHead}>
        <strong>Остатки и потери по заказу</strong>
      </div>

      <Block
        title="Пригодные остатки ткани"
        summary={`${usable.length} ${usable.length === 1 ? 'рулон' : 'рулонов'} · ${money(losses.leftovers_usable_cost)}`}
        count={usable.length}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Рулон</th><th scope="col">Материал</th><th scope="col">Ширина · плотность</th>
              <th scope="col">Остаток, м</th><th scope="col">Источник метража</th><th scope="col">≈ кг</th>
              <th scope="col">Цена за м</th><th scope="col">Стоимость</th><th scope="col">Место хранения</th>
              <th scope="col">Из заказа</th><th scope="col">Движение</th>
            </tr>
          </thead>
          <tbody>
            {usable.map((r) => (
              <tr key={r.roll_id}>
                <th scope="row">{r.label}</th>
                <td>{r.material ?? '—'}</td>
                <td>{r.width_cm ?? '—'} см · {r.density_gsm ?? '—'} г/м²</td>
                <td>{r.length_m === null ? '— (учёт в кг)' : fmtM(r.length_m)}</td>
                <td>{r.length_source ? sourceLabel(r.length_source) : '—'}</td>
                <td>{r.kg === null ? '—' : `${fmtKg(r.kg)}${r.length_m !== null ? ' (расчёт)' : ''}`}</td>
                <td>{r.price_per_m === null ? '—' : money(r.price_per_m)}</td>
                <td>{money(r.cost)}</td>
                <td>{r.location || 'не указано'}</td>
                <td>{r.owner_order_title || '—'}</td>
                <td>{r.used_elsewhere_m > 0 ? `использовано в других заказах: ${fmtM(r.used_elsewhere_m)}` : 'на складе'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.subText}>
          Пригодный остаток остаётся запасом и в затраты изготовленных изделий не входит.
        </p>
      </Block>

      <Block
        title="Годные плюсы"
        summary={`на складе ${extras?.in_stock ?? 0} шт · ${money(extras?.value)}${noAssembly && extras?.value !== null && extras?.value !== undefined ? ` ${NO_ASSEMBLY_MARK}` : ''}`}
        count={(extras?.finished ?? 0) + (extras?.cut_extra ?? 0)}
      >
        <p className={styles.queueReason}>
          Готовых сверх клиентского тиража ({clientQty} шт): <b>{extras?.finished ?? 0}</b> шт ·
          передано клиенту: <b>{extras?.shipped ?? 0}</b> · осталось на складе: <b>{extras?.in_stock ?? 0}</b>
        </p>
        <p className={styles.subText}>
          Плюс закроя: {extras?.cut_extra ?? 0} шт
          {extras?.by_size?.length ? ` (по размерам, по данным закроя: ${sizeRowsText(extras.by_size)})` : ''}.
          Плюсом считаются только готовые годные изделия сверх тиража, ещё не выданные, —
          часть кроя может быть в работе или в браке.
        </p>
        <p className={styles.subText}>
          Себестоимость единицы: {unitCostText(extras?.unit_cost, noAssembly)} · стоимость остатка плюсов:
          {' '}{extras?.value === null || extras?.value === undefined
            ? '—' : `${money(extras.value)}${noAssembly ? ` ${NO_ASSEMBLY_MARK}` : ''}`}
          {' '}— это часть уже произведённой продукции, а не новая статья расходов.
        </p>
      </Block>

      <Block
        title="Окончательный брак"
        summary={`${losses.defects_qty ?? 0} шт · ${moneyOrNot(losses.defects_cost)}${defects.length ? ' (расчёт)' : ''}`}
        count={defects.length}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Этап</th><th scope="col">Шт</th><th scope="col">Причина</th>
              <th scope="col">Кто и когда</th><th scope="col">Накопленная стоимость</th>
            </tr>
          </thead>
          <tbody>
            {defects.map((d) => (
              <tr key={d.report_id}>
                <th scope="row">{d.department}</th>
                <td>{d.qty}</td>
                <td>{d.reason || '—'}</td>
                <td>{d.author || '—'} · {formatDateShort(d.created_at)}</td>
                <td>{d.cost === null ? NOT_CALCULATED_TEXT : `${money(d.cost)} (расчёт)`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.subText}>
          Стоимость брака — полотно на скроенную единицу и выполненные до брака операции;
          это часть уже учтённых затрат, а не добавка к ним.
        </p>
      </Block>

      <Block
        title="Непригодные остатки ткани"
        summary={`${scrap.length} ${scrap.length === 1 ? 'списание' : 'списаний'} · ${money(losses.leftovers_scrap_cost)}`}
        count={scrap.length}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Рулон</th><th scope="col">Материал</th><th scope="col">Списано, м</th>
              <th scope="col">Списано, кг</th><th scope="col">Цена за м</th><th scope="col">Стоимость</th>
              <th scope="col">Причина</th><th scope="col">Кто и когда</th>
            </tr>
          </thead>
          <tbody>
            {scrap.map((s) => (
              <tr key={s.adjustment_id ?? `est-${s.roll_id}`}>
                <th scope="row">{s.label}</th>
                <td>{s.material ?? '—'}</td>
                <td>{fmtM(s.length_m)}</td>
                <td>{s.kg === null || s.kg === undefined ? '—' : fmtKg(s.kg)}</td>
                <td>{s.price_per_m === null || s.price_per_m === undefined ? '—' : money(s.price_per_m)}</td>
                <td>{s.calc ? `${moneyOrNot(s.cost)} (оценка)` : moneyOrNot(s.cost)}</td>
                <td>{s.reason || '—'}</td>
                <td>{s.author || '—'} · {formatDateShort(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.subText}>
          Отходы раскладки, уже включённые в расход закроя, повторно не прибавляются.
          «Оценка» — малый остаток, отмеченный без записи списания: стоимость рассчитана
          по параметрам рулона, а не взята из документа.
        </p>
      </Block>

      <Block
        title="В работе и переделке"
        summary={`не учтено ${losses.wip_qty ?? 0} шт${(losses.wip_rework ?? 0) > 0 ? ` · в т.ч. возвращалось в переделку: ${losses.wip_rework}` : ''}`}
        count={wip.length}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Этап</th><th scope="col">Не учтено</th><th scope="col">в т.ч. возвращалось в переделку</th>
              <th scope="col">По размерам и цветам</th><th scope="col">Затраты на выполненные операции</th>
            </tr>
          </thead>
          <tbody>
            {wip.map((w) => (
              <tr key={w.stage_id}>
                <th scope="row">{w.department}</th>
                <td>{w.unaccounted}</td>
                <td>{w.rework}</td>
                <td>{sizeRowsText(w.by_size) || '—'}</td>
                <td>{w.cost === null ? NOT_CALCULATED_TEXT : `${money(w.cost)} (расчёт)`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.subText}>
          Возвраты в переделку — накопительный счётчик: такие изделия уже внутри
          «не учтено» и к нему не прибавляются.
        </p>
      </Block>

      {adjustments.length > 0 && (
        <AdjustmentsBlock
          adjustments={adjustments}
          open={losses.adjustments_open > 0}
          orderId={orderId}
          itemId={itemId}
        />
      )}
    </section>
  );
}

/**
 * КОРРЕКТИРОВКИ МЕТРАЖА + ПОДТВЕРЖДЕНИЕ ОСТАТОЧНОЙ СТОИМОСТИ (правка 28.09).
 * Рулон ушёл в ноль, а по деньгам на нём что-то осталось — эта сумма
 * относится на позицию только после подтверждения человеком. Без кнопки
 * расчёт оставался предварительным навсегда. Вкладка уже закрыта правом
 * `economics.view`, поэтому кнопку видит каждый, кто видит вкладку.
 */
function AdjustmentsBlock({ adjustments, open, orderId, itemId }) {
  const confirmRollAdjustment = useErpStore((st) => st.confirmRollAdjustment);
  const [pending, setPending] = useState(null);
  const openCount = adjustments.filter((a) => a.kind === 'cost_residual' && !a.confirmed_at).length;

  const confirm = async (id) => {
    setPending(id);
    try {
      await confirmRollAdjustment(id, orderId, itemId ?? null);
    } finally {
      setPending(null);
    }
  };

  return (
    <Block
      title="Корректировки метража"
      summary={`${adjustments.length} ${adjustments.length === 1 ? 'запись' : 'записей'}${openCount > 0 ? ` · остаточная стоимость на подтверждение: ${openCount}` : ''}`}
      count={adjustments.length}
      open={open}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Рулон</th><th scope="col">Вид</th><th scope="col">Было, м</th>
            <th scope="col">Стало, м</th><th scope="col">Сумма</th><th scope="col">Причина</th>
            <th scope="col">Кто и когда</th><th scope="col">Подтверждение</th>
          </tr>
        </thead>
        <tbody>
          {adjustments.map((a) => (
            <tr key={a.adjustment_id}>
              <th scope="row">{a.label}</th>
              <td>{ADJUSTMENT_LABELS[a.kind] ?? a.kind}</td>
              <td>{a.before_m === null ? '—' : fmtM(a.before_m)}</td>
              <td>{a.after_m === null ? '—' : fmtM(a.after_m)}</td>
              <td>{a.cost === null ? '—' : money(a.cost)}</td>
              <td>{a.reason || '—'}</td>
              <td>{a.author || '—'} · {formatDateShort(a.created_at)}</td>
              <td>
                {a.kind !== 'cost_residual' ? '—'
                  : a.confirmed_at ? `подтверждено ${formatDateShort(a.confirmed_at)}`
                    : (
                      <Button
                        variant="primary"
                        size="sm"
                        loading={pending === a.adjustment_id}
                        disabled={pending !== null && pending !== a.adjustment_id}
                        onClick={() => confirm(a.adjustment_id)}
                      >
                        Подтвердить
                      </Button>
                    )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.subText}>
        Корректировка метража сама по себе не меняет сумму закупки и не считается производственным расходом.
      </p>
      {openCount > 0 && (
        <p className={styles.subText}>
          Остаточная стоимость при нулевом остатке рулона относится на позицию после подтверждения;
          до этого расчёт предварительный.
        </p>
      )}
    </Block>
  );
}

const ADJUSTMENT_LABELS = {
  length_refine: 'уточнение метража',
  leftover_measure: 'замер остатка',
  cost_residual: 'остаточная стоимость при нулевом остатке',
};
