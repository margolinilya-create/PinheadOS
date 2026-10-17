import { useId, useState } from 'react';
import { Modal } from '../../erp/components/Modal';
import { Button } from '../../erp/components/Button';
import styles from './Workplace.module.css';

/**
 * Окно «Копия в другом цвете»: один вопрос — цвет новой позиции.
 * Форма ввода не закрывается промахом мимо окна (правило 01.10, п. 3) —
 * только «Отмена» или Escape. Пустой цвет не даёт создать позицию.
 *
 * @param {{ itemName: string, onSubmit: (color: string) => void, onClose: () => void }} props
 */
export default function ColorCopyDialog({ itemName, onSubmit, onClose }) {
  const [color, setColor] = useState('');
  const inputId = useId();
  const trimmed = color.trim();

  const submit = (e) => {
    e.preventDefault();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <Modal title="Копия в другом цвете" onClose={onClose} closeOnOverlay={false} className={styles.copyDialog}>
      <form className={styles.copyForm} onSubmit={submit}>
        <p className={styles.copyHint}>
          Новая позиция повторит «{itemName}»: модель, ткань, нанесения и бирки. Количество — с нуля.
        </p>
        <label className={styles.copyLabel} htmlFor={inputId}>Цвет новой позиции</label>
        <input
          id={inputId}
          className={styles.copyInput}
          value={color}
          onChange={(e) => setColor(e.target.value)}
          autoComplete="off"
          // Первое поле формы получает фокус (правило проекта)
          autoFocus
        />
        <div className={styles.copyActions}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button variant="primary" type="submit" disabled={!trimmed}>Создать позицию</Button>
        </div>
      </form>
    </Modal>
  );
}
