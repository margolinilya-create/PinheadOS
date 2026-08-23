import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { AttachmentPicker } from '../../../components/AttachmentPicker';
import styles from '../../../styles';

/**
 * ЗАМЕТКИ К ЗАКАЗУ (правка заказчика 22.08, п. 5.8).
 *
 * «Есть информация, которую невозможно нормально разложить по
 * структурированным полям: фото фурнитуры, референсы, пояснения по биркам,
 * общий внешний вид упаковки, нестандартные инструкции и изображения
 * с комментариями».
 *
 * ЭТО НЕ ЗАМЕНА СТРУКТУРНЫМ ПОЛЯМ, и документ говорит это прямо: основная
 * ткань, нанесения, бирки и упаковка продолжают заполняться в своих полях.
 * Поэтому секция стоит ПОСЛЕ них и подписана тем, для чего нужна, — иначе
 * она соберёт в себя половину ТЗ, и цеху придётся вычитывать заказ из прозы.
 *
 * ПОРЯДОК МЕНЯЕТСЯ КНОПКАМИ ↑/↓ — и у заметок, и у изображений внутри них
 * (документ требует обоих). Кнопки, а не перетаскивание: у любого
 * перетаскивания обязана быть клавиатурная альтернатива (правило проекта),
 * а здесь строк немного и кнопки её полностью заменяют — заодно они
 * работают на планшете.
 *
 * ЗАМЕТКИ ОТНОСЯТСЯ КО ВСЕМУ ЗАКАЗУ: `itemIndex` у файлов не задаётся вовсе.
 */
export function NotesSection({ notes, setNotes, attach }) {
  const setNote = (key, patch) => setNotes(
    notes.map((n) => (n.key === key ? { ...n, ...patch } : n)),
  );

  const move = (index, delta) => {
    const next = [...notes];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    setNotes(next);
  };

  const remove = (note) => {
    // Изображения уходят вместе с заметкой — и из состояния, и из бакета
    attach.dropOwner(note.key);
    setNotes(notes.filter((n) => n.key !== note.key));
  };

  return (
    <div className={styles.stackTight}>
      <p className={styles.subText}>
        Только то, что нельзя разложить по полям: референсы, фото фурнитуры,
        нестандартные инструкции. Ткань, нанесения, бирки и упаковка
        заполняются в своих блоках.
      </p>

      {notes.map((n, i) => (
        <div key={n.key} className={styles.printBlock}>
          <div className={styles.checkRow}>
            <strong className={styles.fieldLabel}>Заметка №{i + 1}</strong>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Поднять заметку ${i + 1}`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Опустить заметку ${i + 1}`}
              disabled={i === notes.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              aria-label={`Убрать заметку ${i + 1}`}
              onClick={() => remove(n)}
            >
              <Icon name="x" size={14} />
            </Button>
          </div>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Текст</span>
            <textarea
              className={styles.input}
              rows={2}
              value={n.text}
              onChange={(e) => setNote(n.key, { text: e.target.value })}
              placeholder="Велкро-панель как на фото, цвет согласован с клиентом"
              aria-label={`Текст заметки ${i + 1}`}
            />
          </label>
          <AttachmentPicker
            label="+ Изображения к заметке"
            hint="фото и референсы именно этой заметки"
            files={attach.files}
            kind="note"
            ownerKey={n.key}
            onAdd={(file) => attach.add(file, 'note', null, n.key)}
            onRetry={attach.retry}
            onRemove={attach.remove}
            onMove={attach.moveFile}
          />
        </div>
      ))}

      <div className={styles.checkRow}>
        <Button
          variant="secondary"
          onClick={() => setNotes([
            ...notes, { key: crypto.randomUUID(), text: '' },
          ])}
        >
          + Заметка ({notes.length})
        </Button>
      </div>
    </div>
  );
}
