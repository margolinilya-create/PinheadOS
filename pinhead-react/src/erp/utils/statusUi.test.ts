import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  STATUS_LABELS,
  STATUS_VARIANT,
  VARIANT_CHIP_CLASS,
  statusChipClass,
  statusUi,
} from './statusUi';
import type { BadgeVariant, StatusEntity } from './statusUi';
import { PLAN_STATE_CHIP, PLAN_STATE_LABELS } from './planCard';
import { STAGE_CHIP_CLASS } from './stageUi';
import { STAGE_STATUS_LABELS } from '../types';

/**
 * Словарь состояний — единственное место, где статус превращается в слово
 * и цвет. Тесты ниже сторожат ровно то, чем он куплен.
 */

const CSS = resolve(__dirname, '../erp.module.css');
/** Комментарии снимаем ДО поиска — правило проекта */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

describe('словарь состояний раздела', () => {
  /**
   * Новое значение перечисления заводится в подписях (`*_LABELS`), а забыть
   * его легко именно здесь: пропуск ничего не роняет — чип просто станет серым
   * и без объяснения. Тот же приём, что у `dictionaryKinds.test.ts`.
   */
  it('каждый статус из подписей есть в карте вариантов', () => {
    const missing: string[] = [];
    for (const [entity, labels] of Object.entries(STATUS_LABELS)) {
      const variants = STATUS_VARIANT[entity as StatusEntity] as Record<string, string>;
      for (const status of Object.keys(labels ?? {})) {
        if (!(status in variants)) missing.push(`${entity}.${status}`);
      }
    }
    expect(missing, 'статус без цвета покажется серым и без объяснения').toEqual([]);
  });

  /** Обратная сторона: вариант для статуса, которого в подписях нет */
  it('в карте вариантов нет статусов, которых нет в подписях', () => {
    const extra: string[] = [];
    for (const [entity, labels] of Object.entries(STATUS_LABELS)) {
      const variants = STATUS_VARIANT[entity as StatusEntity] as Record<string, string>;
      for (const status of Object.keys(variants)) {
        if (!(status in (labels ?? {}))) extra.push(`${entity}.${status}`);
      }
    }
    expect(extra, 'такой чип не покажется никогда — либо опечатка, либо мёртвая ветка')
      .toEqual([]);
  });

  /**
   * Декоративные варианты отвечают на «что это за работа» (образец, кастом),
   * а псевдонимы — те же заливки под вторым именем. Выдай их статусу — и одно
   * состояние снова начнёт зваться двумя способами, ради чего словарь и заведён.
   */
  it('статусам не выдаются декоративные варианты и псевдонимы', () => {
    const forbidden: BadgeVariant[] = ['violet', 'cyan', 'info', 'danger'];
    const wrong: string[] = [];
    for (const [entity, variants] of Object.entries(STATUS_VARIANT)) {
      for (const [status, variant] of Object.entries(variants as Record<string, string>)) {
        if (forbidden.includes(variant as BadgeVariant)) wrong.push(`${entity}.${status} → ${variant}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('каждый вариант знает свой класс чипа', () => {
    for (const variants of Object.values(STATUS_VARIANT)) {
      for (const variant of Object.values(variants as Record<string, string>)) {
        expect(VARIANT_CHIP_CLASS[variant as BadgeVariant], `нет класса у «${variant}»`)
          .toBeTruthy();
      }
    }
  });

  /**
   * ГЛАВНАЯ НАХОДКА ОБХОДА 04.09: `.chipReady` и `.chipDone` были объявлены
   * до символа одинаково (`--bg-success` / `--color-success-ink`), и на доске
   * «Готов к работе» отличался от «Готово» только текстом — при том, что это
   * противоположные концы шкалы. Проверяется по НАСТОЯЩЕМУ CSS: пара может
   * сойтись обратно одной правкой токена, и ни один функциональный тест этого
   * не увидит.
   */
  it('«можно начинать» и «закрыто» окрашены по-разному', () => {
    const css = withoutComments(readFileSync(CSS, 'utf8'));
    const decl = (cls: string) => {
      const m = css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
      expect(m, `.${cls} не объявлен`).toBeTruthy();
      return (m as RegExpMatchArray)[1].replace(/\s+/g, ' ').trim();
    };
    expect(decl('chipReady')).not.toBe(decl('chipDone'));
  });

  /** Неизвестный статус показывается человеку, а не ломает карточку */
  it('незнакомый статус не роняет экран и виден как есть', () => {
    expect(statusUi('stage', 'привет_из_прошлой_миграции')).toEqual({
      label: 'привет_из_прошлой_миграции',
      variant: 'neutral',
    });
    expect(statusUi('stage', null)).toEqual({ label: '—', variant: 'neutral' });
  });

  it('слово берётся из подписей сущности, а не из кода статуса', () => {
    expect(statusUi('stage', 'ready').label).toBe(STAGE_STATUS_LABELS.ready);
    expect(statusUi('stage', 'ready').variant).toBe('ready');
    expect(statusUi('material', 'received').variant).toBe('done');
  });

  /**
   * Карты, оставленные ради вызывающих, обязаны ВЫВОДИТЬСЯ из словаря.
   * Стоит кому-то вписать в них своё значение — и расхождение вернётся
   * в точности туда, откуда его убрали.
   */
  it('прежние карты классов выводятся из словаря', () => {
    for (const status of Object.keys(STAGE_STATUS_LABELS)) {
      expect(STAGE_CHIP_CLASS[status as keyof typeof STAGE_CHIP_CLASS])
        .toBe(statusChipClass('stage', status));
    }
    for (const state of Object.keys(PLAN_STATE_LABELS)) {
      expect(PLAN_STATE_CHIP[state as keyof typeof PLAN_STATE_CHIP])
        .toBe(statusChipClass('plan', state));
    }
  });

  /**
   * Экраны собирают имя класса строкой (`styles[CHIP[status]]`), поэтому карта
   * обязана отдавать имя, которое в CSS ЕСТЬ: `styles.несуществующий` — это
   * `undefined`, то есть `className={undefined}`, и меняется только вид.
   */
  it('каждый класс чипа объявлен в CSS раздела', () => {
    const css = withoutComments(readFileSync(CSS, 'utf8'));
    for (const cls of Object.values(VARIANT_CHIP_CLASS)) {
      expect(css, `.${cls} не объявлен`).toMatch(new RegExp(`\\.${cls}\\s*\\{`));
    }
  });
});
