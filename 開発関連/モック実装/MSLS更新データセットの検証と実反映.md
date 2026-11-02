# MSLS更新データセットの検証と実反映

更新日: 2026-09-09

## 結論

変更後のデータは利用候補になる。実体の `E:\OpenGraffiti\mapillary_dataset` にある7 ZIPを検査した。指定文の `mapillary\_dataset` は存在しないため、変更された実体側を使用した。前のデトロイトのデータではなく、Mapillary Street-Level Sequences（MSLS）。東京の画像61,133枚と同数の東京メタデータを確認し、対象建物群の緯度経度範囲を各辺0.002度広げた範囲に934枚が存在した。対象壁を写していると確認した934枚、という意味ではない。

原ZIPは変更せず、地域内934枚だけを展開した。JPEGを再圧縮せずSHA256とEXIF向きを確認。すべて640px幅、うち822枚が640×360、70枚が640×342、42枚が640×480。撮影日は2016～2019年で、2025年のPLATEAU形状との年代差がある。

|地域|抽出写真|位置・道路高さ等の条件を満たす入力|実際に使用した写真|部分反映棟|投影面積|
|---|---:|---:|---:|---:|---:|
|都庁周辺|571|65|25|45|6,615.1486m²|
|東京タワー周辺|363|298|44|53|6,001.3064m²|
|合計|934|363|69|98|12,616.4550m²|

98棟は既存の全2,858棟の一部。既存Mapillary追加細分化版で未投影だった建物も都庁9棟・東京タワー5棟を含む。ただし出力は別モデルであり、既存Mapillary1,258棟へ単純加算した統合出力ではない。旧Commons・KartaView・Mapillary、元PLATEAU、壁ID、作品・履歴は上書きしない。

## 表示

- `/msls-review.html`: 934枚の原画像を地域・撮影列・フレーム順で選択し、既存3D比較画面と並べる。写真と3Dの視点は未同期と明記。画像ID、撮影日、方位、緯度経度、SHA256を表示。
- `/texture-city?snap=msls&selection=wall-coverage-refine2-all&area=tokyo-tower`: 左が元PLATEAU、中央がMSLS＋公式SNAPの暫定投影、右が従来Mapillary API写真の暫定投影。両追加投影はチェックボックスで切り替える。
- 「SNAP追加投影の建物」で対象を選び、「SNAP写真の方向から見る」で使用写真の推定位置へ移動できる。
- MSLSもMapillary由来であり、中央と右を独立した撮影者・独立データの比較とは呼ばない。

## 試行と条件

公式説明: https://github.com/mapillary/mapillary_sls 。`raw.csv` の位置・方位・撮影日と、`seq_info.csv` の撮影列・フレーム番号を読み込む。付属CSVには焦点距離・主点・歪み係数・完全な撮影姿勢がないため、緯度経度と方位だけで壁に貼らない。

全9撮影列・934枚にpycolmap 4.2.0の特徴対応とSfMを実行。SIMPLE_RADIALの焦点距離・歪み・相対撮影姿勢を推定した。GPSやCSV方位をSfMの観測値として混ぜない。その後、LOD3道路または地形を用いた概略カメラ位置へ相似変換し、5枚ごとに留保したGPSで評価した。

採用条件は既存KartaView試行と同じ。確認用GPSのRMSEが10m以内、各画像の位置差10m以内、有効なレンズパラメータ、撮影高さの根拠が実LOD3道路または近傍LOD3道路であること。道路階層不明や地面標高だけの写真は投影入力から除外する。GPSが合うだけで正しい壁との対応を保証しない。

代表結果: 東京タワー `hsGA9bkA-GNClZ_rke0aMg` は26枚モデル、確認用GPS RMSE1.53m。都庁 `4JgsedrcyKec_U-TeJ27hA` の55枚モデルは、高さが得られた13枚のうち確認用3枚のRMSE0.291m。同列の別42枚モデルは22.49mで除外。`Y2umfV656bqS59_gR0VmsA` は10.259mのため閾値を緩めず除外した。小モデル・登録不成立も成功数に含めない。

全934枚に既存の固定Cityscapes＋ADE20K分類器による共通マスクを作成。画像の中の建物候補だけを残し、マスクを収縮する。採用写真は推定レンズ歪みを別PNGへ補正。全建物の元壁を細分化して、7標本の画角・マスク・都市モデルによる遮蔽を確認し、建物ごとに可視面積最大の1枚を選ぶ。

公式PLATEAU SNAP固定コミット `d194f8891eddb965af1894e5cc6b67541ca7f307` の正射変換を実行。実PNGをGLBへ埋め込んだ。東京タワーの2面は変換後の有効アルファがなく除外、都庁は変換失敗0。採用しない領域を別写真の色や生成色で埋めていない。

## 検証と限界

実GLBの座標・UV・画像・出典・全棟台帳を監査した。都庁4,410三角形、東京タワー4,490三角形。原画素と正射画像のRGB差中央値は両方2/255（都庁2,891標本、東京タワー3,188標本）。これは変換の画素対応検査であり、壁の同定精度ではない。

- 都庁GLB SHA256: `0a91c1e9ec46ba341aa4a225d02caf46abd635103df3c9f58d9a0635c28e94cc`
- 東京タワーGLB SHA256: `961d7c9bccc1d2a2e743d6dda94894f39bce5bc95873a325620488e8432a6aaa`

初回24棟の画面で実投影のON/OFFを確認し、中央のみ68,757画素が変化した。目視では実看板等が現れる一方、欠損・継ぎ目・別の壁へのずれが残った。写真が640px幅であるため、細部や高い壁面の復元には制約がある。暫定試行であり、全棟適用完了・品質合格とは扱わない。

最終98棟版でも実画面を検査した。都庁の例では中央59,547画素、東京タワーの例では中央81,130画素が変化し、左右は0画素、カメラ位置は不変。既存KartaView・Commons統合版の回帰4件とMSLSの地域別2件・原画像比較1件、計7件が成功。原画像と3Dが同じ画面内に見えることも別途1件で確認。Python単体4件、JavaScript単体62件、ビルドが成功した。

**最終画像の目視評価は品質未合格。** 壁の模様が斜めに引き伸ばされる例、上下・隣接面の不一致、断片的な欠損が残った。写真の情報源としては有用だが、この推定カメラのまま本来のテクスチャを置換する品質ではない。GPS位置誤差の小ささを撮影姿勢・壁対応の正しさと混同しない。比較用の別出力を保持し、通常の都市表示には採用しない。次の改善対象は、壁の縦線・対応点による姿勢／ロールの制約と、異なる写真による壁対応の検証である。

## 利用条件

原ZIP付属LICENSE.txtは名称をCC BY-NC-SAと書く一方、リンクはCC BY-NC 4.0になっている。名称を勝手にCC BY-SAへ置き換えない。原文を比較画面から参照できるよう保持し、ローカル評価用途としている。個々の撮影者名はCSVにない。商用利用や外部公開の許諾を取得したとは扱わず、必要なら提供元へ条件の確認が必要。

## 再実行

1. `python scripts/texture-msls-inspect.py` → `python scripts/texture-msls-extract.py`
2. `node scripts/texture-msls-locations.mjs` → `./scripts/texture-msls-reconstruct.ps1`
3. `python scripts/texture-msls-photo-mask.py --provider msls --device cuda`
4. `python scripts/texture-msls-facade-filter.py --provider msls --device cuda`
5. `./scripts/texture-msls-snap-rebuild.ps1` → `node scripts/texture-msls-gallery.mjs`
6. `node scripts/runtime.mjs build` → MSLS画面試験

Pythonは `.tools/texture-cuda/Scripts/python.exe` を使用。大容量ZIP全体や海外都市は展開しない。推定結果の詳細は `data/texture-city/msls/`、実出力は `public/assets/texture-poc/experimental/snap-msls/`。
