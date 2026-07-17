import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore, orderPreviewUrl } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToastStore';
import { isStageReady, waitingReason } from '../utils/routes';
import { deptShortName, isQueueDept } from '../data/departments';
import {
  BRANDING_METHOD_LABELS,
  MATERIAL_STATUS_LABELS,
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../types';
import styles from '../erp.module.css';

/**
 * Экран цеха: очередь работ конкретного цеха.
 * Группы: Готов к работе → В работе → Ожидает (с причиной) → Готово.
 * Крупные кнопки — цех работает с планшета/телефона.
 * Цех пользователя определяется по erp_employees.profile_id (автопривязка);
 * чужие цеха — только просмотр (кроме admin/director/rop).
 */

/** Роли с полным доступом ко всем цехам */
const FULL_ACCESS_ROLES = ['admin', 'director', 'rop'];

function daysLeft(dueDate) {
  if (!dueDate) return null;
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

/** Полноэкранный просмотр превью: закрытие по клику и Escape */
function Lightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className={styles.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <img src={src} alt={alt} className={styles.lightboxImg} />
      <button
        type="button"
        className={styles.lightboxClose}
        aria-label="Закрыть просмотр"
        onClick={onClose}
        autoFocus
      >
        ✕
      </button>
    </div>
  );
}

/** Кнопка «прикрепить фото» (камера на планшете/телефоне) */
function PhotoAttach({ file, onFile, label }) {
  return (
    <label className={styles.fileBtn}>
      <span aria-hidden="true">📷</span>
      <span className={styles.fileBtnText}>{file ? file.name : label}</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.visuallyHidden}
        aria-label={label}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

/** Разворачиваемое полное ТЗ позиции: сетка, нанесения, упаковка, материалы */
function TzBlock({ order, item }) {
  const [open, setOpen] = useState(false);
  const prints = useMemo(
    () => [...(item.prints ?? [])].sort((a, b) => a.seq - b.seq),
    [item.prints],
  );
  const allSizes = useMemo(
    () => (item.size_grid?.length
      ? [...new Set(item.size_grid.flatMap((r) => Object.keys(r.sizes)))]
      : []),
    [item.size_grid],
  );

  return (
    <>
      <button
        type="button"
        className={`btn btn-secondary ${styles.tzToggle}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        📋 ТЗ позиции {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className={styles.tzBlock}>
          <div className={styles.checkRow}>
            {item.variant && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>Вариант: {item.variant}</span>
            )}
            {order.packaging && order.packaging !== 'none' && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>
                📦 {PACKAGING_LABELS[order.packaging]}
                {order.packaging_note ? `: ${order.packaging_note}` : ''}
              </span>
            )}
            {order.stickers && order.stickers !== 'none' && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>
                🏷 Стикеры: {STICKERS_LABELS[order.stickers]}
                {order.stickers_note ? ` — ${order.stickers_note}` : ''}
              </span>
            )}
            {order.no_chestny_znak && (
              <span className={`${styles.chip} ${styles.chipDanger}`}>Без Честного знака</span>
            )}
          </div>

          {item.size_grid && item.size_grid.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Цв/Разм</th>
                    {allSizes.map((sz) => <th key={sz}>{sz}</th>)}
                    <th>Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {item.size_grid.map((r, i) => (
                    <tr key={i}>
                      <td><strong>{r.color}</strong></td>
                      {allSizes.map((sz) => (
                        <td key={sz} className={styles.progressCell}>{r.sizes[sz] ?? '—'}</td>
                      ))}
                      <td className={styles.progressCell}>
                        <strong>{Object.values(r.sizes).reduce((a, b) => a + b, 0)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {prints.map((p) => (
            <div key={p.id} className={styles.printBlock}>
              <div className={styles.checkRow}>
                <strong>Нанесение №{p.seq} · {BRANDING_METHOD_LABELS[p.method] || p.method}</strong>
                {p.zone && <span>{p.zone}</span>}
                {(p.width_mm || p.height_mm) && (
                  <span className={styles.progressCell}>
                    {p.height_mm ?? '?'}×{p.width_mm ?? '?'} мм
                  </span>
                )}
                {p.pantone && (
                  <span className={`${styles.chip} ${styles.chipNeutral}`}>Pantone {p.pantone}</span>
                )}
              </div>
              {(p.offset_note || p.comment) && (
                <div className={styles.subText}>
                  {[p.offset_note, p.comment].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}

          {(order.materials ?? []).length > 0 && (
            <div>
              <div className={styles.fieldLabel}>Материалы</div>
              <ul className={styles.tzMatList}>
                {order.materials.map((m) => (
                  <li key={m.id}>
                    {m.name}
                    {m.qty ? ` · ${m.qty}` : ''}
                    <span className={styles.subText}> — {MATERIAL_STATUS_LABELS[m.status] || m.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.notes && <div className={styles.subText}>Заметка: {item.notes}</div>}
        </div>
      )}
    </>
  );
}

function QueueCard({ entry, canAct, onStart, onDone, onProgress, onBlock, onUnblock, onDefect }) {
  const { order, item, stage, reason, group } = entry;
  const [blockMode, setBlockMode] = useState(false);
  const [blockText, setBlockText] = useState('');
  const [blockPhoto, setBlockPhoto] = useState(null);
  const [defectMode, setDefectMode] = useState(false);
  const [defectQty, setDefectQty] = useState('');
  const [defectText, setDefectText] = useState('');
  const [defectPhoto, setDefectPhoto] = useState(null);
  const qtyDone = stage.qty_done ?? 0;
  const remaining = Math.max(item.qty - qtyDone, 0);
  const [doneQty, setDoneQty] = useState(String(remaining || item.qty));
  const [zoom, setZoom] = useState(false);
  const [imgError, setImgError] = useState(false);
  const d = daysLeft(order.due_date);
  const preview = orderPreviewUrl(order);
  const cardCls = [
    styles.queueCard,
    group === 'ready' && styles.queueCardReady,
    group === 'in_progress' && styles.queueCardProgress,
    group === 'blocked' && styles.queueCardBlocked,
    d !== null && d < 0 && styles.queueCardUrgent,
  ].filter(Boolean).join(' ');

  return (
    <div className={cardCls}>
      <div className={styles.queueCardHead}>
        {preview && !imgError && (
          <button
            type="button"
            className={styles.queueThumbBtn}
            aria-label={`Открыть превью макета: ${order.title}`}
            onClick={() => setZoom(true)}
          >
            <img
              src={preview}
              alt=""
              className={styles.queueThumb}
              onError={() => setImgError(true)}
            />
          </button>
        )}
        {preview && imgError && (
          <div className={styles.queueThumbStub} aria-hidden="true">🖼</div>
        )}
        <div className={styles.queueCardHeadText}>
          <Link to={`/orders/${order.id}`} className={`${styles.queueCardTitle} ${styles.queueCardTitleLink}`}>
            {order.title}
          </Link>
          <div className={styles.subText}>
            №{order.bitrix_id || '—'} · {item.product_type}
            {item.variant ? ` · ${item.variant}` : ''}
          </div>
        </div>
        <div className={styles.queueDue}>
          <div className={styles.queueQty}>{item.qty} шт</div>
          {order.due_date && (
            <div className={d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : styles.subText}>
              до {new Date(order.due_date + 'T00:00:00').toLocaleDateString('ru-RU')}
              {d !== null && ` · ${d >= 0 ? `${d} дн.` : `−${-d} дн.`}`}
            </div>
          )}
        </div>
      </div>

      {zoom && preview && !imgError && (
        <Lightbox src={preview} alt={`Макет: ${order.title}`} onClose={() => setZoom(false)} />
      )}

      {reason && <div className={styles.queueReason}>⏳ {reason}</div>}
      {stage.status === 'blocked' && stage.block_reason && (
        <div className={styles.queueReason}>🚫 {stage.block_reason}</div>
      )}

      {group === 'in_progress' && qtyDone > 0 && (
        <div className={styles.progressLine} aria-label={`Сделано ${qtyDone} из ${item.qty}`}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.min(Math.round((qtyDone / item.qty) * 100), 100)}%` }}
            />
          </div>
          <span className={styles.progressCell}>{qtyDone}/{item.qty}</span>
        </div>
      )}

      <TzBlock order={order} item={item} />

      {canAct && (
        <div className={styles.queueActions}>
          {group === 'ready' && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => onStart(entry)}>
                ▶ Взять в работу
              </button>
              {!blockMode && (
                <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                  🚫 Проблема
                </button>
              )}
            </>
          )}
          {group === 'in_progress' && (
            <>
              <input
                type="number"
                min="1"
                max={item.qty}
                className={styles.input}
                style={{ maxWidth: 84, flex: '0 0 auto' }}
                value={doneQty}
                onChange={(e) => setDoneQty(e.target.value)}
                aria-label="Сколько сделано, шт"
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!(Number(doneQty) > 0)}
                onClick={() => {
                  onProgress(entry, Math.max(1, Number(doneQty) || 0));
                  setDoneQty(String(Math.max(remaining - (Number(doneQty) || 0), 1)));
                }}
              >
                ＋ Частично
              </button>
              <button type="button" className="btn btn-primary" onClick={() => onDone(entry)}>
                ✓ Готово
              </button>
              {!blockMode && !defectMode && (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
                    ↩ Брак
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                    🚫 Проблема
                  </button>
                </>
              )}
            </>
          )}
          {group === 'done' && !defectMode && (
            <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
              ↩ Брак / переделка
            </button>
          )}
          {group === 'blocked' && (
            <button type="button" className="btn btn-secondary" onClick={() => onUnblock(entry)}>
              Снять блокировку
            </button>
          )}
        </div>
      )}

      {canAct && blockMode && (
        <div className={styles.queueBlockForm}>
          <input
            className={styles.input}
            placeholder="Что мешает? (брак кроя, нет ниток…)"
            value={blockText}
            onChange={(e) => setBlockText(e.target.value)}
            autoFocus
          />
          <PhotoAttach file={blockPhoto} onFile={setBlockPhoto} label="Фото (необязательно)" />
          <button
            type="button"
            className="btn btn-danger"
            disabled={!blockText.trim()}
            onClick={() => {
              onBlock(entry, blockText.trim(), blockPhoto);
              setBlockMode(false); setBlockText(''); setBlockPhoto(null);
            }}
          >
            Заблокировать
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setBlockMode(false); setBlockPhoto(null); }}>
            Отмена
          </button>
        </div>
      )}

      {canAct && defectMode && (
        <div className={styles.queueBlockForm}>
          <input
            type="number"
            min="1"
            className={styles.input}
            style={{ maxWidth: 84, flex: '0 0 auto' }}
            placeholder="шт"
            value={defectQty}
            onChange={(e) => setDefectQty(e.target.value)}
            aria-label="Сколько штук в брак"
            autoFocus
          />
          <input
            className={styles.input}
            placeholder="Причина брака (кривая строчка, пятно…)"
            value={defectText}
            onChange={(e) => setDefectText(e.target.value)}
          />
          <PhotoAttach file={defectPhoto} onFile={setDefectPhoto} label="Фото (необязательно)" />
          <button
            type="button"
            className="btn btn-danger"
            disabled={!defectText.trim() || !(Number(defectQty) > 0)}
            onClick={() => {
              onDefect(entry, Number(defectQty), defectText.trim(), defectPhoto);
              setDefectMode(false); setDefectQty(''); setDefectText(''); setDefectPhoto(null);
            }}
          >
            В переделку
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setDefectMode(false); setDefectPhoto(null); }}>
            Отмена
          </button>
        </div>
      )}
    </div>
  );
}

const GROUP_TITLES = {
  ready: '🟢 Готово к работе',
  in_progress: '🟡 В работе',
  waiting: '⏳ Ожидает',
  blocked: '🚫 Заблокировано',
  done: '✓ Завершено недавно',
};

export default function DepartmentQueue() {
  const {
    orders, departments, loading, loaded, loadAll,
    myDeptId, myDeptLoaded, loadMyDept,
    setStageStatus, reportProgress, reportDefect, uploadOrderAttachment,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadAll: s.loadAll,
      myDeptId: s.myDeptId,
      myDeptLoaded: s.myDeptLoaded,
      loadMyDept: s.loadMyDept,
      setStageStatus: s.setStageStatus,
      reportProgress: s.reportProgress,
      reportDefect: s.reportDefect,
      uploadOrderAttachment: s.uploadOrderAttachment,
    })),
  );
  const user = useAuthStore((s) => s.user);
  // Ручной выбор вкладки: legacy localStorage — начальное значение
  const [pickedDept, setPickedDept] = useState(() => localStorage.getItem('erp_my_dept') || '');
  // Выбирал ли пользователь вкладку в этой сессии (иначе действует автопривязка)
  const [sessionPick, setSessionPick] = useState(false);

  // dev-режим — свободный выбор, роли рук. состава — полный доступ
  const privileged = user?.id === 'dev' || FULL_ACCESS_ROLES.includes(user?.role);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  useEffect(() => {
    if (!myDeptLoaded) loadMyDept(user?.id);
  }, [myDeptLoaded, loadMyDept, user?.id]);

  /** Цех из привязки erp_employees (автопривязка, п.10) */
  const boundDept = useMemo(
    () => departments.find((dd) => dd.id === myDeptId) || null,
    [departments, myDeptId],
  );

  // Автовыбор своего цеха: пока пользователь не переключил вкладку сам
  const deptCode = !sessionPick && boundDept ? boundDept.code : pickedDept;
  const selectDept = (code) => {
    setPickedDept(code);
    setSessionPick(true);
    localStorage.setItem('erp_my_dept', code);
  };

  const dept = departments.find((dd) => dd.code === deptCode) || null;
  const deptNameById = useMemo(
    () => new Map(departments.map((dd) => [dd.id, dd.name])),
    [departments],
  );

  // Привязки нет и нет legacy-выбора (localStorage) → заглушка для рядовых ролей
  const showStub = !privileged && myDeptLoaded && !boundDept && !deptCode;
  // Действия разрешены: рук. состав всюду; при привязке — только в своём цехе;
  // без привязки (legacy localStorage) — как раньше, в выбранном цехе
  const canAct = privileged || !boundDept || (dept ? dept.code === boundDept.code : false);

  /** Счётчик «готово к работе» по каждому цеху — для бейджей на вкладках */
  const readyByDept = useMemo(() => {
    const counts = new Map();
    const deptById = new Map(departments.map((dd) => [dd.id, dd]));
    for (const order of orders) {
      if (order.status !== 'active') continue;
      for (const item of order.items) {
        for (const stage of item.stages) {
          const dd = deptById.get(stage.department_id);
          if (!dd) continue;
          const isReady =
            stage.status === 'in_progress' ||
            (stage.status === 'waiting' &&
              isStageReady(stage, item.stages, order.materials, dd.code));
          if (isReady) counts.set(dd.code, (counts.get(dd.code) || 0) + 1);
        }
      }
    }
    return counts;
  }, [orders, departments]);

  const groups = useMemo(() => {
    const g = { ready: [], in_progress: [], waiting: [], blocked: [], done: [] };
    if (!dept) return g;
    for (const order of orders) {
      if (order.status !== 'active') continue;
      for (const item of order.items) {
        for (const stage of item.stages) {
          if (stage.department_id !== dept.id) continue;
          if (stage.status === 'skipped') continue;
          const entry = { order, item, stage, reason: null };
          if (stage.status === 'done') {
            g.done.push({ ...entry, group: 'done' });
          } else if (stage.status === 'blocked') {
            g.blocked.push({ ...entry, group: 'blocked' });
          } else if (stage.status === 'in_progress') {
            g.in_progress.push({ ...entry, group: 'in_progress' });
          } else if (isStageReady(stage, item.stages, order.materials, dept.code)) {
            g.ready.push({ ...entry, group: 'ready' });
          } else {
            g.waiting.push({
              ...entry,
              group: 'waiting',
              reason: waitingReason(stage, item.stages, order.materials, deptNameById, dept.code),
            });
          }
        }
      }
    }
    const byDue = (a, b) =>
      (a.order.due_date || '9999').localeCompare(b.order.due_date || '9999');
    g.ready.sort(byDue); g.in_progress.sort(byDue); g.waiting.sort(byDue); g.blocked.sort(byDue);
    g.done.sort((a, b) => (b.stage.finished_at || '').localeCompare(a.stage.finished_at || ''));
    g.done = g.done.slice(0, 10);
    return g;
  }, [orders, dept, deptNameById]);

  const onStart = (entry) => setStageStatus(entry.stage.id, 'in_progress');
  /** «Готово» без числа — закрыть этап целиком */
  const onDone = (entry) =>
    setStageStatus(entry.stage.id, 'done', { qty_done: entry.item.qty });
  /** «Частично» — накопительный прогресс qty_done += N */
  const onProgress = (entry, qty) => reportProgress(entry.stage.id, qty);
  const onBlock = async (entry, reason, photo) => {
    let photoOk = false;
    if (photo) photoOk = await uploadOrderAttachment(entry.order.id, photo, `Блокировка: ${reason}`);
    await setStageStatus(entry.stage.id, 'blocked', {
      block_reason: photoOk ? `${reason} (фото во вложениях)` : reason,
    });
    if (photo && !photoOk) toast.warning('Блокировка записана, но фото не загрузилось');
  };
  const onUnblock = (entry) => setStageStatus(entry.stage.id, 'waiting', { block_reason: null });
  const onDefect = async (entry, qty, reason, photo) => {
    let photoOk = false;
    if (photo) photoOk = await uploadOrderAttachment(entry.order.id, photo, `Брак: ${reason}`);
    await reportDefect(entry.stage.id, qty, photoOk ? `${reason} (фото во вложениях)` : reason);
    if (photo && !photoOk) toast.warning('Брак записан, но фото не загрузилось');
  };

  if (showStub) {
    return (
      <>
        <PageHead
          title="Мой цех"
          sub="Очередь работ цеха: бери в работу, отмечай готово, сообщай о проблемах."
        />
        <div className={styles.emptyState}>
          Ваш профиль не привязан к цеху — обратитесь к администратору.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title={dept ? dept.name : 'Мой цех'}
        sub="Очередь работ цеха: бери в работу, отмечай готово, сообщай о проблемах."
      />

      <div className={styles.deptTabs} role="tablist" aria-label="Выбор цеха">
        {departments.filter((dd) => dd.active && isQueueDept(dd.code)).map((dd) => {
          const count = readyByDept.get(dd.code) || 0;
          const isMine = boundDept?.code === dd.code;
          return (
            <button
              key={dd.code}
              type="button"
              role="tab"
              aria-selected={deptCode === dd.code}
              className={`${styles.deptTab} ${deptCode === dd.code ? styles.deptTabActive : ''}`}
              onClick={() => selectDept(dd.code)}
            >
              {deptShortName(dd.code, dd.name)}
              {isMine && <span aria-label="ваш цех" title="Ваш цех">★</span>}
              {count > 0 && (
                <span className={`${styles.deptTabCount} ${styles.deptTabHot}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {!dept && <div className={styles.emptyState}>Выберите свой цех выше — выбор запомнится.</div>}
      {dept && loading && !loaded && <div className={styles.emptyState}>Загрузка…</div>}

      {dept && !canAct && (
        <div className={styles.queueReason} style={{ marginBottom: 'var(--space-md, 14px)' }}>
          👁 Это не ваш цех — только просмотр. Ваш цех: {boundDept ? deptShortName(boundDept.code, boundDept.name) : '—'}.
        </div>
      )}

      {dept && loaded && Object.entries(GROUP_TITLES).map(([key, title]) => {
        const list = groups[key];
        if (!list || list.length === 0) return null;
        return (
          <section key={key} style={{ marginBottom: 'var(--space-lg, 20px)' }}>
            <h2 className={styles.queueGroupTitle}>{title} <span className={styles.subText}>({list.length})</span></h2>
            <div className={styles.queueGrid}>
              {list.map((entry) => (
                <QueueCard
                  key={entry.stage.id}
                  entry={entry}
                  canAct={canAct}
                  onStart={onStart}
                  onDone={onDone}
                  onProgress={onProgress}
                  onBlock={onBlock}
                  onUnblock={onUnblock}
                  onDefect={onDefect}
                />
              ))}
            </div>
          </section>
        );
      })}

      {dept && loaded &&
        Object.values(groups).every((l) => l.length === 0) && (
        <div className={styles.emptyState}>В этом цехе пока нет работ.</div>
      )}
    </>
  );
}
