import '../public/loading/type-wipe.css';

/** The artwork is decorative; the status remains readable without animation. */
export function TypeWipeLoading({label='街を準備しています'}:{label?:string}){
 return <div className="og-type-wipe" role="status" aria-live="polite">
  <div className="og-type-wipe__mark" aria-hidden="true"><i className="og-type-wipe__light"/></div>
  <div className="og-type-wipe__caption"><span className="og-type-wipe__label">{label}</span></div>
 </div>;
}
