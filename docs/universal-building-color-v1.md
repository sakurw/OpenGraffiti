# 普遍建物着色 v1（確定版）

## 目的

PLATEAU の任意建物に対し、形状を変更せず、利用できる画像根拠の強さに応じて面単位で着色する。全面を実写復元できない場合も、直接観測・同種面からの転写・外部画像合意・属性事前分布を区別する。根拠不足を理由に未描画面を残さず、最後は低confidenceの属性色を必ず割り当てる。

## 入力と根拠順位

1. PLATEAU LOD2 geometry と CityGML semantic surface
2. PLATEAU appearance の UV 対応画像
3. 建物を同定し、camera-to-geometry 登録を通過した地上・航空画像
4. Mapillary・KartaView のGPS、方位、距離で選別した複数地上画像の合意色
5. 国土地理院オルソ画像の座標対応屋根色
6. 同一建物内の同方向・同材質面からの転写
7. semantic class と建物属性による低信頼度の色事前分布

camera-to-geometry 登録済み画像だけを面の直接根拠とする。登録前のMapillary・KartaView画像は、対象方向を向く複数画像が同じ色傾向を示す場合に限り、未観測面の低confidence推定へ使う。Wikimedia Commonsはライセンス確認済み候補を保存するが、位置だけでは対象建物を保証できないため今回の着色値には混ぜない。

## 面単位の処理

- `RoofSurface`、`WallSurface`、`GroundSurface`、`BuildingInstallation` を分離する。
- PLATEAU appearance がある面は、画像の外れ値を除いた robust palette を直接色根拠にする。
- 壁幅 4.5 m 以上、高さ 5.5 m 以上、輪郭の凹み 2.25 m 以下で、appearance の contrast 0.055 以上かつ edge density 0.018 以上の場合だけ、画像から抽出した反復意匠を適用する。
- 直接画像のない面は、同じ semantic class と近い法線方向を持つ根拠面を優先して色・意匠を転写する。
- 転写不能な外壁は地上複数画像の合意色、屋根は座標対応オルソ画像を参照する。
- 画像推定も不能な面は semantic prior で着色し、低い confidence を明示する。未描画にはしない。
- `BuildingInstallation` は元画像の輝度を保ちつつ彩度を 72% 低減し、設備として目立ち過ぎない色にする。
- 内向き壁や内側境界には窓意匠を生成しない。

## provenance と confidence

各面に `semanticClass`、`provenance`、`confidence`、`directlyObserved`、`sourceImage`、`patternPolicy` を保存する。代表的な provenance は次のとおり。

- `plateau-appearance-derived-facade-pattern`: 画像根拠から意匠まで抽出
- `plateau-appearance-solid-wall`: 画像根拠はあるが反復意匠の条件を満たさない
- `plateau-appearance-robust-palette`: 画像根拠から色のみ抽出
- `same-building-surface-transfer`: 同一建物の根拠面から転写
- `same-building-palette-plus-external-ground-consensus`: 建物内paletteと外部地上画像合意を統合
- `gsi-orthophoto-roof-inference`: 座標対応オルソ画像から屋根色を推定
- `external-image-attribute-inference`: 外部画像と面属性から低confidenceで推定
- `semantic-class-prior-only`: 属性事前分布のみ

## 非PLATEAU画像優先モード

比較用に `external-first` モードを持つ。このモードではPLATEAU appearanceの色を使用しない。

- 壁はMapillary・KartaView候補をGPS、撮影方位、距離で絞り、複数画像の合意色を優先する。
- 屋根は建物座標に対応する国土地理院オルソ画像の合意色を優先する。
- 設備は屋根・地上画像の周辺色から彩度を抑えた色を作る。
- 幾何登録前の地上画像は面の直接観測とはせず、`directlyObserved=false` と画像数を保存する。
- 外部画像が全く使えない場合だけ、低confidenceのsemantic priorへフォールバックする。

10棟比較では全430面が外部画像合意を持ち、PLATEAU画像使用0面、semantic priorのみ0面、未描画0面となった。面積加重confidence平均は0.515であり、PLATEAU優先版より低い。これは外部地上画像のcamera-to-geometry登録が未完であることを反映する。

## ソフト補正版（外部色 + PLATEAU設備）

`software-corrected` モードでは、外壁・屋根の非PLATEAU画像優先を維持しつつ、画像に含まれる陰影と撮影条件の差を色推定から減らす。`OuterBuildingInstallation` に分類された設備面だけは、PLATEAU appearanceから求めたrobust paletteを使う。

- 地上・航空画像の空や極端な暗部をマスクし、低周波Retinexで局所照明を平坦化する。
- 画像群の輝度分位を共通目標へ合わせ、画像間の露出差を減らす。
- 彩度の高い色かぶりを圧縮して、壁・屋根の基調色を安定させる。
- 設備面はPLATEAU由来の輝度を保ち、彩度を72%低減する。設備区分のない面へは適用しない。
- 補正前後の画像間輝度標準偏差を保存し、補正後が小さいことを検証条件にする。

10棟比較の補正版は、外部画像を使う217面とPLATEAU設備213面で全430面を着色した。うち177設備面は元appearanceの直接palette、残る36設備面は同じ建物の設備palette転写である。属性priorのみと未描画は0面、意匠適用壁は46面、面積加重confidence平均は0.551となった。外部画像群の平均輝度標準偏差は0.102から0.011へ低下した。

この補正は面へのcamera-to-geometry登録を生成しない。したがって、外壁色のprovenanceは引き続き複数画像による推定であり、PLATEAU設備だけが直接観測または同一設備群からの転写として区別される。

## 完成判定

- PLATEAU元appearance・PLATEAU優先・外部優先・ソフト補正版の triangle-resolved position が完全一致する。
- geometry-only 側にテクスチャがなく、着色側の意匠数がレポートと一致する。
- 全面に provenance と confidence が存在する。
- 全面に可視materialがあり、`renderedSurfaces` が全polygon数と一致し、`unrenderedSurfaces` が0である。
- 10棟すべてを HTTP 経由で読み込み、4画面の操作・同期カメラ・面選択が成立する。
- `file:` で開かれた場合も HTTP へ誘導し、CORS エラーを出さない。

この仕様を `universal-building-color-v1` として固定する。
