import { useRef } from 'react';
import { PdfPick } from './FormParts';
import { useRemovalFocus } from './useRemovalFocus';
import { TZ_MAX_BYTES } from '../../../types';
import { batchStatusText, fileLimitCaption } from '../../../utils/fileLimitText';
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
 * Файлы выбираются пачкой (правка 19.10, п. 4), каждый — своей строкой.
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

/**
 * Строка файла со статусом загрузки: спиннер / галочка / причина ошибки + повтор.
 *
 * Чипы БЕЗ `role="status"` (правка 19.10, п. 4): при пачке из пяти файлов
 * пять живых регионов перебивали бы друг друга — состояние объявляет одна
 * сводка раздела. Кнопки названы с именем файла: «Загрузить заново» пять раз
 * подряд в списке читалки не говорит, какой файл повторяется.
 */
function TzDocRow({ doc, onRemove, onRetry }) {
  // Имя — из снимка: у восстановленного из черновика `File` нет (27.09, п. 12)
  const name = doc.name || doc.file?.name;
  return (
    <li>
      <span className={styles.cellWithIcon}>
        <Icon name="orders" size={14} /> {name}
      </span>
      {' '}
      {doc.state === 'uploading' && (
        <span className={`${styles.chip} ${styles.chipProgress}`}>Загружается…</span>
      )}
      {doc.state === 'uploaded' && (
        <span className={`${styles.chip} ${styles.chipDone}`}>
          <Icon name="checkCircle" size={13} /> ТЗ загружено
        </span>
      )}
      {doc.state === 'error' && (
        <>
          <span className={`${styles.chip} ${styles.chipBlocked}`}>
            {/* Большой файл несёт готовую причину; повтор ему бессмыслен (лимит тот же) */}
            <Icon name="alert" size={13} /> {doc.tooBig ? doc.error : `не загрузилось: ${doc.error}`}
          </span>
          {!doc.tooBig && (
            <>
              {' '}
              <Button
                variant="secondary"
                aria-label={`Загрузить заново: ${name}`}
                onClick={() => onRetry(doc.groupId)}
              >
                Загрузить заново
              </Button>
            </>
          )}
        </>
      )}
      {' '}
      <Button
        variant="ghost"
        data-row-focus={doc.groupId}
        aria-label={`Убрать: ${name}`}
        disabled={doc.state === 'uploading'}
        onClick={() => onRemove(doc.groupId)}
      >
        <span className={styles.cellWithIcon}><Icon name="x" size={13} /> убрать</span>
      </Button>
    </li>
  );
}

/**
 * Блок одной привязки (общее ТЗ или позиция): кнопка выбора пачки и строки.
 * Свой контейнер нужен переносу фокуса: убрали строку — фокус на соседнюю
 * строку этого же блока, а не на чужой.
 */
function TzDocGroup({ head, docs, onRemove, onRetry }) {
  const ref = useRef(null);
  const markRemoved = useRemovalFocus(ref);
  const remove = (groupId) => {
    markRemoved(docs.map((d) => d.groupId), groupId);
    onRemove(groupId);
  };
  return (
    <div ref={ref}>
      {head}
      {docs.length > 0 && (
        <ul className={styles.tzMatList}>
          {docs.map((d) => (
            <TzDocRow key={d.groupId} doc={d} onRemove={remove} onRetry={onRetry} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function TzSection({ tzItems, tzDocs, addTzDocs, removeTzDoc, retryTzDoc }) {
  const generalDocs = tzDocs.filter((d) => d.itemIndex === null);
  const caption = fileLimitCaption(TZ_MAX_BYTES);
  const status = batchStatusText(
    tzDocs.filter((d) => d.state === 'uploaded').length,
    tzDocs.length,
    tzDocs.filter((d) => d.state === 'error').length,
  );

  return (
    <>
      <p className={styles.subText}>
        Одно ТЗ на позицию — его автоматически увидят все цеха её маршрута. Если изделия
        в заказе одинаковые, достаточно общего ТЗ на заказ. Можно выбрать несколько файлов
        сразу. Заменить файл потом можно в карточке заказа — обновится сразу у всех цехов.
      </p>
      {/* Одна сводка на раздел: регион смонтирован заранее, текст появляется с файлами */}
      <p className={styles.subText} role="status">{status}</p>

      <TzDocGroup
        docs={generalDocs}
        onRemove={removeTzDoc}
        onRetry={retryTzDoc}
        head={(
          <div className={styles.checkRow}>
            <PdfPick label="+ Общее ТЗ заказа (PDF)" onPick={(fs) => addTzDocs(fs, null)} />
            <span className={styles.subText}>{caption}</span>
          </div>
        )}
      />

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
            <TzDocGroup
              docs={ownDocs}
              onRemove={removeTzDoc}
              onRetry={retryTzDoc}
              head={(
                <div className={styles.matSectionHead}>
                  <strong>Позиция: {ti.label}</strong>
                  <PdfPick label="+ ТЗ позиции (PDF)" onPick={(fs) => addTzDocs(fs, ti.index)} />
                  <span className={styles.subText}>{caption}</span>
                </div>
              )}
            />
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
