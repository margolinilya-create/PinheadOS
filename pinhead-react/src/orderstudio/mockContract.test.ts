// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  J_TEXTS, K_CLIENT_REV, K_NOTES_MAX, K_TEXTS, K_ZONE_ID_RE, LAUNCH_WINDOW_MINUTES, MS_PAYMENT_KINDS, SEND_RULES,
} from '../../e2e/support/mock/orderV4Rpc';
import { SALES_CLIENT_REV } from './api/salesOrders';
import { ZONE_ID_RE } from './catalog/tzRows';

/**
 * Сторож контракта мока e2e с миграцией J (веха 6+7, задача 4; решение 41).
 *
 * Мок RPC заказа v4 (`e2e/support/mock/orderV4Rpc.ts`) отвечает текстами
 * отказов — e2e проверяют экран по ним. Расхождение одной буквы с сервером —
 * e2e зелёный, а на бою экран показывает другое. Поэтому:
 * - каждый русский литерал тел функций J (`message = …`, `reason`, части
 *   склейки «Заказ сейчас запускает » || имя || « — …») есть среди `J_TEXTS`
 *   мока, и каждый текст мока есть в J;
 * - виды оплаты МС, условия отправки и окно метки мока совпадают с условиями J.
 *
 * Лежит в `src`, а не рядом с моком: vitest исключает `e2e/**`, а Playwright
 * подхватил бы `*.test.ts` из `e2e/` как свою спеку.
 *
 * Зелёный после слияния задачи 1 (миграция J): до неё сверка с J пропускается,
 * самопроверка извлечения работает всегда.
 */
const J_FILE = join(process.cwd(), '..', 'supabase', 'migrations', '20261018120000_order_v4_launch.sql');
const HAS_J = existsSync(J_FILE);

/** Тела функций (`$$ … $$`) без комментариев `--` */
function bodies(sql: string): string {
  const parts = sql.split('$$');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 2) out.push(parts[i]);
  return out.join('\n').replace(/--[^\n]*/g, '');
}

/** Русские строковые литералы тел функций; `''` → `'` */
export function cyrillicLiterals(sql: string): string[] {
  const found = new Set<string>();
  for (const m of bodies(sql).matchAll(/'((?:[^']|'')*)'/g)) {
    const lit = m[1].replace(/''/g, "'");
    if (/[А-Яа-яЁё]/.test(lit)) found.add(lit);
  }
  return [...found];
}

/** Расхождения мока с J: литералы J без пары в моке и тексты мока, которых нет в J */
export function contractProblems(sql: string, texts: Record<string, string>): string[] {
  const values = new Set(Object.values(texts));
  const text = bodies(sql).replace(/''/g, "'");
  return [
    ...cyrillicLiterals(sql).filter((l) => !values.has(l)).map((l) => `нет в моке: «${l}»`),
    ...Object.entries(texts).filter(([, v]) => !text.includes(v)).map(([k, v]) => `нет в J: ${k} «${v}»`),
  ];
}

describe('самопроверка извлечения (без J)', () => {
  const SAMPLE = `
    create function f() returns jsonb language plpgsql as $$
    begin
      -- 'Комментарий не текст отказа'
      raise exception using errcode = 'P0001', message = 'Нет отметки оплаты';
      return jsonb_build_object('ok', false, 'reason', 'Заказ сейчас запускает ' || v_name || ' — подождите');
      perform 'ascii only';
    end;
    $$;
    comment on function f() is 'Описание вне тела';`;

  it('литералы тел — с частями склейки, без комментариев и текста вне тела', () => {
    expect(cyrillicLiterals(SAMPLE).sort()).toEqual([' — подождите', 'Заказ сейчас запускает ', 'Нет отметки оплаты'].sort());
  });

  it('мутация: одна буква в тексте мока — расхождение в обе стороны', () => {
    const ok = { a: 'Нет отметки оплаты', b: 'Заказ сейчас запускает ', c: ' — подождите' };
    expect(contractProblems(SAMPLE, ok)).toEqual([]);
    const bad = { ...ok, a: 'Нет отметки оплатЫ' };
    expect(contractProblems(SAMPLE, bad)).toEqual([
      'нет в моке: «Нет отметки оплаты»',
      'нет в J: a «Нет отметки оплатЫ»',
    ]);
  });

  it('тексты мока непустые и не повторяются', () => {
    const v = Object.values(J_TEXTS);
    expect(v.every((t) => t.trim().length > 0)).toBe(true);
    expect(new Set(v).size).toBe(v.length);
  });
});

describe.skipIf(!HAS_J)('мок e2e = миграция J', () => {
  const sql = HAS_J ? readFileSync(J_FILE, 'utf8') : '';

  it('тексты отказов совпадают побуквенно в обе стороны', () => {
    expect(contractProblems(sql, J_TEXTS)).toEqual([]);
  });

  it('виды оплаты МС — как в J', () => {
    const list = MS_PAYMENT_KINDS.map((k) => `'${k}'\\s*`).join(',\\s*');
    expect(bodies(sql)).toMatch(new RegExp(`p_kind\\s+(?:not\\s+)?in\\s*\\(\\s*${list}\\)`));
  });

  it('условия отправки — как в J: PDF в /tz/, тип, предел; макет у всех, кроме «прочее»', () => {
    const b = bodies(sql);
    expect(b).toContain(`${SEND_RULES.tzDir}%'`);
    expect(b).toContain(`'${SEND_RULES.pdfMime}'`);
    expect(b).toContain(String(SEND_RULES.pdfMaxBytes));
    expect(b).toMatch(new RegExp(`method\\s*<>\\s*'${SEND_RULES.noArtworkMethod}'`));
  });

  it('окно метки запуска и запрета возврата — одно, в минутах J', () => {
    // окна метки — от now(); окно возраста копии ТЗ в order_v4_erp_authentic
    // (`launch_started_at - interval '30 minutes'`) — другая величина, мок её не знает
    const windows = [...bodies(sql).matchAll(/now\(\)\s*-\s*interval\s+'(\d+) minutes'/g)].map((m) => Number(m[1]));
    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(windows)).toEqual(new Set([LAUNCH_WINDOW_MINUTES]));
  });
});

/**
 * Веха 8: мок сохранения = миграция K (`order_v4_save_full`): тексты отказов
 * побуквенно в обе стороны, порог ревизии = K = клиент, предел комментария,
 * формат кода зоны = `ZONE_ID_RE`.
 */
const K_FILE = join(process.cwd(), '..', 'supabase', 'migrations', '20261018160000_order_v4_zone_notes.sql');
const HAS_K = existsSync(K_FILE);

describe.skipIf(!HAS_K)('мок e2e = миграция K', () => {
  const sql = HAS_K ? readFileSync(K_FILE, 'utf8') : '';

  it('тексты отказов сохранения совпадают побуквенно в обе стороны', () => {
    expect(contractProblems(sql, K_TEXTS)).toEqual([]);
  });

  it('порог ревизии мока = порог K = ревизия клиента', () => {
    expect(bodies(sql)).toMatch(new RegExp(`\\(p_order->>'client_rev'\\)::int, 0\\) < ${K_CLIENT_REV} then`));
    expect(K_CLIENT_REV).toBe(SALES_CLIENT_REV);
  });

  it('предел комментария и формат кода зоны — как в K и в справочнике', () => {
    expect(bodies(sql)).toContain(`> ${K_NOTES_MAX}`);
    expect(K_ZONE_ID_RE.source).toBe(ZONE_ID_RE.source);
    expect(bodies(sql)).toContain(`!~ '${K_ZONE_ID_RE.source}'`);
  });
});
