-- СУХОЙ ПРОГОН ОТКАТА M до apply — ВЛАДЕЛЕЦ: M, откат, сверка значений со снимком по md5.
-- ОЖИДАНИЕ: ERROR  ROLLBACK_M_OK (всё откатывается).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── Предусловие: G применена, M нет (значения сверяет сама миграция по снимку) ──
do $pre$
declare v text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261017150000') then
    raise exception 'Сначала миграция G (20261017150000)';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261018170000') then
    raise exception 'Миграция M уже записана в schema_migrations';
  end if;
end;
$pre$;

-- ── Миграция M ──
-- Справочники заказа, веха 8 единого потока, миграция M (18.10): старые ключи
-- `catalog_config` (`prices`, `labels`, `extras`, `fabrics`) удаляются.
--
-- План: docs/superpowers/plans/2026-10-18-order-flow-m8-polish-enable.md, задача 2
-- (решение К7). Значения сняты задачей 0 в репозиторий:
-- supabase/snapshots/catalog_config_legacy_2026-10-18.json (md5 `value::text`).
-- Последняя правка ключей — 11.05.2026; новые экраны их не читают (справочники
-- вехи 4 живут в `app_config` и `catalog_config.suppliers`).
--
-- ПРИМЕНЯЕТ ВЛАДЕЛЕЦ в SQL Editor (файлы supabase/rollout/m8/*-M.sql): MCP `execute_sql`
-- на операторе удаления ждёт подтверждения. Порядок с фронтом любой: клиент вехи 8
-- ключи не читает.
--
-- Предусловие — в самой миграции: строка с таким ключом, чьё значение разошлось
-- со снимком, — отказ «значения изменились — переснимите» (удалять несохранённое
-- нельзя). Строки нет — нечего сверять (`supabase db reset` локально).
--
-- Политика чтения G теряет ветку «старый `prices` — только руководству продаж»:
-- имя сохраняется (`alter policy`), обёртка `(select …)` — как в G.
-- Откат: supabase/rollout/m8/3-rollback-M.sql (вставка значений снимка, прежнее условие).

do $pre$
declare
  v_row record;
  c_md5 constant jsonb := '{
    "extras":  "378d803d6883ca5644155b6f8a853ea6",
    "fabrics": "7d939c429d033c13a986a9cb5a35a425",
    "labels":  "bcbc3031a827cf03b261ef40d349c362",
    "prices":  "15d6c08d3234d4d342748aa7c5a3e655"
  }'::jsonb;
begin
  for v_row in
    select key, md5(value::text) as h from public.catalog_config
     where key in ('prices', 'labels', 'extras', 'fabrics')
  loop
    if v_row.h is distinct from c_md5 ->> v_row.key then
      raise exception 'Значения catalog_config.% изменились после снимка (md5 %) — переснимите supabase/snapshots/catalog_config_legacy_2026-10-18.json',
        v_row.key, v_row.h;
    end if;
  end loop;
end;
$pre$;

delete from public.catalog_config where key in ('prices', 'labels', 'extras', 'fabrics');

alter policy catalog_config_select on public.catalog_config
  using ((select public.catalog_reader()));

notify pgrst, 'reload schema';

-- ── Откат M: значения снимка задачи 0 и прежнее условие политики чтения G ──
insert into public.catalog_config (key, value, updated_at)
values ('extras', '{"icons":{"grommet":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><circle cx=\"18\" cy=\"18\" r=\"8\"/><circle cx=\"18\" cy=\"18\" r=\"4\"/><path d=\"M18 2v6M18 28v6M2 18h6M28 18h6\"/></svg>","lace-flat":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M6 18c4-6 8 6 12 0s8 6 12 0\"/><path d=\"M6 24c4-6 8 6 12 0s8 6 12 0\"/></svg>","lace-lock":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><rect x=\"13\" y=\"10\" width=\"10\" height=\"16\" rx=\"2\"/><path d=\"M16 4v6M20 4v6M16 26v6M20 26v6\"/><line x1=\"13\" y1=\"18\" x2=\"23\" y2=\"18\"/></svg>","lace-waxed":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M6 18c4-6 8 6 12 0s8 6 12 0\" stroke-width=\"2.5\"/><circle cx=\"8\" cy=\"22\" r=\"2\" fill=\"currentColor\"/><circle cx=\"28\" cy=\"22\" r=\"2\" fill=\"currentColor\"/></svg>","zipper-ykk":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M14 4v28M22 4v28\"/><path d=\"M14 10l8 4-8 4 8 4-8 4\"/><rect x=\"12\" y=\"2\" width=\"12\" height=\"5\" rx=\"1\"/></svg>","cuff-ribana":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M8 8v20M12 8v20M16 8v20M20 8v20M24 8v20M28 8v20\"/><path d=\"M6 8h24M6 28h24\"/></svg>","hanger-loop":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M18 6a4 4 0 0 1 4 4c0 2-4 4-4 4s-4-2-4-4a4 4 0 0 1 4-4z\"/><path d=\"M10 28h16\"/><path d=\"M10 28L18 18l8 10\"/></svg>","magnet-snap":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><circle cx=\"18\" cy=\"18\" r=\"10\"/><circle cx=\"18\" cy=\"18\" r=\"4\" fill=\"currentColor\"/><path d=\"M18 8v-4M18 32v-4\"/></svg>","zipper-half":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M14 14v18M22 14v18\"/><path d=\"M14 18l8 4-8 4 8 4\"/><rect x=\"12\" y=\"10\" width=\"12\" height=\"5\" rx=\"1\"/></svg>","double-stitch":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M4 14h28\" stroke-dasharray=\"3 3\"/><path d=\"M4 22h28\" stroke-dasharray=\"3 3\"/><path d=\"M4 10h28\"/><path d=\"M4 26h28\"/></svg>","reinforced-seam":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M8 8l20 20\" stroke-width=\"2.5\"/><path d=\"M5 14l4-4M10 19l4-4M15 24l4-4M20 29l4-4\"/></svg>","strap-reinforce":"<svg width=\"36\" height=\"36\" viewBox=\"0 0 36 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M10 8h4v20h-4zM22 8h4v20h-4z\"/><path d=\"M14 14h8M14 22h8\" stroke-width=\"2\"/></svg>"},"catalog":[{"code":"grommet","name":"Люверсы на капюшон","price":35,"forCategories":["hoodies","ziphoodies","half-zip"]},{"code":"lace-flat","name":"Шнурок плоский","price":20,"forCategories":["hoodies","ziphoodies","half-zip"]},{"code":"lace-waxed","name":"Шнурок вощёный","price":25,"forCategories":["hoodies","ziphoodies","half-zip"]},{"code":"lace-lock","name":"Фиксатор шнурка","price":15,"forCategories":["hoodies","ziphoodies","half-zip"]},{"code":"zipper-ykk","name":"Молния YKK","price":120,"forCategories":["ziphoodies"]},{"code":"zipper-half","name":"Молния полузакрытая","price":80,"forCategories":["half-zip"]},{"code":"hanger-loop","name":"Петля для вешалки","price":15,"forCategories":["tshirts","longsleeves","tanks","hoodies","sweatshirts","ziphoodies","half-zip","pants","shorts"]},{"code":"reinforced-seam","name":"Усиление плечевых швов","price":40,"forCategories":["tshirts","longsleeves","tanks","hoodies","sweatshirts","ziphoodies","half-zip"]},{"code":"double-stitch","name":"Двойная отстрочка","price":30,"forCategories":["tshirts","longsleeves","tanks","hoodies","sweatshirts","ziphoodies","half-zip","pants","shorts"]},{"code":"cuff-ribana","name":"Подгиб рукавов рибана","price":25,"forCategories":["longsleeves","hoodies","sweatshirts","ziphoodies","half-zip"]},{"code":"strap-reinforce","name":"Усиление ручек","price":20,"forCategories":["accessories"]},{"code":"magnet-snap","name":"Кнопка магнитная","price":30,"forCategories":["accessories"]}],"descriptions":{"grommet":"Металлические люверсы для продевания шнурка","lace-flat":"Плоский хлопковый шнурок в капюшон","lace-lock":"Пластиковый/металлический фиксатор шнурка","lace-waxed":"Вощёный шнурок с наконечниками","zipper-ykk":"Японская молния YKK, полноразмерная","cuff-ribana":"Трикотажный подгиб рукавов рибаной","hanger-loop":"Петля на воротнике для хранения на вешалке","magnet-snap":"Скрытая магнитная кнопка-застёжка","zipper-half":"Молния 1/4 длины для полузипа","double-stitch":"Декоративная двойная строчка по краям","reinforced-seam":"Двойной шов на плечах для прочности","strap-reinforce":"Дополнительное усиление строп и ручек"}}'::jsonb, '2026-05-11 16:54:44.348461+00');
insert into public.catalog_config (key, value, updated_at)
values ('fabrics', '{"trims":[{"code":"ribana-1x1","name":"Рибана 1×1","priceUSD":2.5},{"code":"ribana-2x2","name":"Рибана 2×2","priceUSD":2.7},{"code":"kashkorse","name":"Кашкорсе","priceUSD":3}],"layer1":[{"key":"kulirnaya","sub":"лёгкая","meta":"100% хлопок","name":"Кулирка","priceKey":"kulirnaya"},{"key":"dvunitka","sub":"плотная","meta":"100% хлопок","name":"2-х нитка","priceKey":"dvunitka"},{"key":"interlock","sub":"гладкий","meta":"100% хлопок","name":"Интерлок","priceKey":"interlock"}],"layer2":[{"key":"futher-350-nachers","sub":"100% хлопок","meta":"350 г/м² · Начёс","name":"Футер 3х нитка","priceKey":"futher-350-nachers"},{"key":"futher-350-petlya","sub":"100% хлопок","meta":"350 г/м² · Петля","name":"Футер 3х нитка","priceKey":"futher-350-petlya"},{"key":"futher-370-nachers","sub":"80/20 хлопок ПЭ","meta":"370 г/м² · Начёс","name":"Футер 3х нитка","priceKey":"futher-370-nachers"},{"key":"futher-370-petlya","sub":"80/20 хлопок ПЭ","meta":"370 г/м² · Петля","name":"Футер 3х нитка","priceKey":"futher-370-petlya"},{"key":"futher-470-petlya","sub":"100% хлопок","meta":"470 г/м² · Петля","name":"Футер 3х нитка","priceKey":"futher-470-petlya"}],"catalog":[{"code":"kulirnaya","name":"Кулирная гладь 190 г/м²","priceUSD":2.8,"supplier":"Medastex","forCategories":["tshirts","longsleeves","tanks"]},{"code":"dvunitka","name":"Двунитка 240 г/м²","priceUSD":3.4,"supplier":"Medastex","forCategories":["tshirts","longsleeves","tanks"]},{"code":"interlock","name":"Интерлок 220 г/м²","priceUSD":3.1,"supplier":"Medastex","forCategories":["tshirts","longsleeves","tanks"]},{"code":"futher-350-petlya","name":"Футер петля 350 г/м²","priceUSD":3.8,"supplier":"Medastex","forCategories":["hoodies","sweatshirts","ziphoodies","pants","shorts"]},{"code":"futher-350-nachers","name":"Футер начёс 350 г/м²","priceUSD":3.8,"supplier":"Medastex","forCategories":["hoodies","sweatshirts","ziphoodies","pants","shorts"]},{"code":"futher-370-petlya","name":"Футер петля 370 г/м²","priceUSD":4.2,"supplier":"Medastex","forCategories":["hoodies","sweatshirts","ziphoodies","pants","shorts"]},{"code":"futher-370-nachers","name":"Футер начёс 370 г/м²","priceUSD":4.2,"supplier":"Medastex","forCategories":["hoodies","sweatshirts","ziphoodies","pants","shorts"]},{"code":"futher-470-petlya","name":"Футер петля 470 г/м²","priceUSD":5.1,"supplier":"Medastex","forCategories":["hoodies","sweatshirts","ziphoodies","pants","shorts"]}],"layer1Types":["tee","longsleeve","tank"],"layer2Types":["hoodie","sweat","zip-hoodie","half-zip","pants","shorts"]}'::jsonb, '2026-05-11 16:55:15.362045+00');
insert into public.catalog_config (key, value, updated_at)
values ('labels', '{"config":{"hangTag":{"id":"hang-tag","name":"Хэнг-тег (картон)","options":[{"key":"none","name":"Без хэнг-тега","price":0},{"key":"standard","name":"Стандартный","price":15},{"key":"custom","name":"Кастомный","price":25}],"nameShort":"Хэнг-тег"},"careLabel":{"id":"care-label","name":"Бирка по уходу","options":[{"key":"my-logo","name":"Мой логотип бренда","priceDelta":20},{"key":"no-logo","name":"Без логотипа","priceDelta":0},{"key":"standard","name":"Стандартный","priceDelta":0}],"basePrice":10,"nameShort":"Составник"},"mainLabel":{"id":"main-label","name":"Основная бирка","colors":[{"hex":"#FFFFFF","key":"white","name":"Белая"},{"hex":"#000000","key":"black","name":"Чёрная"}],"options":[{"key":"none","name":"Без бирки","price":0},{"key":"send-own","name":"Пришлю свои","price":0},{"key":"standard","name":"Стандартная","price":30},{"key":"custom","name":"Кастомная","price":45}],"materials":[{"key":"woven","name":"Тканая","priceDelta":0},{"key":"polyester","name":"Полиэстер","priceDelta":-5},{"key":"canvas","name":"Хлопковый канвас","priceDelta":10}],"nameShort":"Нашивка","dimensions":{"unit":"см","width":3,"height":6},"placements":[{"key":"neck","name":"На воротнике (спина)"},{"key":"inseam","name":"Петля вшивная (шов)"}]}},"catalog":[{"code":"patch-woven","name":"Нашивка тканая (ворот)","price":30,"forCategories":["tshirts","longsleeves","tanks","hoodies","sweatshirts","ziphoodies","pants","shorts"]},{"code":"patch-jacquard","name":"Нашивка жаккардовая","price":45,"forCategories":["tshirts","longsleeves","tanks","hoodies","sweatshirts","ziphoodies","pants","shorts"]},{"code":"label-hem","name":"Лейбл на подоле","price":20,"forCategories":["tshirts","longsleeves","tanks","hoodies","sweatshirts","ziphoodies"]},{"code":"tag-size","name":"Бирка размерная (вшивная)","price":10,"forCategories":["tshirts","longsleeves","tanks","hoodies","sweatshirts","ziphoodies","pants","shorts","accessories"]},{"code":"hang-tag","name":"Хэнг-тег (картон)","price":15,"forCategories":["tshirts","longsleeves","tanks","hoodies","sweatshirts","ziphoodies","pants","shorts","accessories"]}],"hardware":[{"code":"zipper-ykk","name":"Молния YKK","group":"zippers","price":80},{"code":"zipper-auto","name":"Замок автомат","group":"zippers","price":45},{"code":"zipper-reverse","name":"Молния реверсивная","group":"zippers","price":90},{"code":"lace-waxed","name":"Шнурок вощёный","group":"cords","price":25},{"code":"lace-flat","name":"Шнурок плоский","group":"cords","price":20},{"code":"lace-round","name":"Шнурок круглый","group":"cords","price":20},{"code":"drawstring","name":"Кулиска","group":"cords","price":15},{"code":"elastic-waist","name":"Резинка в пояс","group":"elastic","price":20},{"code":"elastic-cuff","name":"Резинка манжетная","group":"elastic","price":15},{"code":"elastic-hem","name":"Резинка подол","group":"elastic","price":15},{"code":"grommet","name":"Люверсы","group":"metal","price":35},{"code":"snap-button","name":"Кнопка кольцевая","group":"metal","price":20},{"code":"d-ring","name":"Полукольцо D","group":"metal","price":15},{"code":"hook","name":"Карабин","group":"metal","price":25},{"code":"cord-stopper","name":"Фиксатор шнурка","group":"plastic","price":10},{"code":"buckle","name":"Фастекс","group":"plastic","price":20},{"code":"cord-end","name":"Наконечник шнурка","group":"plastic","price":8},{"code":"label-woven","name":"Нашивка тканая","group":"labels","price":30},{"code":"label-printed","name":"Бирка печатная","group":"labels","price":15},{"code":"label-leather","name":"Кожаная нашивка","group":"labels","price":40},{"code":"hangtag","name":"Хенгтег (бирка навес.)","group":"labels","price":10}],"hardwareGroups":[{"id":"zippers","name":"Молнии"},{"id":"cords","name":"Шнурки и завязки"},{"id":"elastic","name":"Резинки"},{"id":"metal","name":"Металлическая фурнитура"},{"id":"plastic","name":"Пластиковая фурнитура"},{"id":"labels","name":"Этикетки и бирки"}]}'::jsonb, '2026-05-11 16:55:27.404335+00');
insert into public.catalog_config (key, value, updated_at)
values ('prices', '{"fit":{"free":50,"regular":0,"oversize":100},"pack":15,"tech":{"dtf":180,"dtg":280,"flex":0,"screen":0,"embroidery":350},"type":{"tee":480,"tank":350,"pants":1000,"socks":280,"sweat":900,"5panel":550,"hoodie":1200,"shorts":750,"basecap":600,"dad-cap":650,"shopper":350,"half-zip":1100,"longsleeve":620,"zip-hoodie":1400},"label":30,"fabric":{"dvunitka":80,"interlock":120,"kulirnaya":0,"futher-350-petlya":0,"futher-370-petlya":30,"futher-470-petlya":80,"futher-350-nachers":0,"futher-370-nachers":30},"embAreaAdd":{"l":180,"m":80,"s":0},"urgentMult":0.2,"embColorAdd":20,"screenTiers":[50,100,300,500,700,1000],"volumeTiers":[1,100,300,500,1000],"dtfFormatAdd":{"A3":100,"A4":50,"A5":20,"A6":0,"A3+":160},"dtgFormatAdd":{"A3":120,"A4":60,"A5":30,"A6":0,"A3+":180},"screenFxMult":2,"screenMatrix":{"A3":{"1":[141,127,120,113,105,99],"2":[183,165,156,147,136,129],"3":[226,203,192,181,167,159],"4":[268,241,228,214,199,189],"5":[329,296,280,263,235,223],"6":[380,342,323,304,272,258],"7":[432,388,367,345,308,293],"8":[483,435,410,386,345,328]},"A4":{"1":[128,115,109,103,95,90],"2":[167,150,142,133,124,117],"3":[205,185,174,164,152,144],"4":[244,219,207,195,181,171],"5":[289,260,245,231,214,203],"6":[333,300,283,267,247,235],"7":[378,341,322,303,280,266],"8":[423,381,360,339,314,298]},"A3+":{"1":[172,155,147,138,115,109],"2":[224,202,191,179,149,142],"3":[276,248,234,221,184,175],"4":[328,295,278,262,218,207],"5":[388,349,330,310,259,246],"6":[448,403,381,359,299,284],"7":[509,458,432,407,339,322],"8":[569,512,484,455,379,360]},"Max":{"1":[212,190,180,169,132,126],"2":[275,247,234,220,172,163],"3":[338,305,288,271,212,201],"4":[402,362,342,321,251,239],"5":[476,428,405,381,297,283],"6":[550,495,467,440,344,327],"7":[624,562,530,499,390,370],"8":[698,628,593,558,436,414]}},"dtgWhiteUnder":60,"screenFormats":["A4","A3","A3+","Max"],"screenFxOptions":["none","stone","puff","metallic","fluor"],"screenMaxColors":8,"volumeDiscounts":[0,0.03,0.05,0.08,0.12],"screenFutherMult":1.5,"screenColoredMult":1.3}'::jsonb, '2026-05-11 16:55:44.241007+00');

alter policy catalog_config_select on public.catalog_config
  using ((select public.catalog_reader())
         and (key <> 'prices' or (select public.sales_is_lead())));

notify pgrst, 'reload schema';

-- ── Сверка отката M: значения равны снимку по md5 ──
do $chk$
declare v text;
begin
  select md5(value::text) into v from public.catalog_config where key = 'extras';
  if v is distinct from '378d803d6883ca5644155b6f8a853ea6' then
    raise exception 'ОТКАТ M: extras не равен снимку (md5 %)', v;
  end if;
  select md5(value::text) into v from public.catalog_config where key = 'fabrics';
  if v is distinct from '7d939c429d033c13a986a9cb5a35a425' then
    raise exception 'ОТКАТ M: fabrics не равен снимку (md5 %)', v;
  end if;
  select md5(value::text) into v from public.catalog_config where key = 'labels';
  if v is distinct from 'bcbc3031a827cf03b261ef40d349c362' then
    raise exception 'ОТКАТ M: labels не равен снимку (md5 %)', v;
  end if;
  select md5(value::text) into v from public.catalog_config where key = 'prices';
  if v is distinct from '15d6c08d3234d4d342748aa7c5a3e655' then
    raise exception 'ОТКАТ M: prices не равен снимку (md5 %)', v;
  end if;
end;
$chk$;

do $$
begin
  raise exception 'ROLLBACK_M_OK';
end;
$$;
