/** 表示の設定。対局の状態とは別のキーに保存する(AppState の保存形式を変えずに済む) */
export interface Prefs {
  /** カードの絵を出すか。絵は第三者のサービスから読むので、切れるようにしている */
  cardArt: boolean;
}

export const DEFAULT_PREFS: Prefs = { cardArt: true };

/** 壊れた値は既定(絵を出す)に倒す。明示的に false が保存されている時だけ切る */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const o = JSON.parse(raw) as { cardArt?: unknown } | null;
    if (typeof o !== 'object' || o === null) return DEFAULT_PREFS;
    return { cardArt: o.cardArt !== false };
  } catch {
    return DEFAULT_PREFS;
  }
}
