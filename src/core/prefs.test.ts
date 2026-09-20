import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parsePrefs } from './prefs';

describe('表示の設定', () => {
  it('保存が無ければ絵を出す', () => {
    expect(parsePrefs(null)).toEqual({ cardArt: true });
  });

  it('切った設定は切ったまま読める', () => {
    expect(parsePrefs('{"cardArt":false}')).toEqual({ cardArt: false });
  });

  it('壊れた値は既定に倒す', () => {
    for (const raw of ['', '{', 'null', '[]', '"x"', '1', '{"cardArt":"no"}', '{"cardArt":0}', '{"other":1}']) {
      expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
    }
  });

  it('保存した形のまま読み戻せる', () => {
    for (const prefs of [{ cardArt: true }, { cardArt: false }]) {
      expect(parsePrefs(JSON.stringify(prefs))).toEqual(prefs);
    }
  });
});
