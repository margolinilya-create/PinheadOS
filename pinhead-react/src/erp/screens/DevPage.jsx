import { useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { Badge } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { Icon } from '../components/Icon';
import { LoadFailed, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { DEV_STATE_LABELS } from '../utils/filterExperimental';
import { devState, nextAction, currentBlocker } from '../utils/experimentalTasks';
import {
  cuttingGate,
  DEV_BRANDING_TASK_TYPES,
  DEV_STAGE_LABELS, devBoardColumn, devBrandingFromPrints, devStageStates,
} from '../utils/experimentalBoard';
import { findSupplyDept, openSupplyStages } from '../utils/supply';
import { neighbourStage } from '../utils/devBoardMove';
import { useDevStageMove } from '../hooks/useDevStageMove';
import { formatDateShort } from '../utils/time';
import { factoryToday } from '../../utils/date';
import { DevCard } from './experimental/DevCard';
import styles from '../styles';

/**
 * ПОЛНОЭКРАННАЯ КАРТОЧКА РАЗРАБОТКИ (правка заказчика 22.08, п. 4.11).
 *
 * «Сейчас разработка открывается в длинной боковой панели. Для такого
 * количества информации это неудобно. При клике на разработку основную работу
 * лучше открывать в полноценной карточке на отдельной странице».
 *
 * Шторки больше нет вовсе — то же решение, что 16.08 приняли для карточки
 * заказа: две поверхности с одним содержимым разъезжаются, а «быстрый
 * просмотр» здесь ничего не добавляет — в карточку приходят работать.
 *
 * СТАРЫЙ АДРЕС `?dev=<id>` ПРОДОЛЖАЕТ РАБОТАТЬ: он живёт в переписке
 * и в закладках, и молча приводить человека на список вместо разработки
 * нельзя. Редирект делает сам список.
 *
 * ГЕЙТ. `/experimental/<uuid>` закрыт тем же правом, что раздел: с 22.08
 * `canOpenScreen` сравнивает ПЕРВЫЙ СЕГМЕНТ пути, иначе подстраница
 * оказалась бы «незнакомым путём», то есть открытой всем.
 *
 * Шапка отвечает на три вопроса документа — где разработка, что с ней
 * происходит, что делать дальше, — и остаётся видимой над всей карточкой.
 */
export default function DevPage() {
  const { devId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    orders, detailIds, loadOne, departments, loaded, loadError, loadAll,
    experimental, experimentalLoaded, experimentalError, loadExperimental,
    updateExperimental, addDevTasks, updateDevTask, sendDevTaskToDept,
    closeExperimental, approveSample, uploadDevFile, deleteDevFile,
  } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    detailIds: s.detailIds,
    loadOne: s.loadOne,
    departments: s.departments,
    loaded: s.loaded,
    loadError: s.loadError,
    loadAll: s.loadAll,
    experimental: s.experimental,
    experimentalLoaded: s.experimentalLoaded,
      experimentalError: s.experimentalError,
    loadExperimental: s.loadExperimental,
    updateExperimental: s.updateExperimental,
    addDevTasks: s.addDevTasks,
    updateDevTask: s.updateDevTask,
    sendDevTaskToDept: s.sendDevTaskToDept,
    closeExperimental: s.closeExperimental,
    approveSample: s.approveSample,
    uploadDevFile: s.uploadDevFile,
    deleteDevFile: s.deleteDevFile,
  })));
  const canManage = useErpAccess().can('experimental.manage');
  // Перенос — та же реализация, что у доски (§3.6): порядок «закрыть свой этап →
  // записать колонку → завести нанесения» повторять второй раз нельзя
  const { requestMove } = useDevStageMove();

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => {
    if (!experimentalLoaded) loadExperimental();
  }, [experimentalLoaded, loadExperimental]);

  const dev = useMemo(
    () => (experimental ?? []).find((e) => e.id === devId) ?? null,
    [experimental, devId],
  );
  const order = useMemo(
    () => (dev ? (orders ?? []).find((o) => o.id === dev.order_id) ?? null : null),
    [orders, dev],
  );

  /**
   * ПОЛНЫЙ ЗАКАЗ ДОЗАГРУЖАЕТСЯ, как и в карточке заказа: справка разработки
   * показывает размерный ряд, а `items.size_grid` намеренно выброшен
   * из списочной выборки (`ORDER_LIST_SELECT`) — она едет по всем заказам.
   * Без дозагрузки строка молча стояла бы пустой при заполненных данных:
   * ровно тот отказ, от которого в проекте сторож `orderSelect.test.ts`.
   *
   * Проверка идёт по `detailIds`, а не по «есть ли заказ в сторе»: он там
   * есть всегда — списочный, без сетки.
   */
  const orderId = dev?.order_id ?? null;
  const hasDetail = orderId ? detailIds.includes(orderId) : true;
  useEffect(() => {
    if (!loaded || hasDetail || !orderId) return;
    loadOne(orderId);
  }, [loaded, hasDetail, orderId, loadOne]);

  /** Куда вернуться: ссылка принесла контекст списка (фильтры, вид, страница) */
  const back = location.state?.from || '/experimental';

  /**
   * Условие смешивало флаги ДВУХ доменов: `loadError` — про заказы,
   * `experimentalLoaded` — про разработки (правка 03.09). При живых заказах
   * и упавших разработках карточка замирала на скелетоне навсегда.
   */
  if (experimentalError && !experimentalLoaded) {
    return <LoadFailed onRetry={loadExperimental} what="разработку" />;
  }
  // Заказы — второй источник этой страницы (размерный ряд живёт в `size_grid`,
  // которого нет в списочной выборке), и их отказ тоже надо назвать
  if (loadError && !loaded) {
    return <LoadFailed onRetry={loadAll} what="заказ" />;
  }
  if (!experimentalLoaded) {
    return <TableSkeleton rows={6} label="Загрузка разработки" />;
  }
  if (!dev) {
    return (
      <EmptyState
        icon="flask"
        title="Разработка не найдена"
        text="Возможно, её закрыли или ссылка устарела."
        action={<ButtonLink to="/experimental">К списку разработок</ButtonLink>}
      />
    );
  }

  const tasks = dev.tasks ?? [];
  const today = factoryToday();
  const state = devState(dev, tasks, today);
  // Контекст шагов тот же, что у доски (правка 01.09): открыта ли закупка
  // заказа и есть ли у позиции нанесения. Иначе страница и доска показывали бы
  // разный маршрут одной разработки
  const stageStates = devStageStates({
    dev,
    tasks,
    materials: order?.materials ?? [],
    supplyOpen: openSupplyStages(order, findSupplyDept(departments)?.id).length > 0,
    hasBranding: devBrandingFromPrints(
      (order?.items ?? []).find((it) => it.id === dev.item_id)?.prints).length > 0,
  });
  const stage = devBoardColumn(stageStates, dev);
  const blocker = currentBlocker(tasks, new Map(), today);

  /**
   * ПЕРЕНОС КАРТОЧКИ СО СТРАНИЦЫ (§3.6 обхода 04.09). Со страницы разработки
   * карточку было не перенести вовсе, хотя диалоги переноса обещают «перейдёт»,
   * а страница с 22.08 — основное место работы технолога: шторку заказчик
   * отверг, доска отвечает на «что у всех», страница — на «что с этой».
   *
   * Соседний шаг считается ПО ПУТИ ЭТОЙ разработки, а не по общему порядку
   * колонок: у образца без нанесений «Дальше» из «Кроя» ведёт в «Пошив».
   * Контекст тот же, что у гейта, — иначе кнопка предлагала бы ход, который
   * тут же отклоняется.
   */
  /**
   * «Материалы держат крой» — тот же `cuttingGate`, что у доски и у карточки:
   * `devStageStates` отдаёт МАССИВ шагов, и читать из него `.materials.open`
   * нельзя — получится `undefined`, то есть «держат всегда».
   */
  const patternsDone = tasks.some((t) => t.task_type === 'patterns')
    && tasks.filter((t) => t.task_type === 'patterns')
      .every((t) => t.status === 'done' || t.status === 'cancelled');
  const materialsPending = !cuttingGate({
    patternsDone,
    itemId: dev.item_id,
    materials: order?.materials ?? [],
    supplyOpen: openSupplyStages(order, findSupplyDept(departments)?.id).length > 0,
  }).open;
  const hasBranding = devBrandingFromPrints(
    (order?.items ?? []).find((it) => it.id === dev.item_id)?.prints).length > 0;
  const brandingOpen = (dev.tasks ?? []).some(
    (t) => DEV_BRANDING_TASK_TYPES.includes(t.task_type) && t.status !== 'done');
  const moveCtx = { materialsPending, hasBranding };
  const prevStage = neighbourStage(stage, -1, moveCtx);
  const nextStage = neighbourStage(stage, 1, moveCtx);
  const moveTo = (to) => requestMove({
    devId: dev.id,
    from: stage,
    outcome: dev.outcome,
    canManage,
    materialsPending,
    hasBranding,
    brandingOpen,
  }, to);

  return (
    <>
      <PageHead
        title={dev.tech_name || 'Разработка'}
        sub={`№${dev.order?.bitrix_id || order?.bitrix_id || '—'} · ${dev.order?.title || order?.title || ''}`}
      />
      {/* Возврат несёт контекст списка (вид, фильтры, страница) — тем же
          приёмом, что «Назад» в карточке заказа: ключ `useScrollRestore` —
          это `pathname + search`, и без него теряется и подбор, и прокрутка */}
      <ButtonLink to={back} variant="secondary" className={styles.cellWithIcon}>
        <Icon name="chevronLeft" size={14} />К разработкам
      </ButtonLink>

      {/*
        Шапка первого уровня (п. 4.11): изделие · заказ · ответственный · срок ·
        текущий этап · статус · следующее действие. Всё остальное — ниже,
        в самой карточке.
      */}
      <div className={styles.checkRow}>
        <span className={styles.subText}>
          Текущий этап: <strong>{DEV_STAGE_LABELS[stage]}</strong>
        </span>
        <Badge variant={STATE_VARIANT[state] ?? 'neutral'}>{DEV_STATE_LABELS[state]}</Badge>
        <span className={styles.subText}>
          Ответственный: <strong>{dev.technologist || '—'}</strong>
        </span>
        <span className={styles.subText}>
          Срок: <strong>{dev.due_date ? formatDateShort(dev.due_date) : '—'}</strong>
        </span>
        {canManage && !dev.outcome && (prevStage || nextStage) && (
          <span className={styles.checkRow}>
            {prevStage && (
              <Button variant="ghost" onClick={() => moveTo(prevStage)}>
                <Icon name="chevronLeft" size={14} /> {DEV_STAGE_LABELS[prevStage]}
              </Button>
            )}
            {nextStage && (
              <Button variant="secondary" onClick={() => moveTo(nextStage)}>
                {DEV_STAGE_LABELS[nextStage]} <Icon name="chevronRight" size={14} />
              </Button>
            )}
          </span>
        )}
      </div>
      <div className={styles.subText}>
        Следующее действие: {nextAction(dev, tasks, new Map(), today) || '—'}
        {blocker ? ` · блокер: ${blocker.title || blocker.task_type}` : ''}
      </div>

      <DevCard
        dev={dev}
        order={order}
        departments={departments}
        canManage={canManage}
        onUpdate={updateExperimental}
        onAddTasks={(rows) => addDevTasks(dev.id, rows)}
        onUpdateTask={updateDevTask}
        onSendTask={sendDevTaskToDept}
        onClose={async (id, patch) => {
          const ok = await closeExperimental(id, patch);
          // Закрытая разработка исчезает из рабочих подборок — возвращаем
          // человека туда, откуда он пришёл, а не оставляем на карточке
          if (ok !== false) navigate(back);
          return ok;
        }}
        onApproveSample={approveSample}
        onUploadFile={uploadDevFile}
        onRemoveFile={deleteDevFile}
      />
    </>
  );
}

const STATE_VARIANT = {
  new: 'neutral', in_progress: 'progress', attention: 'blocked',
  fitting: 'waiting', ready: 'ready',
  // Переданные на склад (правка 30.08, п. 4). Пропуск здесь не роняет ничего —
  // Badge получил бы undefined и нарисовался нейтральным, то есть состояние
  // молча перестало бы отличаться от прочих
  handed: 'done',
};
