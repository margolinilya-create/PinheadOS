/**
 * Фикстуры образцов ТЗ (веха 6+7, задача 2; К25) — сборка заказа v4 из JSON.
 *
 * JSON держит только то, что у образца есть: прочие поля позиции, нанесения,
 * бирки и заказа добирают фабрики модели (`model/factory`) с ключами из JSON.
 * У 68180 три файла — одна сделка: заказ собирается из шапки `68180-tee` и позиций
 * всех трёх файлов по порядку (футболка → свитшот → поло), `group` — номер ТЗ
 * в этом заказе (с нуля).
 */
import type { SalesItem, SalesLabel, SalesNoteCard, SalesOrder, SalesPrint } from '../model/types';
import { newSalesItem, newSalesLabel, newSalesNoteCard, newSalesOrder, newSalesPrint } from '../model/factory';
import type { TzCatalogs } from '../tz/model/tzDocTypes';
import catalogsJson from './catalogs.json';
import f63886 from './63886.json';
import f67108 from './67108.json';
import fTee from './68180-tee.json';
import fSweat from './68180-sweat.json';
import fPolo from './68180-polo.json';
import t63886 from './63886.tz.json';
import t67108 from './67108.tz.json';
import tTee from './68180-tee.tz.json';
import tSweat from './68180-sweat.tz.json';
import tPolo from './68180-polo.tz.json';

export const FIXTURE_NAMES = ['63886', '67108', '68180-tee', '68180-sweat', '68180-polo'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

/** Дата оформления и адрес, с которыми собраны ожидания `*.tz.json` */
export const FIXTURE_OPTS = { issuedOn: '2026-10-18', appOrigin: 'https://pinhead-os.vercel.app' } as const;

type Raw = Record<string, unknown>;
interface RawFixture { sample: string; group: number; order: Raw }

const RAW: Record<FixtureName, RawFixture> = {
  63886: f63886 as unknown as RawFixture,
  67108: f67108 as unknown as RawFixture,
  '68180-tee': fTee as unknown as RawFixture,
  '68180-sweat': fSweat as unknown as RawFixture,
  '68180-polo': fPolo as unknown as RawFixture,
};

const EXPECTED: Record<FixtureName, Raw> = {
  63886: t63886, 67108: t67108, '68180-tee': tTee, '68180-sweat': tSweat, '68180-polo': tPolo,
};

function item(raw: Raw): SalesItem {
  const { prints = [], labels = [], ...rest } = raw as Raw & { prints?: Raw[]; labels?: Raw[] };
  return newSalesItem({
    ...(rest as Partial<SalesItem>),
    prints: prints.map((p) => newSalesPrint(p as Partial<SalesPrint>)),
    labels: labels.map((l) => newSalesLabel(l as Partial<SalesLabel>)),
  });
}

function order(raw: Raw, items: Raw[]): SalesOrder {
  const { notes_cards: notes = [], ...rest } = raw as Raw & { notes_cards?: Raw[] };
  return newSalesOrder({
    ...(rest as Partial<SalesOrder>),
    items: items.map(item),
    notes_cards: notes.map((n) => newSalesNoteCard(n as Partial<SalesNoteCard>)),
  });
}

/** Каталоги образцов (глубокая копия — тест может их править) */
export function fixtureCatalogs(): TzCatalogs {
  return structuredClone(catalogsJson) as unknown as TzCatalogs;
}

/** Заказ образца (у 68180 — все три позиции) и номер его ТЗ */
export function loadFixture(name: FixtureName): { order: SalesOrder; group: number; expected: Raw } {
  const raw = structuredClone(RAW[name]);
  const expected = structuredClone(EXPECTED[name]);
  if (raw.sample !== '68180') {
    return { order: order(raw.order, (raw.order.items as Raw[]) ?? []), group: raw.group, expected };
  }
  const head = structuredClone(RAW['68180-tee'].order);
  const items = (['68180-tee', '68180-sweat', '68180-polo'] as const)
    .flatMap((n) => structuredClone(RAW[n].order.items as Raw[]));
  return { order: order(head, items), group: raw.group, expected };
}
