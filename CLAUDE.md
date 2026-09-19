# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**triadnavi** — FF14 のミニゲーム「トリプルトライアド」の最善手ナビ。ユーザーが FF14 本体で対戦しながら、有効なルールとカードの四方向の数字を都度入力すると、盤面を最後まで読み切って次の一手を示す静的Webアプリ(画面読み取りや自動操作はしない)。GitHub Pagesで公開。

## Commands

```bash
npm run dev          # ローカル開発 (http://localhost:5173/triadnavi/)
npm run build        # 型チェック(tsc -b) + 本番ビルド
npm test             # Vitest (コアロジックとデータの単体テスト)
npm run lint         # oxlint
npm run preview      # ビルド成果物の確認 (http://localhost:4173/triadnavi/)
npm run bench        # 探索のベンチマーク(VITE_BENCH=1 で bench.test.ts を有効化)
npm run data:update  # カード/NPC データの更新(手動実行。生成された src/data/*.json をコミットする)
```

`npm install` が `Cannot read properties of null (reading 'edgesOut')` で落ちる場合は npm 10.9.2 の依存解決の不具合。`package-lock.json` がある状態なら通る。

## Architecture

**Vite + React 19 + TypeScript strict。** ロジックは `src/core/` に純粋TSモジュールとして分離されており、React非依存。乱数は `core/rng.ts` の `makeRng` を注入する(core は `Math.random` を読まない)。テストはコロケーション(`*.test.ts`)。`erasableSyntaxOnly` のため enum は使わない。

- `core/types.ts` — `CardDef {sides:[上,右,下,左], type}`、`Player`(0=自分/青, 1=相手/赤)、`RuleSet`
- `core/rules.ts` — ゲームデータのルール ID(1〜15)との対応、排他 3 組、高速エンジン用のビット
- `core/refEngine.ts` — **参照エンジン**。不変データの読みやすい実装で、裏返りの理由(セイム/プラス/コンボ何連鎖目)を返す。**UI はこちらを使う**
- `core/fastEngine.ts` — **高速エンジン**。型付き配列とビットマスクを `place()`/`undo()` で書き換える探索専用の実装
- `core/search.ts` — 全深さの negamax + アルファベータ、幅ゼロの窓の探り、相手の応手ごとの保証結果の集計
- `core/position.ts` — ソルバーの唯一の入力 `Position`、`guaranteeKind()`(exact / pool / estimate / chaos)、高速エンジンへの変換
- `core/analyze.ts` — タスク単位の純関数 `runTask()`(1 タスク = 初手 1 つ × 計算 1 種類)
- `core/scheduler.ts` — タスクの優先順と結果の反映(純関数)。`core/analyzeSync.ts` はワーカーなしで最後まで解く版(テスト用とフォールバック)
- `core/rank.ts` — 手の順位付けと日本語のラベル
- `core/worlds.ts` — 相手の具体的な手札(とカオスの引き順)の列挙/サンプリング
- `core/chaos.ts` — カオスの厳密な期待値計算と悲観的下界
- `core/match.ts` — 対局の記録(イベントソーシング)。`replay()` は参照エンジンで再生する
- `core/suddenDeath.ts` — サドンデス再戦の手札の組み直し
- `core/appState.ts` / `core/presets.ts` — アプリの状態、保存データの検証つき読み込み
- `core/collection.ts` — 手持ち(所持カードの ID の集合)の保存形式・テキスト入出力と、デッキの制限(★5 は 1 枚まで、★4 以上は合わせて 2 枚まで)
- `data/` — 同梱データ(`cards.json` / `npcs.json`)と検索、数字 4 つからの逆引き、数字 → カード ID の対応づけ。エンジンとソルバーは触らない(core は `data/` を import しない。ID とレアリティが要る所は `DeckCard` で受け取る)
- `worker/solver.worker.ts` — `runTask` を包むだけの殻。`hooks/useSolver.ts` がワーカープールを管理する

### 設計上の重要な決定

- **エンジンは 2 本**: 読みやすい参照エンジンと探索用の高速エンジンを、ランダム生成の対局(3000 局)で毎手突き合わせる(`fastEngine.test.ts`)。ルールを変える時は**必ず両方**を直す。参照エンジンを UI の本番コードにしているのは、テスト専用コードとして腐らせないため。
- **設置処理の順序**: 設置 → セイム/プラス判定 + 通常支配 → (セイム/プラスで取れた場合のみ)コンボ連鎖 → タイプ枚数の更新。タイプアセンド/ディセンドは「置くカード自身を含めない枚数」で全ての比較を行い、解決が終わってから枚数を増やす。値は [1,10] にクランプ(「11」は A と同値で A に勝てない)。
- **勝敗は 10 枚で数える**: 盤面 9 枚 + 後攻の手元に残る 1 枚。
- **厳密探索を採る**: 既存の FF14 ツールはランダムプレイアウトで勝率を出すが、全深さのアルファベータがブラウザで十分速い(`npm run bench` の実測で、全窓探索の中央値は空の盤面 0.7 秒、1 枚後 0.12 秒、2 枚後 0.02 秒。セイム+プラス有効時)。遅いのは自分が先攻の初手だけなので、ワーカープールに初手ごとのタスクを配り、結果を逐次表示している。置換表と探索木内の手の並べ替えは、2 回の計測で効果が無いか逆効果だったので入れていない。盤面の対称性による削減は**無効**(カードは盤面と一緒に回転しない)。
- **同点の手の選び方**: 最善手は同点で並ぶことが非常に多いので、保証クラス → 「相手の応手のうち何通りで自分の勝ちが確定するか」(非公開手札では、具体的な手札の全列挙での勝ち数)→ 枚数差 → 静的評価、の順で選ぶ。期待値最大化(expectimax)は保証を守る前提と矛盾するので使わない。
- **非公開手札は上位集合で解く**: 相手は既知カードに加えて候補のどのカードでも出せるが、合計は不明スロットの数まで、という緩和。相手の選択肢を実際より増やすだけなので、「勝ち」と出ればどの具体的な手札に対しても勝ち(健全な最悪ケース保証)。候補が足りない時はこの探索をしない(相手の出すカードが尽きて値が壊れる)。
- **「確定」「保証」「推定」のラベルを混ぜない**: 保証できないもの(候補不明の手札、カオス)に保証の言葉を使わない。具体的な手札の列挙は、各世界で相手の手札を知っている前提になるので楽観側の推定。
- **ワーカーの中断は terminate**: 同期処理の探索はメッセージでは止められず、`SharedArrayBuffer` は GitHub Pages では必要なヘッダーを設定できない。局面が変わったら計算中のワーカーを破棄して作り直す。
- **画面反映の間引きはタイマー**: `requestAnimationFrame` は非表示のタブで発火しないため、ゲームの横で裏に回っている間に更新が止まる。
- **状態の更新関数に副作用を入れない**: StrictMode では更新関数が 2 回走り、カードが二重に確定する(`CardEditor` で実際に踏んだ)。
- **手持ちはカード ID で保存する**: 保存済みデッキは `CardDef`(数字とタイプ)だが、手持ちは数字もタイプも同じ別カードが 6 組あるので ID で持つ(`triadnavi:collection:v1`)。同梱データに無い ID も捨てない(データを古い版に戻しても所持が消えないように)。手持ちの画面は `AppState.phase` に入れず `App.tsx` の一時的な状態にしている(`parseAppState` は未知の phase を対戦前に落とすので、保存形式を変えずに済む)。
- **カードリストの並びは ID 順ではない**: ゲーム内の番号は `order`(`ex` なら Ex. 番号)。475 枚中 408 枚で ID と食い違うので、手持ちの画面は `CARDS_IN_LIST_ORDER` で並べる。
- **データの更新は手動**: CI では第三者 API を叩かない(API の停止でデプロイが壊れないように)。NPC のデッキとルールはゲームデータ由来の XIVAPI を正とする。ルーレットが 2 枠ある NPC は `rules: [1, 1]` になる。

### 実機で未確認の挙動(どの情報源にも検証例が無い)

食い違った時のために、UI に「所有を修正」と「食い違いをコピー」がある。確定したら該当箇所とテストを直すこと。

- コンボ連鎖中のエースキラー(`EngineOptions.fallenAceInCombo`、既定は有効)
- サドンデス再戦時の先攻(交互と仮定。再戦開始時に選べる)
- 置いたカードが通常支配したカードは、コンボの連鎖の起点にならない(FFTriadBuddy と同じ順序)
- エースキラーはタイプ補正後の値で判定する

「リバース時はエースキラーが無効」と書く攻略サイトがあるが、ゲーム内テキスト(「リバース適用時は1をAで支配できる」)と矛盾するので採用していない。

## Deployment

GitHub Pages(GitHub Actions、`deploy-pages@v4`)。push to main で自動デプロイ(test → lint → build)。

- `vite.config.ts` の `base: '/triadnavi/'` は**リポジトリ名と一致必須**
- `index.html` の `darkreader-lock` メタは Dark Reader 拡張の再配色防止。削除しないこと
