import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { SearchInput } from '../components/SearchInput';
import { StageIndicator } from '../components/StageIndicator';
import { OrderLink } from '../components/OrderLink';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { subcontractOverdue } from '../utils/time';
import { deptShortName } from '../data/departments';
import {
  SUBCONTRACT_PHASE_LABELS,
  SUBCONTRACT_PAYMENT_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
  STAGE_STATUS_LABELS,
} from '../types';
import { SUBCONTRACT_PHASE_FLOW } from '../utils/subcontractPhase';
import { subcontractView } from '../utils/subcontractFlow';
import { StageDetails } from './subcontracting/StageDetails';
import { StageRowCard } from './subcontracting/StageRowCard';
import {
  DatesCell, ItemCell, LocationCell, NextStageCell, OperationCell,
  OrderCell, StateCell, WorkQtyCell,
} from './subcontracting/StageFields';
import { SUBCONTRACT_LABELS } from './subcontracting/subcontractLabels';
import { useCompactLayout } from '../layout/useCompactLayout';
import { outsourcedStages, nextRouteStage } from '../utils/outsourcing';
import { STAGE_CHIP_CLASS } from '../utils/stageUi';
import styles from '../styles';
import { DateField } from '../components/DateField';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { Button } from '../components/Button';
import { factoryToday } from '../../utils/date';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import { statusChipClass } from '../utils/statusUi';

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

/** Цвет фазы — из словаря раздела; своей таблицы здесь больше нет */
const PHASE_CHIP = Object.fromEntries(
  Object.keys(SUBCONTRACT_PHASE_LABELS).map((p) => [p, statusChipClass('subcontractPhase', p)]),
);

const FUNNEL_STEPS = SUBCONTRACT_PHASE_FLOW.map((key) => ({
  key, label: SUBCONTRACT_PHASE_LABELS[key],
}));

/**
 * «Где заказ сейчас» СЧИТАЕТ `utils/outsourcing.stageLocation` (правка 22.08,
 * пп. 3.6–3.7). Здесь стояла своя версия, отвечавшая по маршруту: текущий этап
 * подрядный — значит «У подрядчика», хотя передано 0 и этап стоит в «Готово
 * к передаче». Будущий подрядный этап она же подписывала «У нас: Подряд» —
 * названием участка вместо состояния.
 */

export default function Subcontracting() {
  const {
    orders, departments, loaded, loadError, loadAll,
    subcontracting, subcontractingLoaded, subcontractingError, loadSubcontracting, updateSubcontractOp,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      subcontracting: s.subcontracting,
      subcontractingLoaded: s.subcontractingLoaded,
      subcontractingError: s.subcontractingError,
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
  /** Планшет цеха и телефон: карточки вместо таблицы из десяти колонок */
  const compact = useCompactLayout();

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  /**
   * Позиция прокрутки при возврате из карточки (правка 03.09). Приём был
   * у списка заказов, доски и очереди цеха и НЕ доехал сюда: человек уходил
   * в заказ из середины длинного списка и возвращался в его начало.
   */
  useScrollRestore(loaded);
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
        const sub = subByStage.get(stage.id) ?? null;
        /**
         * «Запланировано» и «Готово к передаче» СЧИТАЮТСЯ из маршрута:
         * пока предыдущий этап ничего не сдал — передавать нечего, сдал 200 —
         * столько и готово. Документ формулирует это буквально, и хранить
         * такое второй колонкой значит завести два источника правды.
         */
        const view = subcontractView(sub, stage, item.stages ?? [], item.qty ?? 0);
        out.push({ order, item, stage, sub, view });
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
      // Считаем ПОКАЗЫВАЕМУЮ фазу: «готово к передаче» не хранится, и воронка
      // по хранимой сваливала бы все ждущие передачи в «Запланировано»
      counts[r.view.display] = (counts[r.view.display] || 0) + 1;
    }
    return FUNNEL_STEPS.map((s) => ({ ...s, count: counts[s.key] || 0 }));
  }, [rows]);

  /*
   * ОПЕРАЦИЙ БЕЗ МАРШРУТА ЗДЕСЬ БОЛЬШЕ НЕТ (правка 23.08, п. 5).
   *
   * Блок описывал не работу подрядчика, а состояние миграции: заказы,
   * заведённые до перехода на подрядные этапы. Заказчик — «оставить их
   * только в админском/техническом контуре, но не в рабочем интерфейсе
   * подряда», — и он переехал в админку (`admin/LegacySubcontractTab`),
   * где вкладка заводится только при наличии таких записей.
   *
   * Сами записи НЕ удалены: правило проекта запрещает снимать legacy, пока
   * блок совместимости не опустел, а у них своя ветка возврата
   * (`return_dept` → этап). На 23.08 их четыре.
   */

  return (
    <>
      <PageHead
        title="Подряд"
        sub="Этапы маршрута, отданные подрядчикам: где заказ сейчас и что дальше."
      />

      {/*
        Воронка — сводка по РАБОТЕ, и при её отсутствии она девять раз пишет
        ноль над словами «Подрядных этапов нет» (обход 04.09). Пустая сводка
        занимает первый экран и ничего не сообщает; список ниже отвечает
        то же самое одной строкой.
      */}
      {rows.length > 0 && (
        <StageIndicator variant="funnel" title="Подрядные этапы по фазам" nodes={funnel} />
      )}

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
      {/* Реестр подряда — свои данные и свой отказ (правка 03.09): без флага
          строки рисовались с `sub = null`, то есть «Запланировано» и пустые
          числа у ВСЕХ операций разом — экран выглядел рабочим и врал */}
      {subcontractingError && !subcontractingLoaded && (
        <LoadFailed onRetry={loadSubcontracting} what="карточки подрядчиков" />
      )}
      {/* Скелетона здесь не было: пока заказы едут, экран показывал пустоту,
          неотличимую от «подрядных этапов нет» (правило UX-2) */}
      {!loaded && !loadError && <TableSkeleton rows={5} label="Загрузка подрядных этапов" />}
      {loaded && rows.length === 0 && (
        <EmptyState
          icon="truck"
          title="Подрядных этапов нет"
          text="Подряд заводится в карточке заказа: вкладка «Позиции» → «Изменить маршрут» → участок «Подряд»."
        />
      )}
      {rows.length > 0 && shown.length === 0 && (
        <EmptyResult query={query.trim()} onReset={() => setQuery('')} />
      )}

      {/*
        КОМПАКТНАЯ РАСКЛАДКА (планшет цеха). Таблица здесь из десяти колонок,
        и кнопка «Этап» — та, ради которой на экран приходят, — стоит последней:
        ниже 1024px она уезжала за край. Содержимое обеих раскладок общее
        (`StageFields`), различается только обёртка.
      */}
      {shown.length > 0 && compact && (
        <div className={styles.dataCardList}>
          {shown.map(({ order, item, stage, sub, view }) => {
            const overdue = subcontractOverdue(
              sub?.planned_date, sub?.returned_date, view.stored, today);
            const next = nextRouteStage(item, stage);
            const open = openRow === stage.id;
            return (
              <div key={stage.id}>
                <StageRowCard
                  order={order}
                  item={item}
                  stage={stage}
                  sub={sub}
                  view={view}
                  next={next}
                  phase={view.display}
                  delayed={overdue && view.stored !== 'returned'}
                  phaseChipClass={PHASE_CHIP[view.display]}
                  deptName={deptNameById.get(stage.department_id)}
                  nextDeptName={next && deptNameById.get(next.department_id)}
                  overdue={overdue}
                  canManage={canManage}
                  open={open}
                  onToggle={() => setOpenRow(open ? null : stage.id)}
                  onUpdate={updateSubcontractOp}
                />
                {open && sub && (
                  <StageDetails
                    order={order}
                    item={item}
                    stage={stage}
                    sub={sub}
                    view={view}
                    canManage={canManage}
                    deptById={deptById}
                    deptNameById={deptNameById}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {shown.length > 0 && !compact && (
        <ScrollHintBox className={styles.tableWrap} wrapClassName={styles.scrollHintGapTop} label="Подрядные этапы">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{SUBCONTRACT_LABELS.order}</th>
                <th>{SUBCONTRACT_LABELS.item}</th>
                <th>{SUBCONTRACT_LABELS.qty}</th>
                <th>{SUBCONTRACT_LABELS.operation}</th>
                <th>{SUBCONTRACT_LABELS.location}</th>
                <th>{SUBCONTRACT_LABELS.dates}</th>
                <th>{SUBCONTRACT_LABELS.state}</th>
                <th>{SUBCONTRACT_LABELS.stage}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ order, item, stage, sub, view }) => {
                const phase = view.display;
                const next = nextRouteStage(item, stage);
                const overdue = subcontractOverdue(
                  sub?.planned_date, sub?.returned_date, view.stored, today);
                const delayed = overdue && view.stored !== 'returned';
                const open = openRow === stage.id;
                return [
                  <tr key={stage.id}>
                    <td><OrderCell order={order} /></td>
                    <td><ItemCell item={item} /></td>
                    <td className={styles.progressCell}>
                      <WorkQtyCell item={item} view={view} />
                    </td>
                    {/*
                      ОПЕРАЦИЯ И ПОДРЯДЧИК — ОДНА ЯЧЕЙКА (обход 04.09):
                      это ответ на один вопрос, «что и кем делается», а десять
                      колонок на 1280px уводили за правый край «Состояние»
                      и «Этап» — ту самую кнопку, ради которой на экран приходят.
                    */}
                    <td>
                      <OperationCell
                        stage={stage}
                        sub={sub}
                        deptName={deptNameById.get(stage.department_id)}
                      />
                      <div className={styles.subText}>{stage.contractor || '—'}</div>
                    </td>
                    {/*
                      ГДЕ СЕЙЧАС И ЧТО ДАЛЬШЕ — ОДНА ЯЧЕЙКА. «Следующий этап»
                      требует документ 20.08 («вернулось» ≠ «готово»), поэтому
                      колонка не снимается, а объединяется с местоположением:
                      оба отвечают на «где заказ», только в разное время.
                    */}
                    <td>
                      <LocationCell item={item} stage={stage} view={view} />
                      <NextStageCell
                        next={next}
                        deptName={next && deptNameById.get(next.department_id)}
                      />
                    </td>
                    <td>
                      <DatesCell
                        stage={stage}
                        sub={sub}
                        overdue={overdue}
                        canManage={canManage}
                        onUpdate={updateSubcontractOp}
                      />
                    </td>
                    <td>
                      <StateCell
                        stage={stage}
                        sub={sub}
                        phase={phase}
                        delayed={delayed}
                        phaseChipClass={PHASE_CHIP[phase]}
                        canManage={canManage}
                        onUpdate={updateSubcontractOp}
                      />
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
                    <tr key={`${stage.id}-details`}>
                      <td colSpan={10}>
                        {/*
                          Раскладку раскрытой карточки держит `StageDetails`
                          (п. 3.2): сверху рабочая строка и одно главное
                          действие, ниже — свёрнутые служебные блоки. Маршрут
                          позиции тоже там, отдельным блоком: он отвечает
                          на вопрос «что дальше», а не «что нажать сейчас».
                        */}
                        <StageDetails
                          order={order}
                          item={item}
                          stage={stage}
                          sub={sub}
                          view={view}
                          canManage={canManage}
                          deptById={deptById}
                          deptNameById={deptNameById}
                        />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </ScrollHintBox>
      )}

    </>
  );
}
