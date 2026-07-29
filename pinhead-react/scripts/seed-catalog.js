/**
 * ⚠️ СКРИПТ УСТАРЕЛ И НЕ ЗАПУСКАЕТСЯ. Не чинить импорты «до зелёного» не разобравшись.
 *
 * Две независимые причины:
 * 1. Ссылается на экспорты, которых больше нет: EXTRAS_ICONS (удалён вместе с
 *    эмодзи-иконками при переходе на SVG-набор), FABRICS_LAYER1/FABRICS_LAYER2
 *    (удалены при перестройке каталога тканей). Падает на импорте модуля.
 * 2. Пишет в catalog_config ключи `prices`/`sku`/`fabrics`/`extras`/`labels`,
 *    а lib/catalogs.ts читает `skuCatalog`/`fabricsCatalog`/`trimCatalog` и
 *    `sku_catalog` из app_config. Даже починив импорты, получим скрипт, который
 *    успешно пишет то, что приложение не читает, — хуже, чем сломанный.
 *
 * Решение «починить под текущую схему или удалить» продуктовое: команда `npm run seed`
 * упомянута в CLAUDE.md. Опасный дефолт SUPABASE_URL из него уже убран (см. ниже).
 */
import { createClient } from '@supabase/supabase-js'

import { PRICES } from '../src/data/prices.js'
import { SKU_CATEGORIES, SKU_CATALOG_DEFAULT } from '../src/data/skuCatalog.js'
import {
  FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT,
  LAYER1_TYPES, LAYER2_TYPES,
  FABRICS_LAYER1, FABRICS_LAYER2
} from '../src/data/fabricsCatalog.js'
import {
  EXTRAS_CATALOG_DEFAULT, EXTRAS_DESCS,
  LABELS_CATALOG_DEFAULT, LABEL_CONFIG,
  HARDWARE_GROUPS, HARDWARE_CATALOG_DEFAULT
} from '../src/data/extras.js'

// Дефолта здесь быть не должно. Раньше стояло `|| 'https://pulzirakjqehsulmjhdj…'` —
// это kontora24-prod, БОЕВОЙ проект другого продукта в той же организации. Скрипт
// работает с service-role ключом и делает upsert в catalog_config: забыл экспортировать
// SUPABASE_URL — молча перезаписал каталоги чужого прода, и скрипт отчитался успехом.
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL) {
  console.error(
    'Не задан SUPABASE_URL.\n\n' +
    'Укажите проект явно — дефолта у скрипта нет намеренно:\n' +
    '  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=ey... npm run seed\n\n' +
    'Ref проекта: Supabase Dashboard → Settings → General → Reference ID'
  )
  process.exit(1)
}

if (!SUPABASE_SERVICE_KEY) {
  console.error(
    'Missing SUPABASE_SERVICE_KEY env variable.\n\n' +
    'Как получить:\n' +
    '  1. Supabase Dashboard → ваш проект\n' +
    '  2. Settings → API\n' +
    '  3. Скопируйте "service_role" ключ\n\n' +
    'Использование:\n' +
    '  SUPABASE_SERVICE_KEY=ey... npm run seed\n' +
    '  или создайте .env файл (см. .env.example)'
  )
  process.exit(1)
}

// Целевой проект печатаем перед записью: ключ и URL приходят из окружения,
// а перезапись каталогов необратима — видеть, куда пишем, нужно до, а не после.
console.log(`Пишу каталоги в ${SUPABASE_URL}`)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const { error } = await supabase.from('catalog_config').upsert([
  { key: 'prices',    value: PRICES },
  { key: 'sku',       value: { categories: SKU_CATEGORIES, items: SKU_CATALOG_DEFAULT } },
  { key: 'fabrics',   value: {
      catalog: FABRICS_CATALOG_DEFAULT,
      trims: TRIM_CATALOG_DEFAULT,
      layer1Types: LAYER1_TYPES,
      layer2Types: LAYER2_TYPES,
      layer1: FABRICS_LAYER1,
      layer2: FABRICS_LAYER2
    }
  },
  // icons: EXTRAS_ICONS убрано — экспорта больше нет. Эмодзи-иконки обработок
  // удалены вместе с переходом ERP на SVG-набор, и скрипт с тех пор падал
  // на импорте, то есть seed не запускался ни разу после той правки.
  { key: 'extras',    value: {
      catalog: EXTRAS_CATALOG_DEFAULT,
      descriptions: EXTRAS_DESCS
    }
  },
  { key: 'labels',    value: {
      catalog: LABELS_CATALOG_DEFAULT,
      config: LABEL_CONFIG,
      hardwareGroups: HARDWARE_GROUPS,
      hardware: HARDWARE_CATALOG_DEFAULT
    }
  },
])

if (error) {
  console.error('Seed failed:', error.message)
  process.exit(1)
}

console.log('Catalog seeded successfully (5 keys: prices, sku, fabrics, extras, labels)')
