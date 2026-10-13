import { PrintSizeFields } from './PrintSizeFields';
import {
  BRANDING_METHOD_LABELS,
  BRANDING_METHOD_CHOICES,
  EMBROIDERY_GARMENT_KINDS,
} from '../../../types';
import styles from '../../../styles';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { ItemFilePicker } from './ItemFilePicker';

/**
 * Одно нанесение позиции: техника, расположение, размеры, поля техники,
 * отступ/Pantone/комментарий и макет. Вынесено из `ItemBlock` (резка 26.09);
 * состояния не держит — всё приходит пропсами.
 */
export function PrintBlock({ p, pi, i, err, setPrint, removePrint, attach }) {
  return (
    <div className={styles.printBlock}>
      {/*
        ЗАГОЛОВОК И КРЕСТИК — ОТДЕЛЬНОЙ ШАПКОЙ (правки 07.09, п. 12:
        «Перенести крестик удаления нанесения в правый верхний угол
        блока, как сделано у позиции»). Прежде крестик стоял ПОСЛЕДНИМ
        в строке параметров, за полями «В, мм» и «Ш, мм»: при переносе
        строки он уезжал под поля, а на планшете — за край.

        Классы те же, что у шапки позиции (`itemBlockHead` /
        `itemBlockTitle`): вид и поведение совпадают дословно, второй
        набор правил для того же самого разошёлся бы с первым.
      */}
      <div className={styles.itemBlockHead}>
        <span className={styles.itemBlockTitle}>Нанесение №{pi + 1}</span>
        <Button
          variant="ghost"
          aria-label={`Убрать нанесение ${pi + 1}`}
          onClick={() => removePrint(i, pi)}>
          <Icon name="x" size={14} />
        </Button>
      </div>
      <div className={`${styles.checkRow} ${styles.printRow}`}>
        <select
          className={`${styles.select} ${styles.inputSm}`}
          value={p.method}
          aria-label="Техника нанесения"
          onChange={(e) => setPrint(i, pi, { method: e.target.value })}
        >
          {/*
            ВЫБОР ИДЁТ ПО `BRANDING_METHOD_CHOICES`, а не по всему словарю
            подписей (правки 07.09, п. 17): DTG убран из выбора, но
            остаётся читаемым у заведённых нанесений. Перебирать словарь
            значило бы предлагать снятую технику снова.
          */}
          {BRANDING_METHOD_CHOICES.map((v) => (
            <option key={v} value={v}>{BRANDING_METHOD_LABELS[v]}</option>
          ))}
        </select>
        <input
          className={`${styles.input} ${styles.inputSm} ${styles.printZoneInput}`}
          placeholder="Расположение (спина справа по втачке)"
          aria-label="Расположение нанесения"
          value={p.zone}
          onChange={(e) => setPrint(i, pi, { zone: e.target.value })}
        />
        <PrintSizeFields print={p} error={err(`item_${i}_print_${pi}_size`)}
          errorId={`err-item-${i}-print-${pi}-size`} onChange={(patch) => setPrint(i, pi, patch)} />
      </div>
      {/*
        ПОЛЯ ТЕХНИКИ (правки 07.09, пп. 10–11). Показываются ровно
        у своей: «Эффекты» — у шелкографии, «Тип изделия» — у вышивки.
        Общей строки не заводим — это разные величины, и поле,
        видимое у чужой техники, читалось бы цехом как требование.

        Эффект — свободный ввод с подсказкой справочника (`print_effect`):
        набор эффектов растёт, и закрытый список пришлось бы обновлять
        релизом. Тип изделия вышивки, наоборот, `select` из трёх значений:
        это классификация технологии, зеркало CHECK базы.
      */}
      {p.method === 'silkscreen' && (
        <div className={`${styles.checkRow} ${styles.printRow}`}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Эффекты</span>
            <input
              className={`${styles.input} ${styles.inputSm}`}
              list="erp-print-effects"
              placeholder="без эффектов"
              value={p.special ?? ''}
              onChange={(e) => setPrint(i, pi, { special: e.target.value })}
            />
          </label>
        </div>
      )}
      {p.method === 'embroidery' && (
        <div className={`${styles.checkRow} ${styles.printRow}`}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Тип изделия</span>
            <select
              className={`${styles.select} ${styles.inputSm}`}
              value={p.garment_kind ?? ''}
              onChange={(e) => setPrint(i, pi, { garment_kind: e.target.value })}
            >
              <option value="">не указан</option>
              {EMBROIDERY_GARMENT_KINDS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className={`${styles.checkRow} ${styles.printRow}`}>
        <input
          className={`${styles.input} ${styles.inputSm} ${styles.printNoteInput}`}
          placeholder="Отступ (10см от шва горловины)"
          aria-label="Отступ нанесения"
          value={p.offset_note}
          onChange={(e) => setPrint(i, pi, { offset_note: e.target.value })}
        />
        <input
          className={`${styles.input} ${styles.inputSm} ${styles.pantoneInput}`}
          placeholder="Pantone (1163, 1181)"
          aria-label="Pantone нанесения"
          value={p.pantone}
          onChange={(e) => setPrint(i, pi, { pantone: e.target.value })}
        />
        <input
          className={`${styles.input} ${styles.inputSm} ${styles.printNoteInput}`}
          placeholder="Комментарий (макет как в сделке…)"
          aria-label="Комментарий нанесения"
          value={p.comment}
          onChange={(e) => setPrint(i, pi, { comment: e.target.value })}
        />
      </div>
      {/*
        МАКЕТ ПРИНАДЛЕЖИТ ЭТОМУ НАНЕСЕНИЮ (правка 22.08, п. 5.2).
        Раньше макеты лежали общим блоком вместе с прочими файлами ТЗ,
        и при трёх-четырёх нанесениях цех сам угадывал, какой файл
        к какому относится. Привязка идёт по КЛЮЧУ нанесения: строки
        `erp_item_prints` в этот момент ещё не существует — заказ
        создаётся одной транзакцией.
      */}
      <ItemFilePicker
        label="+ Макет нанесения"
        hint="файл именно этого нанесения — цех не будет угадывать"
        kind="print"
        itemIndex={i}
        ownerKey={p.key}
        onAdd={(file) => attach.add(file, 'print', i, p.key)}
        attach={attach}
      />
    </div>
  );
}
