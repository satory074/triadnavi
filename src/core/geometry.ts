/** 方向: 0 = 上, 1 = 右, 2 = 下, 3 = 左。対面は (d + 2) & 3 */
export const DIRS = 4;
export const CELLS = 9;

const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];

/** NEIGHBOUR[cell * 4 + dir] = 隣のマス。盤外なら -1 */
export const NEIGHBOUR: Int8Array = (() => {
  const t = new Int8Array(CELLS * DIRS).fill(-1);
  for (let cell = 0; cell < CELLS; cell++) {
    const r = Math.floor(cell / 3);
    const c = cell % 3;
    for (let d = 0; d < DIRS; d++) {
      const nr = r + DR[d];
      const nc = c + DC[d];
      if (nr >= 0 && nr < 3 && nc >= 0 && nc < 3) t[cell * DIRS + d] = nr * 3 + nc;
    }
  }
  return t;
})();

export function opposite(d: number): number {
  return (d + 2) & 3;
}

export const CELL_NAMES: readonly string[] = [
  '左上', '上', '右上',
  '左', '中央', '右',
  '左下', '下', '右下',
];
