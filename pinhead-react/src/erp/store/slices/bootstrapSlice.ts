/**
 * Бутстрап оболочки: шесть справочных запросов ErpLayout сведены в один RPC.
 *
 * Было (замер 03.08.2026, загрузка `/` до открытия карточки): departments,
 * role_permissions, dictionaries, subcontracting, experimental, employees —
 * шесть round-trip ради данных, которые все вместе весят 28 кБ. На цеховом
 * Wi-Fi платят именно за round-trip, а не за килобайты.
 *
 * Стало: `erp_bootstrap()` — один запрос. Функция SECURITY INVOKER, то есть
 * RLS работает как раньше: «одним запросом» не означает «мимо политик».
 *
 * Слайсы-владельцы данных остаются на месте со своими `load*` — они нужны
 * для точечного обновления после мутаций (добавили значение справочника —
 * перечитали справочники, а не всю оболочку).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type {
  ErpDepartment,
  ErpDictionaryItem,
  ErpEmployee,
  ErpExperimental,
  ErpRolePermission,
  ErpSubcontractOp,
} from '../../types';
import type { PermissionMatrix } from '../../utils/permissions';
import type { BootstrapSlice, ErpStore } from '../types';
import { cachedQuery } from '../queryCache';

/** Ответ RPC `erp_bootstrap()` */
interface BootstrapPayload {
  departments: ErpDepartment[];
  permissions: ErpRolePermission[];
  dictionaries: ErpDictionaryItem[];
  subcontracting: ErpSubcontractOp[];
  experimental: ErpExperimental[];
  my_employee: { department_id: string | null; role: ErpEmployee['role'] | null } | null;
}

/**
 * Кэш-ключ бутстрапа: он один на сессию, параметров нет.
 *
 * Имя намеренно НЕ кончается на `_KEY`: под этим суффиксом страж
 * `lib/storage.test.js` ищет ключи localStorage и требует решения
 * «чистить при выходе или оставить». Это ключ памяти, а не хранилища —
 * и он всё равно чистится, но иначе: `resetErpStore()` зовёт
 * `clearQueryCache()` при выходе.
 */
export const BOOTSTRAP_CACHE_ID = 'erp:bootstrap';

export const bootstrapSlice: StateCreator<ErpStore, [], [], BootstrapSlice> = (set, get) => ({
  bootstrapLoaded: false,

  loadBootstrap: async () => {
    if (get().bootstrapLoaded) return;
    /**
     * Снимок ДО ожидания — им отличается «запоздавший ответ» от «повторной
     * загрузки». См. развёрнутое объяснение у `set` ниже.
     */
    const before = {
      experimental: get().experimentalLoaded,
      subcontracting: get().subcontractingLoaded,
    };
    const payload = await cachedQuery<BootstrapPayload | null>(BOOTSTRAP_CACHE_ID, async () => {
      // try/catch, а не только проверка `error`: supabase-js возвращает `error`
      // на ответ сервера, но БРОСАЕТ на сбое до ответа (нет сети, CORS, клиент
      // не настроен). Обещание «оболочка поднимется даже без справочников»
      // держится только если оба случая ведут в одну ветку — иначе вместо
      // оболочки без меню получаем unhandled rejection и пустой экран.
      try {
        const { data, error } = await supabase.rpc('erp_bootstrap');
        if (error) {
          // Права упадут на DEFAULT_PERMISSIONS, справочники — на свободный
          // ввод. Тост только про цеха: без них меню действительно пустое.
          toast.error('Не удалось загрузить справочники ERP');
          return null;
        }
        return data as BootstrapPayload;
      } catch (e) {
        console.error('[loadBootstrap]', e);
        toast.error('Не удалось загрузить справочники ERP');
        return null;
      }
    });
    if (!payload) {
      // Помечаем загруженным, чтобы эффект не крутился по кругу; повтор —
      // через кнопку «Повторить» на экране, как везде в разделе.
      set({ bootstrapLoaded: true, permissionsLoaded: true, dictionariesLoaded: true, myDeptLoaded: true });
      return;
    }

    const matrix: PermissionMatrix = {};
    for (const row of payload.permissions ?? []) {
      (matrix[row.role] ??= {})[row.permission] = row.allowed;
    }

    /**
     * ЗАПОЗДАВШИЙ ПАКЕТ НЕ ЗАТИРАЕТ ТО, ЧТО ЗАГРУЗИЛОСЬ ПОКА ОН ЛЕТЕЛ
     * (найдено падением e2e 24.08).
     *
     * Разработки и подряд приезжают ДВУМЯ путями: этим пакетом и своим `load*`
     * у экрана, — и оба стартуют при открытии раздела. Если экран отрисовался
     * от своего запроса, человек успевает нажать кнопку, а пакет прилетает
     * следом и ставит СНИМОК ДО правки: карточка молча возвращается назад,
     * и повторное нажатие выглядит как «сайт не работает». Тот же класс гонки,
     * от которого у realtime стоит `pendingMutations`.
     *
     * Сравнивается состояние ДО и ПОСЛЕ ожидания, а не просто «загружено ли
     * сейчас»: иначе кнопка «Повторить» перестала бы обновлять эти разделы —
     * при повторе они уже загружены по определению. Пропускается ровно один
     * случай: на старте пусто, к ответу — наполнено кем-то другим.
     */
    const s = get();
    set({
      departments: payload.departments ?? [],
      permissionMatrix: matrix,
      permissionsLoaded: true,
      dictionaries: payload.dictionaries ?? [],
      dictionariesLoaded: true,
      ...(s.subcontractingLoaded && !before.subcontracting
        ? {}
        : { subcontracting: payload.subcontracting ?? [], subcontractingLoaded: true }),
      ...(s.experimentalLoaded && !before.experimental
        ? {}
        : { experimental: payload.experimental ?? [], experimentalLoaded: true }),
      myDeptId: payload.my_employee?.department_id ?? null,
      myRole: payload.my_employee?.role ?? null,
      myDeptLoaded: true,
      bootstrapLoaded: true,
    });
  },
});
