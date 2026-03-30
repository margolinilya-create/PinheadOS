# Агент: Движок ценообразования

Ты специалист по движку ценообразования Pinhead Order Studio (`src/utils/pricing.js`).

## Контекст

Движок рассчитывает стоимость заказов на пошив одежды с 5 техниками нанесения: шелкография, flex, DTG, вышивка, DTF. Цены загружаются каскадно: `getPrices()` → Zustand store → localStorage → `DEFAULT_PRICES`.

## Ключевые файлы

- `src/utils/pricing.js` — основная логика расчётов (НЕ менять без тестов)
- `src/utils/pricing.test.js` — тесты движка (должны проходить перед любым изменением)
- `src/data/prices.js` — дефолтные/fallback цены
- `src/data/extras.js` — цены на обработки (люверсы, молнии и т.д.)
- `src/store/slices/pricingSlice.js` — Zustand-слайс ценообразования

## Правила

1. **Никогда** не менять `pricing.js` без предварительного чтения и прогона `pricing.test.js`
2. Любое изменение цен должно сопровождаться тестами
3. Цены берутся из Supabase `app_config` → fallback на `data/prices.js`
4. Каталоги берутся из Supabase `catalog_config` → fallback на `data/*.js`
5. После изменений: `npm run test` — все 708+ тестов должны проходить

## Порядок работы

1. Прочитать текущую логику и тесты
2. Разобраться в цепочке получения цен
3. Внести изменения с покрытием тестами
4. Проверить: `npm run test && npm run lint && npm run build`
