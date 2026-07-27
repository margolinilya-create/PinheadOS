import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { TzViewer } from '../../components/TzViewer';
import { deptShortName } from '../../data/departments';
import {
  currentVersion,
  deptNeedsTz,
  documentHistory,
  itemTzDocuments,
  missingTzMessage,
  missingTzStages,
  tzAssignmentFor,
} from '../../utils/tz';
import styles from '../../erp.module.css';

/**
 * Управление PDF-ТЗ позиции (волна 4): загрузка общего ТЗ и файлов позиции,
 * назначение документа каждому производственному цеху маршрута, замена файла новой
 * версией и просмотр внутри ERP.
 *
 * Ключевое: назначение хранит `group_id`, поэтому замена файла обновляет ТЗ сразу
 * у всех цехов, которым он назначен, — переназначать ничего не нужно.
 * Загрузка и назначение — по праву `tz.manage`; смотреть и скачивать может каждый.
 */

/** Кнопка выбора PDF: скрытый input + внешний вид обычной кнопки */
function PdfButton({ label, onPick, disabled, variant = 'btn-secondary' }) {
  const ref = useRef(null);
  return (
    <>
      <button
        type="button"
        className={`btn ${variant}`}
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        {label}
      </button>
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
  const { uploadTzDocument, replaceTzDocument, assignTz } = useErpStore(
    useShallow((s) => ({
      uploadTzDocument: s.uploadTzDocument,
      replaceTzDocument: s.replaceTzDocument,
      assignTz: s.assignTz,
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

  const assign = async (departmentId, groupId) => {
    if (!groupId) return;
    setBusy(true);
    await assignTz({ orderId: order.id, itemId: item.id, departmentId, groupId });
    setBusy(false);
  };

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
          ТЗ в PDF не загружено. {canManage ? 'Загрузите файл и назначьте его цехам.' : ''}
        </div>
      ) : (
        options.map((doc) => {
          const history = documentHistory(order, doc.group_id);
          return (
            <TzViewer
              key={doc.group_id}
              doc={doc}
              compact
              badge={doc.item_id === null
                ? <span className={`${styles.chip} ${styles.chipNeutral}`}>общее ТЗ заказа</span>
                : null}
              actions={canManage ? (
                <PdfButton
                  label="Заменить файл"
                  variant="btn-ghost"
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

      <div>
        <div className={styles.matSectionHead}><strong>Кто по какому ТЗ работает</strong></div>
        {stages.length === 0 && (
          <div className={styles.subText}>В маршруте позиции нет производственных цехов.</div>
        )}
        {stages.map((st) => {
          const dept = deptById.get(st.department_id);
          const assignment = tzAssignmentFor(order, item.id, st.department_id);
          const doc = assignment ? currentVersion(order.tz_documents, assignment.group_id) : null;
          return (
            <div key={st.id} className={styles.tzAssignRow}>
              <span className={styles.tzAssignDept}>
                {dept ? deptShortName(dept.code, dept.name) : '—'}
              </span>
              {canManage ? (
                <select
                  className={styles.select}
                  value={assignment?.group_id ?? ''}
                  disabled={busy || options.length === 0}
                  aria-label={`ТЗ для цеха ${dept?.name || ''}`}
                  onChange={(e) => assign(st.department_id, e.target.value)}
                >
                  <option value="">— не назначено —</option>
                  {options.map((o) => (
                    <option key={o.group_id} value={o.group_id}>
                      {o.item_id === null ? 'Общее ТЗ: ' : ''}{o.file_name || 'ТЗ.pdf'}
                      {o.version > 1 ? ` (v${o.version})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={doc ? undefined : styles.tzAssignMissing}>
                  {doc ? (doc.file_name || 'ТЗ.pdf') : 'не назначено'}
                </span>
              )}
              <span className={styles.subText}>
                {doc ? `версия ${doc.version}` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Красный баннер «не назначено ТЗ» по всему заказу — для заказов, заведённых до
 * внедрения ТЗ, и для этапов, добавленных переносом между цехами.
 */
export function TzMissingBanner({ order, departments }) {
  const setTzRequired = useErpStore((s) => s.setTzRequired);
  const access = useErpAccess();
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const nameById = new Map(departments.map((d) => [d.id, deptShortName(d.code, d.name)]));
  const missing = missingTzStages(order, deptById);
  const message = missingTzMessage(missing, nameById, 'Заказ не запустится');

  if (order.tz_required === false) {
    return (
      <div className={styles.queueReason}>
        📄 Заказ заведён до внедрения ТЗ в PDF — гейт к нему не применяется.
        {access.can('tz.manage') && (
          <>
            {' '}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setTzRequired(order.id, true)}
            >
              Требовать ТЗ
            </button>
          </>
        )}
      </div>
    );
  }
  if (!message) return null;
  return <div className={`${styles.queueReason} ${styles.overdue}`}>🚫 {message}</div>;
}
