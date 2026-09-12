import { Icon } from '../../../components/Icon';
import { Button } from '../../../components/Button';
import { AttachmentPicker } from '../../../components/AttachmentPicker';
import { FieldError } from './FormParts';
import styles from '../../../styles';

/**
 * Лист закупки — ФАЙЛ менеджера (правки заказчика 20.08).
 *
 * ЧТО ИЗМЕНИЛОСЬ И ПОЧЕМУ. 16.08 менеджер заводил потребность СТРОКАМИ прямо
 * здесь. Документ 20.08 разворачивает роли: «лист закупки должен формироваться
 * менеджером сопровождения ДО создания заказа и загружаться готовым файлом…
 * менеджер сопровождения не заводит вручную материалы, количество,
 * поставщиков, цены и сроки прихода в ERP». Фактические строки создаёт
 * закупщик, «потому что уже он знает, у кого реально заказали, какое
 * количество купили, какую цену получили и когда материал должен приехать».
 *
 * Обязательно ОДНО ИЗ ДВУХ: файл или отметка «Закупка не требуется». Проверяет
 * это `validateOrderForm` — только оттуда работают рамка, автоскролл
 * и раскрытие секции.
 *
 * БЛОКА «ПОДСКАЗКИ ЗАКУПЩИКУ СТРОКАМИ» БОЛЬШЕ НЕТ (правки 07.09, п. 14).
 * 20.08 строки оставили необязательной подсказкой в свёрнутом блоке — то есть
 * ровно тем, чем документ 20.08 их и объявил лишним. Заказчик убрал их
 * совсем: потребность задаёт файл, а сказать словами есть куда — «Заметки
 * к заказу» и комментарий. Секция `materials` в payload и `material_index`
 * у вложений в `erp_create_order` ОСТАЮТСЯ: их несут заведённые заказы.
 */
export function PurchaseListSection({
  attach, notRequired, onToggleNotRequired,
  /**
   * Закупать нечего ПО СОСТАВУ ЗАКАЗА (правки 07.09, п. 4): все значимые
   * позиции — давальческое готовое изделие. Отдельно от отметки менеджера:
   * та — его решение, а это следствие уже сделанного выбора, и просить
   * подтвердить его галочкой значило бы спрашивать дважды об одном.
   * Секция при этом не прячется: приложить лист по-прежнему можно (закупают
   * не только изделие), просто он перестал быть обязательным.
   */
  notNeededByItems = false,
  err = () => undefined,
}) {
  /**
   * СТАТУС ЗАГРУЗКИ ЛИСТА (правки 07.09, п. 13: «показывать зелёный статус
   * „Лист закупки загружен“, по той же логике, что и у ТЗ»).
   *
   * Считается по тем же файлам, что показывает `AttachmentPicker`, — второй
   * список рядом разошёлся бы с первым. Сам `AttachmentPicker` не трогаем:
   * он универсален, и чип «Лист закупки загружен» появился бы у макетов
   * нанесений и у файлов упаковки.
   */
  const files = attach.files.filter((f) => f.kind === 'purchase_list');
  const uploaded = files.find((f) => f.state === 'uploaded');
  const uploading = files.find((f) => f.state === 'uploading');
  const failed = files.find((f) => f.state === 'error');

  return (
    <>
      <p className={styles.subText}>
        Потребность задаёт ФАЙЛ: менеджер сопровождения готовит лист закупки
        заранее и прикладывает его сюда. Фактические строки — сколько заказано,
        у кого, по какой цене и когда придёт — заводит закупщик: на момент
        запуска этого ещё никто не знает.
      </p>

      {notNeededByItems && (
        <p className={styles.subText} role="status">
          Все позиции заказа — давальческое готовое изделие: покупать нечего,
          и лист закупки не обязателен. Приложить его всё равно можно —
          закупают не только само изделие.
        </p>
      )}

      <div className={styles.checkRow}>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={Boolean(notRequired)}
            onChange={(e) => onToggleNotRequired(e.target.checked)}
            aria-label="Закупка не требуется"
          />
          <span>Закупка не требуется</span>
        </label>
        <span className={styles.subText}>
          {/* Документ: «клиент дал готовые изделия… закупка не нужна» */}
          заказ не появится у закупщика, и этап «Закупка» в маршрут не попадёт
        </span>
      </div>

      {!notRequired && (
        <div
          className={err('purchase_list') ? styles.invalidBlock : undefined}
          data-invalid={err('purchase_list') ? true : undefined}
        >
          {/*
            Чип стоит НАД пикером, как у ТЗ: он отвечает на вопрос «готово ли»,
            а имя файла и кнопки «убрать»/«загрузить заново» — ниже, у самого
            файла. `role="status"` — тот же приём, что в `TzSection`.
          */}
          <div className={styles.checkRow}>
            {uploading && (
              <span className={`${styles.chip} ${styles.chipProgress}`} role="status">
                Загружается…
              </span>
            )}
            {!uploading && uploaded && (
              <span className={`${styles.chip} ${styles.chipDone}`} role="status">
                <Icon name="checkCircle" size={13} /> Лист закупки загружен
              </span>
            )}
            {!uploading && !uploaded && failed && (
              <>
                <span className={`${styles.chip} ${styles.chipBlocked}`} role="status">
                  <Icon name="alert" size={13} /> не загрузилось: {failed.error}
                </span>
                <Button variant="secondary" onClick={() => attach.retry(failed.uid)}>
                  Загрузить заново
                </Button>
              </>
            )}
          </div>
          <AttachmentPicker
            label="+ Лист закупки *"
            hint="файл, который вы готовили к запуску: xlsx, pdf, фото"
            files={attach.files}
            kind="purchase_list"
            multiple={false}
            onAdd={attach.add}
            onRetry={attach.retry}
            onRemove={attach.remove}
          />
          <FieldError id="err-purchase-list" text={err('purchase_list')} />
        </div>
      )}
    </>
  );
}
