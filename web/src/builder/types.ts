// Tipos do SQL Builder (wizard visual). Lógica pura — sem React.

export type Col = { name: string; type: string };

export type Agg = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'count_distinct';

export type Measure = { column: string; agg: Agg };

/** Referência a uma coluna de dimensão (table === fato para colunas do próprio fato). */
export type DimRef = { table: string; column: string };

export type JoinEdge = { dimTable: string; on: { factCol: string; dimCol: string }[] };

export type RelatedDim = {
  table: string;
  join: JoinEdge;
  /** Atributos exibíveis (não numéricos, fora das colunas de join). */
  attrs: Col[];
  score: number;
};

export type BuilderModel = {
  fact: { name: string; columns: Col[] };
  /** Colunas numéricas do fato que viram medidas Σ. */
  measures: Col[];
  /** Atributos do próprio fato (não numéricos + ano). */
  factAttrs: Col[];
  related: RelatedDim[];
};

export type Filter = { table: string; column: string; values: string[] };

export type Selections = {
  groupBy: DimRef[];
  measures: Measure[];
  filters: Filter[];
  limit: number;
};

export const EMPTY_SEL: Selections = { groupBy: [], measures: [], filters: [], limit: 100 };

export type SourceInfo = { name: string; columns: Col[] };

/**
 * Argumento declarado do View Block (spec §5 Passo 3): declaração primeiro,
 * input derivado — enum→Dropdown, text→TextInput, number→Slider, date→DateRange.
 */
export type VbParam = {
  name: string;
  type: 'enum' | 'text' | 'number' | 'date';
  from: string;
  default?: string;
  label?: string;
  /** Slider (number): faixa do input. */
  min?: number;
  max?: number;
  step?: number;
};
