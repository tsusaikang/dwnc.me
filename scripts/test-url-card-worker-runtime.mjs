import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Run the production metadata code with workerd Request/fetch semantics. A
// service fixture supplies DNS and HTML without making internet requests.
const compiled=await build({
  stdin:{contents:`import {resolveCardHtml} from './src/lib/url-link-cards.ts';
    export default {async fetch(request,env){
      return new Response(await resolveCardHtml(new URL(request.url).searchParams.get('target'),[],(input,init)=>env.ORIGIN.fetch(input,init)));
    }};`,resolveDir:process.cwd(),sourcefile:'url-card-runtime-entry.ts'},
  bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'
});
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[
  {name:'metadata-check',modules:true,compatibilityDate:'2026-08-24',script:compiled.outputFiles[0].text,serviceBindings:{ORIGIN:'metadata-fixture'}},
  {name:'metadata-fixture',modules:true,compatibilityDate:'2026-08-24',script:`
    export default {fetch(request){
      const url=new URL(request.url);
      if(url.hostname==='cloudflare-dns.com'){
        if(url.searchParams.get('name')==='dns-redirect.example')return Response.redirect('https://blocked.example/',302);
        return Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]});
      }
      if(url.hostname==='redirect.example')return Response.redirect('https://final.example/',302);
      return new Response('<head><title>External preview runtime title</title></head>',{headers:{'content-type':'text/html'}});
    }};`}
]}));
try{
  for(const target of ['https://external.example/','https://redirect.example/']){
    const response=await runtime.dispatchFetch('http://localhost/?target='+encodeURIComponent(target));
    assert.equal(response.status,200);
    assert.match(await response.text(),/External preview runtime title/);
  }
  const rejected=await runtime.dispatchFetch('http://localhost/?target=https://dns-redirect.example/');
  assert.doesNotMatch(await rejected.text(),/External preview runtime title/);
  console.log('URL card workerd DNS, metadata and redirect regression passed');
}finally{await runtime.dispose();}
