// ── Pricing types ──

export interface ScreenMatrix {
  [format: string]: {
    [colors: number]: number[];
  };
}

export interface Prices {
  type: Record<string, number>;
  fabric: Record<string, number>;
  tech: Record<string, number>;
  screenTiers: number[];
  screenFormats: string[];
  screenMaxColors: number;
  screenMatrix: ScreenMatrix;
  screenColoredMult: number;
  screenFutherMult: number;
  screenFxStoneMult: number;
  screenFxPuffMult: number;
  screenFxMetallicMult: number;
  screenFxFluorMult: number;
  screenFxOptions: string[];
  dtgFormatAdd: Record<string, number>;
  dtgWhiteUnder: number;
  embStitchesPerCm2: number;
  embPricePerThousand: number;
  embMetallicMult: number;
  embPuffMult: number;
  embMinPrice: number;
  embAreaAdd: Record<string, number>;
  embColorAdd: number;
  dtfPricePerMeter: number;
  dtfTransferPrice: number;
  dtfFilmWidth: number;
  dtfGap: number;
  dtfFormatAdd: Record<string, number>;
  label: number;
  pack: number;
  urgentMult: number;
  fit: Record<string, number>;
  markupTiers: number[];
  markupByType: Record<string, number[]>;
  markupDefault: number[];
  flexMatrix?: Record<string, Record<number, number[]>>;
}

export interface PriceBreakdown {
  cost: number;
  markup: number;
  markupPct: number;
  markedBase: number;
  base: number;       // alias for cost
  extras: number;
  labels: number;
  print: number;
  pack: number;
  discount: number;   // alias for markup
  urgent: number;
  unitPrice: number;
  total: number;
  qty: number;
  /** Разбивка себестоимости изделия (правка 13.10), ₽ за штуку */
  fabric: number;
  trim: number;
  sewing: number;
  extraMaterials: number;
  /** Накладные, ₽ и доля (0.7 = 70 %) */
  overhead: number;
  overheadPct: number;
  /** Надбавка за срочный пошив, доля */
  urgentPct: number;
  /** Ткань не найдена или без цены — показывать ошибку, а не ноль */
  fabricMissing: boolean;
}
