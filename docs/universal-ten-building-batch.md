# 都庁周辺・一般建物10棟 普遍着色バッチ

## 対象選択

都庁から約 250–350 m、LOD2、高さ 10–45 m、PLATEAU appearance 対応率 80% 以上を条件にした。PLATEAU の建物名が空で、既知ランドマーク ID に含まれない建物だけを採用した。

| 対象 | Building ID | 都庁からの距離 (m) | 高さ (m) | 面数 | 直接根拠面 | 意匠適用壁 | 面積加重 confidence | Tier |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 一般建物 01 | `bldg_056fbe4d-bce5-44f3-a4ba-c786b23de5e6` | 268.9 | 22.43 | 6 | 5 | 2 | 0.682 | A |
| 一般建物 02 | `bldg_87434b30-0653-4b85-8b2e-c4b771c475a7` | 269.2 | 21.11 | 82 | 70 | 2 | 0.643 | B |
| 一般建物 03 | `bldg_76b1851f-7f4b-473f-8b12-19633221d922` | 275.2 | 11.09 | 6 | 5 | 1 | 0.659 | A |
| 一般建物 04 | `bldg_81497526-1f90-459f-8da8-4c1abe108739` | 279.8 | 10.99 | 6 | 5 | 2 | 0.671 | A |
| 一般建物 05 | `bldg_9539786f-8be5-4799-8847-a36b83ed4659` | 322.6 | 20.35 | 30 | 29 | 3 | 0.632 | A |
| 一般建物 06 | `bldg_071b0e01-cc56-4e31-b0f4-e567e5b0a3df` | 323.4 | 44.45 | 101 | 90 | 5 | 0.679 | A |
| 一般建物 07 | `bldg_43b9edcb-f263-43e0-9dce-6e3b224926c5` | 325.1 | 43.61 | 30 | 25 | 4 | 0.690 | A |
| 一般建物 08 | `bldg_7e9c0c6b-e707-43eb-8ead-ba50333f188b` | 327.7 | 20.24 | 104 | 92 | 12 | 0.641 | A |
| 一般建物 09 | `bldg_0cc0cc78-85fe-4db4-af00-ba6d82c60529` | 327.7 | 12.95 | 21 | 20 | 3 | 0.626 | A |
| 一般建物 10 | `bldg_c73f11de-4e76-43aa-a59c-cd3f880f8fcd` | 341.4 | 43.48 | 44 | 42 | 3 | 0.712 | A |

## 実行結果

- 10棟、430面を処理した。
- PLATEAU appearance を直接根拠にした面は383面。
- 画像のコントラスト・エッジ条件を通過し、反復意匠を適用した壁は37面。
- 面積加重 confidence の10棟平均は0.663。
- 品質 Tier は A が9棟、Bが1棟。
- Mapillary 1370画像を発見し262画像、KartaView 1102画像から262画像、ライセンス確認済みWikimedia Commons 50画像、国土地理院27航空タイルを取得した。重複をプロバイダ内で除いた外部取得総数は601件。
- 10棟すべてで地上画像20件以上の合意色と、屋根航空画像3件の合意色を生成した。
- PLATEAU直接根拠383面、外部画像合意を使った未観測面推定11面、同一建物内転写36面となった。属性priorのみの面と未描画面はともに0面。
- 外部地上画像はGPS・方位・距離で候補を絞り、複数画像の合意を未観測面の低confidence推定に使う。camera-to-geometry登録前の画像を面の直接根拠とは記録しない。

## 比較成果物

- 比較ページ: `http://127.0.0.1:3100/universal-ten-building-demo.html`
- 左: PLATEAU標準の航空・斜め航空写真appearanceを元のUVで適用した同一 geometry
- 中央: PLATEAU appearanceを優先した `universal-building-color-v1` 適用結果
- 右: PLATEAU画像色を使わず、Mapillary・KartaView・国土地理院画像を優先した `external-first` 適用結果
- 右端: 外壁・屋根を補正済み非PLATEAU画像から着色し、CityGMLの設備面だけPLATEAU paletteを使う `software-corrected` 適用結果
- 10棟選択、4画面同期 Orbit 操作、ズーム、着色3方式の面クリックによる semantic・provenance・confidence・ソフト処理確認に対応する。

`external-first` は430面すべてを外部画像合意から着色し、PLATEAU画像使用0面、未描画0面、窓帯46壁、面積加重confidence平均0.515となった。地上写真の面登録は未完であるため、登録済み直接テクスチャではなく、GPS・方位・距離による複数画像推定として扱う。

`software-corrected` は、空・暗部マスク付き低周波Retinex、画像間露出・輝度分位整合、色かぶり圧縮を外部画像へ適用する。外部画像217面、PLATEAU設備213面（元appearance直接177面、設備群転写36面）、未描画0面、窓帯46壁、面積加重confidence平均0.551となった。10棟平均の画像間輝度標準偏差は0.102から0.011へ低下した。これは陰影・露出差の低減指標であり、外壁の幾何登録精度を表す値ではない。

左側の比較元は独自にテクスチャを貼ったモデルではない。PLATEAU配布アーカイブ内の `udx/bldg/53394525_bldg_6697_op.gml` に記録された `ParameterizedTexture` を読み、同じアーカイブの元JPEGと `textureCoordinates` をそのままGLBへ移した抽出モデルである。GLTF座標規約に合わせてV軸の表現だけを変換している。

`scripts/audit-universal-ten-plateau-source.mjs` で、配布マニフェスト、CityGML、元JPEG、UV、抽出GLBを照合する。現在の監査は10棟430面、テクスチャ対応385面、元画像28枚について、CityGMLと配布マニフェストのSHA-256一致、埋め込みJPEGのバイト一致、UV一致、形状一致、任意画像適用0を確認している。結果は `test-results/universal-ten-building-plateau-source-audit.json` に保存する。

## 不自然に見える建物の監査

- 左側はPLATEAU元appearanceを加工せず表示するため、斜め航空画像の遠近、屋上、隣接物が垂直壁へ写り込む面がある。特に一般建物04・06・07・10で差が見えやすい。
- 一般建物01・03は元appearanceにも外壁細部が乏しく、普遍着色側は根拠のない窓を増やさず単色面を残した。
- 一般建物09の変則的な屋根は左右で一致するPLATEAU原形状であり、着色処理が生成した形状ではない。
- 普遍着色側は元画像を壁へ直接貼り直さず、面内の安定色と反復性を抽出する。そのため斜め航空投影の歪みは減るが、窓帯はCityGML openingではなく画像由来の推定意匠である。

検証では10棟すべてで4方式の triangle-resolved position の最大差0、PLATEAU appearanceが割り当てられた面のテクスチャ読込、外部優先430面と補正版430面のmaterial・provenance・推定画像数、補正版の設備区分、補正前後の輝度ばらつき低下、全HTTPリソース200、ブラウザエラー0、CORSエラー0、4カメラ同期成功を確認する。

## 再生成・検証

```powershell
node scripts\universal-ten-building-source-discover.mjs
node scripts\universal-ten-building-source-maximize.mjs
python scripts\universal-ten-building-semantics.py
node scripts\generate-universal-ten-buildings.mjs
node scripts\audit-universal-ten-plateau-source.mjs
npm run build
node scripts\verify-universal-ten-buildings.mjs
```

選定条件と ID は `scripts/universal-ten-building-selection.json`、集計と面単位監査は `public/assets/universal-ten-building/report.json` に保存している。
