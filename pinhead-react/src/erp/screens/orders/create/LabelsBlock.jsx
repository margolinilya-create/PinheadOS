import { DictionaryDatalist } from '../../../components/DictionaryDatalist';
import { emptyLabel } from '../../../utils/orderForm';
import styles from '../../../styles';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { ItemFilePicker } from './ItemFilePicker';

/**
 * БИРКИ ПОЗИЦИИ (правка 22.08, п. 5.3).
 *
 * «Сейчас используется одно общее текстовое поле Бирки. В реальном заказе
 * у изделия обычно может быть несколько бирок» — размерник, составник,
 * брендовая, по уходу, — и у каждой своё расположение, размер и МАКЕТ.
 * Одно поле на всех означало, что половина сведений теряется при беглом
 * чтении, а макет не привязан ни к чему.
 *
 * Старое поле `labels_note` осталось в техблоке: его несут заведённые заказы,
 * и разложить свободный текст по полям может только человек.
 */
export function LabelsBlock({ it, i, setItem, attach }) {
  const labels = it.labels ?? [];
  const setLabel = (li, patch) => setItem(i, {
    labels: labels.map((l, k) => (k === li ? { ...l, ...patch } : l)),
  });

  return (
    <details className={styles.gridDetails}>
      <summary className={styles.subText}>
        Бирки{labels.length > 0 ? ` — ${labels.length}` : ''}
      </summary>
      {/* Справочник — подсказка поверх свободного ввода (правило проекта) */}
      <DictionaryDatalist kind="label_type" id="erp-label-types" />
      {labels.map((l, li) => (
        <div key={l.key} className={styles.printBlock}>
          <div className={`${styles.checkRow} ${styles.printRow}`}>
            <strong className={styles.fieldLabel}>Бирка №{li + 1}</strong>
            <input
              className={`${styles.input} ${styles.inputSm}`}
              list="erp-label-types"
              placeholder="Тип (размерник, составник)"
              aria-label={`Тип бирки ${li + 1}`}
              value={l.label_type}
              onChange={(e) => setLabel(li, { label_type: e.target.value })}
            />
            <input
              className={`${styles.input} ${styles.inputSm} ${styles.printZoneInput}`}
              placeholder="Расположение (левый внутренний боковой шов)"
              aria-label={`Расположение бирки ${li + 1}`}
              value={l.place}
              onChange={(e) => setLabel(li, { place: e.target.value })}
            />
            <input
              className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
              placeholder="Размер"
              aria-label={`Размер бирки ${li + 1}`}
              value={l.size}
              onChange={(e) => setLabel(li, { size: e.target.value })}
            />
            <Button
              variant="ghost"
              aria-label={`Убрать бирку ${li + 1}`}
              onClick={() => {
                attach?.dropOwner(l.key);
                setItem(i, { labels: labels.filter((_, k) => k !== li) });
              }}
            >
              <Icon name="x" size={14} />
            </Button>
          </div>
          <div className={`${styles.checkRow} ${styles.printRow}`}>
            <input
              className={`${styles.input} ${styles.inputSm} ${styles.printNoteInput}`}
              placeholder="Комментарий"
              aria-label={`Комментарий к бирке ${li + 1}`}
              value={l.comment}
              onChange={(e) => setLabel(li, { comment: e.target.value })}
            />
          </div>
          <ItemFilePicker
            label="+ Макет бирки"
            hint="файл именно этой бирки"
            kind="label"
            itemIndex={i}
            ownerKey={l.key}
            onAdd={(file) => attach.add(file, 'label', i, l.key)}
            attach={attach}
          />
        </div>
      ))}
      <div className={styles.checkRow}>
        <Button
          variant="secondary"
          onClick={() => setItem(i, { labels: [...labels, emptyLabel()] })}
        >
          + Бирка ({labels.length})
        </Button>
      </div>
    </details>
  );
}
