export default async function teardown(config){
 const base=config.projects[0].use.baseURL;
 try{await fetch(base+'/api/v1/test/shutdown',{method:'POST',signal:AbortSignal.timeout(5000)});}catch{}
}
