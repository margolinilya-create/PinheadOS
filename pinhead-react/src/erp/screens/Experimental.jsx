import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { FilterBar } from '../components/FilterBar';
import { Badge } from '../components/Badge';
import { Pagination } from '../components/Pagination';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { DateField } from '../components/DateField';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { useErpStore } from '../store/useErpStore';
import { useDictionary } from '../store/useDictionary';
import {
  DEV_STATE_LABELS,
  EMPTY_DEV_FILTERS,
  DEV_SORT_LABELS,
  applyDevFilters,
  buildDevRows,
  devFiltersFromParams,
  devFiltersToParams,
  hasActiveDevFilters,
  devFilterParamKeys,
} from '../utils/filterExperimental';
import {
  currentBlocker, devReadiness, nextAction, taskLabel,
} from '../utils/experimentalTasks';
import { DEV_OUTCOME_LABELS } from '../types';
import { formatDateShort } from '../utils/time';
import { factoryToday } from '../../utils/date';
import { DevBoard } from './experimental/DevBoard';
import { DevRowCard } from './experimental/DevRowCard';
import { useCompactLayout } from '../layout/useCompactLayout';
import { DevViews } from './experimental/DevViews';
import styles from '../styles';

/**
 * Экспериментальный цех — разработка изделий (ТЗ заказчика 12.08).
 *
 * Экран отвечает на вопрос «что сейчас происходит с каждой разработкой и что
 * конкретно нужно сделать дальше», а не «на какой фазе заказ». Поэтому в строке
 * стоят ГОТОВНОСТЬ и ТЕКУЩИЙ БЛОКЕР — руководитель видит, почему изделие стоит,
 * не открывая карточку (ТЗ п.12, п.16).
 *
 * Верхние вкладки — ВЫЧИСЛЯЕМЫЕ состояния (`devState`), а не хранимые статусы:
 * прежние пять фаз были линейной цепочкой, от которой заказчик отказался.
 * Хранится только ИСХОД закрытой разработки.
 */

/** Плитки-состояния в порядке срочности: сначала то, где нужно вмешаться */
const STATE_TILES = [
  // «Все», а не «Все разработки»: так теперь называется ВИД раздела (документ
  // 20.08), и две одинаковые подписи рядом означали бы два разных действия
  { key: '', icon: 'orders', label: 'Все', cls: '' },
  { key: 'new', icon: 'plus', label: DEV_STATE_LABELS.new, cls: '' },
  { key: 'in_progress', icon: 'flask', label: DEV_STATE_LABELS.in_progress, cls: '' },
  { key: 'attention', icon: 'alert', label: DEV_STATE_LABELS.attention, cls: 'kpiIconDanger' },
  { key: 'fitting', icon: 'shirt', label: DEV_STATE_LABELS.fitting, cls: '' },
  { key: 'ready', icon: 'checkCircle', label: DEV_STATE_LABELS.ready, cls: 'kpiIconOk' },
];

/**
 * Виды раздела (правки заказчика 20.08). Доска — по умолчанию: документ
 * называет её ГЛАВНЫМ экраном.
 *
 * «Кроме главного борда по этапам, внутри раздела должны быть доступны:
 * Все разработки · Лекала · Крой · Шелкография · DTF · Вышивка · DTG ·
 * Пошив · Финальный этап». Отдельного ВТО здесь нет — документ его запрещает
 * прямо: «если для образца требуется ВТО, оно выполняется внутри работы
 * экс цеха без создания отдельной колонки и отдельной очереди».
 *
 * Вид — в QUERY, а не подпутём: `canOpenScreen` перечисляет ИСКЛЮЧЕНИЯ
 * и открывает незнакомый путь, поэтому `/experimental/dtf` был бы доступен
 * всем, включая цех без права.
 */
const VIEWS = [
  'board', 'list',
  'patterns', 'cutting',
  'silkscreen', 'dtf', 'embroidery', 'dtg',
  'sewing', 'final',
];

const VIEW_LABELS = {
  board: 'Доска по этапам',
  list: 'Все разработки',
  patterns: 'Лекала',
  cutting: 'Крой',
  silkscreen: 'Шелкография',
  dtf: 'DTF',
  embroidery: 'Вышивка',
  dtg: 'DTG',
  sewing: 'Пошив',
  final: 'Финальный этап',
};

/** Виды, показывающие внутренние очереди, а не список разработок */
const QUEUE_VIEWS = new Set([
  'patterns', 'cutting', 'silkscreen', 'dtf', 'embroidery', 'dtg', 'sewing', 'final',
]);

const STATE_VARIANT = {
  new: 'neutral', in_progress: 'progress', attention: 'blocked',
  fitting: 'waiting', ready: 'ready',
};

export default function Experimental() {
  /**
   * Действий над самой разработкой здесь больше НЕТ: они уехали на страницу
   * карточки вместе со шторкой (правка 22.08, п. 4.11). Экран остался списком
   * и доской — и грузит ровно то, что ему для этого нужно.
   */
  const {
    orders, departments, loaded, loadError, loadAll,
    experimental, experimentalLoaded, loadExperimental,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      experimental: s.experimental,
      experimentalLoaded: s.experimentalLoaded,
      loadExperimental: s.loadExperimental,
    })),
  );
  const navigate = useNavigate();
  const location = useLocation();

  /*
   * Права здесь больше не спрашиваются: единственным действием этого экрана
   * было создание разработки, и оно снято правкой 23.08 (п. 6). Гейт
   * `experimental.manage` остался там, где ведут саму разработку, —
   * на странице карточки (`screens/DevPage`).
   */
  const typeDict = useDictionary('experimental_task_type');
  const typeNames = useMemo(
    () => new Map((typeDict ?? []).map((d) => [d.code, d.name])), [typeDict]);

  // Контекст списка живёт в адресе: возврат из карточки восстанавливает подбор,
  // а ссылкой на отфильтрованный список можно поделиться
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => devFiltersFromParams(params), [params]);
  /**
   * СТАРЫЙ АДРЕС `?dev=<id>` — БОКОВАЯ ШТОРКА, КОТОРОЙ БОЛЬШЕ НЕТ (п. 4.11).
   * Ссылки на неё живут в переписке и закладках, поэтому параметр не забыт,
   * а ПЕРЕАДРЕСУЕТ на страницу разработки. Молча показать список вместо
   * запрошенной карточки — это потерять человека на ровном месте.
   */
  const openId = params.get('dev');
  /**
   * Вид раздела — в адресе, как и остальной контекст списка. QUERY, а не
   * путь-сегмент: `canOpenScreen` перечисляет ИСКЛЮЧЕНИЯ и открывает
   * незнакомый путь, поэтому `/experimental/board` был бы доступен всем,
   * включая цех без права. Белый список — чтобы мусор в адресе не давал
   * молча пустой экран.
   */
  const view = VIEWS.includes(params.get('view')) ? params.get('view') : 'board';
  const setView = useCallback((next) => {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (next === 'board') out.delete('view'); else out.set('view', next);
      return out;
    });
  }, [setParams]);

  /**
   * ФИЛЬТРЫ МЕНЯЮТ ТОЛЬКО СВОИ КЛЮЧИ, остальное в адресе не трогают.
   *
   * Здесь стояло `setParams(new URLSearchParams(devFiltersToParams(next)))` —
   * то есть ПОЛНАЯ замена набора. Любой клик по фильтру сбрасывал `view`,
   * и человек, выбравший «Список», при первом же нажатии на плитку состояния
   * оказывался на доске: вид молча прыгал.
   *
   * Тест на это был («фильтр по состоянию живёт в адресе»), но проходил четыре
   * раза из пяти: он успевал снять ассерт со СТАРОГО кадра, до перерисовки
   * с новыми параметрами. Падал — когда не успевал, то есть когда видел
   * настоящее поведение. Ровно тот жанр, что уже описан в CLAUDE.md про
   * одноразовые проверки.
   *
   * Ключи фильтров снимаются поимённо (`devFilterParamKeys`), а не «всё,
   * кроме известного»: белый список чужого пришлось бы дополнять при каждом
   * новом параметре экрана, и однажды его забыли бы — вернув ту же ошибку.
   */
  const setFilters = useCallback((next) => {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      for (const key of devFilterParamKeys()) out.delete(key);
      for (const [key, value] of Object.entries(devFiltersToParams(next))) out.set(key, value);
      return out;
    });
  }, [setParams]);

  /**
   * ОТКРЫТИЕ РАЗРАБОТКИ — ПЕРЕХОД НА СТРАНИЦУ (правка 22.08, п. 4.11).
   * Боковой шторки больше нет: «для такого количества информации это
   * неудобно». Контекст списка (вид, фильтры, страница) уезжает в `state.from`
   * в том же формате, что ключ `useScrollRestore` (`pathname + search`), —
   * иначе возврат потеряет и подбор, и позицию прокрутки.
   */
  const openDev = useCallback((id) => {
    if (!id) return;
    navigate(`/experimental/${id}`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  }, [navigate, location.pathname, location.search]);

  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  /**
   * Переадресация со старой ссылки на шторку. `replace`, а не `push`: запись
   * истории про исчезнувшую поверхность вернула бы человека сюда же по «Назад»
   * и снова переадресовала — то есть «Назад» перестал бы работать вовсе.
   */
  useEffect(() => {
    if (openId) navigate(`/experimental/${openId}`, { replace: true });
  }, [openId, navigate]);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => {
    if (!experimentalLoaded) loadExperimental();
  }, [experimentalLoaded, loadExperimental]);

  const today = factoryToday();
  /** Планшет: список из шести колонок не помещается — карточки */
  const compact = useCompactLayout();
  const rows = useMemo(() => buildDevRows(experimental, today), [experimental, today]);
  /**
   * Материалы по заказам — их спрашивает гейт кроя: «крой можно начать только
   * когда лекала готовы И материалы физически приняты складом». Берём из уже
   * загруженных заказов, отдельного запроса не заводим.
   */
  const materialsByOrder = useMemo(
    () => new Map(orders.map((o) => [o.id, o.materials ?? []])),
    [orders],
  );

  const counts = useMemo(() => {
    const c = { '': rows.length, new: 0, in_progress: 0, attention: 0, fitting: 0, ready: 0 };
    for (const r of rows) c[r.state] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => applyDevFilters(rows, filters), [rows, filters]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * pageSize, safePage * pageSize);


  /*
   * РУЧНОГО СОЗДАНИЯ РАЗРАБОТКИ ЗДЕСЬ НЕТ (правка заказчика 23.08, п. 6).
   *
   * «Разработка должна появляться в экспериментальном цехе только из
   * соответствующей сделки/заказа». Единственный писатель — `createOrder`
   * (`store/slices/orderWriteSlice`): он заводит разработку на КАЖДУЮ
   * позицию-образец той же операцией, что и заказ.
   *
   * Вместе с селектом снят и блок «позиций-образцов без разработки: N».
   * Он был компенсацией дефекта, которого больше нет: автосоздание падало
   * 42501 МОЛЧА (у менеджера не было `experimental.manage`), и заказ-образец
   * оставался без разработки — 15 из 21 на боевой базе. Право расширено,
   * а отказ теперь называет себя через `erpError`. На 23.08 позиций без
   * разработки НОЛЬ, то есть блок совместимости пуст — правило проекта
   * разрешает снимать legacy именно с этого момента.
   */

  const set = (patch) => { setFilters({ ...filters, ...patch }); setPage(1); };

  return (
    <>
      <PageHead
        title="Экспериментальный цех"
        sub="Разработка изделия: набор нужных задач, параллельная работа, циклы доработки и финальное решение. Работа образца в цехе видна в очереди самого цеха."
      />

      {experimentalLoaded && rows.length > 0 && (
        <div className={styles.dashKpis} style={{ marginBottom: 16 }}>
          {STATE_TILES.map((t) => (
            <button
              key={t.key || 'all'}
              type="button"
              className={styles.kpiCard}
              aria-pressed={filters.state === t.key}
              onClick={() => set({ state: filters.state === t.key ? '' : t.key })}
            >
              <span className={`${styles.kpiIcon} ${t.cls ? styles[t.cls] : ''}`}>
                <Icon name={t.icon} size={20} />
              </span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>{t.label}</span>
                <span className={styles.kpiCardValue}>{counts[t.key]}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <FilterBar
        search={filters.q}
        onSearch={(v) => set({ q: v })}
        searchPlaceholder="Поиск: изделие, заказ, № сделки"
        searchLabel="Поиск по разработкам"
      >
        <button
          type="button"
          aria-pressed={filters.problem}
          title="Есть заблокированная задача"
          className={`${styles.chip} ${styles.chipBtn} ${filters.problem ? styles.chipProgress : styles.chipNeutral}`}
          onClick={() => set({ problem: !filters.problem })}
        >
          <Icon name="ban" size={13} /> С проблемой
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          className={`${styles.chip} ${styles.chipBtn} ${expanded ? styles.chipProgress : styles.chipNeutral}`}
          onClick={() => setExpanded((v) => !v)}
        >
          Фильтры <Icon name="chevronDown" size={13} className={expanded ? styles.chevronUp : undefined} />
        </button>
        {hasActiveDevFilters(filters) && (
          <Button variant="ghost" onClick={() => setFilters({ ...EMPTY_DEV_FILTERS })}>
            Сбросить
          </Button>
        )}
      </FilterBar>

      {expanded && (
        <div className={styles.filterPanel}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Конструктор</span>
            <input
              className={styles.input}
              value={filters.constructorName}
              onChange={(e) => set({ constructorName: e.target.value })}
              aria-label="Фильтр по конструктору"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Проработчик</span>
            <input
              className={styles.input}
              value={filters.developer}
              onChange={(e) => set({ developer: e.target.value })}
              aria-label="Фильтр по проработчику"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Тип разработки</span>
            <input
              className={styles.input}
              value={filters.devType}
              onChange={(e) => set({ devType: e.target.value })}
              aria-label="Фильтр по типу разработки"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок с</span>
            <DateField
              value={filters.dueFrom}
              onChange={(v) => set({ dueFrom: v })}
              aria-label="Срок разработки с"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок по</span>
            <DateField
              value={filters.dueTo}
              onChange={(v) => set({ dueTo: v })}
              aria-label="Срок разработки по"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Сортировка</span>
            <select
              className={styles.select}
              value={filters.sort}
              onChange={(e) => set({ sort: e.target.value })}
              aria-label="Сортировка разработок"
            >
              {Object.entries(DEV_SORT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {experimentalLoaded && rows.length > 0 && (
        <ScrollHintBox className={styles.toolbar} label="Представления раздела">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              // Переключатель вида — кнопки с `aria-pressed`, а не `role="tab"`:
              // половина таб-паттерна хуже, чем обычные кнопки (правило проекта)
              aria-pressed={view === v}
              className={`${styles.chip} ${styles.chipBtn} ${
                view === v ? styles.chipProgress : styles.chipNeutral}`}
              onClick={() => setView(v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </ScrollHintBox>
      )}

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="разработки" />}
      {!experimentalLoaded && !loadError && <TableSkeleton rows={5} label="Загрузка разработок" />}

      {experimentalLoaded && rows.length === 0 && (
        <EmptyState
          icon="flask"
          title="Разработок пока нет"
          text="Выберите позицию-образец в панели выше и заведите разработку. Набор задач выбирается под изделие — одинаковых пяти этапов больше нет."
        />
      )}

      {/* Пустой подбор — сообщение СПИСКА и доски: внутренние очереди фильтрами
          не гейтятся и о них ничего не знают */}
      {experimentalLoaded && !QUEUE_VIEWS.has(view)
        && rows.length > 0 && visible.length === 0 && (
        <EmptyResult onReset={() => setFilters({ ...EMPTY_DEV_FILTERS })}>
          Под фильтры ничего не подошло. Всего разработок: {rows.length}.
        </EmptyResult>
      )}

      {/* Внутренние очереди читают ВСЕ разработки, а не отфильтрованный
          список: фильтры списка (конструктор, срок, состояние) отвечают
          на другой вопрос, и «пусто» из-за них выглядело бы как «работы нет» */}
      {experimentalLoaded && QUEUE_VIEWS.has(view) && (
        <DevViews
          view={view}
          rows={rows}
          orders={orders}
          departments={departments}
          typeNames={typeNames}
          onOpen={openDev}
        />
      )}

      {experimentalLoaded && visible.length > 0 && view === 'board' && (
        <DevBoard
          rows={visible}
          today={today}
          onOpen={openDev}
          materialsByOrder={materialsByOrder}
          typeNames={typeNames}
        />
      )}

      {/*
        КОМПАКТНАЯ РАСКЛАДКА (планшет). Шесть колонок, из которых «Текущий
        блокер» и «Состояние» несут по две строки, ниже 1024px уезжали за край —
        вместе с ответом на вопрос, ради которого на экран и приходят.
      */}
      {experimentalLoaded && visible.length > 0 && view === 'list' && compact && (
        <>
          <div className={styles.dataCardList}>
            {pageRows.map(({ dev, tasks, state }) => (
              <DevRowCard
                key={dev.id}
                dev={dev}
                tasks={tasks}
                state={state}
                stateVariant={STATE_VARIANT[state]}
                typeNames={typeNames}
                today={today}
                onOpen={openDev}
              />
            ))}
          </div>
          <Pagination
            page={safePage}
            pageCount={pageCount}
            total={visible.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => { setPageSize(n); setPage(1); }}
          />
        </>
      )}

      {experimentalLoaded && visible.length > 0 && view === 'list' && !compact && (
        <>
          <ScrollHintBox className={styles.tableWrap} label="Разработки">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Изделие</th>
                  <th>Кто ведёт</th>
                  <th>Готовность</th>
                  <th>Текущий блокер</th>
                  <th>Срок</th>
                  <th>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ dev, tasks, state }) => {
                  const readiness = devReadiness(tasks);
                  const blocker = currentBlocker(tasks, typeNames, today);
                  const due = dev.due_date || dev.order?.due_date || null;
                  return (
                    <tr
                      key={dev.id}
                      className={styles.rowClickable}
                      onClick={() => openDev(dev.id)}
                    >
                      <td>
                        <strong>{dev.tech_name || 'Без названия'}</strong>
                        <div className={styles.cellSub}>
                          №{dev.order?.bitrix_id || '—'} · {dev.order?.title || ''}
                        </div>
                      </td>
                      <td>
                        {dev.technologist || dev.constructor
                          || <span className={styles.subText}>не назначен</span>}
                      </td>
                      <td>
                        {/* Ноль задач — «—», а не «0 %»: это «неизвестно», а не «готово» */}
                        {readiness.total > 0
                          ? `${readiness.done} / ${readiness.total}`
                          : <span className={styles.subText}>—</span>}
                      </td>
                      <td>
                        {dev.outcome
                          ? <span className={styles.subText}>{DEV_OUTCOME_LABELS[dev.outcome]}</span>
                          : (blocker
                            ? <>
                              {taskLabel(blocker, typeNames)}
                              <div className={styles.subText}>
                                {nextAction(dev, tasks, typeNames, today)}
                              </div>
                            </>
                            : <span className={styles.subText}>нет</span>)}
                      </td>
                      <td className={state === 'attention' ? styles.overdue : undefined}>
                        {due ? formatDateShort(due) : '—'}
                      </td>
                      <td>
                        <Badge variant={STATE_VARIANT[state]}>{DEV_STATE_LABELS[state]}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollHintBox>
          <Pagination
            page={safePage}
            pageCount={pageCount}
            total={visible.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => { setPageSize(n); setPage(1); }}
          />
        </>
      )}

    </>
  );
}
