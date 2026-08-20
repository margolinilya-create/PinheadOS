import { DictionaryDatalist } from '../../../components/DictionaryDatalist';
import { SizeGridEditor } from './SizeGridEditor';
import { FieldError } from './FormParts';
import { Icon } from '../../../components/Icon';
import { EMPTY_PRINT, gridTotal } from '../../../utils/orderForm';
import {
  ITEM_PACKAGING_LABELS,
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
} from '../../../types';
import styles from '../../../erp.module.css';
import { Button } from '../../../components/Button';
import { RouteFields, RouteIssues } from '../../../components/RouteFields';
import { AttachmentPicker } from '../../../components/AttachmentPicker';
import { routeIssues } from '../../../utils/routeDraft';

/**
 * Одна позиция заказа в форме создания: изделие, вариант, тираж (или размерная
 * сетка), тип производства, подряд, нанесения и заметка.
 *
 * Вынесено из CreateOrderModal — это была самая крупная часть файла (278 строк
 * JSX внутри `items.map`). Состояния не держит: всё приходит пропсами, чтобы
 * валидация и черновик остались в одном месте — в самой модалке.
 */
export function ItemBlock({
  it, i, itemsCount, err, inputCls, route, attach,
  setItem, setBranding, setPrint, removeItem, removePrint,
}) {
  const gTotal = gridTotal(it.size_grid);

  return (
    <div className={styles.itemBlock}>
      <div className={styles.itemBlockHead}>
        <span className={styles.itemBlockTitle} title={it.product_type || undefined}>
          Позиция {i + 1}{it.product_type ? ` · ${it.product_type}` : ''}
        </span>
        <Button
          variant="ghost"
          aria-label={`Убрать позицию ${i + 1}`}
          disabled={itemsCount === 1}
          onClick={() => removeItem(i)}>
          <Icon name="x" size={14} />
        </Button>
      </div>
    <div className={styles.itemRow}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Изделие *</span>
        {/* Подсказки из справочника типов изделий (правка 12), ввод остаётся свободным */}
        <input
          className={inputCls(`item_${i}_product_type`)}
          value={it.product_type}
          onChange={(e) => setItem(i, { product_type: e.target.value })}
          placeholder="футболка"
          list="erp-product-types"
          aria-required="true"
          aria-invalid={err(`item_${i}_product_type`) ? true : undefined}
          aria-describedby={err(`item_${i}_product_type`) ? `err-item-${i}-product` : undefined}
          data-invalid={err(`item_${i}_product_type`) ? true : undefined}
        />
        <FieldError id={`err-item-${i}-product`} text={err(`item_${i}_product_type`)} />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Вариант / цвет</span>
        <input
          className={styles.input}
          value={it.variant}
          onChange={(e) => setItem(i, { variant: e.target.value })}
          placeholder="голубые"
        />
      </label>
      {/* Крой стоит между цветом и количеством: документ задаёт порядок
          заполнения позиции — Изделие → Цвет → Крой → Размер → Количество.
          Ввод свободный с подсказками справочника: у каждого заказчика свои
          лекала, и перечисление означало бы миграцию на каждое название. */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Крой</span>
        <input
          className={styles.input}
          value={it.fit}
          onChange={(e) => setItem(i, { fit: e.target.value })}
          placeholder="Regular · Oversize · Free Fit"
        />
      </label>
      {gTotal > 0 ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Кол-во</span>
          <input
            className={styles.input}
            value={gTotal}
            readOnly
            aria-label={`Количество позиции ${i + 1} — из размерной сетки`}
          />
          <span className={styles.subText}>из размерной сетки</span>
        </label>
      ) : (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Кол-во *</span>
          <input
            type="number"
            min="1"
            className={inputCls(`item_${i}_qty`)}
            value={it.qty}
            onChange={(e) => setItem(i, { qty: e.target.value.replace('-', '') })}
            aria-required="true"
            aria-invalid={err(`item_${i}_qty`) ? true : undefined}
            aria-describedby={err(`item_${i}_qty`) ? `err-item-${i}-qty` : undefined}
            data-invalid={err(`item_${i}_qty`) ? true : undefined}
          />
          <FieldError id={`err-item-${i}-qty`} text={err(`item_${i}_qty`)} />
        </label>
      )}
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Тип производства</span>
        {/*
          «Подряд» ТИПОМ ПРОИЗВОДСТВА БОЛЬШЕ НЕ ВЫБИРАЕТСЯ (правки 20.08):
          документ требует этого прямо — «убрать "Подряд" как отдельный тип
          производства». Подряд — признак ЭТАПА, и задаётся он в маршруте
          ниже: исполнитель «Подрядчик» у любого шага, сколько угодно раз.

          Значение `outsource` остаётся в схеме и в подписях: его несут заказы,
          заведённые раньше, и карточка заказа обязана их показывать. Убрана
          ровно точка ВВОДА — иначе одно и то же задавалось бы двумя способами,
          а маршрут считался бы по частному правилу `material_source`.
        */}
        <div className={styles.tileRow} role="radiogroup" aria-label="Тип производства">
          {Object.entries(PRODUCTION_TYPE_LABELS)
            .filter(([v]) => v !== 'outsource')
            .map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={it.production_type === v}
                className={`${styles.tile} ${it.production_type === v ? styles.tileActive : ''}`}
                onClick={() => setItem(i, { production_type: v })}
              >
                {label}
              </button>
            ))}
        </div>
      </div>
      {/*
        БЛОК «ТИП ПОДРЯДА» УДАЛЁН (правки заказчика 16.08, п. 5 блока 2).

        Документ запрещает фиксированные типы подряда прямо: «не нужно создавать
        отдельные типы — подряд на пошив, на печать, на крой и т.д. Вместо этого
        маршрут должен собираться из последовательных этапов, и для каждого
        выбирается тип исполнителя: наш цех или подрядный цех».

        Теперь это делает блок «Маршрут производства» ниже: у каждого этапа свой
        исполнитель, подрядных этапов может быть несколько, а изделие
        возвращается в наши цеха обычным следующим этапом маршрута.

        Колонки `subcontract_kind` / `material_source` / `return_dept` в схеме
        ОСТАЮТСЯ: их несут заказы, заведённые до правки, и блок совместимости
        на экране «Подряд» читает их до тех пор, пока не опустеет. Снимать их
        раньше — тот самый обратный порядок, который уже ронял весь раздел
        «Производство» дропом `erp_experimental_ops`.
      */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Брендирование</span>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={Boolean(it.has_branding)}
                onChange={(e) => setBranding(i, e.target.checked)}
              />
              С нанесением
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Нанесение на</span>
            <select
              className={styles.select}
              value={it.branding_on}
              disabled={!it.has_branding}
              onChange={(e) => setItem(i, { branding_on: e.target.value })}
            >
              <option value="cut">на крое</option>
              <option value="finished">на готовом</option>
            </select>
          </label>
        </div>

        {it.has_branding && it.prints.map((p, pi) => (
          <div key={pi} className={styles.printBlock}>
            <div className={`${styles.checkRow} ${styles.printRow}`}>
              <strong className={styles.fieldLabel}>Нанесение №{pi + 1}</strong>
              <select
                className={`${styles.select} ${styles.inputSm}`}
                value={p.method}
                aria-label="Техника нанесения"
                onChange={(e) => setPrint(i, pi, { method: e.target.value })}
              >
                {Object.entries(BRANDING_METHOD_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <input
                className={`${styles.input} ${styles.inputSm} ${styles.printZoneInput}`}
                placeholder="Расположение (спина справа по втачке)"
                aria-label="Расположение нанесения"
                value={p.zone}
                onChange={(e) => setPrint(i, pi, { zone: e.target.value })}
              />
              <label className={`${styles.checkLabel} ${styles.mmLabel}`} style={{ gap: 3 }}>
                <span className={styles.subText}>В, мм</span>
                <input type="number" min="1"
                  className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                  value={p.height_mm}
                  onChange={(e) => setPrint(i, pi, { height_mm: e.target.value })} />
              </label>
              <label className={`${styles.checkLabel} ${styles.mmLabel}`} style={{ gap: 3 }}>
                <span className={styles.subText}>Ш, мм</span>
                <input type="number" min="1"
                  className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                  value={p.width_mm}
                  onChange={(e) => setPrint(i, pi, { width_mm: e.target.value })} />
              </label>
              <Button
                variant="ghost"
                aria-label={`Убрать нанесение ${pi + 1}`}
                onClick={() => removePrint(i, pi)}>
                <Icon name="x" size={14} />
              </Button>
            </div>
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
          </div>
        ))}

        {it.has_branding && (
          <div
            className={styles.checkRow}
            data-invalid={err(`item_${i}_prints`) ? true : undefined}
          >
            <Button
              variant="secondary"
              aria-describedby={err(`item_${i}_prints`) ? `err-item-${i}-prints` : undefined}
              onClick={() => setItem(i, { prints: [...it.prints, { ...EMPTY_PRINT }] })}>
              + Нанесение ({it.prints.length})
            </Button>
            <FieldError id={`err-item-${i}-prints`} text={err(`item_${i}_prints`)} />
          </div>
        )}

        <details className={styles.gridDetails}>
          <summary className={styles.subText}>
            Размерная сетка (цвет × размер){gTotal > 0 ? ` — ${gTotal} шт` : ''}
          </summary>
          <SizeGridEditor
            grid={it.size_grid}
            onChange={(g) => setItem(i, { size_grid: g })}
          />
        </details>

        <TechBlock it={it} i={i} setItem={setItem} attach={attach} />
        <PackagingBlock it={it} i={i} setItem={setItem} attach={attach} />
        <RouteBlock it={it} i={i} setItem={setItem} route={route} />
        </div>
  );
}

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
function TechBlock({ it, i, setItem, attach }) {
  const filled = [it.trim_material, it.cutting_note, it.sewing_note, it.labels_note]
    .filter((v) => v.trim()).length;

  return (
    <details className={styles.gridDetails}>
      <summary className={styles.subText}>
        Технический блок изделия{filled > 0 ? ` — заполнено полей: ${filled}` : ''}
      </summary>
      <div className={styles.itemRow}>
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
      <AttachmentPicker
        label="+ Файлы техблока"
        hint="схема узла, расположение бирки, пример раскроя"
        files={attach.files}
        kind="tech"
        itemIndex={i}
        onAdd={attach.add}
        onRetry={attach.retry}
        onRemove={attach.remove}
      />
    </details>
  );
}

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
function PackagingBlock({ it, i, setItem, attach }) {
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
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Размер пакета</span>
          <input
            className={styles.input}
            value={it.packaging_size}
            onChange={(e) => setItem(i, { packaging_size: e.target.value })}
            placeholder="40×60"
          />
        </label>
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
      <AttachmentPicker
        label="+ Файлы упаковки"
        hint="вариант упаковки, расположение стикера и маркировки"
        files={attach.files}
        kind="packaging"
        itemIndex={i}
        onAdd={attach.add}
        onRetry={attach.retry}
        onRemove={attach.remove}
      />
    </details>
  );
}

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
function RouteBlock({ it, i, setItem, route }) {
  const edited = Boolean(it.route);
  const issues = routeIssues(route);

  return (
    <details className={styles.gridDetails}>
      <summary className={styles.subText}>
        Маршрут производства — {edited ? 'правлен вручную' : 'рассчитан автоматически'},
        {' '}шагов: {route.length}
      </summary>
      <div className={styles.routeEditor}>
        <RouteFields draft={route} onChange={(next) => setItem(i, { route: next })} />
        <RouteIssues issues={issues} />
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
