import { PdfPick } from './FormParts';
import { Icon } from '../../../components/Icon';
import styles from '../../../erp.module.css';

/**
 * Раздел «ТЗ в PDF для цехов» формы создания заказа: загрузка общего ТЗ и файлов
 * позиции + назначение документа каждому производственному цеху маршрута.
 *
 * Маршрут считается ДО создания заказа тем же `buildItemRoute`, что и стор
 * (список приходит готовым в `tzItems`), поэтому превью не расходится с фактом.
 * File-объекты живут в состоянии модалки отдельно от `form`/`items`: черновик
 * пишется через JSON.stringify, и File молча превратился бы в `{}`.
 */
export function TzSection({ tzItems, tzDocs, tzAssign, addTzDoc, removeTzDoc, setTzAssign }) {
  const generalDocs = tzDocs.filter((d) => d.itemIndex === null);

  /**
   * Назначить один документ всем цехам позиции.
   * Типовой «Пошив + ДТФ» даёт четыре производственных этапа, с вышивкой — пять,
   * на две позиции — до десяти одинаковых выборов подряд, и до последнего кнопка
   * «Создать заказ» заблокирована. Это самое утомительное место формы.
   */
  const assignAll = (ti, groupId) => setTzAssign((m) => {
    const next = { ...m };
    for (const st of ti.stages) next[`${ti.index}:${st.departmentId}`] = groupId;
    return next;
  });

  return (
    <>
      <p className={styles.subText}>
        Каждому производственному цеху маршрута нужно назначить ТЗ в PDF. Один файл можно
        назначить нескольким цехам; заменить его потом можно в карточке заказа — обновится
        сразу у всех.
      </p>

      <div className={styles.checkRow}>
        <PdfPick label="+ Общее ТЗ заказа (PDF)" onPick={(f) => addTzDoc(f, null)} />
        <span className={styles.subText}>Только PDF, до 15 МБ</span>
      </div>
      {generalDocs.length > 0 && (
        <ul className={styles.tzMatList}>
          {generalDocs.map((d) => (
            <li key={d.groupId}>
              <span className={styles.cellWithIcon}><Icon name="orders" size={14} /> {d.file.name}</span>
              {' '}
              <button type="button" className="btn btn-ghost" onClick={() => removeTzDoc(d.groupId)}>
                <span className={styles.cellWithIcon}><Icon name="x" size={13} /> убрать</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {tzItems.length === 0 && (
        <div className={styles.subText}>
          Заполните позицию (изделие и количество) — здесь появится её маршрут.
        </div>
      )}

      {tzItems.map((ti) => {
        const itemDocs = tzDocs.filter((d) => d.itemIndex === null || d.itemIndex === ti.index);
        return (
          <div key={ti.index} className={styles.tzBlock}>
            <div className={styles.matSectionHead}>
              <strong>Позиция: {ti.label}</strong>
              <PdfPick label="+ ТЗ позиции (PDF)" onPick={(f) => addTzDoc(f, ti.index)} />
            </div>
            {tzDocs.filter((d) => d.itemIndex === ti.index).length > 0 && (
              <ul className={styles.tzMatList}>
                {tzDocs.filter((d) => d.itemIndex === ti.index).map((d) => (
                  <li key={d.groupId}>
                    <span className={styles.cellWithIcon}><Icon name="orders" size={14} /> {d.file.name}</span>
                    {' '}
                    <button type="button" className="btn btn-ghost" onClick={() => removeTzDoc(d.groupId)}>
                      <span className={styles.cellWithIcon}><Icon name="x" size={13} /> убрать</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {ti.stages.length === 0 && (
              <div className={styles.subText}>
                В маршруте позиции нет производственных цехов — ТЗ не требуется.
              </div>
            )}
            {ti.stages.length > 1 && (
              <div className={styles.checkRow}>
                <span className={styles.subText}>Назначить всем цехам позиции:</span>
                {tzDocs
                  .filter((d) => d.itemIndex === null || d.itemIndex === ti.index)
                  .map((d) => (
                    <button
                      key={d.groupId}
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => assignAll(ti, d.groupId)}
                    >
                      {d.itemIndex === null ? 'Общее ТЗ' : d.file.name}
                    </button>
                  ))}
              </div>
            )}
            {ti.stages.map((st) => {
              const key = `${ti.index}:${st.departmentId}`;
              const value = tzAssign[key] ?? '';
              return (
                <div key={st.departmentId} className={styles.tzAssignRow}>
                  <span className={styles.tzAssignDept}>{st.departmentName}</span>
                  <select
                    className={styles.select}
                    value={value}
                    aria-label={`ТЗ для цеха ${st.departmentName}, позиция ${ti.label}`}
                    data-invalid={!value ? true : undefined}
                    onChange={(e) => setTzAssign((m) => ({ ...m, [key]: e.target.value }))}
                  >
                    <option value="">— выбрать ТЗ —</option>
                    {itemDocs.map((d) => (
                      <option key={d.groupId} value={d.groupId}>
                        {d.itemIndex === null ? 'Общее ТЗ: ' : ''}{d.file.name}
                      </option>
                    ))}
                  </select>
                  {!value && <span className={styles.tzAssignMissing}>не назначено</span>}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
