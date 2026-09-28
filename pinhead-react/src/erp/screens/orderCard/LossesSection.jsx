import { formatDateShort } from '../../utils/time';
import { fmtM, fmtKg, sourceLabel } from '../../utils/fabricMetres';
import { money, moneyOrNot, sizeRowsText, NOT_CALCULATED_TEXT } from '../../utils/itemEconomics';
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
function Block({ title, summary, count, children }) {
  return (
    <details className={styles.dataCard}>
      <summary>
        <strong>{title}</strong>
        <span className={styles.subText}> — {summary}</span>
      </summary>
      {count === 0 ? <p className={styles.subText}>Записей нет.</p> : children}
    </details>
  );
}

export function LossesSection({ losses, clientQty }) {
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
              <th scope="col">Остаток, м</th><th scope="col">Источник</th><th scope="col">≈ кг</th>
              <th scope="col">Цена за м</th><th scope="col">Стоимость</th><th scope="col">Движение</th>
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
        summary={`на складе ${extras?.in_stock ?? 0} шт · ${money(extras?.value)}`}
        count={(extras?.finished ?? 0) + (extras?.cut_extra ?? 0)}
      >
        <p className={styles.queueReason}>
          Готовых сверх клиентского тиража ({clientQty} шт): <b>{extras?.finished ?? 0}</b> шт ·
          передано клиенту: <b>{extras?.shipped ?? 0}</b> · осталось на складе: <b>{extras?.in_stock ?? 0}</b>
        </p>
        <p className={styles.subText}>
          Плюс закроя: {extras?.cut_extra ?? 0} шт
          {extras?.by_size?.length ? ` (${sizeRowsText(extras.by_size)})` : ''}.
          Плюсом считаются только готовые годные изделия сверх тиража, ещё не выданные, —
          часть кроя может быть в работе или в браке.
        </p>
        <p className={styles.subText}>
          Себестоимость единицы: {extras?.unit_cost === null || extras?.unit_cost === undefined
            ? 'Нет данных для расчёта' : money(extras.unit_cost)} · стоимость остатка плюсов: {money(extras?.value)}
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
              <th scope="col">Стоимость</th><th scope="col">Причина</th><th scope="col">Кто и когда</th>
            </tr>
          </thead>
          <tbody>
            {scrap.map((s) => (
              <tr key={s.adjustment_id}>
                <th scope="row">{s.label}</th>
                <td>{s.material ?? '—'}</td>
                <td>{fmtM(s.length_m)}</td>
                <td>{money(s.cost)}</td>
                <td>{s.reason || '—'}</td>
                <td>{s.author || '—'} · {formatDateShort(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.subText}>
          Отходы раскладки, уже включённые в расход закроя, повторно не прибавляются.
        </p>
      </Block>

      <Block
        title="В работе и переделке"
        summary={`не учтено ${losses.wip_qty ?? 0} шт · в переделке ${losses.wip_rework ?? 0} шт`}
        count={wip.length}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Этап</th><th scope="col">Не учтено</th><th scope="col">В переделке</th>
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
          Переделка показана внутри незавершённого количества и вторично не прибавляется.
        </p>
      </Block>

      {adjustments.length > 0 && (
        <Block
          title="Корректировки метража"
          summary={`${adjustments.length} ${adjustments.length === 1 ? 'запись' : 'записей'}${losses.adjustments_open > 0 ? ' · есть остаточная стоимость на подтверждение' : ''}`}
          count={adjustments.length}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Рулон</th><th scope="col">Вид</th><th scope="col">Было, м</th>
                <th scope="col">Стало, м</th><th scope="col">Сумма</th><th scope="col">Причина</th><th scope="col">Кто и когда</th>
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
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.subText}>
            Корректировка метража сама по себе не меняет сумму закупки и не считается производственным расходом.
          </p>
        </Block>
      )}
    </section>
  );
}

const ADJUSTMENT_LABELS = {
  length_refine: 'уточнение метража',
  leftover_measure: 'замер остатка',
  cost_residual: 'остаточная стоимость при нулевом остатке',
};
