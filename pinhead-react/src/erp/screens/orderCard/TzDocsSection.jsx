import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { TzViewer } from '../../components/TzViewer';
import { Icon } from '../../components/Icon';
import { deptShortName } from '../../data/departments';
import {
  deptNeedsTz,
  documentHistory,
  itemTzDocument,
  itemTzDocuments,
  missingTzMessage,
  missingTzItems,
} from '../../utils/tz';
import styles from '../../styles';
import { Button } from '../../components/Button';

/**
 * Управление PDF-ТЗ позиции: загрузка общего ТЗ и файла позиции, замена файла новой
 * версией и просмотр внутри ERP.
 *
 * Ключевое: ТЗ принадлежит ПОЗИЦИИ и автоматически доступно всем цехам её маршрута.
 * Поцеховое назначение отменено правкой менеджера 2026-08-03 — оно требовало выбрать
 * один и тот же файл в N выпадающих списках и блокировало заказ, если хоть один
 * пропущен. Замена файла обновляет ТЗ у всех цехов сразу, как и раньше.
 * Загрузка и замена — по праву `tz.manage`; смотреть и скачивать может каждый.
 */

/**
 * Кнопка выбора PDF: скрытый input + примитив `Button`.
 *
 * Здесь стоял глобальный `btn btn-secondary` — язык Order Studio с его
 * uppercase-типографикой, и это было ЕДИНСТВЕННОЕ такое место в разделе.
 * Правило проекта прямое: кнопки ERP — только примитив (у него свои размеры,
 * состояния и ≥44px на тач-экранах, которых глобальный класс не даёт).
 */
function PdfButton({ label, onPick, disabled, variant = 'secondary' }) {
  const ref = useRef(null);
  return (
    <>
      <Button
        variant={variant}
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
    </>
  );
}

export function TzDocsSection({ order, item, deptById }) {
  const { uploadTzDocument, replaceTzDocument } = useErpStore(
    useShallow((s) => ({
      uploadTzDocument: s.uploadTzDocument,
      replaceTzDocument: s.replaceTzDocument,
    })),
  );
  const access = useErpAccess();
  const canManage = access.can('tz.manage');
  const [busy, setBusy] = useState(false);

  const options = itemTzDocuments(order, item.id);
  // ТЗ требуют только производственные цеха — закупку и склады не гейтим
  const stages = (item.stages ?? []).filter(
    (st) => st.status !== 'skipped' && deptNeedsTz(deptById.get(st.department_id)));

  const upload = async (file, itemId) => {
    setBusy(true);
    await uploadTzDocument({ orderId: order.id, itemId, file });
    setBusy(false);
  };

  const replace = async (groupId, file) => {
    setBusy(true);
    await replaceTzDocument(groupId, file);
    setBusy(false);
  };

  // Тот самый файл, который увидит каждый цех маршрута этой позиции
  const effective = itemTzDocument(order, item.id);

  return (
    <div className={styles.tzBlock}>
      {canManage && (
        <div className={styles.checkRow}>
          <PdfButton
            label="+ Общее ТЗ заказа (PDF)"
            disabled={busy}
            onPick={(f) => upload(f, null)}
          />
          <PdfButton
            label="+ ТЗ этой позиции (PDF)"
            disabled={busy}
            onPick={(f) => upload(f, item.id)}
          />
          <span className={styles.subText}>Только PDF, до 15 МБ</span>
        </div>
      )}

      {options.length === 0 ? (
        <div className={styles.subText}>
          ТЗ в PDF не загружено.
          {canManage ? ' Загрузите файл — он сразу станет доступен всем цехам маршрута позиции.' : ''}
        </div>
      ) : (
        options.map((doc) => {
          const history = documentHistory(order, doc.group_id);
          return (
            <TzViewer
              key={doc.group_id}
              doc={doc}
              compact
              /* Если у позиции есть и своё ТЗ, и общее на заказ, цеха работают
                 по своему — без пометки было бы не понять, по какому именно */
              badge={(
                <>
                  {doc.item_id === null && (
                    <span className={`${styles.chip} ${styles.chipNeutral}`}>общее ТЗ заказа</span>
                  )}
                  {effective?.group_id === doc.group_id && (
                    <span className={`${styles.chip} ${styles.chipDone}`}>цеха работают по нему</span>
                  )}
                </>
              )}
              actions={canManage ? (
                <PdfButton
                  label="Заменить файл"
                  variant="ghost"
                  disabled={busy}
                  onPick={(f) => replace(doc.group_id, f)}
                />
              ) : (
                history.length > 1
                  ? <span className={styles.subText}>версий: {history.length}</span>
                  : null
              )}
            />
          );
        })
      )}

      {/* Не выбор, а справка: цеха ТЗ не выбирают — оно у позиции одно на всех */}
      <div className={styles.tzAssignRow}>
        <span className={styles.tzAssignDept}>По этому ТЗ работают</span>
        {stages.length === 0 ? (
          <span className={styles.subText}>в маршруте позиции нет производственных цехов</span>
        ) : effective ? (
          <span>
            {stages
              .map((st) => {
                const dept = deptById.get(st.department_id);
                return dept ? deptShortName(dept.code, dept.name) : '—';
              })
              .join(' · ')}
          </span>
        ) : (
          <span className={styles.tzAssignMissing}>
            ТЗ не загружено — цеха не смогут начать работу
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Красный баннер «не загружено ТЗ» по всему заказу — для заказов, заведённых до
 * внедрения ТЗ, и для позиций, оставшихся без документа.
 */
export function TzMissingBanner({ order, departments }) {
  const setTzRequired = useErpStore((s) => s.setTzRequired);
  const access = useErpAccess();
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const missing = missingTzItems(order, deptById);
  const message = missingTzMessage(missing, 'Заказ не запустится');

  if (order.tz_required === false) {
    return (
      <div className={styles.queueReason}>
        <Icon name="orders" size={14} /> Заказ заведён до внедрения ТЗ в PDF — гейт к нему не применяется.
        {/*
          ПРАВО `order.manage`, А НЕ `tz.manage` (правка 03.09, решение владельца).
          `tz_required` — колонка ЗАКАЗА, и серверный страж `erp_order_guard`
          держит её в одном блоке со сроком, менеджером и упаковкой, то есть
          под `order.manage`. Кнопка же стояла под `tz.manage`, а это право
          есть у технолога, у которого `order.manage` нет: он видел кнопку,
          нажимал — и получал 42501, а оптимистичная правка откатывалась.
          Классическое «кнопка есть, действие падает»; гейт интерфейса обязан
          совпадать со стражем ЗНАЧЕНИЕМ.
        */}
        {access.can('order.manage') && (
          <>
            {' '}
            <Button variant="ghost" onClick={() => setTzRequired(order.id, true)}>
              Требовать ТЗ
            </Button>
          </>
        )}
      </div>
    );
  }
  if (!message) return null;
  return (
    <div className={`${styles.queueReason} ${styles.overdue}`}>
      <Icon name="ban" size={14} /> {message}
    </div>
  );
}
