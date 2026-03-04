window.onerror = function(msg, url, line, col, err) {
  var el = document.getElementById('skuEditorBody');
  if (el) el.innerHTML = '<div style="padding:20px;color:red;font-size:12px"><b>JS Error (line ' + line + '):</b> ' + msg + '<br><br><button onclick="try{localStorage.removeItem(\'ph_sku\');localStorage.removeItem(\'ph_fabrics\');localStorage.removeItem(\'ph_trims\');localStorage.removeItem(\'ph_extras\');location.reload()}catch(e){}">Сбросить каталог</button></div>';
  console.error('Global error:', msg, 'line:', line);
};
/*
╔══════════════════════════════════════════════════════════════╗
║            PINHEAD ORDER STUDIO v1.7 — JAVASCRIPT           ║
║                                                              ║
║  TABLE OF CONTENTS                                           ║
║                                                              ║
║   1. CHANGELOG                      Version history          ║
║   2. AUTH & CLOUD                   Supabase authentication, ║
║   3. DATA — STATE                   Application state object ║
║   4. DATA — PRICES                  Price tables, surcharges ║
║   5. DATA — FABRICS                 Fabric types, layers, ge ║
║   6. DATA — COLORS (MEDASTEX)       Medastex palette — full  ║
║   7. DATA — COLORS (COTTONPROM)     CottonProm palette v1 (9 ║
║   8. DATA — CONSTANTS               Type names, fabric names ║
║   9. DRAFT & AUTOSAVE               localStorage draft save/ ║
║  10. NAVIGATION & STEPS             Step rendering, goToStep ║
║  11. PROGRESSIVE SECTIONS           updateStepSections, sec( ║
║  12. UI — GARMENT SELECT            selectGarmentRow, select ║
║  13. UI — COLORS                    renderSwatches, makeSwat ║
║  14. UI — FABRIC & FIT              selectFabric, selectFit  ║
║  15. UI — ZONES                     toggleZone, renderZonesG ║
║  16. UI — SIZE TABLE                buildSizeTable, size inp ║
║  17. PRICING ENGINE                 calcTotal, updateTotal,  ║
║  18. MOCKUP                         SVG garment mockup, shad ║
║  19. SUMMARY & OUTPUT               buildSummary, copyTZ, PD ║
║  20. ORDER HISTORY                  Local + cloud history, r ║
║  21. RESTORE & INIT                 restoreDraftToUI, DOMCon ║
║  22. PRICES EDITOR v.2              Fullscreen editor, tabs, ║
║  23. EXPRESS CALCULATOR v2.0        Right panel, quick calc, ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
*/


// ════════════════════════════════════════════════════════════
//   CHANGELOG
// ════════════════════════════════════════════════════════════
// Version history

/*
╔══════════════════════════════════════════════════════════════╗
║            PINHEAD ORDER STUDIO — VERSION HISTORY           ║
╠══════════════════════════════════════════════════════════════╣
║  v1.0   Фундамент                                            ║
║         Supabase auth, регистрация сотрудников,              ║
║         пошаговый флоу, сохранение заказов, история          ║
║                                                              ║
║  v1.1   Аксессуары и логика зон                              ║
║         ONE SIZE, предупреждения о минималке,                ║
║         рекомендация DTF, таблица размеров,                  ║
║         поля телефон + мессенджер, кликабельный прогресс     ║
║                                                              ║
║  v1.11  Стабилизация                                         ║
║         Баги: calcTotal ONE SIZE, зоны носков,               ║
║         ZONE_LABELS аксессуары, телефон в buildSummary,      ║
║         цвет аксессуаров, renderFabricGrid краш,             ║
║         сброс maxStep при загрузке черновика                 ║
║                                                              ║
║  v1.12  Редизайн хедера + Express-калькулятор v2.0           ║
║         Хедер: Barlow Condensed, единая строка               ║
║         ⚡ EXPRESS — правая панель 480px, живой калькулятор  ║
║         Динамические зоны по типу изделия/аксессуара        ║
║         Исправлен расчёт ONE SIZE                            ║
║                                                              ║
║  v1.13  Редактор цен v.2 (fullscreen)                        ║
║         6 вкладок, сводная таблица нанесения,                ║
║         Live-калькулятор всегда справа,                      ║
║         история изменений с откатом, экспорт/импорт JSON     ║
║         Исправлен баг calcTotal (учёт fit-наценки)           ║
║         Все 14 типов изделий в PRICES.type                   ║
║                                                              ║
║  v1.14  Синхронизация Express ↔ Редактор цен                 ║
║         Горячая синхронизация при сохранении цен             ║
║         loadStoredPrices: все поля v.2 из localStorage       ║
║         Комплексное тестирование: 178 функций, 0 ошибок      ║
║                                                              ║
║  v1.2   Палитра CottonProm + прогрессивный шаг 0             ║
║         96 цветов CottonProm (5001–5096) с HEX               ║
║         Переключатель поставщика Medastex / CottonProm       ║
║         Прогрессивная цепочка на шаге 0:                     ║
║           Изделие → Лекала → Ткань → Цвет → Размеры         ║
║         state.fitChosen — флаг явного выбора лекал           ║
║         Фикс: секции скрыты до выбора, dividers sync         ║
║         Фикс: updateAccessoryUI не перезаписывает display    ║
║                                                              ║
║  v1.5   Структурная реорганизация                            ║
║         Код разбит на именованные секции с баннерами          ║
║         CSS: 12 групп, JS: 23 группы                         ║
║         TABLE OF CONTENTS в начале CSS и JS                   ║
║         Логика не изменена — только порядок блоков            ║
║                                                              ║
║  ВНУТРЕННИЕ ВЕРСИИ КОМПОНЕНТОВ:                              ║
║    Express-калькулятор:  v2.0                                ║
║    Редактор цен:         v.2                                  ║
║    Палитра Medastex:     полная (все группы)                 ║
║    Палитра CottonProm:   v1 (96 цветов, 5001–5096)           ║
╚══════════════════════════════════════════════════════════════╝
*/


