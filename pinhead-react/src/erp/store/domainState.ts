import { DEFAULT_CAPACITY } from '../utils/capacity';
import type { ErpStore } from './types';

/**
 * Исходные ДАННЫЕ доменных слайсов — в ядре, хотя сами слайсы приезжают лениво.
 *
 * ЗАЧЕМ. Слайс прицепляется вместе с чанком экрана, а данные нужны раньше:
 *   · `myDeptId`/`myRole` (employees) читает `useErpAccess` — он в оболочке;
 *   · `subcontracting`, `experimental`, `dictionaries` НАПОЛНЯЕТ `loadBootstrap`,
 *     то есть ядро, ещё до открытия любого экрана.
 * Если бы данные приезжали вместе со слайсом, позднее подключение затирало бы
 * уже загруженное: `loadBootstrap` — сетевой запрос, подключение слайса —
 * локальный импорт, и кто из них финиширует последним, зависит от кэша.
 * Поэтому `attachDomainSlices()` переносит в стор ТОЛЬКО функции, а данные
 * стоят здесь с самого начала.
 *
 * Второе следствие — `resetErpStore()`: он снимает снимок данных при создании
 * стора, и доменные поля обязаны быть в нём. Иначе выход из системы не очистил
 * бы список подряда, и на общем планшете следующая смена увидела бы чужой.
 *
 * ЭТО ЗЕРКАЛО, А НЕ ВТОРОЙ ИСТОЧНИК. Значения обязаны совпадать с тем, что
 * объявляют сами слайсы; расхождение ловит `domainSlices.test.ts`, выполняя
 * каждую фабрику и сверяя её нефункциональные поля с этим объектом.
 */
/**
 * Именно `Pick`, а не `Partial`: так TypeScript проверяет и имена полей,
 * и типы значений против настоящего контракта стора. С `Partial` опечатка
 * в имени прошла бы молча — поле просто не попало бы в стор.
 */
type DomainState = Pick<ErpStore,
  | 'subcontracting' | 'subcontractingLoaded'
  | 'employees' | 'profilesList' | 'employeesLoaded'
  | 'invites' | 'invitesLoaded'
  | 'myDeptId' | 'myRole' | 'myDeptLoaded'
  | 'dictionaries' | 'dictionariesLoaded'
  | 'experimental' | 'experimentalLoaded'
  | 'planSlots' | 'planComments' | 'planLoaded' | 'planLoading' | 'planLoadError'
  | 'plannedStageIds' | 'plannedAheadLoaded'
  | 'capacity' | 'capacityLoaded'
>;

export const DOMAIN_INITIAL_STATE: DomainState = {
  // subcontractingSlice
  subcontracting: [],
  subcontractingLoaded: false,
  // employeesSlice — `myDeptId`/`myRole` нужны оболочке (useErpAccess)
  employees: [],
  profilesList: [],
  employeesLoaded: false,
  myDeptId: null,
  myRole: null,
  myDeptLoaded: false,
  // invitesSlice
  invites: [],
  invitesLoaded: false,
  // dictionariesSlice
  dictionaries: [],
  dictionariesLoaded: false,
  // experimentalSlice
  experimental: [],
  experimentalLoaded: false,
  // planSlice
  planSlots: [],
  planComments: [],
  planLoaded: false,
  planLoading: false,
  planLoadError: false,
  plannedStageIds: [],
  plannedAheadLoaded: false,
  // settingsSlice
  capacity: DEFAULT_CAPACITY,
  capacityLoaded: false,
};

/**
 * Слайсы этапов, материалов, склада, закупки и ТЗ здесь не перечислены
 * НАМЕРЕННО: у них нет собственных данных вовсе — они правят `orders`,
 * которые принадлежат ядру. Пустая строка в этом списке была бы ложью
 * о том, что у слайса есть состояние.
 */
