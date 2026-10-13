import styles from '../../../styles';
import { Button } from '../../../components/Button';
import { RouteFields, RouteIssues } from '../../../components/RouteFields';
import { ItemFilePicker } from './ItemFilePicker';
import { emptyStep, routeIssues } from '../../../utils/routeDraft';
import { OUTSOURCE_DEPT_CODE } from '../../../utils/outsourcing';

/**
 * Маршрут позиции в форме создания (правки заказчика 16.08, блок 2).
 *
 * Заказчик решил прямо: автоматический расчёт ОСТАЁТСЯ и предлагает маршрут,
 * а человек его правит. Поэтому блок свёрнут по умолчанию и подписан тем,
 * что получится, если его не открывать, — «рассчитан автоматически».
 *
 * `it.route === undefined` и есть «не трогали». Отличать это от пустого массива
 * обязательно: пустой означал бы «маршрута нет вовсе», и заказ уехал бы без
 * единого этапа — то есть невидимым для всех цехов сразу.
 *
 * Разметка — общий `RouteFields`, тот же, что в карточке заказа. Две реализации
 * одного решения («какие этапы, в каком порядке, чьими руками») разошлись бы
 * в первую же правку, и обе при этом продолжали бы «работать».
 */
export function RouteBlock({ it, i, setItem, route, attach }) {
  const edited = Boolean(it.route);
  const issues = routeIssues(route);
  /**
   * ЯВНЫЙ ВХОД В ПОДРЯД (правка 22.08, п. 5.6).
   *
   * «В Типе производства видны Без изделий, Готовое изделие, Крой, Пошив
   * и Образцы. Подряд как понятный отдельный сценарий не виден».
   *
   * НОВОЙ ЛОГИКИ ЗДЕСЬ НЕТ, и документ требует этого прямо: «после выбора
   * должен использоваться уже существующий механизм подрядного маршрута».
   * Кнопка добавляет в маршрут шаг на участке «Подряд» — то же, что человек
   * сделал бы руками; подрядным его делает `executorForDept`, единственное
   * правило «участок → исполнитель». Типом производства подряд не становится:
   * эта плитка убрана 20.08 осознанно, две точки ввода одного решения
   * однажды разойдутся.
   */
  const addOutsourceStep = () => setItem(i, {
    route: [...route, [emptyStep(OUTSOURCE_DEPT_CODE)]],
  });
  const hasOutsource = route.some(
    (group) => group.some((step) => step.departmentCode === OUTSOURCE_DEPT_CODE
      || step.executor === 'contractor'),
  );

  /**
   * ТЗ и файлы подрядного шага (девятое поле подрядного этапа, документ 20.08).
   *
   * Этапа в этот момент ЕЩЁ НЕТ — он создаётся той же транзакцией, что и заказ.
   * Поэтому файл привязывается к ШАГУ по ключу формы, а в payload превращается
   * в `stage_index` (номер этапа внутри позиции) — тем же приёмом, что
   * `material_index` у строк листа закупки.
   *
   * Ключ включает и позицию, и шаг: файлы разных позиций попали бы в одну кучу,
   * а `stage_index` считается ВНУТРИ позиции.
   */
  const stageFiles = (gi, si) => {
    const ownerKey = `stage:${i}:${gi}:${si}`;
    return (
      <ItemFilePicker
        attach={attach}
        label="+ ТЗ / файлы подрядчику"
        hint="схема узла, раскладка, образец шва — уедут подрядчику"
        kind="subcontract"
        itemIndex={i}
        ownerKey={ownerKey}
        onAdd={(file) => attach.add(file, 'subcontract', i, ownerKey)}
      />
    );
  };

  return (
    <details className={styles.gridDetails}>
      <summary className={styles.subText}>
        Маршрут производства — {edited ? 'правлен вручную' : 'рассчитан автоматически'},
        {' '}шагов: {route.length}
      </summary>
      <div className={styles.routeEditor}>
        <RouteFields
          draft={route}
          onChange={(next) => setItem(i, { route: next })}
          renderStageFiles={stageFiles}
          productionType={it.production_type}
        />
        <RouteIssues issues={issues} />
        {!hasOutsource && (
          <div className={styles.checkRow}>
            <Button variant="secondary" size="sm" icon="truck" onClick={addOutsourceStep}>
              Отдать шаг подрядчику
            </Button>
            <span className={styles.subText}>
              добавит в маршрут участок «Подряд» — дальше работает обычный
              подрядный этап
            </span>
          </div>
        )}
        {edited && (
          <div className={styles.routeEditorFoot}>
            <Button
              variant="ghost"
              size="sm"
              icon="undo"
              onClick={() => setItem(i, { route: undefined })}
            >
              Вернуть расчётный маршрут
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
