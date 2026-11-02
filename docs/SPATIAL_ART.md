# 立体アート再設計 2026-11-03

旧版の「塗装あり」「北面の保持」は立体作品の可読性を証明しなかった。v5と生成スクリプトは復旧用に残し、現在の生成はDOUBLE CURRENTへ変更した。

参考: Rice GalleryのSoo Sunny Park「Unwoven Light」 https://www.ricegallery.org/soo-sunny-park 、Felipe Pantoneの立体作品 https://www.gallerycommon.com/en/artists/felipe-pantone 。空間と移動する鑑賞者を構成に含める考えを参考にし、作品の意匠を複製していない。

再設計: 建物中心を巡る二重の螺旋、凹凸で折れ曲がる連続帯、頂部の環。魚の具象画から抽象的な流れへ変更。各画素のUVから実際の3D座標を逆算して一つの色場を評価し、元UVへ焼き込む。描画時は普通の作品テクスチャなので退色・上書きが可能。モデル形状は変更しない。既存の筆で建物を回しながら帯を塗ることで近似可能だが、この版の自動生成はポインター操作の再生ではなく3D座標に基づく焼き込みである。

検査は二段階。spatial-art.spec.tsで12方向と屋根を実際にレンダリングし、未レビューJSONを生成する。続いて各画像を視覚で読み、何に見えるか・形状との関係・限界をdocs/spatial-art-review.jsonへ記録する。scripts/verify-spatial-art-review.mjsは13画像のハッシュと判定を照合し、未確認・画像変更・不合格では失敗する。色数や面積のみで意味の理解を自動合格にしない。レビュー担当は実装者と同じCodexであり独立した被験者テストではない。

## NEON GUARDIAN · 双塔の守り神（2026-11-03）

PVの冒頭用に、都庁の双塔を巨大な角・耳に見立てるキャラクター壁画へ発展。中央の実際の空隙を二本の角の間として残し、その下の胴へ特大の目、菱形の鼻、牙のある笑顔を配置。左右の青緑と蛍光ピンク、金色の角、飛沫と滴でストリートアートの視認性を強めた。実際の上部頂点の主軸から座標系を求め、建物の長手方向と段差に模様を合わせる。元の形状・UVは保持する。

参考はOSGEMEOSのGiants（https://www.vancouverbiennale.com/artworks/giants/）。既存の工業構造物を全周キャラクターへ変える発想を参考にし、都庁の二塔に合わせた独自の顔を設計した。作者の特定キャラクターや図柄の複製ではない。

前作DOUBLE CURRENTは保存済み履歴とsrc/pv-spatial-tide-v7.tsに保持。新作IDはtocho-neon-guardian-v8。生成はワールド座標を評価して通常の描画レイヤーへ焼き込む方式で、手描きポインター再生ではない。大きな色面、丸い目、ステンシル状の牙、点の飛沫は既存描画ツールで近似可能。

## LUMINOUS BLOOM · 光の繭（2026-11-03）

ユーザーがNEON GUARDIANをファンシー作品として採用。都庁版を維持し、美しさを主軸とする別作品をモード学園コクーンタワー（bldg_4e9cedb2-e1b8-48f6-9c04-b862aca365f1）へ追加した。実モデルのふくらみ・先細り・付属する球状棟を確認し、花弁／孔雀の羽根に見える三重の曲面模様を3D座標で構成。青緑・紫・珊瑚のぼかし、金縁、葉脈、スプレー飛沫で立体を包む。モデルは元のままで、発光材質ではなく色の対比による光の表現。

起動: scripts/launchers/OpenGraffiti-Bloom.bat または /demo-mural?art=bloom&scope=expanded&terrain=flat 。従来Mural.batは都庁版のまま。保存IDをcocoon-luminous-bloom-v1と分離し、別建物の既存作品を上書きしない。

検証: TypeScript/Vite成功。都庁の生成・退色・再実行、拡大街区、両作品の全周撮影の4テスト成功（1.2分）。新作13方向を実際に読み、docs/bloom-art-review.jsonへ記録。照合: node scripts/verify-spatial-art-review.mjs docs/bloom-art-review.json 。画像では羽根・花弁として読め、頂部へ収束する。細い縦線や基壇の区切りはモデルの分割が見える。美的評価はCodexによるもので独立被験者評価ではない。


## 桜富士 · SAKURA FUJI (2026-11-03)

「万人受けする分かりやすい美しさ、日本風」の依頼に対し、コクーンタワーを桜・富士山・流水の和柄で包む別作品を追加。生成り、桜色、朱色、藍色を中心に五弁の桜を大きく配置。枝が上昇し、波が基部と球状付属棟を巡る。東西方向をPV導入に推奨。南北では山が両端へ回り込むが桜と波は見える。

`/demo-mural?art=sakura&terrain=flat&scope=expanded` / `scripts/launchers/OpenGraffiti-Sakura.bat`。ID `cocoon-sakura-fuji-v2`。v1は構図調整前のローカル履歴として保持。都庁の採用済みguardian、前作bloomも保持。

`src/pv-sakura-field.ts` の連続したワールド座標・角度・高さによる手続き描画をnative UVへ焼き、通常の描画レイヤーへ保存する。PLATEAU形状・UV・配置の変更なし。写真由来素材ではなくオリジナル手続きアート。ブラシ・塗り・グラデーションで近似可能な図形だが手動操作の記録ではない。

TypeScript/Vite成功。sakura-artとexpansionの3テスト成功（50.3秒）。初回はビルド中にテストを開始したためdist未配置の404で失敗し、ビルド完了後に再実行して成功。12方向＋屋根の実画像を確認、`docs/sakura-art-review.json` に個別観察とSHA256を記録。美的評価はCodexによる確認であり、万人受けの実証ではない。細い元モデルの継ぎ目と屋根付近の図形の伸びは残る。


## RISING TIDE · 昇流 (2026-11-03)

桜案の規則的で静かな見え方を受け、旧鯉案のモチーフを再解釈。損保ジャパン本社ビルに紅白の大きな鯉、金白の副役、非対称な青緑の渦、かすれ・飛沫・垂れを配置。広がる裾に水流を通し、角を越えて尾と胴体が続く。北側の顔から旋回するPV構成を想定。都庁guardianはそのまま、コクーンの旧作履歴も保持。

入口 `/demo-mural?art=koi&terrain=flat&scope=expanded`、`scripts/launchers/OpenGraffiti-RisingKoi.bat`。建物 `bldg_81cf4164-d885-4134-81f8-5356472517ee`、作品ID `sompo-rising-koi-v2`。

原画はbuilt-in image_genによる新規生成。`docs/rising-koi-prompt.md` に完全な入力、`docs/rising-koi-provenance.json` に出力SHA256と消費経路を保存。元PNGを変更せず保存し、`src/pv-rising-koi-field.ts` で建物周囲の方位・高さに従って連続サンプリング、少量の高さ方向のねじれと継ぎ目補間を加えてnative UVへ焼く。上端に余白を取り口を切らない。平面原画を全周へ巻く方式であり、立体彫刻の生成や手作業ストローク再生ではない。同じ絵を各壁に反復しない。建物形状・UV・座標は元のPLATEAUモデルを保持。

通常の1描画レイヤーとして保存するので既存の上書き・退色対象となる。画像読込完了をawaitしてから保存するよう共通経路を調整。TypeScript/Vite成功、koi-art＋expansionの3テスト成功（48.7秒）。都庁生成・保存・冪等性・退色の既存回帰も含む。12周回方向＋屋根を実画像で確認し個別の観察と制限を `docs/rising-koi-art-review.json` へ保存。屋根は藍色の余白、魚の顔を全方向で同時に見せる構成ではない。裾での伸びと細いモデルの継ぎ目は残る。画像生成の美的品質を独立した人間の評価で検証したわけではない。
