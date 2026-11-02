import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import './texture-lab.css';

const base='/assets/texture-poc/';
const variants=[['original','元のPLATEAUテクスチャ'],['snap','地上撮影＋SNAP'],['mapillary','Mapillary地上画像']] as const;
export function TextureLab(){
 const hosts=useRef<(HTMLDivElement|null)[]>([]),reset=useRef<(all:boolean)=>void>(()=>{});
 const [ready,setReady]=useState(0),[error,setError]=useState('');
 useEffect(()=>{
  let disposed=false,syncing=false;const views:{renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;observer:ResizeObserver}[]=[];
  try{variants.forEach(([id],i)=>{
   const host=hosts.current[i]!;const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);
   const scene=new THREE.Scene();scene.background=new THREE.Color('#e4e7df');
   const camera=new THREE.PerspectiveCamera(40,1,.1,3000),controls=new OrbitControls(camera,renderer.domElement);
   controls.minDistance=8;controls.maxDistance=1100;controls.zoomToCursor=true;
   const observer=new ResizeObserver(()=>{const {width,height}=host.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();renderer.render(scene,camera);});observer.observe(host);
   const render=()=>renderer.render(scene,camera);
   controls.addEventListener('change',()=>{render();if(syncing)return;syncing=true;for(const v of views)if(v.camera!==camera){v.camera.position.copy(camera.position);v.camera.quaternion.copy(camera.quaternion);v.controls.target.copy(controls.target);v.controls.update();v.renderer.render(v.scene,v.camera);}syncing=false;});
   views.push({renderer,scene,camera,controls,observer});
   new GLTFLoader().load(base+id+'.glb',g=>{if(disposed)return;scene.add(g.scene);render();setReady(n=>n+1);},undefined,e=>{if(!disposed)setError('モデルの読込に失敗しました: '+String(e));});
  });
  reset.current=(all)=>{syncing=true;for(const v of views){v.controls.target.set(17,all?163:157,8);v.camera.position.set(all?410:145,all?215:158,all?-110:-16);v.controls.update();v.renderer.render(v.scene,v.camera);}syncing=false;};reset.current(false);
  }catch(e){setError('WebGLを初期化できませんでした: '+String(e));}
  return()=>{disposed=true;for(const v of views){v.observer.disconnect();v.controls.dispose();v.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of (Array.isArray(o.material)?o.material:[o.material])){m.map?.dispose();m.dispose();}}});v.renderer.dispose();v.renderer.domElement.remove();}};
 },[]);
 return <main className="texture-lab"><header><a href="/areas/tocho/city">← 3D都市</a><a href="/texture-city">全建物の都市比較・適用状況 →</a><span>EXPERIMENT / 実画像の適用比較</span></header><h1>都庁の同じ壁を、3種類のテクスチャで比較</h1>
 <p>現在のPLATEAUモデルから第一本庁舎を抽出し、東側中央の既存壁面へ実写真を適用しています。形状・視点・描画条件は共通です。</p>
 <div className="lab-toolbar"><button onClick={()=>reset.current(false)}>比較する壁に寄る</button><button onClick={()=>reset.current(true)}>建物全体を見る</button><span role="status">{error||`モデル読込 ${ready}/3`}　左ドラッグ：回転 ／ 右ドラッグ：移動 ／ ホイール：拡大縮小（3画面同期）</span></div>
 <div className="lab-grid">{variants.map(([id,title],i)=><section key={id}><h2><small>0{i+1}</small>{title}</h2><div className="lab-viewport" ref={el=>{hosts.current[i]=el;}} aria-label={title+'の3Dモデル'}/><p>{id==='original'?'既存CityGMLの形状・写真UVを保持。比較の基準です。':id==='snap'?'2005年の公開地上写真をSNAP公式の正射変換関数で処理。対応点は手動指定。':'2023年の実地上画像を同じ正射変換処理で適用。彫刻が写る下部は適用せず、元写真を保持。'}</p><a href={base+id+'.glb'} download>この比較用GLBを保存</a></section>)}</div>
 <aside><strong>比較範囲と限界</strong><p>両方式の共通比較範囲は中央壁面の標高130〜186.37m（幅約31.6m）です。SNAP側のみ下端82.31mまで適用しています。他の壁・屋根・ユーザー作品は変更していません。これは1棟・1壁面の手動位置合わせ試作で、街全体の復元完了ではありません。</p><p>SNAPは画像供給元ではなく処理系です。今回は公式サーバーの正射変換関数をローカル実行しており、撮影アプリ・VPS・自動位置推定は使用していません。Mapillary側も同じ関数で正射化し、画像供給元の差を比較します。撮影年・天候・解像度が異なるため、画質差をサービス全体の優劣とは判断できません。手動対応点・モデルの簡略化に由来する境界ずれは残ります。</p></aside>
 <a href="https://www.mapillary.com"><img src={base+'mapillary-logo.svg'} width="180" height="60" alt="Mapillary"/></a>
 <h2>取得した原写真と対応点</h2><div className="lab-sources"><section><h3>公開地上写真 → SNAP</h3><a href={base+'snap-source.jpg'}><img src={base+'snap-source.jpg'} alt="都庁の公開地上写真、黄色の枠が適用壁面"/></a><p>© Markus Leupold-Löwenthal / 2005-08-19<br/><a href="https://commons.wikimedia.org/wiki/File:TokyoMetropolitanGovernmentOffice.jpg">Wikimedia Commons 原典</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a></p></section><section><h3>Mapillary 地上画像</h3><a href={base+'mapillary-source.jpg'}><img src={base+'mapillary-source.jpg'} alt="Mapillaryの都庁地上写真、黄色の枠が対応壁面、赤い彫刻は遮蔽物"/></a><p>© bamatel / Mapillary / 2023-03-21<br/><a href="https://www.mapillary.com/app/?pKey=1402663663827916">Mapillary 実画像 1402663663827916</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a></p></section></div>
 <footer><p>写真への変更：対応点の注記・正射変換・切り出し・遮蔽範囲の透明化。加工写真とそのGLB内テクスチャには各原写真と同じCC BY-SAライセンスを適用します。</p><p>3D都市モデル：国土交通省 Project PLATEAU / 東京都（2025年度・新宿区）を加工。<a href="https://www.mlit.go.jp/plateau/site-policy/">利用条件</a>。正射変換：<a href="https://github.com/Project-PLATEAU/PLATEAU-SNAP-Server">PLATEAU SNAP Server</a>（Apache-2.0）。候補画像の検索：<a href="https://michiyomi.dev/en/docs/">michiyomi</a>（検索補助のみ、AI記述は壁面判定に使用せず実画像を確認）。</p><a href={base+'processing.json'}>処理・対応点記録</a> · <a href={base+'model.json'}>既存建物・壁面ID</a></footer>
 </main>;
}
