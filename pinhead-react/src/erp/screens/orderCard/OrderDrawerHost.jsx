import { Suspense, lazy, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ORDER_DRAWER_PARAM, useOrderDrawer } from '../../store/useOrderDrawer';
import { Skeleton } from '../../../components/shared/Skeleton';
import styles from '../../erp.module.css';

/**
 * Карточка заказа грузится ПРИ ПЕРВОМ ОТКРЫТИИ, а не вместе с оболочкой.
 *
 * Хост монтируется в `ErpApp` вне `<Routes>` — иначе он не пережил бы переход
 * между разделами. Из-за статического импорта это тянуло в критический путь всё
 * дерево карточки: комментарии, историю, ТЗ, файлы, позиции и инлайн-правки —
 * 124 кБ (39 кБ gzip) каждому, кто просто открыл обзор производства. Хост при
 * этом с самого начала возвращал `null`, пока карточка закрыта: содержимое
 * не рисовалось, но ехало по сети всегда.
 *
 * Ленивый импорт уносит вместе с карточкой и примитив `Drawer` — им пользуются
 * только ленивые экраны. Чанк общий с полной страницей `/orders/:id`: открыли
 * одно — второе уже в кэше.
 */
const OrderDrawer = lazy(() => import('./OrderDrawer').then((m) => ({ default: m.OrderDrawer })));

/**
 * Заглушка на время загрузки чанка. Повторяет геометрию панели своими классами
 * и НЕ использует `Drawer` — иначе примитив вернулся бы в оболочку, ради чего
 * всё и делалось. На планшете с плохим Wi-Fi это единственное, что человек
 * видит между нажатием и карточкой, поэтому пустого места здесь быть не должно.
 */
function DrawerLoading() {
  return (
    <div className={styles.drawerOverlay} role="presentation">
      <aside className={styles.drawerPanel} aria-busy="true" aria-label="Карточка заказа загружается">
        <div className={styles.drawerHead}>
          <div className={styles.drawerHeadMain}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="40%" height={12} />
          </div>
        </div>
        <div className={styles.drawerBody}>
          <Skeleton height={14} />
          <Skeleton height={14} width="80%" />
          <Skeleton height={14} width="90%" />
        </div>
      </aside>
    </div>
  );
}

/**
 * Хост боковой карточки заказа: монтируется один раз в ErpApp и показывает Drawer
 * поверх любого экрана. `key={orderId}` — свежий стейт вкладок на каждый заказ.
 *
 * Открытая карточка живёт в адресе (`?order=<id>`), поэтому:
 * - перезагрузка страницы её не теряет;
 * - ссылку «список с открытой карточкой» можно переслать;
 * - «Назад» закрывает панель, а не уводит с экрана (жест номер один на планшете).
 *
 * Открытие ПУШИТ запись истории, закрытие снимает её же (`navigate(-1)`) — так
 * «Назад» и крестик делают ровно одно и то же. Если карточку открыли не мы, а пришли
 * по ссылке сразу с `?order=`, своей записи в истории нет: тогда закрытие просто
 * убирает параметр через `replace`, иначе крестик уносил бы человека на прошлый сайт.
 *
 * Смена раздела закрывает карточку сама: у другого маршрута нет нашего параметра.
 *
 * Ctrl/Cmd-клик по ссылке заказа по-прежнему ведёт на полную страницу
 * `/orders/:id` в новой вкладке (см. `orderLinkClick`).
 */
export function OrderDrawerHost() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const urlId = params.get(ORDER_DRAWER_PARAM);
  const orderId = useOrderDrawer((s) => s.orderId);
  const close = useOrderDrawer((s) => s.close);
  /** Добавляли ли мы сами запись истории под текущую открытую карточку */
  const pushedRef = useRef(false);

  useEffect(() => {
    useOrderDrawer.setState({
      navigate: (id) => {
        // Актуальный search берём из window, а не из замыкания: фильтры списка
        // тоже живут в адресе, и захваченное значение затёрло бы свежие
        const next = new URLSearchParams(window.location.search);
        if (id) {
          next.set(ORDER_DRAWER_PARAM, id);
          setParams(next);
          pushedRef.current = true;
          return;
        }
        if (pushedRef.current) {
          pushedRef.current = false;
          navigate(-1);
          return;
        }
        next.delete(ORDER_DRAWER_PARAM);
        setParams(next, { replace: true });
      },
    });
    return () => useOrderDrawer.setState({ navigate: null });
  }, [setParams, navigate]);

  useEffect(() => {
    // Карточку могли закрыть кнопкой «Назад» — тогда своей записи в истории
    // больше нет, и следующее закрытие не должно звать navigate(-1)
    if (!urlId) pushedRef.current = false;
    useOrderDrawer.getState().syncFromUrl(urlId);
  }, [urlId]);

  if (!orderId) return null;
  return (
    <Suspense fallback={<DrawerLoading />}>
      <OrderDrawer key={orderId} orderId={orderId} onClose={close} />
    </Suspense>
  );
}
