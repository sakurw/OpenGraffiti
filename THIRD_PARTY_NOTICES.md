# Third-party notices

## PLATEAU data

3D都市モデル（Project PLATEAU）港区・新宿区（2025年度）（東京都）をOpenGraffitiが加工。

- [港区 2025](https://www.geospatial.jp/ckan/dataset/plateau-13103-minato-ku-2025)
- [新宿区 2025](https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025)
- [PLATEAU site policy / Public Data License 1.0](https://www.mlit.go.jp/plateau/site-policy/)

加工内容: 対象建物・道路の抽出、座標変換、三角形化、GLB圧縮、壁面UV・マスク・基底画像生成。元テクスチャを使用し、道路とテクスチャ未対応背景面には表示用の中立色を付けています。公式機関が本アプリを制作・推奨したものではありません。現行v2では東京タワー・都庁周辺のテクスチャ付きLOD2/3壁面を描画対象にしています。街全体表示は元画像を最大512pxへ縮小・アトラス化、壁面の描画下地は元画像から生成しています。元データのURLとハッシュは `public/assets/datasets/plateau-2025-v2/source-manifest.json` に収録。

Original generated fixtures remain for isolated tests only (`MOCK_FIXTURE=1`); their model and sample artworks were created for this repository.

## Software

| Dependency | License | Source |
|---|---|---|
| saxes / earcut | ISC | https://github.com/lddubeau/saxes / https://github.com/mapbox/earcut |
| proj4 | MIT | https://github.com/proj4js/proj4js |
| glTF Transform | MIT | https://github.com/donmccurdy/glTF-Transform |
| meshoptimizer | MIT | https://github.com/zeux/meshoptimizer |
| React / React DOM | MIT | https://github.com/facebook/react |
| React Router | MIT | https://github.com/remix-run/react-router |
| Three.js | MIT | https://github.com/mrdoob/three.js |
| Vite / plugin-react | MIT | https://github.com/vitejs/vite |
| Fastify / fastify-static | MIT | https://github.com/fastify/fastify |
| Lucide | ISC | https://github.com/lucide-icons/lucide |
| Sharp | Apache-2.0 | https://github.com/lovell/sharp |
| libvips (Sharp image runtime) | LGPL-2.1-or-later | https://github.com/libvips/libvips |
| TypeScript / Playwright | Apache-2.0 | https://github.com/microsoft |

Exact installed versions and transitive dependencies are fixed in `package-lock.json`. License texts are included in the relevant packages under `node_modules`. Distributing an installed/bundled application requires preserving their license notices, including Sharp's bundled native dependencies. The portable Node distribution in `.tools` includes its own LICENSE.

Inspection also used the [2023 Shinjuku dataset](https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2023); it is not included in rendered assets.
