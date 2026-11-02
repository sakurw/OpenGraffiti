# 立体アート再設計 2026-11-03

旧版の「塗装あり」「北面の保持」は立体作品の可読性を証明しなかった。v5と生成スクリプトは復旧用に残し、現在の生成はDOUBLE CURRENTへ変更した。

参考: Rice GalleryのSoo Sunny Park「Unwoven Light」 https://www.ricegallery.org/soo-sunny-park 、Felipe Pantoneの立体作品 https://www.gallerycommon.com/en/artists/felipe-pantone 。空間と移動する鑑賞者を構成に含める考えを参考にし、作品の意匠を複製していない。

再設計: 建物中心を巡る二重の螺旋、凹凸で折れ曲がる連続帯、頂部の環。魚の具象画から抽象的な流れへ変更。各画素のUVから実際の3D座標を逆算して一つの色場を評価し、元UVへ焼き込む。描画時は普通の作品テクスチャなので退色・上書きが可能。モデル形状は変更しない。既存の筆で建物を回しながら帯を塗ることで近似可能だが、この版の自動生成はポインター操作の再生ではなく3D座標に基づく焼き込みである。

検査は二段階。spatial-art.spec.tsで12方向と屋根を実際にレンダリングし、未レビューJSONを生成する。続いて各画像を視覚で読み、何に見えるか・形状との関係・限界をdocs/spatial-art-review.jsonへ記録する。scripts/verify-spatial-art-review.mjsは13画像のハッシュと判定を照合し、未確認・画像変更・不合格では失敗する。色数や面積のみで意味の理解を自動合格にしない。レビュー担当は実装者と同じCodexであり独立した被験者テストではない。
