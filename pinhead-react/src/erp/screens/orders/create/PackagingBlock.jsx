import { ITEM_PACKAGING_LABELS } from '../../../types';
import styles from '../../../styles';
import { ItemFilePicker } from './ItemFilePicker';

/**
 * Упаковка ПОЗИЦИИ (правка заказчика 16.08).
 *
 * «У разных изделий внутри одной сделки могут отличаться тип пакета, размер
 * пакета, расположение стикера и маркировки — упаковка должна задаваться именно
 * на уровне изделия». Настройка на весь заказ при этом осталась: для заказа
 * из одинаковых изделий она удобнее, и её несут уже заведённые заказы.
 *
 * Отсюда значение «Как в заказе» и то, что оно стоит первым и по умолчанию.
 * Пустого значения нет намеренно: «не заполняли» и «эту позицию не упаковывать»
 * должны различаться, иначе забытая позиция молча уедет в отгрузку без упаковки.
 * Разрешает эти два уровня одна функция — `utils/packaging.itemPackaging`.
 */
export function PackagingBlock({ it, i, setItem, attach }) {
  const own = it.packaging !== 'inherit';

  return (
    <details className={styles.gridDetails}>
      <summary className={styles.subText}>
        Упаковка изделия{own ? ` — ${ITEM_PACKAGING_LABELS[it.packaging] ?? it.packaging}` : ' — как в заказе'}
      </summary>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Вариант упаковки</span>
        <div className={styles.tileRow} role="radiogroup" aria-label={`Упаковка позиции ${i + 1}`}>
          {Object.entries(ITEM_PACKAGING_LABELS).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={it.packaging === v}
              className={`${styles.tile} ${styles.tileSm} ${it.packaging === v ? styles.tileActive : ''}`}
              onClick={() => setItem(i, { packaging: v })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* Документ (п. 1) перечисляет их отдельными пунктами: это читает цех
          при упаковке, а из свободного комментария половина теряется
          при беглом чтении */}
      <div className={styles.itemRow}>
        {/*
          РАЗМЕР ПАКЕТА — ДВА ЧИСЛА В ММ (правки 07.09, п. 16). Свободное поле
          `packaging_size` из формы убрано: на боевой базе в нём лежат
          «25*30см», «25*33» и «30*40» — три записи, три написания, и отобрать
          по нему нельзя ничего. Колонка осталась в схеме и видна на чтение
          в карточке заказа: её несут заведённые позиции.
        */}
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Размер пакета, мм</span>
          <div className={styles.checkRow}>
            <label className={`${styles.checkLabel} ${styles.mmLabel}`}>
              <span className={styles.subText}>Ш</span>
              <input
                type="number"
                min="1"
                className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                aria-label={`Ширина пакета позиции ${i + 1}, мм`}
                value={it.packaging_width_mm ?? ''}
                onChange={(e) => setItem(i, {
                  packaging_width_mm: e.target.value.replace('-', ''),
                })}
              />
            </label>
            <label className={`${styles.checkLabel} ${styles.mmLabel}`}>
              <span className={styles.subText}>В</span>
              <input
                type="number"
                min="1"
                className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                aria-label={`Высота пакета позиции ${i + 1}, мм`}
                value={it.packaging_height_mm ?? ''}
                onChange={(e) => setItem(i, {
                  packaging_height_mm: e.target.value.replace('-', ''),
                })}
              />
            </label>
          </div>
          <span className={styles.subText}>пусто — размер из заказа</span>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Расположение стикера</span>
          <input
            className={styles.input}
            value={it.sticker_place}
            onChange={(e) => setItem(i, { sticker_place: e.target.value })}
            placeholder="лицевая сторона, снизу справа"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Расположение маркировки</span>
          <input
            className={styles.input}
            value={it.marking_place}
            onChange={(e) => setItem(i, { marking_place: e.target.value })}
            placeholder="боковой шов"
          />
        </label>
      </div>
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span className={styles.fieldLabel}>Дополнительные требования к упаковке</span>
        <input
          className={styles.input}
          value={it.packaging_note}
          onChange={(e) => setItem(i, { packaging_note: e.target.value })}
          placeholder="вложить открытку, не складывать пополам"
        />
      </label>
      {/* Документ (п. 1): вариант упаковки, расположение стикера и маркировки
          показываются картинкой, а не описываются */}
      <ItemFilePicker
        label="+ Файлы упаковки"
        hint="вариант упаковки, расположение стикера и маркировки"
        kind="packaging"
        itemIndex={i}
        onAdd={attach?.add}
        attach={attach}
      />
    </details>
  );
}
