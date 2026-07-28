import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ORDER_DRAWER_PARAM, useOrderDrawer } from '../../store/useOrderDrawer';
import { OrderDrawer } from './OrderDrawer';

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
  return <OrderDrawer key={orderId} orderId={orderId} onClose={close} />;
}
