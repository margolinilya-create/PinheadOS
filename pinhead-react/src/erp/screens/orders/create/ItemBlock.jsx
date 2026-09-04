import { DictionaryDatalist } from '../../../components/DictionaryDatalist';
import { SizeGridEditor } from './SizeGridEditor';
import { FieldError } from './FormParts';
import { Icon } from '../../../components/Icon';
import { emptyLabel, emptyPrint, gridTotal } from '../../../utils/orderForm';
import {
  ITEM_PACKAGING_LABELS,
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
} from '../../../types';
import styles from '../../../styles';
import { Button } from '../../../components/Button';
import { RouteFields, RouteIssues } from '../../../components/RouteFields';
import { AttachmentPicker } from '../../../components/AttachmentPicker';
import { emptyStep, routeIssues } from '../../../utils/routeDraft';
import { OUTSOURCE_DEPT_CODE } from '../../../utils/outsourcing';

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
  allItems = [], onCopyPrint,
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
      <div className={`${styles.field} ${styles.fieldFull}`}>
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
            {/*
              МАКЕТ ПРИНАДЛЕЖИТ ЭТОМУ НАНЕСЕНИЮ (правка 22.08, п. 5.2).
              Раньше макеты лежали общим блоком вместе с прочими файлами ТЗ,
              и при трёх-четырёх нанесениях цех сам угадывал, какой файл
              к какому относится. Привязка идёт по КЛЮЧУ нанесения: строки
              `erp_item_prints` в этот момент ещё не существует — заказ
              создаётся одной транзакцией.
            */}
            <AttachmentPicker
              label="+ Макет нанесения"
              hint="файл именно этого нанесения — цех не будет угадывать"
              files={attach.files}
              kind="print"
              itemIndex={i}
              ownerKey={p.key}
              onAdd={(file) => attach.add(file, 'print', i, p.key)}
              onRetry={attach.retry}
              onRemove={attach.remove}
            />
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
              onClick={() => setItem(i, { prints: [...it.prints, emptyPrint()] })}>
              + Нанесение ({it.prints.length})
            </Button>
            {/*
              КОПИРОВАНИЕ НАНЕСЕНИЯ ИЗ ДРУГОЙ ПОЗИЦИИ (правка 22.08, п. 5.4):
              «в одной сделке могут быть футболка и свитшот с полностью
              одинаковыми нанесениями» — менеджер заполняет один раз.
              После копирования данные правятся независимо от источника.
            */}
            <CopyPrintPicker items={allItems} target={i} onCopy={onCopyPrint} />
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
        <LabelsBlock it={it} i={i} setItem={setItem} attach={attach} />
        <PackagingBlock it={it} i={i} setItem={setItem} attach={attach} />
        <RouteBlock it={it} i={i} setItem={setItem} route={route} attach={attach} />
        </div>
  );
}

/**
 * Выбор «откуда копировать нанесение» (п. 5.4).
 *
 * Селект, а не кнопка «копировать всё»: позиций бывает четыре, нанесений
 * в каждой несколько, и человеку нужно назвать КОНКРЕТНОЕ. Показываем только
 * заполненные нанесения других позиций — пустая строка в списке
 * не отличалась бы от заполненной.
 */
function CopyPrintPicker({ items, target, onCopy }) {
  const options = [];
  (items ?? []).forEach((src, si) => {
    if (si === target) return;
    (src.prints ?? []).forEach((p, pi) => {
      if (!p.zone?.trim() && !p.pantone?.trim() && !p.comment?.trim()) return;
      options.push({
        si,
        pi,
        label: `Поз. ${si + 1}${src.product_type ? ` (${src.product_type})` : ''} · `
          + `${BRANDING_METHOD_LABELS[p.method] || p.method}`
          + `${p.zone?.trim() ? ` — ${p.zone.trim()}` : ''}`,
      });
    });
  });
  if (options.length === 0 || !onCopy) return null;

  return (
    <label className={styles.checkLabel}>
      <span className={styles.subText}>Копировать нанесение:</span>
      <select
        className={`${styles.select} ${styles.inputSm}`}
        value=""
        aria-label={`Копировать нанесение в позицию ${target + 1}`}
        onChange={(e) => {
          const opt = options[Number(e.target.value)];
          if (opt) onCopy(target, opt.si, opt.pi);
          e.target.value = '';
        }}
      >
        <option value="">выбрать источник…</option>
        {options.map((o, idx) => (
          <option key={`${o.si}:${o.pi}`} value={idx}>{o.label}</option>
        ))}
      </select>
    </label>
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
  const filled = [it.main_fabric, it.trim_material, it.cutting_note, it.sewing_note,
    it.labels_note].filter((v) => (v ?? '').trim()).length;

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
 * БИРКИ ПОЗИЦИИ (правка 22.08, п. 5.3).
 *
 * «Сейчас используется одно общее текстовое поле Бирки. В реальном заказе
 * у изделия обычно может быть несколько бирок» — размерник, составник,
 * брендовая, по уходу, — и у каждой своё расположение, размер и МАКЕТ.
 * Одно поле на всех означало, что половина сведений теряется при беглом
 * чтении, а макет не привязан ни к чему.
 *
 * Старое поле `labels_note` осталось в техблоке: его несут заведённые заказы,
 * и разложить свободный текст по полям может только человек.
 */
function LabelsBlock({ it, i, setItem, attach }) {
  const labels = it.labels ?? [];
  const setLabel = (li, patch) => setItem(i, {
    labels: labels.map((l, k) => (k === li ? { ...l, ...patch } : l)),
  });

  return (
    <details className={styles.gridDetails}>
      <summary className={styles.subText}>
        Бирки{labels.length > 0 ? ` — ${labels.length}` : ''}
      </summary>
      {/* Справочник — подсказка поверх свободного ввода (правило проекта) */}
      <DictionaryDatalist kind="label_type" id="erp-label-types" />
      {labels.map((l, li) => (
        <div key={l.key} className={styles.printBlock}>
          <div className={`${styles.checkRow} ${styles.printRow}`}>
            <strong className={styles.fieldLabel}>Бирка №{li + 1}</strong>
            <input
              className={`${styles.input} ${styles.inputSm}`}
              list="erp-label-types"
              placeholder="Тип (размерник, составник)"
              aria-label={`Тип бирки ${li + 1}`}
              value={l.label_type}
              onChange={(e) => setLabel(li, { label_type: e.target.value })}
            />
            <input
              className={`${styles.input} ${styles.inputSm} ${styles.printZoneInput}`}
              placeholder="Расположение (левый внутренний боковой шов)"
              aria-label={`Расположение бирки ${li + 1}`}
              value={l.place}
              onChange={(e) => setLabel(li, { place: e.target.value })}
            />
            <input
              className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
              placeholder="Размер"
              aria-label={`Размер бирки ${li + 1}`}
              value={l.size}
              onChange={(e) => setLabel(li, { size: e.target.value })}
            />
            <Button
              variant="ghost"
              aria-label={`Убрать бирку ${li + 1}`}
              onClick={() => {
                attach.dropOwner(l.key);
                setItem(i, { labels: labels.filter((_, k) => k !== li) });
              }}
            >
              <Icon name="x" size={14} />
            </Button>
          </div>
          <div className={`${styles.checkRow} ${styles.printRow}`}>
            <input
              className={`${styles.input} ${styles.inputSm} ${styles.printNoteInput}`}
              placeholder="Комментарий"
              aria-label={`Комментарий к бирке ${li + 1}`}
              value={l.comment}
              onChange={(e) => setLabel(li, { comment: e.target.value })}
            />
          </div>
          <AttachmentPicker
            label="+ Макет бирки"
            hint="файл именно этой бирки"
            files={attach.files}
            kind="label"
            itemIndex={i}
            ownerKey={l.key}
            onAdd={(file) => attach.add(file, 'label', i, l.key)}
            onRetry={attach.retry}
            onRemove={attach.remove}
          />
        </div>
      ))}
      <div className={styles.checkRow}>
        <Button
          variant="secondary"
          onClick={() => setItem(i, { labels: [...labels, emptyLabel()] })}
        >
          + Бирка ({labels.length})
        </Button>
      </div>
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
function RouteBlock({ it, i, setItem, route, attach }) {
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
      <AttachmentPicker
        label="+ ТЗ / файлы подрядчику"
        hint="схема узла, раскладка, образец шва — уедут подрядчику"
        files={attach.files}
        kind="subcontract"
        itemIndex={i}
        ownerKey={ownerKey}
        accept="image/*,application/pdf"
        onAdd={(file) => attach.add(file, 'subcontract', i, ownerKey)}
        onRetry={attach.retry}
        onRemove={attach.remove}
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
