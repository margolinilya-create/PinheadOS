import { useState } from 'react';
import useWorkshopStore from '../store/useWorkshopStore';
import { WORKSHOP_MAP, ROUTE_TEMPLATES, PROBLEM_TYPES } from '../data/workshops';
import OrderTimeline from './OrderTimeline';
import HandoffDialog from './HandoffDialog';
import QCChecklist from './QCChecklist';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES } from '../data/labels';
import styles from './TaskDetail.module.css';
import TaskDetailHeader from './task-detail/TaskDetailHeader';
import TaskDetailActions from './task-detail/TaskDetailActions';
import TaskDetailComments from './task-detail/TaskDetailComments';
import TaskDetailPhotos from './task-detail/TaskDetailPhotos';

const DEFECT_TYPES = [
  { code: 'print',   label: 'Брак печати' },
  { code: 'sewing',  label: 'Брак пошива' },
  { code: 'fabric',  label: 'Брак ткани' },
  { code: 'other',   label: 'Другое' },
];

function DefectSection({ taskId, totalUnits }) {
  const defect = useWorkshopStore(s => s.defects[taskId]);
  const reportDefect = useWorkshopStore(s => s.reportDefect);

  const [count, setCount] = useState(defect?.count ?? 0);
  const [type, setType] = useState(defect?.type ?? 'print');
  const [notes, setNotes] = useState(defect?.notes ?? '');
  const [saved, setSaved] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    reportDefect(taskId, Number(count), type, notes);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const goodUnits = Math.max(0, totalUnits - (defect?.count || 0));
  const yieldPct = totalUnits > 0 ? Math.round((goodUnits / totalUnits) * 100) : 100;

  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>Брак</div>

      {defect && (
        <div className={styles.defectSummary}>
          <div className={styles.defectYield}>
            <span className={styles.defectYieldVal} style={{ color: yieldPct >= 95 ? 'var(--color-success)' : yieldPct >= 80 ? 'var(--color-warning)' : 'var(--color-error)' }}>
              {yieldPct}% годных
            </span>
            <span className={styles.defectYieldSub}>
              {goodUnits} / {totalUnits} шт — брак: {defect.count} шт ({DEFECT_TYPES.find(d => d.code === defect.type)?.label || defect.type})
            </span>
          </div>
        </div>
      )}

      <form className={styles.defectForm} onSubmit={handleSubmit}>
        <div className={styles.defectRow}>
          <label className={styles.defectLabel}>Количество брака</label>
          <input
            type="number"
            min="0"
            max={totalUnits}
            value={count}
            onChange={e => setCount(e.target.value)}
            className={styles.defectInput}
          />
        </div>
        <div className={styles.defectRow}>
          <label className={styles.defectLabel}>Тип брака</label>
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className={styles.defectSelect}
          >
            {DEFECT_TYPES.map(d => (
              <option key={d.code} value={d.code}>{d.label}</option>
            ))}
          </select>
        </div>
        <input
          type="text"
          placeholder="Примечание (необязательно)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className={styles.defectNotes}
        />
        <button type="submit" className={`${styles.defectBtn}${saved ? ' ' + styles.defectBtnSaved : ''}`}>
          {saved ? 'Сохранено ✓' : 'Зафиксировать'}
        </button>
      </form>
    </div>
  );
}

const COLOR_NAMES = {
  white: 'Белый',
  black: 'Чёрный',
  navy: 'Тёмно-синий',
  grey: 'Серый',
  red: 'Красный',
  yellow: 'Жёлтый',
};

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </div>
  );
}

function WorkshopSpecificDetails({ task, order }) {
  const item = order?.data?.items?.[0];
  if (!item) return null;
  const ws = task.workshop_code;

  if (ws === 'screen' || ws === 'dtf') {
    const zones = item.zones || [];
    if (!zones.length) return null;
    return (
      <div className={styles.zones}>
        {zones.map(z => {
          const tech = item.zoneTechs?.[z];
          return (
            <div key={z} className={styles.zoneRow}>
              <span className={styles.zoneName}>{ZONE_LABELS[z] || z}</span>
              <span className={styles.zoneTech}>{TECH_NAMES[tech] || tech || '—'}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (ws === 'embroidery') {
    const zones = (item.zones || []).filter(z => item.zoneTechs?.[z] === 'embroidery');
    if (!zones.length) return null;
    return (
      <div className={styles.zones}>
        {zones.map(z => (
          <div key={z} className={styles.zoneRow}>
            <span className={styles.zoneName}>{ZONE_LABELS[z] || z}</span>
            <span className={styles.zoneTech}>Вышивка</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

export default function TaskDetail() {
  const task = useWorkshopStore(s => s.tasks.find(t => t.id === s.selectedTaskId));
  const orders = useWorkshopStore(s => s.orders);
  const showHandoff = useWorkshopStore(s => s.showHandoff);
  const closeTask = useWorkshopStore(s => s.closeTask);

  if (!task) return null;

  const order = orders[task.order_id];
  const item = order?.data?.items?.[0];
  const typeName = TYPE_NAMES[item?.type] || item?.type || '—';
  const fabricName = FABRIC_NAMES[item?.fabric] || item?.fabric || '—';
  const colorName = COLOR_NAMES[item?.color] || item?.color || '—';
  const fitName = item?.fit === 'oversize' ? 'Оверсайз' : item?.fit === 'regular' ? 'Регуляр' : item?.fit || '—';

  const sizesStr = item?.sizes
    ? Object.entries(item.sizes).map(([sz, qty]) => `${sz}×${qty}`).join(', ')
    : '—';

  const route = order ? ROUTE_TEMPLATES[order.route] : [];
  const currentIdx = route.indexOf(task.workshop_code);
  const prevWorkshopCode = currentIdx > 0 ? route[currentIdx - 1] : null;
  const prevWs = prevWorkshopCode ? WORKSHOP_MAP[prevWorkshopCode] : null;

  const problemLabel = PROBLEM_TYPES.find(p => p.code === task.problem_type)?.label;

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) closeTask();
  }

  return (
    <>
      <div className={styles.backdrop} onClick={handleBackdropClick}>
        <div className={styles.panel}>
          <TaskDetailHeader task={task} order={order} />

          {/* Scrollable body */}
          <div className={styles.panelBody}>
            {/* Order info */}
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Заказ</div>
              <DetailRow label="Клиент" value={order?.data?.name} />
              <DetailRow label="Изделие" value={typeName} />
              <DetailRow label="Ткань" value={fabricName} />
              <DetailRow label="Цвет" value={colorName} />
              <DetailRow label="Крой" value={fitName} />
              <DetailRow label="Кол-во" value={`${task.total_units} шт`} />
              <DetailRow label="Размеры" value={sizesStr} />
            </div>

            {/* Timeline */}
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Маршрут заказа</div>
              <OrderTimeline orderId={task.order_id} currentTaskId={task.id} compact={false} />
            </div>

            {/* Handoff note from prev workshop */}
            {task.handoff_note && prevWs && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>От {prevWs.name}</div>
                <div className={styles.handoffNote}>
                  <span className={styles.handoffNoteIcon}>💬</span>
                  {task.handoff_note}
                </div>
              </div>
            )}

            {/* Workshop-specific details */}
            {(task.workshop_code === 'screen' || task.workshop_code === 'dtf' || task.workshop_code === 'embroidery') && item?.zones?.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>Зоны печати</div>
                <WorkshopSpecificDetails task={task} order={order} />
              </div>
            )}

            {/* Blocked info */}
            {task.status === 'blocked' && (
              <div className={styles.blockedBox}>
                <div className={styles.blockedTitle}>
                  ⚠ Заблокировано{problemLabel ? `: ${problemLabel}` : ''}
                </div>
                {task.problem_note && (
                  <div className={styles.blockedNote}>{task.problem_note}</div>
                )}
              </div>
            )}

            {/* QC Checklist for packaging_qc */}
            {task.workshop_code === 'packaging_qc' && (
              <QCChecklist taskId={task.id} />
            )}

            {/* Defect tracking for packaging_qc */}
            {task.workshop_code === 'packaging_qc' && (
              <DefectSection taskId={task.id} totalUnits={task.total_units} />
            )}

            <TaskDetailPhotos taskId={task.id} />
            <TaskDetailComments taskId={task.id} />
          </div>

          <TaskDetailActions task={task} />
        </div>
      </div>

      {showHandoff && <HandoffDialog />}
    </>
  );
}
