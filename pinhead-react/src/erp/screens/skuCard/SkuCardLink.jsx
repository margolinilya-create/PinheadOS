import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { ButtonLink } from '../../components/Button';

/**
 * ССЫЛКА НА КАРТОЧКУ МОДЕЛИ, ВЫШЕДШЕЙ ИЗ ЭТОЙ РАЗРАБОТКИ.
 *
 * Документ требует «одна и та же карточка»: и каталог, и разработка обязаны
 * открывать её, а не две похожие поверхности. Отсюда отдельный компонентик —
 * вкладке SKU разработки нужен ровно один вопрос («есть ли карточка»),
 * и тянуть ради него в `DevCard` весь слайс каталога незачем.
 *
 * НИЧЕГО НЕ РИСУЕТ БЕЗ ПРАВА И БЕЗ КАРТОЧКИ: ссылка, ведущая в «Нет доступа»,
 * хуже её отсутствия.
 */
export function SkuCardLink({ experimentalId }) {
  const canView = useErpAccess().can('sku.view');
  const { cards, loaded, load } = useErpStore(useShallow((s) => ({
    cards: s.skuCards,
    loaded: s.skuCardsLoaded,
    load: s.loadSkuCards,
  })));

  useEffect(() => {
    if (canView && !loaded) void load();
  }, [canView, loaded, load]);

  if (!canView) return null;
  const card = cards.find((c) => c.experimental_id === experimentalId);
  if (!card) return null;

  return (
    <ButtonLink to={`/sku-card/${card.id}`} variant="secondary">
      Открыть карточку модели
    </ButtonLink>
  );
}
