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
  embAreaAdd: Record<string, number>;
  embColorAdd: number;
  dtfFormatAdd: Record<string, number>;
  label: number;
  pack: number;
  urgentMult: number;
  fit: Record<string, number>;
  volumeTiers: number[];
  volumeDiscounts: number[];
  flexMatrix?: Record<string, Record<number, number[]>>;
}

export interface PriceBreakdown {
  base: number;
  extras: number;
  labels: number;
  print: number;
  pack: number;
  discount: number;
  urgent: number;
  unitPrice: number;
  total: number;
  qty: number;
}
