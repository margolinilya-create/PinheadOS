import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { AttachmentList } from '../../components/AttachmentList';
import { taskLabel } from '../../utils/experimentalTasks';
import { cuttingWaitLabel } from '../../utils/experimentalBoard';
import { formatDateCell, formatDateTimeShort } from '../../utils/format';
import styles from '../../styles';

/**
 * Правая колонка карточки разработки (референс заказчика 24.08).
 *
 * ЧТО ЗДЕСЬ И ПОЧЕМУ ИМЕННО ЗДЕСЬ. Три блока референса — «Информация»,
 * «Файлы», «Блокеры» — плюс две строки, которые в проекте обязаны быть видны
 * ВСЕГДА: следующее действие и состояние материалов. До вкладок они стояли
 * над карточкой; вкладки их бы спрятали, а правило записано прямо — «почему
 * стоит» и «что делать дальше» не прячутся за переключателем. Постоянная
 * колонка исполняет и требование референса, и правило, не заводя третьего
 * места для одних и тех же двух строк.
 *
 * ВСЁ НА ЧТЕНИЕ. Правится разработка на вкладке «Информация»; вторая точка
 * ввода тех же полей означала бы два обработчика записи, которые однажды
 * разойдутся. Здесь — справка, к которой возвращаются глазами.
 *
 * Число файлов и кнопка «Показать все» ведут на вкладку «Файлы», а не
 * раскрывают список на месте: полный перечень с загрузкой и удалением —
 * это уже работа, а работа живёт в главной колонке.
 */

/** Сколько файлов показать в справке — дальше отсылаем на вкладку */
const PREVIEW_FILES = 3;

function Row({ label, children }) {
  return (
    <div className={styles.devAsideRow}>
      <span className={styles.subText}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function DevAside({
  dev, item, blocker, action, materialGate, files, typeNames, onShowFiles,
}) {
  const list = files ?? [];
  /**
   * Размерный ряд — из позиции заказа: у разработки своего нет и быть
   * не должно, изделие описывает заказ. Поле приезжает только с ПОЛНЫМ
   * заказом (`size_grid` намеренно выброшен из списочной выборки), поэтому
   * страница разработки его дозагружает — иначе строка молча стояла бы
   * пустой при заполненных данных.
   */
  const sizes = item?.size_grid?.sizes ?? [];

  return (
    <aside className={styles.devAside} aria-label="Справка по разработке">
      <div className={styles.devAsideCard}>
        <h3 className={styles.queueGroupTitle}>Информация</h3>
        <Row label="Модель">{dev.tech_name || '—'}</Row>
        <Row label="Изделие">
          {item ? `${item.product_type}${item.variant ? ` (${item.variant})` : ''}` : '—'}
        </Row>
        <Row label="Размерный ряд">
          {sizes.length > 0 ? sizes.join(' · ') : '—'}
        </Row>
        {/*
          Техническое название лекал — прямое требование документа 30.08
          (п. 3): «поле должно быть доступно для просмотра внутри заказа
          без открытия истории задач». Раньше оно жило только в форме
          финального пакета, то есть на отдельной вкладке; справка видна
          на любой. Правится по-прежнему там — здесь чтение, как и всё
          в этой колонке.
        */}
        <Row label="Тех. название лекал">{dev.pattern_tech_name || '—'}</Row>
        <Row label="Конструктор">{dev.constructor || '—'}</Row>
        <Row label="Проработчик">{dev.technologist || '—'}</Row>
        <Row label="Срок">{dev.due_date ? formatDateCell(dev.due_date) : '—'}</Row>
        <Row label="Создана">{formatDateTimeShort(dev.created_at)}</Row>
        <Row label="Обновлена">{formatDateTimeShort(dev.updated_at)}</Row>
      </div>

      <div className={styles.devAsideCard}>
        <div className={styles.matSectionHead}>
          <h3 className={styles.queueGroupTitle}>Файлы</h3>
          <span className={styles.subText}>{list.length}</span>
        </div>
        {list.length === 0
          ? <p className={styles.subText}>Файлов нет.</p>
          : <AttachmentList files={list.slice(0, PREVIEW_FILES)} />}
        <Button variant="ghost" size="sm" icon="paperclip" onClick={onShowFiles}>
          {list.length > PREVIEW_FILES ? `Показать все (${list.length})` : 'Все файлы'}
        </Button>
      </div>

      {/*
        Блокер, следующее действие и материалы — то, ради чего заказчик
        и переделывал раздел. У закрытой разработки их нет: работа кончилась,
        и «что делать дальше» превратилось бы в пустую строку с прочерком.
      */}
      {!dev.outcome && (
        <div
          className={`${styles.devAsideCard} ${blocker ? styles.devAsideCardWarn : ''}`}
        >
          <h3 className={styles.queueGroupTitle}>Блокеры</h3>
          {blocker ? (
            <p>
              <Icon name="alert" size={13} /> {taskLabel(blocker, typeNames)}
              {blocker.blocked_reason ? ` — ${blocker.blocked_reason}` : ''}
            </p>
          ) : (
            <p className={styles.subText}>Нет активных блокеров</p>
          )}

          <div style={{ marginTop: 8 }}>
            <span className={styles.fieldLabel}>Следующее действие</span>
            <div>{action || <span className={styles.subText}>—</span>}</div>
          </div>

          <div style={{ marginTop: 8 }}>
            <span className={styles.fieldLabel}>Материалы</span>
            <div>
              {materialGate.missing.length === 0 ? (
                <span className={`${styles.chip} ${styles.chipDone}`}>
                  приняты складом
                </span>
              ) : (
                <span className={`${styles.chip} ${styles.chipWaiting}`}>
                  {cuttingWaitLabel('materials', materialGate.missing)}
                </span>
              )}
              {/* Единственное исключение документа, и сказать о нём надо там же,
                  где человек видит ожидание */}
              <div className={styles.subText}>
                Построение лекал идёт независимо от прихода материалов.
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
