import { PdfPick } from './FormParts';
import { Icon } from '../../../components/Icon';
import styles from '../../../styles';
import { Button } from '../../../components/Button';

/**
 * Раздел «ТЗ в PDF для цехов» формы создания заказа.
 *
 * Одна загрузка на позицию (или одна общая на весь заказ) — файл автоматически
 * доступен всем цехам её производственного маршрута. Прежний вариант требовал
 * назначить один и тот же PDF каждому цеху отдельным выпадающим списком: типовой
 * «Пошив + ДТФ» давал четыре выбора на позицию, а пропуск любого блокировал
 * создание заказа. Список цехов остался, но как СПРАВКА — кто увидит файл.
 *
 * Файл уходит в бакет сразу при выборе, поэтому у каждого своё состояние:
 * «загружается» → «загружено» либо «ошибка» с повтором. Раньше загрузка шла
 * только по кнопке «Создать заказ», и форма показывала приложенным файл,
 * которого в Storage не было.
 *
 * Маршрут считается ДО создания заказа тем же `buildItemRoute`, что и стор
 * (список приходит готовым в `tzItems`), поэтому превью не расходится с фактом.
 * File-объекты живут в состоянии модалки отдельно от `form`/`items`: черновик
 * пишется через JSON.stringify, и File молча превратился бы в `{}`.
 */

/** Строка файла со статусом загрузки: спиннер / галочка / причина ошибки + повтор */
function TzDocRow({ doc, onRemove, onRetry }) {
  return (
    <li>
      <span className={styles.cellWithIcon}>
        <Icon name="orders" size={14} /> {doc.file.name}
      </span>
      {' '}
      {doc.state === 'uploading' && (
        <span className={`${styles.chip} ${styles.chipProgress}`} role="status">
          Загружается…
        </span>
      )}
      {doc.state === 'uploaded' && (
        <span className={`${styles.chip} ${styles.chipDone}`} role="status">
          <Icon name="checkCircle" size={13} /> ТЗ загружено
        </span>
      )}
      {doc.state === 'error' && (
        <>
          <span className={`${styles.chip} ${styles.chipBlocked}`} role="status">
            <Icon name="alert" size={13} /> не загрузилось: {doc.error}
          </span>
          {' '}
          <Button variant="secondary" onClick={() => onRetry(doc.groupId)}>
            Загрузить заново
          </Button>
        </>
      )}
      {' '}
      <Button variant="ghost" disabled={doc.state === 'uploading'} onClick={() => onRemove(doc.groupId)}>
        <span className={styles.cellWithIcon}><Icon name="x" size={13} /> убрать</span>
      </Button>
    </li>
  );
}

export function TzSection({ tzItems, tzDocs, addTzDoc, removeTzDoc, retryTzDoc }) {
  const generalDocs = tzDocs.filter((d) => d.itemIndex === null);

  return (
    <>
      <p className={styles.subText}>
        Одно ТЗ на позицию — его автоматически увидят все цеха её маршрута. Если изделия
        в заказе одинаковые, достаточно общего ТЗ на заказ. Заменить файл потом можно
        в карточке заказа — обновится сразу у всех цехов.
      </p>

      <div className={styles.checkRow}>
        <PdfPick label="+ Общее ТЗ заказа (PDF)" onPick={(f) => addTzDoc(f, null)} />
        <span className={styles.subText}>Только PDF, до 15 МБ</span>
      </div>
      {generalDocs.length > 0 && (
        <ul className={styles.tzMatList}>
          {generalDocs.map((d) => (
            <TzDocRow key={d.groupId} doc={d} onRemove={removeTzDoc} onRetry={retryTzDoc} />
          ))}
        </ul>
      )}

      {tzItems.length === 0 && (
        <div className={styles.subText}>
          Заполните позицию (изделие и количество) — здесь появится её маршрут.
        </div>
      )}

      {tzItems.map((ti) => {
        const ownDocs = tzDocs.filter((d) => d.itemIndex === ti.index);
        const covered = ownDocs.some((d) => d.state === 'uploaded')
          || generalDocs.some((d) => d.state === 'uploaded');
        return (
          <div key={ti.index} className={styles.tzBlock}>
            <div className={styles.matSectionHead}>
              <strong>Позиция: {ti.label}</strong>
              <PdfPick label="+ ТЗ позиции (PDF)" onPick={(f) => addTzDoc(f, ti.index)} />
            </div>
            {ownDocs.length > 0 && (
              <ul className={styles.tzMatList}>
                {ownDocs.map((d) => (
                  <TzDocRow key={d.groupId} doc={d} onRemove={removeTzDoc} onRetry={retryTzDoc} />
                ))}
              </ul>
            )}
            {/* Не выбор, а справка: назначать ТЗ цехам больше не нужно */}
            <div className={styles.tzAssignRow}>
              <span className={styles.tzAssignDept}>ТЗ увидят</span>
              {ti.stages.length === 0 ? (
                <span className={styles.subText}>
                  в маршруте позиции нет производственных цехов — ТЗ не требуется
                </span>
              ) : covered ? (
                <span>{ti.stages.map((st) => st.departmentName).join(' · ')}</span>
              ) : (
                <span className={styles.tzAssignMissing}>
                  {ti.stages.map((st) => st.departmentName).join(' · ')} — ТЗ не загружено
                </span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
