import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { DevDeptQueue } from './experimental/DevDeptQueue';
import {
  DEV_BRANDING_DEPT_CODE, DEV_BRANDING_TASK_TYPES, devBrandingFromPrints,
} from '../utils/experimentalBoard';
import { devMovePrompt } from '../utils/devBoardMove';
import { devOwnStageToClose, devStageRemainder } from '../utils/devOwnStage';
import { confirmWithInput } from '../../store/useConfirmStore';
import { experimentalDeptEntries } from '../utils/experimentalQueue';
import { findSupplyDept, openSupplyStages } from '../utils/supply';
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
/* Состояния разработки для отбора: рисуются чипами в тулбаре (обход 04.09) */
const STATE_FILTERS = [
  // «Все», а не «Все разработки»: так теперь называется ВИД раздела (документ
  // 20.08), и две одинаковые подписи рядом означали бы два разных действия
  { key: '', icon: 'orders', label: 'Все' },
  { key: 'new', icon: 'plus', label: DEV_STATE_LABELS.new },
  { key: 'in_progress', icon: 'flask', label: DEV_STATE_LABELS.in_progress },
  { key: 'attention', icon: 'alert', label: DEV_STATE_LABELS.attention },
  { key: 'fitting', icon: 'shirt', label: DEV_STATE_LABELS.fitting },
  { key: 'ready', icon: 'checkCircle', label: DEV_STATE_LABELS.ready },
  // Переданные на склад (правка 30.08, п. 4) — последними: работа ЭКС по ним
  // закончена, и вмешательства они не требуют. С доски они уходят, но из
  // списка нет: это история, а не активная работа
  { key: 'handed', icon: 'box', label: DEV_STATE_LABELS.handed },
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
 *
 * ВИД «ОЧЕРЕДЬ УЧАСТКА» добавлен правкой 24.08 (п. 4.1): экспериментальный цех
 * стал участком маршрута, и его этапы обязаны быть видны. Участок
 * непроизводственный, то есть общие поверхности его вырезают, — без этого вида
 * заказ, дошедший до шага ЭКС, не показывался бы нигде.
 */
const VIEWS = [
  'board', 'queue', 'list',
  'patterns', 'cutting',
  'silkscreen', 'dtf', 'embroidery', 'dtg',
  'sewing', 'final',
];

const VIEW_LABELS = {
  board: 'Доска по этапам',
  queue: 'Очередь участка',
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

/**
 * Виды, которые ПОДЧИНЯЮТСЯ фильтрам списка. Их ровно два, и перечислены они
 * положительно, а не как «всё, кроме очередей»: очередь участка (п. 4.1)
 * фильтрам тоже не подчиняется, и отрицательный список пришлось бы дополнять
 * при каждом новом виде — однажды его забыли бы, и человек увидел бы
 * «под фильтры ничего не подошло» там, где фильтры ни при чём.
 */
const FILTERED_VIEWS = new Set(['board', 'list']);

const STATE_VARIANT = {
  new: 'neutral', in_progress: 'progress', attention: 'blocked',
  fitting: 'waiting', ready: 'ready',
  // Переданные на склад (правка 30.08, п. 4). Пропуск здесь не роняет ничего —
  // Badge получил бы undefined и нарисовался нейтральным, то есть состояние
  // молча перестало бы отличаться от прочих
  handed: 'done',
};

export default function Experimental() {
  /**
   * Действий над самой разработкой здесь больше НЕТ: они уехали на страницу
   * карточки вместе со шторкой (правка 22.08, п. 4.11). Экран остался списком
   * и доской — и грузит ровно то, что ему для этого нужно.
   */
  const {
    orders, departments, loaded, loadError, loadAll,
    experimental, experimentalLoaded, experimentalError, loadExperimental, updateExperimental,
    addDevTasks, sendDevTaskToDept, reportProgress,
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
      updateExperimental: s.updateExperimental,
      addDevTasks: s.addDevTasks,
      sendDevTaskToDept: s.sendDevTaskToDept,
      reportProgress: s.reportProgress,
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
  const closeOwnStage = useCallback(async (dev, from) => {
    const order = orders.find((o) => o.id === dev.order_id);
    const item = (order?.items ?? []).find((it) => it.id === dev.item_id);
    if (!item) return;
    const target = devOwnStageToClose({ from, stages: item.stages, departments });
    if (!target) return;
    const rest = devStageRemainder(target, item.qty);
    if (rest > 0) {
      await reportProgress(target.id, rest, { comment: 'Этап закрыт переносом карточки ЭКС' });
    }
  }, [orders, departments, reportProgress]);

  const moveDevStage = useCallback(async (devId, stage) => {
    const dev = experimental.find((e) => e.id === devId);
    if (!dev) return false;
    const from = dev.board_stage ?? 'patterns';

    const prompt = devMovePrompt(from, stage, dev);
    if (prompt) {
      const { ok: confirmed, value } = await confirmWithInput({
        title: prompt.title,
        message: 'Название сохранится в карточке разработки и в финальном пакете.',
        confirmLabel: prompt.confirmLabel,
        prompt: { label: prompt.label, required: true, initialValue: prompt.initialValue },
      });
      if (!confirmed) return false;
      /**
       * Сперва название, потом колонка. Обратный порядок оставил бы карточку
       * в «Крое» с незаписанным названием — то есть этап, объявленный
       * завершённым, без своего результата.
       */
      const saved = await updateExperimental(devId, { [prompt.field]: value.trim() });
      if (!saved) return false;
    }

    /**
     * ПОРЯДОК ОБЯЗАТЕЛЕН — и остаётся обязательным ради РАЗРАБОТОК, ЗАВЕДЁННЫХ
     * ДО 02.09: сначала закрыть покидаемый собственный этап, потом писать
     * колонку и заводить работу нанесений. У таких образцов этап нанесения
     * стоит в маршруте и зависит от кроя (`depends_on = ['cutting']`), то есть
     * до его закрытия висит в `waiting` — цех такой работы не видит. Обратный
     * порядок привязал бы задачу разработки к невидимому этапу, и «Нанесения»
     * встали бы молча.
     *
     * У образцов, заведённых после 02.09, собственных этапов маршрута нет
     * вовсе (`BASE_CHAIN.samples` — одна закупка), и `closeOwnStage` для них
     * ничего не делает: `devOwnStageToClose` отвечает `null` — «закрывать
     * нечего», а не «забыли».
     */
    await closeOwnStage(dev, from);

    if (stage !== 'branding') return updateExperimental(devId, { board_stage: stage });

    /**
     * Виды нанесений и их порядок — из позиции заказа.
     *
     * НАНЕСЕНИЙ НЕТ — ШАГ ПРОПУСКАЕТСЯ (прежнее поведение пустого выбора,
     * п. 4.2 от 24.08: «если нанесения не нужны, технолог переносит карточку
     * сразу из Кроя в Пошив»). Оставить карточку в пустых «Нанесениях»
     * значило бы завести стоянку, из которой человека никто не позовёт:
     * автопереход считает закрытие задач, а их нет.
     */
    const item = orders
      .flatMap((o) => o.items ?? [])
      .find((it) => it.id === dev.item_id);
    const types = devBrandingFromPrints(item?.prints);
    if (types.length === 0) {
      return updateExperimental(devId, { board_stage: 'sewing' });
    }

    /**
     * ПОРЯДОК ОСОЗНАННЫЙ: сначала колонка, потом задачи. Перенос — то, что
     * человек нажал, и он обязан состояться; при сбое на задачах карточка
     * стоит в «Нанесениях» с пустой дорожкой «Ожидает» — состояние видимое
     * и поправимое. Обратный порядок дал бы задачи в цехах при карточке,
     * оставшейся в «Крое»: работа идёт, а на доске её нет.
     *
     * Одной транзакцией это не делается и не должно: `erp_experimental_add_tasks`
     * заводит задачи атомарно сам, а отправка в цех — отдельное действие
     * над каждой задачей, у которого свои права и свой отказ.
     *
     * Уже заведённые виды не дублируются: повторный вход в «Нанесения»
     * (например, после отката назад) не должен второй раз слать ту же
     * работу в цех.
     */
    const ok = await updateExperimental(devId, { board_stage: 'branding' });
    if (!ok) return false;

    const existing = new Set((dev.tasks ?? []).map((t) => t.task_type));
    const fresh = types.filter((t) => !existing.has(t));
    if (fresh.length === 0) return true;

    const created = await addDevTasks(
      devId,
      fresh.map((t, i) => ({ task_type: t, sort_order: 100 + i * 10 })),
    );
    for (const task of created ?? []) {
      const dept = departments.find(
        (d) => d.code === DEV_BRANDING_DEPT_CODE[task.task_type]);
      if (dept) await sendDevTaskToDept(task.id, { department_id: dept.id });
    }
    return true;
  }, [experimental, orders, updateExperimental, addDevTasks, sendDevTaskToDept,
    departments, closeOwnStage]);
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
   * ОБЩИЙ ЦЕХ ЕЩЁ РАБОТАЕТ (правка 01.09, вторая итерация, п. 1). Формула
   * дословно та же, что у серверного автоперехода `erp_dev_branding_advance`:
   * задача нанесения вне ('done','cancelled'). Статус задачи ведёт триггер
   * от статуса ЭТАПА, поэтому это и есть «цех фактически закрыл», а не
   * отдельное мнение доски.
   */
  const brandingOpenByDev = useMemo(
    () => new Map(experimental.map((dev) => [
      dev.id,
      (dev.tasks ?? []).some(
        (t) => DEV_BRANDING_TASK_TYPES.includes(t.task_type)
          && t.status !== 'done' && t.status !== 'cancelled',
      ),
    ])),
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
          <button
            key={t.key || 'all'}
            type="button"
            aria-pressed={filters.state === t.key}
            className={`${styles.chip} ${styles.chipBtn} ${filters.state === t.key ? styles.chipProgress : styles.chipNeutral}`}
            onClick={() => set({ state: filters.state === t.key ? '' : t.key })}
          >
            <Icon name={t.icon} size={13} /> {t.label} {counts[t.key] > 0 && <b>{counts[t.key]}</b>}
          </button>
        ))}
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

      {experimentalLoaded && hasAnything && (
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
          onOpen={openDev}
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
                        {/*
                          ССЫЛКА, А НЕ ТОЛЬКО КЛИК ПО СТРОКЕ (правка 03.09).
                          У `<tr>` не было ни `tabIndex`, ни обработчика клавиш,
                          ни фокусируемого содержимого — реестр разработок
                          не открывался с клавиатуры вовсе (WCAG 2.1.1), а для
                          завершённых он единственный путь: доска ЭКС их
                          не показывает. Ссылка сохраняет Ctrl+клик и «открыть
                          в новой вкладке», кнопка бы их потеряла.
                        */}
                        <Link
                          to={`/experimental/${dev.id}`}
                          state={{ from: `${location.pathname}${location.search}` }}
                          className={styles.queueCardTitleLink}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <strong>{dev.tech_name || 'Без названия'}</strong>
                        </Link>
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
