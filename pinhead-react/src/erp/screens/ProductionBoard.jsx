import { PageHead, Stub } from '../components/PageHead';

export default function ProductionBoard() {
  return (
    <>
      <PageHead title="Производство" sub="Очереди по цехам, статусы этапов, блокировки и брак." />
      <Stub
        icon="🏭"
        title="Производственная доска в разработке"
        text="Очередь задач по каждому цеху, смена статуса (любой в цехе + подтверждение бригадира), блокировки с комментарием, возвраты по браку, НЗП."
        phase="Фаза 3"
      />
    </>
  );
}
