import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { LoadFailed, EmptyResult } from '../components/ErpStates';
import { SearchInput } from '../components/SearchInput';
import { StageIndicator } from '../components/StageIndicator';
import { OrderLink } from '../components/OrderLink';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { formatDateShort, subcontractOverdue } from '../utils/time';
import { deptShortName } from '../data/departments';
import {
  SUBCONTRACT_PHASE_LABELS,
  SUBCONTRACT_PAYMENT_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
  STAGE_STATUS_LABELS,
} from '../types';
import {
  SUBCONTRACT_PHASE_FLOW,
  subcontractPhase,
  subcontractPhasePatch,
} from '../utils/subcontractPhase';
import { outsourcedStages, nextRouteStage, currentStage, stageLabel } from '../utils/outsourcing';
import { STAGE_CHIP_CLASS } from '../utils/stageUi';
import styles from '../erp.module.css';
import { DateField } from '../components/DateField';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { Button } from '../components/Button';
import { factoryToday } from '../../utils/date';
import { MoveJournal } from './subcontracting/MoveJournal';
import { RouteProgress } from '../components/RouteProgress';

/**
 * Подряд — ЭТАПЫ МАРШРУТА, отданные подрядчику (правки заказчика 16.08, блок 2).
 *
 * ЧТО БЫЛО НЕ ТАК. Экран вёл собственный реестр `erp_subcontracting` рядом
 * с производством, и связь с маршрутом — колонка `stage_id` — не заполнялась
 * НИКЕМ (на боевой базе обе строки стоят с `null`). Из-за этого «вернулось
 * от подрядчика» ничего не открывало дальше: подрядной работы в маршруте
 * не существовало, закрывать было нечего, и раздел был тупиком. Ровно на это
 * заказчик и жалуется — «система должна посмотреть следующий этап маршрута».
 *
 * ТЕПЕРЬ СТРОКА — ЭТО ЭТАП. Список строится из подрядных этапов заказов
 * (`utils/outsourcing`, модуль-лист), а `erp_subcontracting` стала КАРТОЧКОЙ
 * ПОДРЯДЧИКА при этапе: подрядчик, сроки, оплата, материалы, журнал
 * перемещений. Ту же переделку прошёл раздел закупки 12.08, и по той же
 * причине — экран, читающий соседние данные вместо этапов, выглядит рабочим
 * и прячет заказ целиком.
 *
 * «ВЕРНУЛОСЬ ≠ ЗАКАЗ ГОТОВ» ПОЛУЧАЕТСЯ ПО ПОСТРОЕНИЮ, без единой строчки
 * специальной логики: следующий этап уже в маршруте и зависит от подрядного
 * через `depends_on`. Приёмка в журнале приращает `qty_done` подрядного этапа
 * (`erp_subcontract_moves_rollup`), этап закрывается, следующий становится
 * готовым тем же гейтом, что у любого другого. Колонка «Следующий этап» здесь
 * ПОКАЗЫВАЕТ это человеку, а не вычисляет переход.
 *
 * ФОРМЫ «ДОБАВИТЬ ОПЕРАЦИЮ» БОЛЬШЕ НЕТ. Подряд заводится конструктором
 * маршрута в карточке заказа — иначе рядом с маршрутом снова заведётся вторая
 * сущность, ради устранения которой всё и переделывалось.
 */

const PHASE_CHIP = {
  planned: 'chipNeutral',
  materials_ready: 'chipNeutral',
  sent: 'chipProgress',
  at_contractor: 'chipProgress',
  ready_at_contractor: 'chipProgress',
  returned: 'chipReady',
  accepted: 'chipReady',
  closed: 'chipSkipped',
};

const FUNNEL_STEPS = SUBCONTRACT_PHASE_FLOW.map((key) => ({
  key, label: SUBCONTRACT_PHASE_LABELS[key],
}));

/** Где заказ физически находится сейчас — главный вопрос раздела */
function whereNow(item, stage, deptNameById) {
  const cur = currentStage(item);
  if (!cur) return 'Производство закончено';
  if (cur.id === stage.id) return `У подрядчика: ${stage.contractor || 'не указан'}`;
  return `У нас: ${deptNameById.get(cur.department_id) || '—'}`;
}

export default function Subcontracting() {
  const {
    orders, departments, loaded, loadError, loadAll,
    subcontracting, subcontractingLoaded, loadSubcontracting, updateSubcontractOp,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      subcontracting: s.subcontracting,
      subcontractingLoaded: s.subcontractingLoaded,
      loadSubcontracting: s.loadSubcontracting,
      updateSubcontractOp: s.updateSubcontractOp,
    })),
  );
  /**
   * Право то же, что у остальных решений по маршруту заказа: `order.manage`.
   * Гейт стоит и на сервере (RLS `erp_subcontracting` и журнала перемещений),
   * и здесь — иначе получилось бы запрещённое «кнопка есть, действие падает».
   */
  const canManage = useErpAccess().can('order.manage');
  const [query, setQuery] = useState('');
  const [openRow, setOpenRow] = useState(null);
  const today = factoryToday();

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => { if (!subcontractingLoaded) loadSubcontracting(); }, [subcontractingLoaded, loadSubcontracting]);

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments],
  );
  /** Карточка подрядчика по этапу; у этапа без карточки её заведёт erp_route_apply */
  const subByStage = useMemo(
    () => new Map(subcontracting.filter((s) => s.stage_id).map((s) => [s.stage_id, s])),
    [subcontracting],
  );

  const rows = useMemo(() => {
    const out = [];
    for (const order of orders) {
      if (order.status !== 'active') continue;
      for (const { item, stage } of outsourcedStages(order)) {
        out.push({ order, item, stage, sub: subByStage.get(stage.id) ?? null });
      }
    }
    return out.sort((a, b) => {
      // Открытые выше закрытых, внутри — по плановой дате возврата
      const closed = (r) => (['done', 'skipped'].includes(r.stage.status) ? 1 : 0);
      if (closed(a) !== closed(b)) return closed(a) - closed(b);
      return (a.sub?.planned_date || '9999').localeCompare(b.sub?.planned_date || '9999');
    });
  }, [orders, subByStage]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.order.title || '').toLowerCase().includes(q)
      || (r.order.bitrix_id || '').includes(q)
      || (r.stage.contractor || '').toLowerCase().includes(q)
      || (r.stage.operation || '').toLowerCase().includes(q)
      || (r.item.product_type || '').toLowerCase().includes(q));
  }, [rows, query]);

  const funnel = useMemo(() => {
    const counts = {};
    for (const r of rows) {
      const phase = r.sub ? subcontractPhase(r.sub) : 'planned';
      counts[phase] = (counts[phase] || 0) + 1;
    }
    return FUNNEL_STEPS.map((s) => ({ ...s, count: counts[s.key] || 0 }));
  }, [rows]);

  /**
   * Операции подряда, не привязанные к маршруту, — заказы, заведённые до этой
   * правки. Блок временный и исчезает сам, когда опустеет; убирать колонки
   * `op_type`/`return_dept` из схемы можно только после этого.
   */
  const legacy = useMemo(
    () => subcontracting.filter((s) => !s.stage_id),
    [subcontracting],
  );

  return (
    <>
      <PageHead
        title="Подряд"
        sub="Этапы маршрута, отданные подрядчикам: где заказ сейчас и что дальше."
      />

      <StageIndicator variant="funnel" title="Подрядные этапы по фазам" nodes={funnel} />

      <div className={styles.toolbar}>
        <SearchInput
          value={query} onChange={setQuery}
          placeholder="Поиск: заказ, № сделки, подрядчик, операция"
          ariaLabel="Поиск подрядных этапов"
        />
        <div className={styles.spacer} />
        <span className={styles.subText}>{shown.length} из {rows.length}</span>
      </div>

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="подрядные этапы" />}
      {loaded && rows.length === 0 && (
        <div className={styles.emptyState}>
          Подрядных этапов нет. Подряд заводится в карточке заказа: вкладка «Позиции» →
          «Изменить маршрут» → исполнитель «Подрядчик».
        </div>
      )}
      {rows.length > 0 && shown.length === 0 && (
        <EmptyResult query={query.trim()} onReset={() => setQuery('')} />
      )}

      {shown.length > 0 && (
        <ScrollHintBox className={styles.tableWrap} wrapClassName={styles.scrollHintGapTop} label="Подрядные этапы">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Заказ</th><th>Изделие</th><th>Кол-во</th><th>Операция</th>
                <th>Подрядчик</th><th>Где заказ сейчас</th><th>Сроки</th>
                <th>Следующий этап</th><th>Фаза и оплата</th><th>Журнал</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ order, item, stage, sub }) => {
                const phase = sub ? subcontractPhase(sub) : 'planned';
                const overdue = subcontractOverdue(
                  sub?.planned_date, sub?.returned_date, phase, today);
                const delayed = overdue && phase !== 'returned';
                const next = nextRouteStage(item, stage);
                const open = openRow === stage.id;
                return [
                  <tr key={stage.id}>
                    <td>
                      <OrderLink orderId={order.id}>
                        <strong>№{order.bitrix_id || '—'}</strong>
                      </OrderLink>
                      <div className={styles.cellSub} title={order.title || undefined}>
                        {order.title || '—'}
                      </div>
                    </td>
                    <td>
                      {item.product_type}
                      {item.variant && <div className={styles.subText}>{item.variant}</div>}
                    </td>
                    <td className={styles.progressCell}>{item.qty ?? '—'}</td>
                    <td>
                      <strong>{stageLabel(stage, deptNameById.get(stage.department_id) || '—')}</strong>
                      <div className={styles.subText}>
                        {/* Цех у подрядного этапа означает «чей это участок
                            ответственности» — куда работа вернётся */}
                        участок: {deptNameById.get(stage.department_id) || '—'}
                        {sub && ` · ${SUBCONTRACT_MATERIAL_SOURCE_LABELS[sub.material_source]}`}
                      </div>
                    </td>
                    <td>{stage.contractor || '—'}</td>
                    <td className={styles.subText}>{whereNow(item, stage, deptNameById)}</td>
                    <td>
                      <div className={styles.subText}>
                        передан: {formatDateShort(sub?.sent_date) || '—'}
                      </div>
                      <label className={overdue ? styles.overdue : styles.subText}>
                        возврат план:{' '}
                        <DateField
                          showFormatHint={false}
                          disabled={!canManage || !sub}
                          value={sub?.planned_date || ''}
                          onChange={(v) => sub && updateSubcontractOp(sub.id, { planned_date: v || null })}
                          aria-label={`Плановая дата возврата ${stage.id}`}
                          style={{ maxWidth: 130 }}
                        />
                      </label>
                    </td>
                    <td>
                      {next ? (
                        <>
                          <strong>{stageLabel(next, deptNameById.get(next.department_id) || '—')}</strong>
                          <div className={styles.subText}>{STAGE_STATUS_LABELS[next.status]}</div>
                        </>
                      ) : (
                        /* Последний этап маршрута: дальше упаковка и отгрузка,
                           а не «заказ готов» — это решает склад */
                        <span className={styles.subText}>последний этап маршрута</span>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.chip} ${styles[delayed ? 'chipBlocked' : PHASE_CHIP[phase]]}`}>
                        {delayed ? 'Задержка' : SUBCONTRACT_PHASE_LABELS[phase]}
                      </span>
                      <div className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[stage.status]]}`}>
                        этап: {STAGE_STATUS_LABELS[stage.status]}
                      </div>
                      {sub && (
                        <select
                          className={`${styles.select} ${styles.inputXs}`}
                          value={phase}
                          disabled={!canManage}
                          onChange={(e) => updateSubcontractOp(sub.id, subcontractPhasePatch(e.target.value))}
                          aria-label={`Фаза подряда ${stage.id}`}
                          style={{ marginTop: 4 }}
                        >
                          {SUBCONTRACT_PHASE_FLOW.map((v) => (
                            <option key={v} value={v}>{SUBCONTRACT_PHASE_LABELS[v]}</option>
                          ))}
                        </select>
                      )}
                      {sub && (
                        <select
                          className={`${styles.select} ${styles.inputXs}`}
                          value={sub.payment_status || 'unpaid'}
                          disabled={!canManage}
                          onChange={(e) => updateSubcontractOp(sub.id, { payment_status: e.target.value })}
                          aria-label={`Оплата ${stage.id}`}
                          style={{ marginTop: 4 }}
                        >
                          {Object.entries(SUBCONTRACT_PAYMENT_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {sub ? (
                        <Button
                          variant="ghost" size="sm"
                          icon={open ? 'chevronUp' : 'chevronDown'}
                          onClick={() => setOpenRow(open ? null : stage.id)}
                          aria-expanded={open}
                        >
                          {sub.qty_accepted ?? 0}/{item.qty ?? '?'}
                        </Button>
                      ) : (
                        <span className={styles.subText}>—</span>
                      )}
                    </td>
                  </tr>,
                  open && sub && (
                    <tr key={`${stage.id}-journal`}>
                      <td colSpan={10}>
                        {/* Документ (п. 19): «при открытии заказа показывать весь
                            маршрут целиком» — что уже сделано, где заказ сейчас
                            и что будет дальше. Примитив это уже умеет */}
                        <RouteProgress
                          item={item}
                          order={order}
                          deptById={deptById}
                          currentStageId={stage.id}
                        />
                        <MoveJournal op={sub} canManage={canManage} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </ScrollHintBox>
      )}

      {legacy.length > 0 && (
        <details className={styles.matSection}>
          <summary>
            Операции подряда без маршрута — {legacy.length}
          </summary>
          <p className={styles.subText}>
            Заказы, заведённые до перехода на подрядные этапы: связи с маршрутом
            у них нет, и следующий этап после возврата система не откроет.
            Маршрут таким заказам задаётся в карточке — вкладка «Позиции» →
            «Изменить маршрут».
          </p>
          <ul className={styles.stackTight}>
            {legacy.map((op) => (
              <li key={op.id} className={styles.subText}>
                №{op.order?.bitrix_id || '—'} · {op.order?.title || '—'} · {op.operation}
                {op.contractor ? ` · ${op.contractor}` : ''}
                {' · '}{SUBCONTRACT_PHASE_LABELS[subcontractPhase(op)]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
