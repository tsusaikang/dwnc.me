import { imageUploadScript } from './admin-image-upload.ts';

// Authenticated, local-only reproduction of the real editor preparation path.
// There is deliberately no content API call or upload operation on this page.
export function imageProcessingCheckHtml() {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>사진 처리 확인</title>
<style>body{max-width:900px;margin:40px auto;padding:20px;font:17px/1.6 system-ui}button,input{font:inherit;margin:10px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f3f4;padding:20px}</style>
<h1>사진 처리 확인</h1><p>선택한 사진은 이 브라우저 안에서만 처리합니다. 사진을 서버로 전송하거나 글을 저장·변경하지 않습니다.</p>
<input id="photo" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif"><br><button id="run" type="button">사진 처리 확인</button><pre id="result" aria-live="polite">사진을 선택해 주세요.</pre>
<script>${imageUploadScript}
const output=document.getElementById('result'),button=document.getElementById('run');
const report=value=>{output.textContent+=JSON.stringify(value,null,2)+'\\n';};
document.addEventListener('securitypolicyviolation',event=>report({securityPolicy:event.violatedDirective,blockedURI:event.blockedURI}));
button.addEventListener('click',async()=>{
  const file=document.getElementById('photo').files[0];if(!file){output.textContent='사진을 선택해 주세요.';return;}
  button.disabled=true;output.textContent='';
  try{
    for(const asset of ['hdr-worker.js','jpeg-metadata.js','hdr-codec.js','hdr-codec.wasm']){
      try{const response=await fetch('/image-codecs/'+asset,{cache:'no-store'});const bytes=await response.arrayBuffer();report({asset,status:response.status,type:response.headers.get('content-type'),bytes:bytes.byteLength,redirected:response.redirected,detail:response.ok?undefined:new TextDecoder().decode(bytes).slice(0,500)});}
      catch(error){report({asset,error:error.message});}
    }
    const started=performance.now(),result=await normalizeUploadImage(file);
    report({ok:true,inputBytes:file.size,outputBytes:result.size,type:result.type,elapsedMs:Math.round(performance.now()-started)});
  }catch(error){report({ok:false,code:error.code,message:error.message,cause:error.cause?.message||null});}
  finally{button.disabled=false;}
});</script></html>`;
}
