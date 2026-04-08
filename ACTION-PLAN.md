# PINHEAD — Action Plan
**Создан:** 06.04.2026  
**Обновлён:** 08.04.2026 (сессия 4)  
**Статус:** Внутренняя система ✅ → Переход к CRM/ERP интеграции

---

## ✅ ПОЛНОСТЬЮ ЗАКРЫТО (сессии 1-4)

### P0 — Критические баги
| # | Задача | Статус |
|---|--------|--------|
| BUG-01 | saveOrder возвращает null при ошибке Supabase | ✅ |
| BUG-02 | updateOrder rollback + null при ошибке | ✅ |
| BUG-03 | deleteOrder confirm dialog + ждёт Supabase | ✅ |
| BUG-04 | wizard auto-save на неправильном шаге (6→5 регрессия) | ✅ |

### P1 — Качество и стабильность
| # | Задача | Статус |
|---|--------|--------|
| — | patchOrderData: rollback + toast.error + return null | ✅ |
| — | fetchMoreOrders: toast.error при ошибке | ✅ |
| — | updateStatus: toast.error после rollback | ✅ |
| — | fetchComments/fetchTemplates: toast при ошибке | ✅ |
| — | deleteTemplate: убран optimistic delete | ✅ |
| — | useShallow в 7 компонентах (16 селекторов) | ✅ |
| — | memo() на KanbanCard и OrderDrawer | ✅ |
| — | Dashboard lazy loading (бандл −26%) | ✅ |

### P2 — UX и фичи
| # | Задача | Статус |
|---|--------|--------|
| — | Визард 6→5 шагов (обработки в аккордеон) | ✅ |
| — | Блокировка навигации (useBlocker) | ✅ |
| — | Комментарии к заказу (order_comments) | ✅ |
| — | Пагинация заказов (50 + «Загрузить ещё») | ✅ |
| — | Папка с макетами (artworkPath) | ✅ |
| — | SVG мокап в PrintPreview | ✅ |
| — | OrderDrawer: мульти-позиции, контакты, менеджер | ✅ |
| — | Дедлайн: min дата + предупреждение 3 дня | ✅ |
| — | ProgressBar: галочки заполненности | ✅ |
| — | Keyboard shortcuts в Kanban (/, n, ?, 1-5) | ✅ |
| — | Кнопка «СКАЧАТЬ PDF» в PrintPreview | ✅ |
| — | Единый PageHeader компонент | ✅ |
| — | Нумерация шагов 01-05 (была 01,03,04,05,06) | ✅ |

### UI/UX аудит
| # | Задача | Статус |
|---|--------|--------|
| — | Контраст текста #999→#666 (WCAG AA) | ✅ |
| — | CSS токены: type scale, spacing, z-index | ✅ |
| — | Touch targets 44px на мобильном | ✅ |
| — | Mobile responsive: auth, express, editors | ✅ |
| — | Zone cards: div→button + aria-pressed | ✅ |
| — | Autofocus на формах (AuthScreen, StepDetails) | ✅ |
| — | Hardcoded #fff → var(--white) | ✅ |

---

## 🔴 НОВОЕ НАПРАВЛЕНИЕ: CRM/ERP интеграция

### Фаза 2 — Модуль планирования производства (СЛЕДУЮЩАЯ)
| # | Задача | Сложность | Статус |
|---|--------|-----------|--------|
| P-01 | Supabase таблицы: production_slots, production_capacity | S | ⏳ |
| P-02 | Триггер: approved → автогенерация слотов | S | ⏳ |
| P-03 | ProductionBoard.jsx — недельный/Gantt вид | L | ⏳ |
| P-04 | WeeklyCapacity.jsx — бары загрузки | M | ⏳ |
| P-05 | useProductionStore.js | M | ⏳ |
| P-06 | Загрузка производства в StepDetails (дедлайн) | S | ⏳ |

### Фаза 1 — Bitrix24 ↔ Pinhead sync (после уточнения доступа)
| # | Задача | Сложность | Статус |
|---|--------|-----------|--------|
| B-01 | Edge Function: bitrix-inbound | M | ⏳ |
| B-02 | Edge Function: bitrix-sync | M | ⏳ |
| B-03 | integration_sync + status_mapping таблицы | S | ⏳ |
| B-04 | Frontend: компонент связи с Bitrix в StepDetails | M | ⏳ |

### Фаза 3 — 1С интеграция
| # | Задача | Сложность | Статус |
|---|--------|-----------|--------|
| C-01 | Edge Function: 1c-export | M | ⏳ |
| C-02 | 1С HTTP Service (нужен 1С-разработчик) | L | ⏳ |

### Фаза 4 — Управленческий дашборд
| # | Задача | Сложность | Статус |
|---|--------|-----------|--------|
| D-01 | Production heatmap + deadline risk | M | ⏳ |
| D-02 | Supabase Realtime подписки | S | ⏳ |

---

## ⏪ ОТКЛОНЁННЫЕ / ОТЛОЖЕННЫЕ

| Задача | Причина |
|--------|---------|
| Покупательский портал /order | Приоритет сменился на CRM/ERP |
| TypeScript миграция | Нет критической нужды |
| Шаблоны заказов | Удалены — не нужны |
| CSS Modules | Конфликтов нет |

---

## 📊 Статистика (08.04.2026)

| Метрика | Значение |
|---------|----------|
| Тестов (unit) | 723 ✅ |
| Тестов (E2E) | 3 ✅ |
| Файлов исходников | 53 |
| Файлов тестов | 36 |
| Коммитов | 180+ |
| Шагов визарда | 5 |
| Критических багов | 0 |
| Бандл index.js | 1142 KB (было 1537) |
| Скиллов Claude | 15 |
| Агентов Claude | 5 |

---

*Следующая сессия: Фаза 2 — production_slots + ProductionBoard*
