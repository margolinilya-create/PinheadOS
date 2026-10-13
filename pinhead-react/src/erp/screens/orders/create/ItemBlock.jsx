import { SizeGridEditor } from './SizeGridEditor';
import { SkuCardPicker } from './SkuCardPicker';
import { FieldError } from './FormParts';
import { Icon } from '../../../components/Icon';
import {
  emptyPrint, gridTotal,
  BRANDING_ON_LABELS, brandingOnOptions, normalizeBrandingOn,
} from '../../../utils/orderForm';
import {
  PRODUCTION_TYPE_LABELS,
  PRODUCTION_TYPE_ORDER,
} from '../../../types';
import {
  GARMENT_SOURCE_HINTS,
  GARMENT_SOURCE_LABELS,
  GARMENT_SOURCE_ORDER,
  garmentSourceOf,
} from '../../../utils/garmentSource';
import styles from '../../../styles';
import { Button } from '../../../components/Button';
// Вложенные блоки позиции — каждый в своём модуле (резка 26.09)
import { PrintBlock } from './PrintBlock';
import { CopyPrintPicker } from './CopyPrintPicker';
import { TechBlock } from './TechBlock';
import { LabelsBlock } from './LabelsBlock';
import { PackagingBlock } from './PackagingBlock';
import { RouteBlock } from './RouteBlock';

/**
 * Одна позиция заказа в форме создания: изделие, вариант, тираж (или размерная
 * сетка), тип производства, подряд, нанесения и заметка.
 *
 * Вынесено из CreateOrderModal — это была самая крупная часть файла (278 строк
 * JSX внутри `items.map`). Состояния не держит: всё приходит пропсами, чтобы
 * валидация и черновик остались в одном месте — в самой модалке.
 *
 * `attach = null` — режим правки (п. 6 правки 01.10): пикеров файлов нет,
 * загрузка «на будущее» в правке давала бы сирот в бакете.
 */
export function ItemBlock({
  it, i, itemsCount, err, inputCls, route, attach, isEdit = false,
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
      {/* Модель каталога стоит ПЕРЕД изделием: она подставляет его название
          и крой, и выбирать её после ручного ввода бессмысленно */}
      <SkuCardPicker item={it} onPick={(patch) => setItem(i, patch)} />
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
        {/* «Цвет» вместо прежнего «Вариант / цвет» (правки 07.09, п. 5) */}
        <span className={styles.fieldLabel}>Цвет</span>
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
        {/*
          ПОРЯДОК ПЛИТОК — `PRODUCTION_TYPE_ORDER` (правки 07.09, п. 3), а не
          порядок ключей словаря подписей: тот читают полтора десятка
          поверхностей, и перестановка ключей ради вида одной формы связала бы
          две разные величины. «Подряда» в массиве нет — см. комментарий выше.

          Смена типа производства НОРМАЛИЗУЕТ `branding_on` (п. 8): у готового
          изделия «на крое» недопустимо, а селект про смену типа не знает.
        */}
        <div className={styles.tileRow} role="radiogroup" aria-label="Тип производства">
          {PRODUCTION_TYPE_ORDER.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={it.production_type === v}
              className={`${styles.tile} ${it.production_type === v ? styles.tileActive : ''}`}
              onClick={() => setItem(i, {
                production_type: v,
                branding_on: normalizeBrandingOn(v, it.branding_on),
              })}
            >
              {PRODUCTION_TYPE_LABELS[v]}
            </button>
          ))}
        </div>
      </div>
      {/*
        ДВА СЦЕНАРИЯ ГОТОВОГО ИЗДЕЛИЯ (правки 07.09, п. 4). Документ просит
        «разделить тип производства „Готовое изделие“ на два сценария»
        и откладывает детализацию; ось назвал заказчик — ЧЬЁ ИЗДЕЛИЕ.

        ВОПРОС ЗАДАЁТСЯ ТОЛЬКО ГОТОВОМУ ИЗДЕЛИЮ и только здесь: у пошива
        изделия ещё нет — оно появится из нашего кроя. Значение, оставшееся
        от переключённой позиции, маршрут не меняет (`garmentSourceOf`
        смотрит и на тип производства), поэтому сбрасывать его при смене
        плитки не требуется — и не нужно: человек, вернувшийся к «Готовому
        изделию», найдёт свой выбор на месте.

        ПОСЛЕДСТВИЯ НАЗВАНЫ ПРЯМО ПОД ВЫБОРОМ. Оба они маршрутные — уходит
        закупка, появляется приёмка склада, — и выбор, о котором известно
        только слово «давальческое», человек сделал бы наугад.
      */}
      {it.production_type === 'ready_garment' && (
        <div className={`${styles.field} ${styles.fieldFull}`}>
          <span className={styles.fieldLabel}>Чьё изделие</span>
          <div className={styles.tileRow} role="radiogroup" aria-label="Чьё изделие">
            {GARMENT_SOURCE_ORDER.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={garmentSourceOf(it) === v}
                className={`${styles.tile} ${garmentSourceOf(it) === v ? styles.tileActive : ''}`}
                onClick={() => setItem(i, { garment_source: v })}
              >
                {GARMENT_SOURCE_LABELS[v]}
              </button>
            ))}
          </div>
          <span className={styles.subText}>
            {GARMENT_SOURCE_HINTS[garmentSourceOf(it)]}
          </span>
        </div>
      )}
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
              /*
                Имя задано ЯВНО и повторяет видимую подпись дословно: пояснение
                ниже лежит внутри той же `<label>` (принятый в форме приём),
                и без `aria-label` оно приклеилось бы к имени поля — скринридер
                читал бы «Нанесение на У готового изделия кроя нет…».
              */
              aria-label="Нанесение на"
              value={normalizeBrandingOn(it.production_type, it.branding_on)}
              disabled={!it.has_branding}
              onChange={(e) => setItem(i, { branding_on: e.target.value })}
            >
              {brandingOnOptions(it.production_type).map((v) => (
                <option key={v} value={v}>{BRANDING_ON_LABELS[v]}</option>
              ))}
            </select>
            {it.production_type === 'ready_garment' && (
              <span className={styles.subText}>
                У готового изделия кроя нет — нанесение только на готовом
              </span>
            )}
          </label>
        </div>

        {it.has_branding && it.prints.map((p, pi) => (
          <PrintBlock
            key={pi}
            p={p}
            pi={pi}
            i={i}
            err={err}
            setPrint={setPrint}
            removePrint={removePrint}
            attach={attach}
          />
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
        {/*
          МАРШРУТ В ПРАВКЕ НЕ РЕДАКТИРУЕТСЯ (долг с 01.10, закрыт 09.10). Правка
          заказа маршрут не отправляет — этапы уже созданы, и пересборка стёрла бы
          факт цеха. Редактор здесь принимал изменения и молча их терял;
          у сохранённой позиции он показывал пересчитанный, а не настоящий маршрут.
        */}
        {isEdit && it.id ? (
          <p className={styles.subText}>
            Маршрут производства уже разложен на этапы. Менять его — в карточке
            заказа: позиция → «Изменить маршрут».
          </p>
        ) : (
          <RouteBlock it={it} i={i} setItem={setItem} route={route} attach={attach} />
        )}
        </div>
  );
}
