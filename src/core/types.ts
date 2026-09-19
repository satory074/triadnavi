/** カードタイプ。ゲームデータ TripleTriadCardType の ID と一致させる */
export type CardType = 0 | 1 | 2 | 3 | 4;

export const CARD_TYPE_NAMES: readonly string[] = ['なし', '蛮神', '暁', '獣人', '帝国'];

/** 辺の並びは常に [上, 右, 下, 左]。値は 1〜10(A = 10) */
export type Sides = readonly [number, number, number, number];

export interface CardDef {
  readonly sides: Sides;
  readonly type: CardType;
  /** 表示用。エンジンとソルバーは参照しない */
  readonly label?: string;
}

/** 0 = 自分(青)、1 = 相手(赤) */
export type Player = 0 | 1;

export interface RuleSet {
  same: boolean;
  plus: boolean;
  reverse: boolean;
  fallenAce: boolean;
  typeShift: 'none' | 'asc' | 'desc';
  pick: 'free' | 'order' | 'chaos';
  open: 'all' | 'three' | 'none';
  suddenDeath: boolean;
}

export interface EngineOptions {
  /**
   * コンボ連鎖中もエースキラーを有効にするか。どの情報源にも実機での検証例が無いため設定項目にしている。
   * リバースがコンボ中も有効なこと(実機確認済み)からの類推で、既定は true。
   */
  fallenAceInCombo: boolean;
}

export const DEFAULT_OPTIONS: EngineOptions = { fallenAceInCombo: true };

export const NO_RULES: RuleSet = {
  same: false,
  plus: false,
  reverse: false,
  fallenAce: false,
  typeShift: 'none',
  pick: 'free',
  open: 'none',
  suddenDeath: false,
};

/** card は文脈ごとのカード配列への添字、cell は 0〜8(左上から行優先) */
export interface Move {
  card: number;
  cell: number;
}

export type Outcome = 'win' | 'draw' | 'loss';

export const A = 10;

export function formatSide(v: number): string {
  return v >= A ? 'A' : String(v);
}

export function formatSides(s: Sides): string {
  return s.map(formatSide).join('/');
}
