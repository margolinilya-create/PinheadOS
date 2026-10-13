import { SizeResultTable } from './SizeResultTable';
import { rowEntered } from '../utils/stageSizes';
import styles from '../erp.module.css';

/**
 * Размерная таблица сдачи результата (швейка и другие участки
 * с `result_detail = 'sizes'`): «Покроено» подтянуто из закроя, «Сшито /
 * Брак / В переделку» вводит мастер, «Статус» считается.
 *
 * Вынесено из `StageReportForm` 27.09 (правка 6): форма стоит на потолке
 * ратчета размера, а таблица — самостоятельный кусок со своей логикой
 * колонок. Данные строк (`rows`) по-прежнему считает форма — здесь только
 * показ и подсветка.
 */
export function SizeReportSection({ rows, values, onChange, canDefect, disabled }) {
  /**
   * ИСТОРИЯ ОТДЕЛЬНО ОТ НОВОЙ ПАРТИИ (правка 05.10, п. 3): «при открытии формы
   * показывать полученный крой и все предыдущие сдачи по размерам и цветам…
   * В поля новой сдачи вводится только новая партия». Колонки «ранее» —
   * вывод из своих отчётов этапа, а не поле ввода, и форма их не обнуляет.
   */
  const anyPrev = rows.some((r) => r.prev && (r.prev.good + r.prev.defect + r.prev.rework) > 0);
  const prevColumns = anyPrev ? [
    { code: 'prevGood', label: 'Сдано ранее', render: (row) => row.prev?.good ?? 0 },
    ...(canDefect ? [
      { code: 'prevDefect', label: 'Брак ранее', render: (row) => row.prev?.defect ?? 0 },
      { code: 'prevRework', label: 'Переделка ранее', render: (row) => row.prev?.rework ?? 0 },
    ] : []),
  ] : [];
  return (
    <>
      <span className={styles.fieldLabel}>Размерная разбивка</span>
      <SizeResultTable
        rows={rows.map((r) => ({ ...r, expected: r.expected ?? '—' }))}
        columns={[
          ...prevColumns,
          {
            code: 'good',
            label: anyPrev ? 'Сдаю сейчас, шт' : 'Сшито, шт',
            /* Подсветка ИМЕННО этого поля: документ просит показать,
               какую строку исправлять, а не «где-то превышение» */
            invalid: (row, vals) => row.remaining !== null
              && row.remaining !== undefined
              && rowEntered(vals) > Number(row.remaining),
          },
          ...(canDefect ? [
            { code: 'defect', label: 'Брак, шт' },
            { code: 'rework', label: 'В переделку, шт' },
          ] : []),
          {
            code: 'state',
            label: 'Статус',
            /* Колонка-ВЫВОД: считается, а не вводится. Мастер видит
               состояние строки, не сверяя два числа глазами */
            /* Остаток — из ПРИНЯТЫХ минус прежние сдачи этого этапа
               (правка 27.09, п. 7): вторая сдача видит 104, а не 472 */
            render: (row, vals) => {
              if (row.remaining === null || row.remaining === undefined) {
                return <span className={styles.subText}>—</span>;
              }
              const entered = rowEntered(vals);
              const left = Number(row.remaining) - entered;
              if (entered === 0) {
                return left > 0
                  ? <span className={styles.subText}>в работе {left}</span>
                  : <span className={styles.subText}>учтено</span>;
              }
              if (left < 0) {
                return (
                  <span className={styles.cellError}>
                    Нельзя указать больше, чем осталось
                  </span>
                );
              }
              return left > 0
                ? <span className={styles.subText}>в работе {left}</span>
                : <span className={styles.subText}>готово</span>;
            },
          },
        ]}
        values={values}
        onChange={onChange}
        expectedLabel="Покроено, шт"
        caption="Результат пошива по размерам"
        disabled={disabled}
      />
    </>
  );
}
