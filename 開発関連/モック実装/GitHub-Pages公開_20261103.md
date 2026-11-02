# GitHub Pages 公開

- 公開先: https://sakurw.github.io/OpenGraffiti/
- 元のアプリ: GitHub の `codex/pv-workspace-20261102`、`9af086a`。
- 公開用ブランチ: `codex/github-pages-20261103`。
- 自動公開: `.github/workflows/pages.yml`。公開用ブランチへの push でビルド・配信。
- 元の作業フォルダーの未コミット変更は含めない。

## 公開方式

現行の PVApp を静的配信する。作品は利用者のブラウザーの IndexedDB に保存し、時計・設定は localStorage、タブ間連携は BroadcastChannel を使う。別端末との共有やサーバー保存は元の現行画面にもない。ローカル版で保存した作品は公開サイトには移らない。

Vite の Pages ビルドは `/OpenGraffiti/` を基準にする。元の GLB・テクスチャの内容は変更せず、読み込み URL のみ解決する。404 ページから入口へ戻し、アプリの読み込み前に元のパス・クエリー・ハッシュを復元するため、編集・履歴などの直リンクや再読み込みにも対応する。

`scripts/package-pages.mjs` は現在の画面に必要な拡大版・元127棟版、平坦・従来地形、アート手順、GLB が参照する全アトラスを同梱する。26ファイル、約170.2 MiB。過去の比較HTMLや開発用生成資材は公開対象に含めない。

## 確認手順

1. `node scripts/runtime.mjs build`
2. `node scripts/runtime.mjs e2e --config playwright.pages-regression.config.ts`
3. 環境変数 `GITHUB_PAGES=1` で `node node_modules/vite/bin/vite.js build --outDir dist-pages`
4. `node scripts/package-pages.mjs dist-pages`
5. `node scripts/serve-pages.mjs` で本番同様の404を返す静的配信を起動。
6. `node scripts/runtime.mjs e2e --config playwright.pages.config.ts`
7. 公開後は `PAGES_TEST_URL=https://sakurw.github.io/OpenGraffiti/` で同じ通しテストを実施。

通しテストは拡大街区、元127棟への直接アクセス、描画、Undo/Redo、作品反映、履歴、再読み込み、別タブの時計、道路左右、歩行、退色サンプル、1280×720表示を操作する。回帰テストはレイヤー・パレット・各筆先・塗りつぶし・投影・既存作品保持・地形・衝突・全周アートも検証する。

デスクトップ Chrome での検証であり、全ブラウザー・全端末・全3492棟への手描き操作を保証するものではない。公開先での初回表示には3Dモデルとテクスチャのダウンロードが発生する。

## 検証結果

- TypeScript・Viteビルド成功。
- 現行画面の回帰40項目（revision 37、expansion 2、mural-wrap 1）がすべて成功。
- Pages相当の静的配信で通し2項目が成功。クエリー付き直リンクで元127棟・従来地形へ切り替わることも確認。
- 配信用26資産は元ファイルとSHA-256が一致。
- 旧 `workflow.spec.ts` の3項目も試したが、初期表示を127棟とする旧仕様の前提で失敗した。旧建物選択欄・旧筆色ボタン・旧カメラ動作も参照しているため、現行画面用の公開回帰設定からは除外した。同機能は現行revision・expansion・Pages通し試験で確認している。元の旧試験は変更せず保持。

- 公開URLでも通し2項目が成功（28.6秒）。描画・保存・履歴再読み込み・道路・歩行・退色・小画面を確認し、対象のJS・JSON・GLB・PNG・CSSでHTTPエラーなし。
- 公開コード: `03ca7da021677ee70b273573e3ea8206f8d4ed49`。GitHub Actions: https://github.com/sakurw/OpenGraffiti/actions/runs/41476569886 （成功）。
