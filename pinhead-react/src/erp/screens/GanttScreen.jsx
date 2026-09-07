import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { ProductionTabs } from '../components/ProductionTabs';
import { Button } from '../components/Button';
import { EmptyState, LoadFailed } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { OrderLink } from '../components/OrderLink';
import { useCompactLayout } from '../layout/useCompactLayout';
import { useErpStore } from '../store/useErpStore';
import { ganttBars } from '../utils/gantt';
import { weekdayShort } from '../utils/format';
import { addDays, factoryToday, mondayOfWeek, parseIsoDate } from '../../utils/date';
import styles from '../styles';

/**
 * ГАНТ — четвёртая вкладка раздела «Производство» (правки 07.09, п. 19).
 *
 * «Добавить режим „Гант“: слева список задач, справа шкала времени, между
 * стартом и финишем — полоса». Зависимости между этапами документ на первом
 * этапе рисовать не просит, и их здесь нет.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ СОСЕДНИХ ВКЛАДОК. «Доска» отвечает «где что стоит
 * сейчас», «План» — «что цех делает в конкретный день», «Загрузка» — «сколько
 * штук цех обязался сдать». Гант отвечает на четвёртый вопрос: «сколько
 * времени занимает каждый этап и где они накладываются».
 *
 * ГЛАВНОЕ ПРЕДУПРЕЖДЕНИЕ ЭКРАНА. Плановых дат на живой базе почти нет, и
 * полоса чаще всего построена по сроку ЗАКАЗА, а не по плану этапа. Экран
 * обязан это называть: источник подписан у каждой строки, а полоса-догадка
 * рисуется штриховкой. Диаграмма, выдающая срок заказа за план этапа,
 * опаснее пустой — по ней начнут принимать решения о сроках.
 *
 * Только чтение: даты правятся в карточке заказа (колонка «План»).
 */

/** Сколько дней показываем; период живёт в адресе (`?from=`, `?days=`) */
const DAY_CHOICES = [14, 30, 60];
const DEFAULT_DAYS = 30;

function dayLabel(iso) {
  return { dow: weekdayShort(iso), day: parseIsoDate(iso).getDate() };
}

/**
 * Дата для человека. Отдаётся локали ЦЕЛИКОМ, а не собирается из числа
 * и месяца отдельно: склеенные вручную, они дают «6 июль» — именительный там,
 * где по-русски нужен родительный («6 июля»).
 */
function dayMonth(iso) {
  return parseIsoDate(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Подпись источника даты — прямым текстом, без легенды где-то сбоку */
const SOURCE_LABELS = {
  planned: 'план этапа',
  fact: 'факт запуска',
  order: 'срок заказа',
  none: 'даты нет',
};

/**
 * Догадка ли эта полоса. `planned`/`fact` — то, что ввели про САМ ЭТАП;
 * `order`/`none` означают «про этап никто ничего не сказал», и такая полоса
 * не имеет права выглядеть как план.
 */
function isGuess(bar) {
  return bar.endSource !== 'planned' || bar.startSource === 'order' || bar.startSource === 'none';
}

function barTitle(bar) {
  return `${bar.orderTitle} · ${bar.deptName}: ${bar.start} → ${bar.end}`
    + ` (начало — ${SOURCE_LABELS[bar.startSource]}, конец — ${SOURCE_LABELS[bar.endSource]})`;
}

export default function GanttScreen() {
  const { orders, departments, loaded, loadError, loadAll } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
    })),
  );
  const compact = useCompactLayout();
  const [params, setParams] = useSearchParams();
  const today = factoryToday();

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  /**
   * Период — В АДРЕСЕ: диаграмму пересылают («посмотри, что у нас в октябре»),
   * и ссылка без периода открывала бы у получателя другую картинку.
   */
  const from = params.get('from') || mondayOfWeek(today);
  const days = DAY_CHOICES.includes(Number(params.get('days')))
    ? Number(params.get('days')) : DEFAULT_DAYS;

  const setPeriod = (next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) p.set(k, String(v));
    setParams(p, { replace: true });
  };

  const { bars, undated, dates } = useMemo(
    () => ganttBars(orders, departments, { from, days, today }),
    [orders, departments, from, days, today],
  );

  /**
   * Колонка «сегодня» — в поле зрения. Период до 60 дней шире любого экрана,
   * и диаграмма открывалась бы на начале периода, когда работа идёт сегодня.
   * Прокрутка только ГОРИЗОНТАЛЬНАЯ и внутри своего контейнера.
   */
  const todayRef = useRef(null);
  useEffect(() => {
    const el = todayRef.current;
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    } catch { /* старый браузер — остаёмся на начале периода, это не поломка */ }
  }, [from, days, compact, loaded]);

  const periodLabel = `${dayMonth(dates[0])} — ${dayMonth(dates[dates.length - 1])}`;

  /** Строки для компактной раскладки: этапы, сгруппированные по заказу */
  const byOrder = useMemo(() => {
    const map = new Map();
    for (const bar of bars) {
      if (!map.has(bar.orderId)) map.set(bar.orderId, { title: bar.orderTitle, bars: [] });
      map.get(bar.orderId).bars.push(bar);
    }
    return [...map.entries()].map(([orderId, v]) => ({ orderId, ...v }));
  }, [bars]);

  return (
    <>
      <PageHead
        title="Гант"
        sub="Этапы во времени: когда начинается и когда должен закончиться каждый."
      />
      <ProductionTabs />

      <div className={styles.toolbar}>
        <Button
          variant="ghost"
          icon="chevronLeft"
          onClick={() => setPeriod({ from: addDays(from, -days) })}
        >
          Назад
        </Button>
        <span className={styles.loadPeriod}>{periodLabel}</span>
        <Button variant="ghost" onClick={() => setPeriod({ from: addDays(from, days) })}>
          Вперёд
        </Button>
        <Button variant="secondary" onClick={() => setPeriod({ from: mondayOfWeek(today) })}>
          Сегодня
        </Button>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Период</span>
          <select
            className={styles.select}
            value={days}
            onChange={(e) => setPeriod({ days: e.target.value })}
            aria-label="Длина периода"
          >
            {DAY_CHOICES.map((d) => <option key={d} value={d}>{d} дней</option>)}
          </select>
        </label>
      </div>

      {!loaded && !loadError && <TableSkeleton />}
      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="диаграмму Ганта" />}

      {/*
        ЧЕСТНОСТЬ ДИАГРАММЫ. Полоса, построенная по сроку ЗАКАЗА, — это не план
        этапа, и молчаливо она читалась бы именно как план. Полоса-догадка
        рисуется штриховкой, а строка называет источник обеих дат словами.
      */}
      {loaded && bars.length > 0 && !compact && (
        <p className={styles.subText}>
          Штриховкой показаны полосы, построенные не по плану этапа, а по сроку
          заказа: плановую дату этапа проставляют в карточке заказа (колонка
          «План») или при взятии работы в цех.
        </p>
      )}

      {loaded && bars.length === 0 && (
        <EmptyState
          icon="calendar"
          title="В этом периоде этапов нет"
          text="Полоса строится по плановым датам этапа, а если их нет — по сроку заказа. Ни того ни другого в периоде не нашлось."
          action={<Link to="/orders" className={styles.widgetLink}>Открыть заказы →</Link>}
        />
      )}

      {loaded && bars.length > 0 && !compact && (
        <ScrollHintBox className={styles.tableWrap} label="Диаграмма Ганта">
          {/*
            СЕТКА НА КАЖДУЮ СТРОКУ, А НЕ ОДНА НА ВСЮ ДИАГРАММУ. Общий грид
            с `display: contents` у строк выглядел короче, но полоса с явной
            колонкой уезжала бы в НОВУЮ строку: разреженная автораскладка
            не возвращается назад по потоку. Строка-грид ставит полосу
            поверх дорожек одним `grid-row: 1`, а `--gantt-days` наследуется
            от обёртки — то есть число дней объявлено ровно один раз.
          */}
          <div className={styles.ganttWrap} style={{ '--gantt-days': dates.length }}>
            <div className={styles.ganttGrid}>
              <div className={styles.ganttHeadLabel} />
              {dates.map((d) => {
                const { dow, day } = dayLabel(d);
                return (
                  <div
                    key={d}
                    ref={d === today ? todayRef : undefined}
                    className={[
                      styles.ganttHeadCell,
                      d === today ? styles.ganttHeadToday : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {dow}<br />{day}
                  </div>
                );
              })}
            </div>

            {bars.map((bar) => {
              /**
               * Полоса кладётся в колонки грида. Хвост, уходящий за край
               * периода, ОБРЕЗАЕТСЯ по краю и помечается прямым углом:
               * иначе полоса, начавшаяся месяц назад, выглядела бы
               * начавшейся в первый день видимого периода.
               */
              const startCol = Math.max(bar.offsetDays, 0);
              const endCol = Math.min(bar.offsetDays + bar.spanDays, dates.length);
              const clipStart = bar.offsetDays < 0;
              const clipEnd = bar.offsetDays + bar.spanDays > dates.length;
              const guess = isGuess(bar);
              return (
                <div key={bar.stageId} className={styles.ganttGrid}>
                  <div className={styles.ganttLabel}>
                    <OrderLink orderId={bar.orderId} className={styles.ganttLabelTitle}>
                      {bar.orderTitle} · {bar.deptName}
                    </OrderLink>
                    <span className={styles.ganttLabelSub}>
                      {bar.itemTitle}
                      {bar.outsourced && ' · подряд'}
                      {' · '}
                      {SOURCE_LABELS[bar.startSource]} → {SOURCE_LABELS[bar.endSource]}
                    </span>
                  </div>
                  {/*
                    Дорожки размещаются ЯВНО, колонка в колонку. Автораскладка
                    здесь не работает: элемент с явной колонкой (полоса) занимает
                    свои ячейки ДО неё, и дорожки, наткнувшись на занятое место,
                    перескакивали во вторую строку — каждая строка диаграммы
                    получала пустого двойника под собой. Видно это только глазами:
                    разметка та же, поведение то же.
                  */}
                  {dates.map((d, i) => (
                    <div
                      key={d}
                      className={[
                        styles.ganttTrack,
                        d === today ? styles.ganttTrackToday : '',
                      ].filter(Boolean).join(' ')}
                      style={{ gridColumn: i + 2, gridRow: 1 }}
                    />
                  ))}
                  <div
                    className={[
                      styles.ganttBar,
                      guess ? styles.ganttBarGuess : '',
                      !guess && bar.overdue ? styles.ganttBarOverdue : '',
                      !guess && !bar.overdue && bar.outsourced ? styles.ganttBarOutsourced : '',
                      clipStart ? styles.ganttBarClipStart : '',
                      clipEnd ? styles.ganttBarClipEnd : '',
                    ].filter(Boolean).join(' ')}
                    /* Колонки грида нумеруются с 1, первая занята подписью */
                    style={{ gridColumn: `${startCol + 2} / ${endCol + 2}`, gridRow: 1 }}
                    title={barTitle(bar)}
                  >
                    {/*
                      Полоса БЕЗ подписи: цех уже назван в строке слева, а на
                      штриховке «догадки» тот же текст ещё и не читался. Смысл
                      полосы — её положение и длина, дублировать им нечего.
                    */}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollHintBox>
      )}

      {/*
        КОМПАКТНАЯ РАСКЛАДКА. Шкала на 60 дней в 375px — это полоса шириной
        в пиксель: читать нечего. Те же данные текстом, сгруппированные
        по заказу, — тот же приём, что у «Загрузки цехов» (`DeptLoadCard`).
      */}
      {loaded && bars.length > 0 && compact && (
        <div className={styles.dataCardList} role="list" aria-label="Этапы во времени">
          {byOrder.map((o) => (
            <div key={o.orderId} className={styles.dataCard} role="listitem">
              <div className={styles.dataCardHead}>
                <OrderLink orderId={o.orderId} className={styles.dataCardTitle}>
                  {o.title}
                </OrderLink>
              </div>
              {o.bars.map((bar) => (
                <div key={bar.stageId} className={styles.ganttCardStage}>
                  <span>
                    {/*
                      ПОЗИЦИЯ НАЗЫВАЕТСЯ ЯВНО. У заказа их несколько, и каждая
                      идёт своим маршрутом: две строки «Закрой» под одним
                      заголовком — это рубашка и фартук, а не дубль. В таблице
                      слева позиция стоит в подписи строки; в карточке шапка
                      общая на заказ, и без неё строки неразличимы.
                    */}
                    {bar.deptName} · <span className={styles.subText}>{bar.itemTitle}</span>
                    {bar.outsourced && <span className={styles.subText}> · подряд</span>}
                    <span className={styles.ganttLabelSub}>
                      {' · '}{SOURCE_LABELS[bar.startSource]} → {SOURCE_LABELS[bar.endSource]}
                    </span>
                  </span>
                  <span
                    className={[
                      styles.ganttCardDates,
                      bar.overdue ? styles.overdue : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {dayMonth(bar.start)} → {dayMonth(bar.end)} · {bar.spanDays} дн.
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/*
        ЭТАПЫ БЕЗ СРОКА НАЗЫВАЮТСЯ, А НЕ ЗАМАЛЧИВАЮТСЯ. Полосы у них нет —
        рисовать её было бы враньём, — но сегодня таких большинство, и
        диаграмма без этой строки отвечала бы «работы нет» там, где работа
        есть и срока у неё нет.
      */}
      {loaded && undated.length > 0 && (
        <div className={styles.warnBox} role="status">
          <strong>Без срока: {undated.length} этапов</strong> — ни плановой даты
          этапа, ни срока заказа, поэтому на диаграмме их нет. Срок ставят
          в карточке заказа.
          <div className={styles.checkRow} style={{ marginTop: 8 }}>
            {[...new Map(undated.map((b) => [b.orderId, b])).values()]
              .slice(0, 5)
              .map((b) => (
                <OrderLink key={b.orderId} orderId={b.orderId}>{b.orderTitle}</OrderLink>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
