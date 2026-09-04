import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { Badge } from '../components/Badge';
import { RouteProgress } from '../components/RouteProgress';
import { ScreenSkeleton } from '../components/ErpSkeletons';
import { LoadFailed } from '../components/ErpStates';
import { useErpStore, orderPreviewUrl } from '../store/useErpStore';
import { useStagePermissions } from '../store/useStagePermissions';
import { findStage } from '../store/orderHelpers';
import { deptShortName } from '../data/departments';
import { isStageAwaitingProcurement, isStageReady, waitingReason, materialsForItem } from '../utils/routes';
import { stageMissingTz } from '../utils/tz';
import { stageQtyProgress } from '../utils/progress';
import { STAGE_CHIP_CLASS } from '../utils/stageUi';
import { daysLeft, formatDateShort, stageOverdue } from '../utils/time';
import { MATERIAL_STATUS_LABELS, STAGE_STATUS_LABELS } from '../types';
import { supabase } from '../../lib/supabase';
import styles from '../styles';
import DeptBindingNotice from '../components/DeptBindingNotice';
import { Icon } from '../components/Icon';
import { StageActionsPanel } from './queue/StageActionsPanel';
import { useStageActions } from './queue/useStageActions';
import { CommentsSection } from './orderCard/CommentsSection';
import { useOrderDetail } from './orderCard/useOrderDetail';
import { dueLabelCompact } from '../utils/format';
import { ButtonLink } from '../components/Button';

/**
 * Страница производственного задания (правка 5): всё, что нужно исполнителю, —
 * задание, заказ, клиент, изделие, количество, материал, срок, ТЗ, файлы,
 * комментарии, исполнитель, прогресс, маршрут по стадиям и выполненное количество.
 * Действия («Взять в работу», «Записать результат», «Проблема», «Завершить этап»)
 * общие с очередью цеха — StageActionsPanel + useStageActions.
 *
 * Номер заказа — кликабельная ссылка на полную карточку (правка 6).
 */
export default function ProductionTask() {
  const { stageId } = useParams();
  const {
    orders, departments, loaded, loadError, loadAll, findOrderIdByStage, myDeptLoaded,
    detailError,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      myDeptLoaded: s.myDeptLoaded,
      detailError: s.detailError,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      findOrderIdByStage: s.findOrderIdByStage,
    })),
  );
  const actions = useStageActions();
  const location = useLocation();
  const [resolvedOrderId, setResolvedOrderId] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  const found = useMemo(() => findStage(orders, stageId), [orders, stageId]);

  // Диплинк на задание архивного/чужого заказа: в сторе его нет — резолвим заказ по этапу
  useEffect(() => {
    if (!loaded || found || resolvedOrderId || notFound) return undefined;
    let alive = true;
    findOrderIdByStage(stageId).then((id) => {
      if (!alive) return;
      if (id) setResolvedOrderId(id);
      /**
       * «Не найдено» — только когда сервер ОТВЕТИЛ и этапа действительно нет
       * (правка 03.09). При сбое запроса функция тоже отдавала `null`,
       * и рабочий по ссылке на задание читал «Задание не найдено или было
       * удалено» — про задание, которое на месте. Отказ теперь виден
       * во флаге `detailError` и показывается «Не удалось загрузить».
       */
      else if (!useErpStore.getState().detailError) setNotFound(true);
    });
    return () => { alive = false; };
  }, [loaded, found, resolvedOrderId, notFound, findOrderIdByStage, stageId]);

  // Комментарии/история/вложения — общий хук карточки заказа
  const detail = useOrderDetail(found?.order.id ?? resolvedOrderId ?? null);

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const deptNameById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const deptShortById = useMemo(
    () => new Map(departments.map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments],
  );

  // Хук прав — до ранних выходов (правило хуков): цех берём из найденного этапа
  const perms = useStagePermissions(found?.stage.department_id ?? null);

  if (loadError && !loaded) {
    return (
      <>
        <PageHead title="Производственное задание" sub="Задание цеха по позиции заказа." />
        <LoadFailed onRetry={loadAll} what="задание" />
      </>
    );
  }
  if (!loaded) return <ScreenSkeleton />;
  if (!found) {
    // Сбой резолва этапа — отдельная ветка, с кнопкой повтора
    if (detailError && !notFound) {
      return (
        <>
          <PageHead title="Производственное задание" />
          <LoadFailed onRetry={() => { setNotFound(false); loadAll(); }} what="задание" />
        </>
      );
    }
    // Диплинк на задание архивного заказа: резолвим его отдельным запросом —
    // до ответа показываем скелетон, а не текст «Загружаем…» (правило DESIGN.md)
    if (!notFound) return <ScreenSkeleton />;
    return (
      <>
        <PageHead title="Производственное задание" sub="Задание цеха по позиции заказа." />
        <div className={styles.emptyState}>Задание не найдено или было удалено.</div>
      </>
    );
  }

  const { order, item, stage } = found;
  const dept = deptById.get(stage.department_id);
  const itemMaterials = materialsForItem(order.materials, item.id);
  const deptName = dept ? deptShortName(dept.code, dept.name) : 'Цех';
  const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, stage.id);
  const noTz = stageMissingTz(order, item.id, dept);
  const ready = stage.status === 'waiting'
    && isStageReady(stage, item.stages, materialsForItem(order.materials, item.id),
      dept, awaitProc, noTz);
  const group = stage.status === 'waiting' && ready ? 'ready' : stage.status;
  const display = group === 'ready' ? 'ready' : stage.status;
  const reason = (display === 'waiting' || display === 'blocked')
    ? waitingReason(
        stage, item.stages, materialsForItem(order.materials, item.id),
        deptNameById, dept, awaitProc, noTz)
    : null;
  const progress = stageQtyProgress(stage, item.qty);
  const d = daysLeft(order.due_date);
  const overdue = stageOverdue(stage.planned_end, stage.status);
  const preview = orderPreviewUrl(order);
  const entry = { order, item, stage, group, reason };

  return (
    <>
      <PageHead
        title={`${deptName}: ${item.product_type}${item.variant ? ` · ${item.variant}` : ''}`}
        sub={`Задание цеха по заказу №${order.bitrix_id || '—'}.`}
      />

      {/*
        Сюда цех приходит работать: пустой блок действий обязан объясниться.
        Но ЖДЁМ БУТСТРАП (правка 03.09): до него `resolveErpRole` отдаёт
        `worker`, а он в `DEPT_BOUND_ROLES` — и нормально заведённому рабочему
        полсекунды показывали, что его профиль не настроен. В очереди цеха это
        условие уже стоит, сюда не доехало.
      */}
      {myDeptLoaded && perms.needsDeptBinding && <DeptBindingNotice />}

      <div className={styles.toolbar}>
        {/*
          Образец экс-цеха. Пометка стояла в строке и карточке очереди, а сюда
          цех приходит РАБОТАТЬ — и именно здесь важно понимать, что тираж
          один-два, а спрос другой (документ 20.08: «заметная пометка
          ЭКС / ОБРАЗЕЦ»). В маршрутную логику признак не входит: образец
          проходит те же гейты и переходы.
        */}
        {stage.origin === 'experimental' && (
          <span
            className={`${styles.chip} ${styles.chipWaiting}`}
            title="Образец из экспериментального цеха — разработка, а не серия"
          >
            <Icon name="flask" size={13} /> ЭКС / ОБРАЗЕЦ
          </span>
        )}
        {/* Заказ открывается своей страницей и помнит, откуда пришли */}
        <ButtonLink
          to={`/orders/${order.id}`}
          state={{ from: `${location.pathname}${location.search}` }}
          variant="secondary"
        >
          Открыть заказ №{order.bitrix_id || '—'} ↗
        </ButtonLink>
        {/* Возврат туда, откуда пришли: ссылка без search теряла и фильтры,
            и позицию прокрутки (useScrollRestore ключуется по pathname+search) */}
        <ButtonLink
          to={location.state?.from || `/queue/${dept?.code ?? ''}`}
          variant="ghost"
        >
          ← В очередь цеха
        </ButtonLink>
        <div className={styles.spacer} />
        <span className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[display]]}`}>
          {STAGE_STATUS_LABELS[display]}
        </span>
        {overdue && (
          <Badge variant="blocked"><Icon name="clock" size={13} /> Этап просрочен</Badge>
        )}
      </div>

      {/*
        ТЗ И ДЕЙСТВИЯ — ПЕРВЫМИ (§6.2 обхода 04.09, блокер Б4).
        Страница задания монтирует ту же панель, что строка очереди, и своей
        роли не имела: очередь отвечает «что взять следующим», страница —
        «работаю над этим». Отвечать на второй вопрос она начинала третьим
        экраном: сверху лежали справка «Задание» и «Маршрут и прогресс»,
        а ТЗ и кнопки — под ними. На 768×1024, ради которых пилот и запущен,
        это прокрутка до того, ради чего сюда пришли.
        Справка не убрана — она уехала ВНИЗ: к ней возвращаются глазами,
        а работают выше.
      */}
      <section className={styles.matSection}>
        <div className={styles.matSectionHead}><strong>ТЗ и действия</strong></div>
        {!perms.inDept && (
          <div className={`${styles.queueReason} ${styles.cellWithIcon}`}>
            <Icon name="eye" size={14} />Это не ваш цех — только просмотр.
          </div>
        )}
        <StageActionsPanel
          entry={entry}
          perms={perms}
          deptShortById={deptShortById}
          actions={actions}
        />
      </section>

      <div className={styles.taskGrid}>
        <section className={styles.matSection}>
          <div className={styles.matSectionHead}><strong>Задание</strong></div>
          <dl className={styles.taskFacts}>
            <dt>Заказ</dt>
            <dd>№{order.bitrix_id || '—'} · {order.title}</dd>
            <dt>Клиент</dt>
            <dd>{order.customer || '—'}</dd>
            <dt>Менеджер</dt>
            <dd>{order.manager || '—'}</dd>
            <dt>Изделие</dt>
            <dd>{item.product_type}{item.variant ? ` · ${item.variant}` : ''}</dd>
            <dt>Количество</dt>
            <dd className={styles.progressCell}>{item.qty} шт</dd>
            <dt>Выполнено</dt>
            <dd className={styles.progressCell}>{progress.done} из {progress.total} шт ({progress.pct}%)</dd>
            <dt>Срок клиента</dt>
            <dd className={d !== null && d < 0 ? styles.overdue : undefined}>
              {order.due_date ? formatDateShort(order.due_date) : '—'}
              {d !== null && ` · ${dueLabelCompact(d)}`}
            </dd>
            <dt>План этапа</dt>
            <dd>{stage.planned_end ? formatDateShort(stage.planned_end) : '—'}</dd>
            <dt>Исполнитель</dt>
            <dd>{stage.assignee || <span className={styles.subText}>не закреплено</span>}</dd>
            <dt>Материал</dt>
            <dd>
              {/*
                МАТЕРИАЛЫ ЭТОЙ ПОЗИЦИИ, А НЕ ВСЕГО ЗАКАЗА (правка 03.09).
                Здесь перечислялся `order.materials` целиком, тогда как гейты
                рядом считают через `materialsForItem`. В заказе из трёх
                изделий швея видела ткань чужого изделия и делала по ней вывод
                о своей готовности; пустой список при этом подписан
                «Материалы не ожидаются» — то есть утверждением.
              */}
              {itemMaterials.length > 0 ? (
                <ul className={styles.tzMatList}>
                  {itemMaterials.map((m) => (
                    <li key={m.id}>
                      {m.name}{m.color ? ` · ${m.color}` : ''}
                      <span className={styles.subText}> — {MATERIAL_STATUS_LABELS[m.status] || m.status}</span>
                    </li>
                  ))}
                </ul>
              ) : <span className={styles.subText}>Материалы не ожидаются.</span>}
            </dd>
          </dl>
          {reason && (
            <div className={styles.queueReason}>
              <span className={styles.cellWithIcon}><Icon name="clock" size={14} />{reason}</span>
            </div>
          )}
          {stage.status === 'blocked' && stage.block_reason && (
            <div className={`${styles.queueReason} ${styles.overdue}`}>
              <span className={styles.cellWithIcon}><Icon name="ban" size={14} />{stage.block_reason}</span>
            </div>
          )}
        </section>

        <section className={styles.matSection}>
          <div className={styles.matSectionHead}><strong>Маршрут и прогресс</strong></div>
          <RouteProgress
            item={item}
            order={order}
            deptById={deptById}
            currentStageId={stage.id}
          />
        </section>
      </div>

      <section className={styles.matSection}>
        <div className={styles.matSectionHead}><strong>Файлы</strong></div>
        {(order.attachments ?? []).length > 0 ? (
          <div className={styles.fileGrid}>
            {preview && (
              <a className={styles.fileCard} href={preview} target="_blank" rel="noreferrer">
                <span className={styles.cellWithIcon}>
                  <Icon name="image" size={15} />Превью макета
                </span>
              </a>
            )}
            {order.attachments.filter((a) => a.kind !== 'preview').map((a) => (
              <a
                key={a.id}
                className={styles.fileCard}
                href={supabase.storage.from('erp-attachments').getPublicUrl(a.file_path).data.publicUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="paperclip" size={14} /> {a.file_name || a.file_path}
              </a>
            ))}
          </div>
        ) : (
          <div className={styles.subText}>Файлов пока нет.</div>
        )}
      </section>

      <CommentsSection comments={detail.comments} onSend={detail.onSendComment} />
    </>
  );
}
