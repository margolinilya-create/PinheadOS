import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * ЧЕГО ЛИНТЕР НЕ ВИДЕЛ ДО 15.09 — и почему это чинилось.
 *
 * `eslint-plugin-react` в конфиге не было вовсе при 270 `.jsx`: не работали
 * ни `jsx-key`, ни `jsx-no-target-blank`, ни `no-danger`. `jsx-a11y` не было
 * тоже — доступность проверялась ТОЛЬКО в браузере (`erp-axe`, `erp-a11y`),
 * то есть на тех экранах и в тех состояниях, до которых доходит e2e.
 * Type-aware линтинг не был включён (`parserOptions.project` не задан),
 * поэтому `no-floating-promises` не действовал — в кодовой базе, которая
 * насквозь асинхронная и уже ловила «unhandled rejection у `loadBootstrap`»
 * и «фоновое сохранение без try/catch» ВРУЧНУЮ, постфактум.
 *
 * ВВОДИТСЯ РАТЧЕТОМ, А НЕ РАЗОМ. Замер 15.09: правила с нулём находок стоят
 * `error` и ловят регрессию с первого дня; правила с находками — `warn`
 * с потолком `--max-warnings` в `npm run lint` (см. package.json). Потолок,
 * который нельзя превысить, но который не красит CI задним числом, — тот же
 * приём, что у числа потерянных миграций в `migrationJournal.test.ts`:
 * запрет оставил бы CI вечно красным, то есть сторожем, мимо которого смотрят.
 */
/**
 * Правила `eslint-plugin-react`, которые к этому проекту НЕ ОТНОСЯТСЯ.
 *
 * Выключены не «чтобы не падало», а потому что описывают другую систему:
 * их 9950 находок из 10098 при замере, и ни одна не дефект.
 */
const REACT_RULE_OVERRIDES = {
  // React 19 с новым JSX-трансформом: `import React` не нужен нигде (7333)
  'react/react-in-jsx-scope': 'off',
  // Типы приходят из TypeScript, `prop-types` в проекте нет вовсе (2617)
  'react/prop-types': 'off',
  /**
   * Метка шага визарда набрана как `// 02 — Дизайн` — это ВИЗУАЛЬНЫЙ приём
   * Order Studio, а не забытый комментарий. Правило даёт на нём пять
   * срабатываний и ни одного настоящего.
   */
  'react/jsx-no-comment-textnodes': 'off',
}

/**
 * Правила `jsx-a11y`, отключённые по РЕШЕНИЮ проекта, а не по удобству.
 */
const A11Y_RULE_OVERRIDES = {
  /**
   * «Autofocus на первом поле формы» — записанное правило проекта
   * (CLAUDE.md, «Правила кода»). Оно принято осознанно: формы здесь
   * открываются поверх экрана по явному действию человека, и фокус,
   * не поставленный в поле, заставляет его ещё раз целиться пальцем.
   * Правило линтера говорит обратное — выигрывает решение проекта.
   */
  'jsx-a11y/no-autofocus': 'off',
  /**
   * `DateField` — СОБСТВЕННЫЙ КОНТРОЛ проекта: он рендерит нативный
   * `<input type="date">` плюс эхо даты под ним. Линтер компонентов
   * не разворачивает и на `<label><span>Срок с</span><DateField/></label>`
   * отвечал «подпись без контрола» — 21 находка из 31, все ложные.
   *
   * Правило проекта здесь уже есть и сторожит РЕЗУЛЬТАТ, а не способ
   * (`erp/labelBinding.test.ts`), поэтому линтеру просто сообщается состав
   * собственных контролов, а не ослабляется проверка.
   */
  'jsx-a11y/label-has-associated-control': ['warn', { controlComponents: ['DateField'] }],
  /**
   * РАТЧЕТ, А НЕ ПОСЛАБЛЕНИЕ. Эти правила дают 95 находок на коде, который
   * писался, пока линтер их не знал: оверлеи, закрывающиеся кликом по
   * подложке, кликабельные карточки в Order Studio, `tabIndex` у
   * прокручиваемых областей. Часть из них — настоящие вопросы доступности,
   * часть — приёмы, у которых клавиатурный путь есть в другом месте
   * (`useFocusTrap` ловит Escape у каждого окна раздела).
   *
   * Поставить их `error` значило бы оставить CI вечно красным, то есть
   * сторожем, мимо которого смотрят; выключить — потерять класс целиком.
   * Поэтому `warn` плюс потолок `--max-warnings` в `npm run lint`: РОСТ
   * числа валит сборку с первого дня, а разбор существующего идёт отдельной
   * работой, по экранам. Потолок опускается по мере разбора и никогда
   * не поднимается — тот же приём, что у числа потерянных миграций
   * в `migrationJournal.test.ts`.
   */
  'jsx-a11y/click-events-have-key-events': 'warn',
  'jsx-a11y/no-static-element-interactions': 'warn',
  'jsx-a11y/no-noninteractive-element-interactions': 'warn',
  'jsx-a11y/no-noninteractive-tabindex': 'warn',
  'jsx-a11y/interactive-supports-focus': 'warn',
}

/**
 * Type-aware правила. Взяты ТОЧЕЧНО — те, что отвечают на реальные дефекты
 * этого проекта (потерянный промис в асинхронном сторе), а не весь
 * `recommendedTypeChecked`: тот даёт сотни находок о стиле и утонил бы
 * в них единственный класс, ради которого линтинг и включался.
 */
const TYPE_AWARE_RULES = {
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
}

export default defineConfig([
  // dist-e2e — сборка для офлайн-спека (`playwright.config.ts`): линтовать
  // минифицированный вывод бессмысленно, а без игнора он даёт 347 ошибок
  globalIgnores(['dist', 'dist-e2e']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      react.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      ...REACT_RULE_OVERRIDES,
      ...A11Y_RULE_OVERRIDES,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      react.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
      ...REACT_RULE_OVERRIDES,
      ...A11Y_RULE_OVERRIDES,
    },
  },
  {
    /**
     * TYPE-AWARE — ТОЛЬКО ПО `src`, И ЭТО НЕ ЭКОНОМИЯ.
     *
     * Правилам нужен тип, то есть программа TypeScript, а `tsconfig.json`
     * проекта содержит ровно `src`. Включённые на всё, они отвечают
     * «файл не найден сервисом проекта» у каждого спека `e2e/` и у обоих
     * конфигов Playwright — 29 таких отказов при первом замере, и это
     * не находки, а отсутствие ответа.
     *
     * Второй tsconfig ради линта не заводим: он стал бы вторым местом,
     * задающим состав проекта, и однажды разошёлся бы с первым. `e2e/`
     * при этом остаётся под обычными правилами — без типов.
     */
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: TYPE_AWARE_RULES,
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.test.{js,jsx,ts,tsx}', '**/*.spec.{js,jsx,ts,tsx}', '**/setupTests.js'],
    languageOptions: {
      globals: {
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
])
