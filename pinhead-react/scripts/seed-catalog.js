import { createClient } from '@supabase/supabase-js'

import { PRICES } from '../src/data/prices.js'
import { SKU_CATEGORIES, SKU_CATALOG_DEFAULT } from '../src/data/skuCatalog.js'
import {
  FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT,
  LAYER1_TYPES, LAYER2_TYPES,
  FABRICS_LAYER1, FABRICS_LAYER2
} from '../src/data/fabricsCatalog.js'
import {
  EXTRAS_CATALOG_DEFAULT, EXTRAS_ICONS, EXTRAS_DESCS,
  LABELS_CATALOG_DEFAULT, LABEL_CONFIG,
  HARDWARE_GROUPS, HARDWARE_CATALOG_DEFAULT
} from '../src/data/extras.js'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars')
  process.exit(1)
}

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
  { key: 'extras',    value: {
      catalog: EXTRAS_CATALOG_DEFAULT,
      icons: EXTRAS_ICONS,
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
