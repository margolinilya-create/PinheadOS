import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import { WORKSHOPS, WORKSHOP_MAP } from '../data/workshops';
import OrderTimeline from './OrderTimeline';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES } from '../data/labels';
import styles from './KioskView.module.css';

function SizesGrid({ sizes }) {
  if (!sizes) return null;
  const entries = Object.entries(sizes).filter(([, v]) => v > 0);
  if (!entries.length) return null;
  return (
    <div className={styles.sizesGrid}>
      {entries.map(([size, qty]) => (
        <div key={size} className={styles.sizeCell}>
          <div className={styles.sizeLabel}>{size}</div>
          <div className={styles.sizeQty}>{qty}</div>
        </div>
      ))}
    </div>
  );
}

function ZonesList({ item }) {
  if (!item || !item.zones || !item.zones.length) return null;
  return (
    <div className={styles.zones}>
      {item.zones.map(z => (
        <span key={z} className={styles.zoneTag}>
          {ZONE_LABELS[z] || z}
          {item.zoneTechs?.[z] && (
            <span className={styles.zoneTech}> · {TECH_NAMES[item.zoneTechs[z]] || item.zoneTechs[z]}</span>
          )}
        </span>
      ))}
    </div>
  );
}

export default function KioskView() {
  const navigate = useNavigate();

  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);
  const currentWorkshop = useWorkshopStore(s => s.currentWorkshop);
  const setWorkshop = useWorkshopStore(s => s.setWorkshop);
  const startTask = useWorkshopStore(s => s.startTask);
  const openProblemPicker = useWorkshopStore(s => s.openProblemPicker);
  const openHandoff = useWorkshopStore(s => s.openHandoff);
  const unblockTask = useWorkshopStore(s => s.unblockTask);
  const selectTask = useWorkshopStore(s => s.selectTask);

  const [currentIndex, setCurrentIndex] = useState(0);

  const activeTasks = tasks.filter(
    t => t.workshop_code === currentWorkshop && ['ready', 'in_progress', 'blocked'].includes(t.status)
  );

  // Reset index if it goes out of bounds
  const safeIndex = activeTasks.length > 0 ? Math.min(currentIndex, activeTasks.length - 1) : 0;
  const task = activeTasks[safeIndex] || null;
  const order = task ? orders[task.order_id] : null;
  const item = order?.data?.items?.[0];
  const ws = WORKSHOP_MAP[currentWorkshop];

  const goNext = useCallback(() => {
    if (activeTasks.length > 1) setCurrentIndex(i => (i + 1) % activeTasks.length);
  }, [activeTasks.length]);

  const goPrev = useCallback(() => {
    if (activeTasks.length > 1) setCurrentIndex(i => (i - 1 + activeTasks.length) % activeTasks.length);
  }, [activeTasks.length]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { navigate('/'); return; }
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate, goNext, goPrev]);

  function handleStart() {
    if (!task) return;
    startTask(task.id);
  }

  function handleProblem() {
    if (!task) return;
    selectTask(task.id);
    setTimeout(() => openProblemPicker(), 50);
  }

  function handleDone() {
    if (!task) return;
    selectTask(task.id);
    setTimeout(() => openHandoff(), 50);
  }

  function handleUnblock() {
    if (!task) return;
    unblockTask(task.id);
  }

  function handleWorkshopSelect(code) {
    setWorkshop(code);
    setCurrentIndex(0);
  }

  const handoffNote = task?.handoff_note || null;
  const prevWorkshopTasks = task
    ? tasks.filter(t => t.order_id === task.order_id && t.seq === task.seq - 1)
    : [];
  const prevTask = prevWorkshopTasks[0] || null;
  const prevWs = prevTask ? WORKSHOP_MAP[prevTask.workshop_code] : null;

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <div className={styles.tabs}>
          {WORKSHOPS.map(w => (
            <button
              key={w.code}
              className={`${styles.tab}${currentWorkshop === w.code ? ' ' + styles.tabActive : ''}`}
              onClick={() => handleWorkshopSelect(w.code)}
            >
              {w.name}
            </button>
          ))}
        </div>
        <button className={styles.closeBtn} onClick={() => navigate('/')} title="Закрыть (ESC)">✕</button>
      </div>

      <div className={styles.body}>
        {!task ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>✓</div>
            <div className={styles.emptyText}>Нет активных задач</div>
            <div className={styles.emptySub}>Цех {ws?.name || currentWorkshop} свободен</div>
          </div>
        ) : (
          <>
            <div
              className={styles.main}
              style={{ '--ki-ws-color': ws?.color || '#1F2937' }}
            >
              <div className={styles.taskHeader}>
                <div className={styles.wsName} style={{ color: ws?.color }}>{ws?.name || currentWorkshop}</div>
                <div className={styles.orderNum}>{order?.order_number || '—'}</div>
                {order?.data?.name && (
                  <div className={styles.client}>{order.data.name}</div>
                )}
              </div>

              {task.status === 'blocked' && task.problem_note && (
                <div className={styles.problemBanner}>
                  <span className={styles.problemIcon}>⚠</span>
                  <div>
                    <div className={styles.problemTitle}>Задача заблокирована</div>
                    <div className={styles.problemNote}>{task.problem_note}</div>
                  </div>
                </div>
              )}

              {handoffNote && prevWs && (
                <div className={styles.handoff}>
                  <span className={styles.handoffIcon}>💬</span>
                  <div>
                    <div className={styles.handoffFrom}>Заметка от: {prevWs.name}</div>
                    <div className={styles.handoffText}>{handoffNote}</div>
                  </div>
                </div>
              )}

              <div className={styles.detailsCard}>
                <div className={styles.detailRow}>
                  {item && (
                    <div className={styles.detailField}>
                      <div className={styles.detailLabel}>Изделие</div>
                      <div className={styles.detailValue}>{TYPE_NAMES[item.type] || item.type}</div>
                    </div>
                  )}
                  {item?.fabric && (
                    <div className={styles.detailField}>
                      <div className={styles.detailLabel}>Ткань</div>
                      <div className={styles.detailValue}>{FABRIC_NAMES[item.fabric] || item.fabric}</div>
                    </div>
                  )}
                  {item?.color && (
                    <div className={styles.detailField}>
                      <div className={styles.detailLabel}>Цвет</div>
                      <div className={styles.detailValue}>{item.color}</div>
                    </div>
                  )}
                  <div className={styles.detailField}>
                    <div className={styles.detailLabel}>Количество</div>
                    <div className={`${styles.detailValue} ${styles.detailValueQty}`}>{task.total_units} шт</div>
                  </div>
                </div>

                {item?.sizes && Object.keys(item.sizes).length > 0 && (
                  <div>
                    <div className={styles.detailLabel} style={{ marginBottom: 8 }}>Размерная сетка</div>
                    <SizesGrid sizes={item.sizes} />
                  </div>
                )}

                {item?.zones && item.zones.length > 0 && (
                  <div>
                    <div className={styles.detailLabel} style={{ marginBottom: 8 }}>Зоны печати</div>
                    <ZonesList item={item} />
                  </div>
                )}
              </div>

              <div className={styles.timelineSection}>
                <div className={styles.sectionLabel}>Маршрут заказа</div>
                <OrderTimeline orderId={task.order_id} currentTaskId={task.id} compact={false} />
              </div>
            </div>

            <div className={styles.nav}>
              <button
                className={styles.navArrow}
                onClick={goPrev}
                disabled={activeTasks.length <= 1}
              >←</button>
              <span className={styles.navCounter}>
                {safeIndex + 1} / {activeTasks.length}
              </span>
              <button
                className={styles.navArrow}
                onClick={goNext}
                disabled={activeTasks.length <= 1}
              >→</button>
            </div>

            <div className={styles.actions}>
              {task.status === 'ready' && (
                <button className={`${styles.btn} ${styles.btnStart}`} onClick={handleStart}>
                  Начать
                </button>
              )}
              {task.status === 'in_progress' && (
                <>
                  <button className={`${styles.btn} ${styles.btnProblem}`} onClick={handleProblem}>
                    Проблема
                  </button>
                  <button className={`${styles.btn} ${styles.btnDone}`} onClick={handleDone}>
                    Готово
                  </button>
                </>
              )}
              {task.status === 'blocked' && (
                <button className={`${styles.btn} ${styles.btnUnblock}`} onClick={handleUnblock}>
                  Разблокировать
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
