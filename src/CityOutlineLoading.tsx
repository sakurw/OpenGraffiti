import '../public/loading/city-outline.css';

export function CityOutlineLoading({label='街を準備しています'}:{label?:string}){
 return <div className="og-city-outline" role="status" aria-live="polite">
  <div className="og-city-outline__art" aria-hidden="true"><i className="og-city-outline__light"/></div>
  <span className="og-city-outline__label">{label}</span>
 </div>;
}
