export const WIDTH = 2048, HEIGHT = 1024;
export const START = Date.parse('2026-09-08T03:00:00.000Z');
export const AREA = 'tokyo-tower';
export const walls = Array.from({ length: 12 }, (_, i) => ({
  id: `wall-${String(i + 1).padStart(2, '0')}`, number: i + 1,
  name: ['芝公園の角壁', '路地のコンクリート', '赤いレンガの壁', '小さなギャラリー', '通り沿いの壁', '木陰のアトリエ', '交差点の壁', '白タイルの壁', '街角の倉庫', '夕陽の壁', 'ひだまりの壁', '通路の終わり'][i],
  street: i < 6 ? 'タワーサイド通り' : '芝公園の小径',
  width: 8, height: 4, color: ['#b6b6ab', '#b7b4a8', '#a17c64', '#c9c7b9'][i % 4],
  position: [(i % 6 - 2.5) * 11, 2.8, i < 6 ? -5 : 17],
  sectionId: 'tower-walk', mock: true,
}));
export const sections = [{ id: 'tower-walk', name: 'タワーサイド通り', subtitle: '芝公園の小径まで', wallIds: walls.map(w => w.id) }];
export function atRevision(revisions, at) {
  return [...revisions].reverse().find(r => r.start <= at && (r.end === null || at < r.end));
}
export function progress(revision, at) { return revision.no === 0 ? 1000 : Math.max(0, Math.min(1000, Math.floor((at - revision.start) / 15))); }
export function stage(p) { return p < 333 ? '鮮明' : p < 667 ? '色あせ' : p < 1000 ? '輪郭のみ' : '元の壁面'; }
