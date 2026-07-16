import { PageHead, Stub } from '../components/PageHead';

export default function FabricPurchasing() {
  return (
    <>
      <PageHead title="Закупка ткани" sub="Заказ ткани под заказ, поставщики, приёмка, расход на заказ." />
      <Stub
        icon="🚚"
        title="Модуль закупки в разработке"
        text="Закупщик заказывает ткань под заказ, учёт поставщиков и приёмки, расход ткани на заказ. Полноценный склад и фурнитура — позже."
        phase="Фаза 5"
      />
    </>
  );
}
