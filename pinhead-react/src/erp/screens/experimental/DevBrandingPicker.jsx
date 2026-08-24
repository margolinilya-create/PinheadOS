import { useState } from 'react';
import { Button } from '../../components/Button';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { DEV_BRANDING_CHOICES } from '../../utils/experimentalBoard';
import { deptShortName } from '../../data/departments';
import styles from '../../styles';

/**
 * ВЫБОР ВИДОВ НАНЕСЕНИЯ ПРИ ВХОДЕ В КОЛОНКУ (правка заказчика 24.08, п. 4.3).
 *
 * «Когда технолог вручную переносит карточку в колонку "Нанесения", система
 * открывает выбор вида нанесения. В списке должны быть Шелкография, DTF,
 * Вышивка и DTG. Нужно разрешить выбрать один или несколько видов… После
 * выбора работа появляется в соответствующей общей очереди нужного цеха».
 *
 * СПРАШИВАЕТСЯ ТЕМ ЖЕ ДЕЙСТВИЕМ, что и перенос (правило проекта). Отдельная
 * форма рядом с колонкой была бы необязательным вторым шагом, а такими
 * в проекте не пользовались ни разу — журнал приёмок и поле результата этапа
 * этому научили.
 *
 * УЖЕ ЗАВЕДЁННЫЕ ВИДЫ ПОКАЗАНЫ ОТМЕЧЕННЫМИ И НЕДОСТУПНЫМИ, а не спрятаны:
 * исчезнувший из списка вид читается как «его нельзя», и человек ищет,
 * где включить. Повторно завести тот же вид нельзя — это была бы вторая
 * задача на ту же работу, и «все нанесения закрыты» перестало бы наступать.
 */
export function DevBrandingPicker({ existing = [], departments = [], onConfirm, onCancel }) {
  const trapRef = useFocusTrap(true, onCancel);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const has = new Set(existing);

  const toggle = (type) => setPicked(
    (list) => (list.includes(type) ? list.filter((t) => t !== type) : [...list, type]));

  const submit = async () => {
    setBusy(true);
    await onConfirm(picked);
    setBusy(false);
  };

  /** Подпись вида — названием УЧАСТКА: работа уйдёт именно туда */
  const label = (type) => {
    const dept = departments.find((d) => d.code === type);
    return dept ? deptShortName(dept.code, dept.name) : type;
  };

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onCancel}>
      <div
        ref={trapRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Виды нанесения"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalTitle}>Какие нанесения нужны образцу?</div>
        <p className={styles.subText}>
          Работа появится в общей очереди выбранного цеха. Карточка останется
          в «Нанесениях», пока не закроют все выбранные работы.
        </p>

        <div className={styles.formGrid}>
          {DEV_BRANDING_CHOICES.map((type) => (
            <label key={type} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={has.has(type) || picked.includes(type)}
                disabled={has.has(type)}
                onChange={() => toggle(type)}
              />
              <span>{label(type)}</span>
              {has.has(type) && <span className={styles.subText}>уже заведено</span>}
            </label>
          ))}
        </div>

        {/*
          НИ ОДНОГО ВИДА — ЗНАЧИТ НАНЕСЕНИЙ НЕТ, И КАРТОЧКА ИДЁТ В «ПОШИВ».
          Дословно по документу: «нанесения не являются обязательным этапом.
          Если нанесения не нужны, технолог переносит карточку сразу из Кроя
          в Пошив» (п. 4.2).

          Найдено падением собственного сторожа: кнопками «‹ ›» перешагнуть
          шаг было НЕЛЬЗЯ — они ходят по соседям, — и «сразу в Пошив»
          получалось в три действия вместо одного. Перетаскиванием это
          работало, то есть требование исполнялось только мышью.
        */}
        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={onCancel}>Отмена</Button>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {picked.length > 0
              ? `Перенести и завести ${picked.length}`
              : 'Нанесения не нужны — в «Пошив»'}
          </Button>
        </div>
      </div>
    </div>
  );
}
