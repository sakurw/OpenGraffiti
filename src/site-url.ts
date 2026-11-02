// Keep source model URLs intact; resolve them under the deployment directory.
export function siteUrl(url:string){
 const base=import.meta.env.BASE_URL;
 return url.startsWith('/')&&!url.startsWith('//')&&!url.startsWith(base)&&base!=='/'?base+url.slice(1):url;
}
