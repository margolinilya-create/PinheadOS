import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { toast } from '../../../store/useToastStore';
import { confirm } from '../../../store/useConfirmStore';
import {
  REWORK_AREAS, REWORK_AREA_LABELS, reworkPlan,
} from '../../utils/experimentalTasks';
import styles from '../../styles';

/**
 * Доработка образца (правки заказчика 20.08; половина «утверждён» снята 12.09).
 *
 * «Если требуется доработка, указывается, что именно нужно изменить…
 * После этого повторно запускаются только необходимые этапы».
 *
 * ЧТО ЗДЕСЬ БЫЛО И ЧЕГО НЕ СТАЛО. Блок назывался «Проверка образца» и нёс
 * ДВА действия: «Образец утверждён» и «Требуется доработка». Правка 12.09
 * (вторая порция, п. 5) просит убрать из сценария именно ПРОВЕРКУ — она была
 * гейтом завершения разработки. Доработка к этому требованию отношения не
 * имеет: у неё своя история («История доработок» в карточке) и своё правило
 * состава задач, и снеси мы блок целиком — круги доработки стало бы НЕЧЕМ
 * заводить, а вкладка истории осталась бы пустой навсегда. Убрана половина,
 * названная в документе, и только она.
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
export function DevRework({ tasks, onRework }) {
  const [open, setOpen] = useState(false);
  const [areas, setAreas] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const plan = useMemo(
    () => reworkPlan(areas, { note, tasks }), [areas, note, tasks]);

  const toggle = (a) => setAreas(
    (prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

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
    if (rows) { setOpen(false); setAreas([]); setNote(''); }
  };

  return (
    <div className={styles.tzBlock}>
      <div className={styles.fieldLabel}>Доработка образца</div>
      {!open && (
        <div className={styles.queueActions}>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Требуется доработка
          </Button>
        </div>
      )}

      {open && (
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
            <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
          </div>
        </>
      )}
    </div>
  );
}
