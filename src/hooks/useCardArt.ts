import { createContext, useContext } from 'react';

/**
 * カードの絵を出すか。CardView が直接読む(memo した CollectionCell の内側にも届くよう、props では渡さない)。
 * Provider が無ければ出さない(設定を切った人の画面で、読み込みが起きないように)。
 */
export const CardArtContext = createContext(false);

export const useCardArt = (): boolean => useContext(CardArtContext);
