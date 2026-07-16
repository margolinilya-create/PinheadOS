import { PageHead, Stub } from '../components/PageHead';

export default function OrdersScreen() {
  return (
    <>
      <PageHead title="Заказы" sub="Создание заказа, изделия, ручной маршрут по цехам, сроки." />
      <Stub
        icon="📋"
        title="Модуль заказов в разработке"
        text="Создание (вручную / визард-лайт), изделия, маршрут по цехам, приоритет и плановые даты по этапам."
        phase="Фаза 2"
      />
    </>
  );
}
