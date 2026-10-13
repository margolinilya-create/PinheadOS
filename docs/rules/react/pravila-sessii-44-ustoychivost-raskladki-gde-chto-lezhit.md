# Правила сессии 44 (устойчивость раскладки): где что лежит


- `deptsSettled(departments, bootstrapLoaded)` — `store/shared.ts`, рядом
  с `arrivedLate`. Один предикат «состав участков окончателен» на трёх
  потребителей: резерв меню цехов (`ErpLayout`), гейт панели плана
  (`PlanScreen.ready`) и — через них — ряд вкладок очереди
- Резерв меню: `ErpLayout` считает `reserveRows` из `erp_dept_rows`
  (localStorage, **KEEP_ON_LOGOUT**) и передаёт в `Sidebar`; заглушка —
  `.navLinkGhost` (`composes: navLink`, объявлен ПОСЛЕ `.navLinkActive`:
  `composes` работает только сверху вниз и только внутри файла). Заглушки —
  `<div aria-hidden>`, не ссылки: спеки доступности считают ссылки в `nav`
- Высота вкладки цеха — токен `--dept-tab-h` в `index.css` (+ переопределение
  под `pointer: coarse` там же). Его читают `.deptTab` (`erp.module.css`)
  и резерв ряда `.deptTabs::before` (`screens.module.css`). Строки
  `.deptTab { min-height: 48px }` в тач-блоке `erp.module.css` больше нет —
  на её месте комментарий-указатель на токен
- `PlanBoardSkeleton` — `screens/plan/PlanBoardSkeleton.jsx`, импортирует
  агрегатор `../../styles`. НЕ в `ErpSkeletons`: тот импортирует
  `erp.module.css` напрямую и едет в чанке оболочки, а `.planBoard`/`.planDay`
  объявлены в `screens.module.css` — импорт агрегатора вернул бы доску плана
  в критический путь
- `CapacityBar` принимает `loading`; точек вызова ТРИ — `ErpDashboard`,
  `DeptLoad`, `PlanScreen`, и мигрируются они одним коммитом
- Сторож — `e2e/erp-cls.spec.ts`, свой проект `perf` (порт 4173, собранное
  приложение); файл вписан в `testIgnore` проектов `desktop` и `mobile`.
  Гейт данных — `MockExtras.deptsGate` в `e2e/support/mockSupabase.ts`,
  ждут его ОБА писателя состава участков: ветка `rpc/erp_bootstrap`
  и таблица `erp_departments`

