import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { FilterBar } from '../components/FilterBar';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { DateField } from '../components/DateField';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { useErpStore } from '../store/useErpStore';
import { DevCreateModal } from './experimental/DevCreateModal';
import { useErpAccess } from '../store/useErpAccess';
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
import { factoryToday } from '../../utils/date';
import { DevBoard } from './experimental/DevBoard';
import { DevViews } from './experimental/DevViews';
import { DevDeptQueue } from './experimental/DevDeptQueue';
import {
  DEV_BRANDING_DEPT_CODE, devBrandingFromPrints, devBrandingOpen,
} from '../utils/experimentalBoard';
import { useDevStageMove } from '../hooks/useDevStageMove';
import { experimentalDeptEntries } from '../utils/experimentalQueue';
import { findSupplyDept, openSupplyStages } from '../utils/supply';
import { FilterChip } from '../components/FilterChip';
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

/**
 * СОСТОЯНИЯ РАЗРАБОТКИ — ТРИ УРОВНЯ УПРАВЛЕНИЯ (правка 13.09, п. 8).
 *
 * Документ просит развести то, что до 13.09 стояло одним рядом чипов:
 * состояния, фильтры по этапам и переключатель вида. Здесь — первый уровень,
 * и в постоянной строке остаются ровно те состояния, которые названы:
 * «Все», «Новые», «В работе», «Требуют внимания», «Готовы к серии»
 * (плюс «С проблемой» — он не состояние, а отдельный признак, и чип у него
 * свой). Остальные уехали в раскрывающиеся «Фильтры» — ниже, `RARE_STATES`.
 */
const STATE_FILTERS = [
  // «Все» здесь — состояние «любое», а не вид раздела: вида «Все разработки»
  // больше нет (п. 8.2), и спорить этой подписи не с чем
  { key: '', icon: 'orders', label: 'Все' },
  { key: 'new', icon: 'plus', label: DEV_STATE_LABELS.new },
  { key: 'in_progress', icon: 'flask', label: DEV_STATE_LABELS.in_progress },
  { key: 'attention', icon: 'alert', label: DEV_STATE_LABELS.attention },
  { key: 'ready', icon: 'checkCircle', label: DEV_STATE_LABELS.ready },
];

/**
 * Состояния, ушедшие из постоянной строки в «Фильтры» (правка 13.09, п. 8.1).
 *
 * `handed` — «Переданы на склад»: работа ЭКС по ним закончена, вмешательства
 * они не требуют, и документ просит убрать их из постоянной строки прямо.
 *
 * `fitting` — «На примерке». Документ разрешает оставить его в строке, «если
 * этот статус реально используется как отдельная рабочая очередь». Спросили
 * боевую базу: задач типа `fitting` там НОЛЬ за всё время, то есть состояние
 * не наступало ни разу — отдельной очередью оно не является. Из механики
 * состояние при этом не убрано: `devState` его по-прежнему считает, и, когда
 * такие задачи появятся, отбор по нему будет здесь.
 *
 * Значение одно и то же (`filters.state`) — строка показывает частые
 * состояния, панель редкие; второго решения о том же тут не заводится.
 */
const RARE_STATES = [
  { key: 'fitting', icon: 'shirt', label: DEV_STATE_LABELS.fitting },
  { key: 'handed', icon: 'box', label: DEV_STATE_LABELS.handed },
];

/**
 * ВИД РАЗДЕЛА — ДОСКА ИЛИ ОЧЕРЕДЬ УЧАСТКА (правка 13.09, п. 8.3).
 *
 * «„Доска по этапам" и „Очередь участка" не смешивать с фильтрами этапов —
 * оформить их как отдельный переключатель вида». До правки оба стояли
 * в одном ряду с семью этапами и «Всеми разработками», то есть выбор
 * «на что я смотрю» был неотличим от выбора «какой этап отбираю».
 *
 * Доска — по умолчанию: документ 20.08 называет её ГЛАВНЫМ экраном. Очередь
 * участка добавлена правкой 24.08 (п. 4.1): ЭКС стал участком маршрута,
 * участок непроизводственный, и общие поверхности его этапы вырезают —
 * без этого вида заказ, дошедший до шага ЭКС, не показывался бы нигде.
 */
const BASE_VIEWS = ['board', 'queue'];

/**
 * ФИЛЬТРЫ ПО ЭТАПАМ — второй уровень (правка 13.09, п. 8.2).
 *
 * «Лекала», «Крой» и «Пошив» — собственные очереди ЭКС (читают задачи
 * разработки), «Шелкография», «DTF» и «Вышивка» — отфильтрованные
 * представления общих производственных задач (читают ЭТАПЫ, те же самые,
 * что видит общий цех), «Финальный этап» — что осталось до «Готово к серии».
 *
 * ⚠️ ВИДА «ВСЕ РАЗРАБОТКИ» БОЛЬШЕ НЕТ (п. 8.2: «убрать как дублирующий
 * пункт»). В группе фильтров «все» — это ничего не выбрано, и отдельным
 * чипом он повторял бы состояние по умолчанию; ту же таблицу целиком
 * показывала доска. Закрытые и переданные на склад разработки, которых
 * доска не рисует, остаются достижимы фильтром «Финальный этап»: он
 * отбирает по `sample_approved_at || outcome`, а переданный на склад образец
 * несёт исход по построению (проверено на боевой базе: обе такие записи
 * с исходом).
 *
 * ⚠️ ВИДА DTG ЗДЕСЬ НЕТ (правки 07.09, п. 17: «полностью убрать DTG из ERP»):
 * участок деактивирован. Сам МЕТОД нанесения `dtg` остаётся читаемым.
 *
 * Отдельного ВТО нет — документ 20.08 запрещает его прямо: «если для образца
 * требуется ВТО, оно выполняется внутри работы экс цеха без создания
 * отдельной колонки и отдельной очереди».
 */
const STAGE_VIEWS = [
  'patterns', 'cutting',
  'silkscreen', 'dtf', 'embroidery',
  'sewing', 'final',
];

/**
 * Вид — в QUERY, а не подпутём: `canOpenScreen` перечисляет ИСКЛЮЧЕНИЯ
 * и открывает незнакомый путь, поэтому `/experimental/dtf` был бы доступен
 * всем, включая цех без права. Белый список — чтобы мусор в адресе (и старая
 * ссылка на снятый `view=list`) не давал молча пустой экран, а приводил
 * на доску.
 */
const VIEWS = [...BASE_VIEWS, ...STAGE_VIEWS];

const VIEW_LABELS = {
  board: 'Доска',
  queue: 'Очередь',
  patterns: 'Лекала',
  cutting: 'Крой',
  silkscreen: 'Шелкография',
  dtf: 'DTF',
  embroidery: 'Вышивка',
  sewing: 'Пошив',
  final: 'Финальный этап',
};

/** Виды, показывающие внутренние очереди, а не доску */
const QUEUE_VIEWS = new Set(STAGE_VIEWS);

/**
 * Виды, которые ПОДЧИНЯЮТСЯ фильтрам состояния. Перечислены положительно,
 * а не как «всё, кроме очередей»: очередь участка (п. 4.1) фильтрам тоже
 * не подчиняется, и отрицательный список пришлось бы дополнять при каждом
 * новом виде — однажды его забыли бы, и человек увидел бы «под фильтры
 * ничего не подошло» там, где фильтры ни при чём.
 */
const FILTERED_VIEWS = new Set(['board']);

/*
  Карта `STATE_VARIANT` (состояние → вариант бейджа) ушла вместе с видом
  «Все разработки» (правка 13.09, п. 8.2): её единственными носителями были
  таблица списка и её планшетная карточка. Общий словарь состояний раздела
  живёт в `utils/statusUi`, и заводить рядом вторую таблицу цветов нельзя.
*/

export default function Experimental() {
  /**
   * Действий над самой разработкой здесь больше НЕТ: они уехали на страницу
   * карточки вместе со шторкой (правка 22.08, п. 4.11). Экран остался списком
   * и доской — и грузит ровно то, что ему для этого нужно.
   */
  const {
    orders, departments, loaded, loadError, loadAll,
    experimental, experimentalLoaded, experimentalError, loadExperimental,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      experimental: s.experimental,
      experimentalLoaded: s.experimentalLoaded,
      experimentalError: s.experimentalError,
      loadExperimental: s.loadExperimental,
    })),
  );
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * ПРАВО ВЕРНУЛОСЬ ВМЕСТЕ С ДЕЙСТВИЕМ (правка 24.08, п. 4.2). После правки
   * 23.08 экран действий не имел вовсе, и гейт был снят честно. Теперь
   * технолог двигает карточки по колонкам прямо здесь, а RLS `erp_experimental`
   * стоит на `experimental.manage` — без клиентского гейта получилось бы
   * запрещённое «кнопка есть, действие падает».
   */
  const { can } = useErpAccess();
  const canManage = can('experimental.manage');
  /** Открыта ли форма «Завести разработку» (правка 14.09) */
  const [creating, setCreating] = useState(false);

  /**
   * ПЕРЕНОС КАРТОЧКИ ПО ЭТАПАМ — единственная точка на доску и кнопки «‹ ›».
   *
   * Что тут происходит помимо самой записи колонки:
   *
   *  1. «Построение лекал → Крой» спрашивает ТЕХНИЧЕСКОЕ НАЗВАНИЕ ЛЕКАЛ
   *     (правка 30.08, п. 3). Раньше его требовало закрытие обязательной
   *     задачи `patterns`, но обязательных задач у этапов больше нет —
   *     вопрос переехал в сам переход, ОДНИМ окном: документ прямо просит
   *     не показывать рядом ещё и свободный «Результат этапа». Что именно
   *     спросить, решает `devMovePrompt`, а не этот компонент: переносят
   *     карточку из двух мест, и вторая копия условия разошлась бы молча.
   *
   *  2. Вход в «Нанесения» берёт виды ИЗ ЗАКАЗА (правка 30.08, п. 2).
   *     Диалога «Какие нанесения нужны образцу?» больше нет: менеджер уже
   *     указал их в позиции, и второй ввод того же решения терял исходные
   *     данные заказа.
   */
  /**
   * СОБСТВЕННЫЙ ЭТАП ЗАКРЫВАЕТСЯ САМИМ ПЕРЕНОСОМ (правка 01.09, вторая
   * итерация, п. 3): «технолог вручную переносит карточку вперёд, система
   * автоматически считает предыдущий собственный этап завершённым».
   *
   * Отдельного подтверждения документ не хочет прямым текстом («отдельных
   * отчётов о завершении Кроя, Пошива и других этапов не нужно, мы специально
   * от этого ушли»), поэтому здесь нет ни диалога, ни формы.
   *
   * Счётчик пишется ПРИРАЩЕНИЕМ на сервере (правило проекта): `reportProgress`
   * зовёт `erp_stage_report_progress`, а та сама ставит `done`, когда тираж
   * добран. Абсолют с клиента был бы потерянным обновлением.
   */
  /**
   * Перенос карточки уехал в `hooks/useDevStageMove` (§3.6 обхода 04.09):
   * со СТРАНИЦЫ разработки — основного места работы технолога с 22.08 —
   * карточку перенести было нельзя, хотя диалоги обещают «перейдёт».
   * Логика одна на обе поверхности; порядок «закрыть свой этап → записать
   * колонку → завести нанесения» повторять второй раз нельзя.
   */
  const { moveDevStage } = useDevStageMove();

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

  /**
   * ЗАКУПКА ЗАКАЗА ЕЩЁ ОТКРЫТА — второе условие входа в «Крой» (правка 01.09,
   * п. 1: «система должна разрешать это только после того, как закупка
   * завершена И материал получен»). Условия действительно разные: у заказа
   * бывает открытый этап закупки при нуле строк материалов, и бывает закрытая
   * закупка при материале, который ждёт приёмки складом.
   *
   * Считаем теми же функциями, что бейдж меню и экран закупки: правило
   * «закупка по заказу» живёт в `utils/supply` и только там. Заказ с отметкой
   * «Закупка не требуется» этапа не имеет вовсе — он попадает сюда `false`
   * по построению, а не по отдельной ветке.
   */
  const supplyOpenByOrder = useMemo(() => {
    const supplyDept = findSupplyDept(departments);
    return new Map(orders.map(
      (o) => [o.id, openSupplyStages(o, supplyDept?.id).length > 0]));
  }, [orders, departments]);

  /**
   * ЕСТЬ ЛИ У ПОЗИЦИИ НАНЕСЕНИЯ — от этого зависит, обязателен ли шаг
   * «Нанесения» (правка 01.09, п. 2). Берём той же `devBrandingFromPrints`,
   * которой сам вход в колонку берёт виды нанесений: второй копии правила
   * «что считается нанесением образца» не появляется.
   */
  /**
   * ОБЩИЙ ЦЕХ ЕЩЁ РАБОТАЕТ (правка 01.09, вторая итерация, п. 1). Формула —
   * `devBrandingOpen`, дословно та же, что у серверного автоперехода
   * `erp_dev_branding_advance`: задача нанесения вне ('done','cancelled').
   * Статус задачи ведёт триггер от статуса ЭТАПА, поэтому это и есть «цех
   * фактически закрыл», а не отдельное мнение доски.
   *
   * До 05.09 формула была выражением ЗДЕСЬ, а страница разработки держала
   * свою копию — и копия успела разойтись (`!== 'done'` без `'cancelled'`).
   */
  const brandingOpenByDev = useMemo(
    () => new Map(experimental.map((dev) => [dev.id, devBrandingOpen(dev.tasks)])),
    [experimental],
  );

  const brandingByItem = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      for (const it of o.items ?? []) {
        map.set(it.id, devBrandingFromPrints(it.prints).length > 0);
      }
    }
    return map;
  }, [orders]);

  /**
   * Счётчики плиток. Ключи берутся ИЗ САМИХ ПЛИТОК, а не перечисляются
   * повторно: пропущенное состояние давало `undefined + 1`, то есть `NaN`
   * прямо на плитке. Так и случилось с `handed` (правка 30.08, п. 4) —
   * список состояний вырос, а этот объект остался прежним.
   */
  const counts = useMemo(() => {
    const c = Object.fromEntries(STATE_FILTERS.map((t) => [t.key, 0]));
    c[''] = rows.length;
    for (const r of rows) c[r.state] = (c[r.state] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => applyDevFilters(rows, filters), [rows, filters]);

  /**
   * ЗАДАНИЯ УЧАСТКА СЧИТАЮТСЯ ОТДЕЛЬНО ОТ РАЗРАБОТОК (правка 24.08, п. 4.1).
   *
   * Это разные сущности: разработка (`erp_experimental`) заводится на позицию-
   * образец, а этап участка стоит в маршруте ЛЮБОГО заказа. Переключатель видов
   * рисовался по числу разработок — то есть у фабрики без единой разработки
   * до очереди участка было бы не добраться, и заказ встал бы молча. Ровно тот
   * отказ, ради которого написан `routeReachable.test.ts`.
   */
  const deptQueueCount = useMemo(
    () => experimentalDeptEntries(orders, departments).length,
    [orders, departments],
  );
  const hasAnything = rows.length > 0 || deptQueueCount > 0;


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

  const set = (patch) => setFilters({ ...filters, ...patch });

  return (
    <>
      <PageHead
        title="Экспериментальный цех"
        sub="Разработка изделия: набор нужных задач, параллельная работа, циклы доработки и финальное решение. Работа образца в цехе видна в очереди самого цеха."
      />

      {/*
        ЗАВЕСТИ РАЗРАБОТКУ РУКАМИ (правка 14.09). До 15.09 входа не было
        вовсе — разработка рождалась только побочным действием создания
        заказа с позицией-образцом, и «вести разработку без сделки» упиралось
        не в колонку, а в отсутствие формы.
      */}
      {canManage && (
        <div className={styles.toolbar}>
          <Button icon="plus" onClick={() => setCreating(true)}>Завести разработку</Button>
        </div>
      )}
      {creating && (
        <DevCreateModal
          onClose={() => setCreating(false)}
          onCreated={(row) => navigate(`/experimental/${row.id}`, {
            // Тот же формат, что ключ `useScrollRestore` (`pathname + search`),
            // иначе возврат из карточки потеряет фильтры и прокрутку
            state: { from: `${location.pathname}${location.search}` },
          })}
        />
      )}

      {/*
        СОСТОЯНИЯ — ЧИПАМИ, А НЕ ПЛИТКАМИ (обход 04.09). Семь плиток по 90px
        плюс поиск, фильтры и одиннадцать чипов видов отодвигали доску —
        «главный экран» раздела по документу — на y≈520 из 800: в первый
        экран попадала одна колонка и половина карточки. Плитки и чипы делают
        здесь одну работу (отбор), и двух видов у одной работы быть не должно;
        счётчики никуда не делись, они при чипах.
      */}
      <FilterBar
        search={filters.q}
        onSearch={(v) => set({ q: v })}
        searchPlaceholder="Поиск: изделие, заказ, № сделки"
        searchLabel="Поиск по разработкам"
      >
        {experimentalLoaded && rows.length > 0 && STATE_FILTERS.map((t) => (
          <FilterChip
            key={t.key || 'all'}
            active={filters.state === t.key}
            onClick={() => set({ state: filters.state === t.key ? '' : t.key })}
          >
            <Icon name={t.icon} size={13} /> {t.label} {counts[t.key] > 0 && <b>{counts[t.key]}</b>}
          </FilterChip>
        ))}
        <FilterChip
          active={Boolean(filters.problem)}
          title="Есть заблокированная задача"
          onClick={() => set({ problem: !filters.problem })}
        >
          <Icon name="ban" size={13} /> С проблемой
        </FilterChip>
        <FilterChip expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          Фильтры <Icon name="chevronDown" size={13} className={expanded ? styles.chevronUp : undefined} />
        </FilterChip>
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
          {/*
            РЕДКИЕ СОСТОЯНИЯ (правка 13.09, п. 8.1) — «Переданы на склад»
            и «На примерке». Значение то же, что у чипов постоянной строки
            (`filters.state`): строка показывает частые состояния, панель
            редкие. Второго решения об одной величине здесь не заводится.
          */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Ещё состояния</span>
            <div className={styles.filterRow} role="group" aria-label="Редкие состояния разработки">
              {RARE_STATES.map((t) => (
                <FilterChip
                  key={t.key}
                  active={filters.state === t.key}
                  onClick={() => set({ state: filters.state === t.key ? '' : t.key })}
                >
                  <Icon name={t.icon} size={13} /> {t.label} {counts[t.key] > 0 && <b>{counts[t.key]}</b>}
                </FilterChip>
              ))}
            </div>
          </div>
        </div>
      )}

      {/*
        ДВА РЯДА ВМЕСТО ОДНОГО (правка 13.09, п. 8.3). Прежде «Доска
        по этапам», «Очередь участка», «Все разработки» и семь этапов стояли
        одной строкой чипов: выбор «на что я смотрю» был неотличим от выбора
        «какой этап отбираю». Теперь сверху переключатель вида, под ним —
        фильтры по этапам, и у каждой группы своё имя для скринридера.

        Повторный клик по активному фильтру этапа снимает его и возвращает
        на вид из переключателя — «ничего не выбрано» и есть «все разработки»,
        ради чего отдельный чип с таким именем и убран (п. 8.2).
      */}
      {experimentalLoaded && hasAnything && (
        <>
          <div className={styles.toolbar}>
            <div role="group" aria-label="Вид раздела" className={styles.filterRow}>
              {BASE_VIEWS.map((v) => (
                /* Переключатель вида — чип с `aria-pressed`, а не `role="tab"`:
                   половина таб-паттерна хуже обычных кнопок (правило проекта) */
                <FilterChip key={v} active={view === v} onClick={() => setView(v)}>
                  {VIEW_LABELS[v]}
                </FilterChip>
              ))}
            </div>
          </div>
          <ScrollHintBox className={styles.toolbar} label="Фильтры по этапам">
            <div role="group" aria-label="Этап разработки" className={styles.filterRow}>
              {STAGE_VIEWS.map((v) => (
                <FilterChip
                  key={v}
                  active={view === v}
                  onClick={() => setView(view === v ? 'board' : v)}
                >
                  {VIEW_LABELS[v]}
                </FilterChip>
              ))}
            </div>
          </ScrollHintBox>
        </>
      )}

      {/*
        ОТКАЗ РАЗРАБОТОК — СВОЙ ФЛАГ (правка 03.09). Здесь стоял `loadError`,
        то есть флаг ЗАКАЗОВ: упади загрузка разработок при живых заказах —
        и скелетон висел бы вечно, потому что `experimentalLoaded` при отказе
        не поднимался, а эффект `if (!loaded) load()` второй раз не срабатывает.
        Выходом была только перезагрузка страницы.
      */}
      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="заказы" />}
      {experimentalError && !experimentalLoaded && (
        <LoadFailed onRetry={loadExperimental} what="разработки" />
      )}
      {!experimentalLoaded && !experimentalError && !loadError && (
        <TableSkeleton rows={5} label="Загрузка разработок" />
      )}

      {/* «Разработок нет» — не ответ для очереди участка: там свой пустой текст,
          и он говорит про этапы маршрута, а не про разработки */}
      {experimentalLoaded && rows.length === 0 && view !== 'queue' && (
        <EmptyState
          icon="flask"
          title="Разработок пока нет"
          text="Разработка появляется из заказа: заведите позицию-образец при создании заказа. Набор задач выбирается под изделие — одинаковых пяти этапов больше нет."
        />
      )}

      {/* Пустой подбор — сообщение СПИСКА и доски: внутренние очереди фильтрами
          не гейтятся и о них ничего не знают */}
      {experimentalLoaded && FILTERED_VIEWS.has(view)
        && rows.length > 0 && visible.length === 0 && (
        <EmptyResult onReset={() => setFilters({ ...EMPTY_DEV_FILTERS })}>
          Под фильтры ничего не подошло. Всего разработок: {rows.length}.
        </EmptyResult>
      )}

      {/* Очередь участка читает ЭТАПЫ маршрута и от разработок не зависит
          вовсе — поэтому и рисуется по `loaded`, а не по `experimentalLoaded` */}
      {loaded && view === 'queue' && (
        <DevDeptQueue orders={orders} departments={departments} />
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
          materialsByOrder={materialsByOrder}
          supplyOpenByOrder={supplyOpenByOrder}
          brandingByItem={brandingByItem}
          brandingOpenByDev={brandingOpenByDev}
          typeNames={typeNames}
          canManage={canManage}
          onMoveStage={moveDevStage}
        />
      )}

      {/*
        ВИДА «ВСЕ РАЗРАБОТКИ» БОЛЬШЕ НЕТ (правка 13.09, п. 8.2) — вместе с ним
        ушли таблица на шесть колонок, её планшетная карточка и пагинация.
        В группе фильтров «все» это «ничего не выбрано», а тот же полный состав
        разработок показывает доска: отдельный чип повторял состояние
        по умолчанию, о чём документ и говорит («убрать как дублирующий пункт»).

        Закрытые и переданные на склад, которых доска не рисует, достижимы
        фильтром «Финальный этап» (отбор по `sample_approved_at || outcome`).
      */}

    </>
  );
}
