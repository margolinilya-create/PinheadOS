import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { toast } from '../../../store/useToastStore';
import { confirm } from '../../../store/useConfirmStore';
import {
  REWORK_AREAS, REWORK_AREA_LABELS, reworkPlan,
} from '../../utils/experimentalTasks';
import styles from '../../erp.module.css';

/**
 * Проверка образца (правки заказчика 20.08).
 *
 * «После сборки образца должна быть возможность зафиксировать результат:
 * образец утверждён / требуется доработка… Если требуется доработка,
 * указывается, что именно нужно изменить… После этого повторно запускаются
 * только необходимые этапы».
 *
 * ПОЧЕМУ ЭТО НЕ ДИАЛОГ `confirmWithInput`. Он умеет одно текстовое поле,
 * а здесь выбор областей — и от него зависит НАБОР задач, то есть реальная
 * работа цеха. Прежняя кнопка «Примерка не принята» заводила жёсткую тройку
 * независимо от причины: вышивку перезапускали из-за длины рукава.
 *
 * ПОСЛЕДСТВИЯ НАЗЫВАЕТ УТИЛИТА (`reworkPlan`), и она же собирает задачи —
 * правило проекта: текст подтверждения, посчитанный отдельно от действия,
 * однажды разойдётся с ним.
 */
export function DevSampleCheck({ dev, tasks, onApprove, onRework }) {
  const [mode, setMode] = useState(null); // null | 'approve' | 'rework'
  const [areas, setAreas] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const plan = useMemo(
    () => reworkPlan(areas, { note, tasks }), [areas, note, tasks]);

  const toggle = (a) => setAreas(
    (prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  const approve = async () => {
    setBusy(true);
    const ok = await onApprove(note.trim() || null);
    setBusy(false);
    if (ok) { setMode(null); setNote(''); }
  };

  const submitRework = async () => {
    if (areas.length === 0) { toast.error('Отметьте, что именно нужно изменить'); return; }
    if (!note.trim()) { toast.error('Опишите, что исправить'); return; }
    const ok = await confirm({
      title: 'Завести круг доработки?',
      message: plan.summary,
      confirmLabel: 'Завести',
    });
    if (!ok) return;
    setBusy(true);
    const rows = await onRework(plan.tasks);
    setBusy(false);
    if (rows) { setMode(null); setAreas([]); setNote(''); }
  };

  if (dev.sample_approved_at) {
    return (
      <div className={styles.tzBlock}>
        <span className={`${styles.chip} ${styles.chipReady}`}>
          <Icon name="checkCircle" size={13} /> Образец утверждён
        </span>
        {dev.sample_approved_note && (
          <div className={styles.subText}>{dev.sample_approved_note}</div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.tzBlock}>
      <div className={styles.fieldLabel}>Проверка образца</div>
      {!mode && (
        <div className={styles.queueActions}>
          <Button variant="primary" onClick={() => setMode('approve')}>
            Образец утверждён
          </Button>
          <Button variant="secondary" onClick={() => setMode('rework')}>
            Требуется доработка
          </Button>
        </div>
      )}

      {mode === 'approve' && (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Комментарий (необязательно)</span>
            <input
              className={styles.input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Комментарий к утверждению образца"
            />
          </label>
          <p className={styles.subText}>
            Разработка перейдёт в колонку «Финальный этап»: дальше собирается
            технический пакет для повторного производства.
          </p>
          <div className={styles.queueActions}>
            <Button variant="primary" disabled={busy} onClick={approve}>
              Зафиксировать
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>Отмена</Button>
          </div>
        </>
      )}

      {mode === 'rework' && (
        <>
          <span className={styles.fieldLabel}>Что именно нужно изменить</span>
          <div className={styles.checkRow}>
            {REWORK_AREAS.map((a) => (
              <label key={a} className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={areas.includes(a)}
                  onChange={() => toggle(a)}
                />
                {REWORK_AREA_LABELS[a]}
              </label>
            ))}
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Что исправить</span>
            <input
              className={styles.input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Увеличить длину рукава на 2 см"
              aria-label="Что исправить в образце"
            />
          </label>
          {/* Последствия видны ДО нажатия: набор задач зависит от галочек,
              и человек должен видеть, что именно он запускает */}
          {areas.length > 0 && <p className={styles.subText}>{plan.summary}</p>}
          <div className={styles.queueActions}>
            <Button variant="primary" disabled={busy} onClick={submitRework}>
              Завести доработку
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>Отмена</Button>
          </div>
        </>
      )}
    </div>
  );
}
