import styles from '../../../styles';
import { ItemFilePicker } from './ItemFilePicker';

/**
 * Технический блок изделия (правка заказчика 16.08).
 *
 * «В карточке изделия необходимо отдельно фиксировать технические особенности
 * производства»: отделочное полотно, комментарий по раскрою, комментарий
 * по пошиву, бирки. Раньше всё это писали в общую заметку позиции или
 * не писали вовсе, и цех узнавал об особенности от менеджера голосом.
 *
 * Свёрнут по умолчанию: заказ без технических особенностей — обычное дело,
 * и четыре пустых поля на каждой позиции удлиняли бы форму втрое. Счётчик
 * в заголовке показывает, что внутри что-то есть, — иначе свёрнутый блок
 * неотличим от пустого.
 */
export function TechBlock({ it, i, setItem, attach }) {
  const filled = [it.main_fabric, it.color_supplier, it.trim_material, it.cutting_note,
    it.sewing_note, it.labels_note].filter((v) => (v ?? '').trim()).length;

  return (
    <details className={styles.gridDetails}>
      <summary className={styles.subText}>
        Технический блок изделия{filled > 0 ? ` — заполнено полей: ${filled}` : ''}
      </summary>
      <div className={styles.itemRow}>
        {/*
          ОСНОВНАЯ ТКАНЬ — ОТДЕЛЬНОЕ ПОЛЕ (правка 22.08, п. 5.1). Раньше был
          только отделочный материал, и основное полотно писали в свободные
          заметки или не писали вовсе — при том, что ТЗ заказчика начинается
          именно с него. Поля хранятся раздельно: у изделия бывает и то,
          и другое.
        */}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Основная ткань</span>
          <input
            className={styles.input}
            value={it.main_fabric}
            onChange={(e) => setItem(i, { main_fabric: e.target.value })}
            placeholder="шерпа 100% пэ, 240 гр"
          />
        </label>
        {/*
          ЦВЕТ / ПОСТАВЩИК (правка 12.09, п. 3). Стоит рядом с тканью, потому
          что отвечает на тот же вопрос — ИЗ ЧЕГО И У КОГО берём материал.

          Это НЕ третье место про цвет изделия. Цвет модели живёт в `variant`
          («Футболка · синяя») и в строках размерной сетки, где он определяет
          раскладку по размерам; здесь — цвет МАТЕРИАЛА вместе с тем, у кого
          он берётся, одной строкой, потому что закупка их и называет вместе
          («футер 320 пыльная роза, Атлас»). Подпись дословно такая, как
          просил заказчик, — чтобы это различие читалось с первого взгляда.
        */}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Цвет / поставщик</span>
          <input
            className={styles.input}
            value={it.color_supplier}
            onChange={(e) => setItem(i, { color_supplier: e.target.value })}
            placeholder="пыльная роза, Атлас"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Отделочный материал</span>
          <input
            className={styles.input}
            value={it.trim_material}
            onChange={(e) => setItem(i, { trim_material: e.target.value })}
            placeholder="твилл плащевый 190гр + подклад"
          />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.fieldLabel}>Комментарий по раскрою</span>
          <input
            className={styles.input}
            value={it.cutting_note}
            onChange={(e) => setItem(i, { cutting_note: e.target.value })}
            placeholder="долевая по спинке, припуск 1.5 см"
          />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.fieldLabel}>Комментарий по пошиву</span>
          <input
            className={styles.input}
            value={it.sewing_note}
            onChange={(e) => setItem(i, { sewing_note: e.target.value })}
            placeholder="плоскошовка, обтачка горловины"
          />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.fieldLabel}>Бирки</span>
          <input
            className={styles.input}
            value={it.labels_note}
            onChange={(e) => setItem(i, { labels_note: e.target.value })}
            placeholder="размерник + составник, левый внутренний боковой шов"
          />
        </label>
      </div>
      {/* Документ (п. 5): «схема узла, расположение бирки, вариант обработки,
          пример раскроя, пример пошива» — словами это не передаётся */}
      <ItemFilePicker
        label="+ Файлы техблока"
        hint="схема узла, расположение бирки, пример раскроя"
        kind="tech"
        itemIndex={i}
        onAdd={attach?.add}
        attach={attach}
      />
    </details>
  );
}
