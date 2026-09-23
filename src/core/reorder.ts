/**
 * 配列の要素 1 つを別の位置へ動かす(自分の手札の並べ替えと、保存デッキの一覧の並べ替えで共用)。
 * 範囲外と「動かない指定」は、中身を変えずに複製を返す。
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from === to || from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}
