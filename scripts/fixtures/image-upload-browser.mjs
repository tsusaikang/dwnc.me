import sharp from 'sharp';
import { deflateSync } from 'node:zlib';
import { imageUploadScript } from '../../src/lib/admin-image-upload.ts';

// Synthetic image bytes only. Served by the local fixture, never a production route.
export async function imageUploadBrowserHtml() {
  const width=384,height=256,raw=Buffer.alloc(width*height*4);let seed=17;
  for(let i=0;i<raw.length;i+=4){seed=(seed*1664525+1013904223)>>>0;raw[i]=seed>>>24;raw[i+1]=(i/4)%width%256;raw[i+2]=Math.floor(i/4/width)%256;raw[i+3]=255}
  const make=()=>sharp(raw,{raw:{width,height,channels:4}});
  const opaque=await make().png().toBuffer(),jpeg=await make().jpeg({quality:100}).toBuffer(),oriented=await make().jpeg({quality:100}).withMetadata({orientation:6}).toBuffer();
  const transparent=Buffer.from(raw);transparent[3]=254;
  const alpha=()=>sharp(transparent,{raw:{width,height,channels:4}});
  const gif=await sharp(Buffer.concat([raw,raw]),{raw:{width,height:height*2,channels:4,pageHeight:height}}).gif({loop:0,delay:[100,100]}).toBuffer();
  const webpAnimation=await sharp(Buffer.concat([raw,Buffer.from(raw).fill(200,0,width*4)]),{raw:{width,height:height*2,channels:4,pageHeight:height}}).webp({loop:0,delay:[100,100]}).toBuffer();
  // Minimal real two-frame APNG, including CRCs, frame controls and frame data.
  const crc=data=>{let c=0xffffffff;for(const byte of data){c^=byte;for(let bit=0;bit<8;bit++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0};
  const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
  const control=seq=>{const b=Buffer.alloc(26);b.writeUInt32BE(seq);b.writeUInt32BE(1,4);b.writeUInt32BE(1,8);b.writeUInt16BE(1,20);b.writeUInt16BE(10,22);return b};
  const actl=Buffer.alloc(8);actl.writeUInt32BE(2);const second=Buffer.concat([Buffer.from([0,0,0,2]),deflateSync(Buffer.from([0,0,255,0,255]))]);
  const apng=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('acTL',actl),chunk('fcTL',control(0)),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('fcTL',control(1)),chunk('fdAT',second),chunk('IEND',Buffer.alloc(0))]);
  const items={opaque:{bytes:opaque,type:'image/png'},jpeg:{bytes:jpeg,type:'image/jpeg'},oriented:{bytes:oriented,type:'image/jpeg'},alpha:{bytes:await alpha().png().toBuffer(),type:'image/png'},webp:{bytes:await make().webp({lossless:true}).toBuffer(),type:'image/webp'},alphaWebp:{bytes:await alpha().webp({lossless:true}).toBuffer(),type:'image/webp'},avif:{bytes:await make().avif({lossless:true}).toBuffer(),type:'image/avif'},alphaAvif:{bytes:await alpha().avif({lossless:true}).toBuffer(),type:'image/avif'},gif:{bytes:gif,type:'image/gif'},animatedWebp:{bytes:webpAnimation,type:'image/webp'},apng:{bytes:apng,type:'image/png'}};
  const encoded=Object.fromEntries(Object.entries(items).map(([key,item])=>[key,{...item,bytes:item.bytes.toString('base64')}]));
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>신규 사진 압축 합성 시험</title><h1>신규 사진 압축 합성 시험</h1><p>실제 사진·운영 서버를 사용하지 않습니다.</p><button id="run">브라우저 시험 실행</button><pre id="result">준비됨</pre><script>${imageUploadScript}
const fixtures=${JSON.stringify(encoded)};
async function runUploadBrowserTests(){const results=[],check=(condition,message)=>{if(!condition)throw new Error(message)};
  for(const [name,item] of Object.entries(fixtures)){const source=new File([Uint8Array.from(atob(item.bytes),c=>c.charCodeAt(0))],name+'.'+item.type.split('/')[1],{type:item.type}),output=await normalizeUploadImage(source);const preserved=output===source;
    if(['gif','animatedWebp','apng'].includes(name)){check(preserved,name+' animation changed');results.push({name,preserved,bytes:output.size});continue}
    const bitmap=await createImageBitmap(output,{imageOrientation:'from-image'}),transparent=await uploadBitmapHasTransparency(bitmap),result={name,inputBytes:source.size,outputBytes:output.size,type:output.type,width:bitmap.width,height:bitmap.height,transparent,preserved};bitmap.close();
    if(name==='oriented')check(result.width===256&&result.height===384,'EXIF orientation lost');else check(result.width===384&&result.height===256,'dimensions changed');
    check(transparent===name.startsWith('alpha'),name+' alpha wrong');if(name.startsWith('alpha'))check(output.type==='image/png',name+' should be PNG');else check(output.size<=source.size,name+' got larger');if(['opaque','jpeg','oriented'].includes(name))check(output.type==='image/jpeg',name+' should be JPEG');results.push(result)
  }
  const big=document.createElement('canvas');big.width=6000;big.height=4000;const ctx=big.getContext('2d'),gradient=ctx.createLinearGradient(0,0,6000,4000);gradient.addColorStop(0,'#124');gradient.addColorStop(1,'#fde');ctx.fillStyle=gradient;ctx.fillRect(0,0,6000,4000);const source=new File([await new Promise(resolve=>big.toBlob(resolve,'image/png'))],'large.png',{type:'image/png'});big.width=big.height=1;
  const output=await normalizeUploadImage(source),bitmap=await createImageBitmap(output);check(bitmap.width*bitmap.height<=16000000,'16MP exceeded');check(Math.abs(bitmap.width/bitmap.height-1.5)<0.001,'aspect ratio changed');results.push({name:'24MP',type:output.type,inputBytes:source.size,outputBytes:output.size,width:bitmap.width,height:bitmap.height});bitmap.close();
  try{await normalizeUploadImage(new File(['broken'],'broken.png',{type:'image/png'}));throw new Error('bad input accepted')}catch(error){check(error.message.includes('업로드하지 않았습니다.'),'failure not explicit')}
  return{status:'PASS',results};
}
document.getElementById('run').onclick=async()=>{document.getElementById('result').textContent='진행 중';try{document.getElementById('result').textContent=JSON.stringify(await runUploadBrowserTests(),null,2)}catch(error){document.getElementById('result').textContent=JSON.stringify({status:'FAIL',message:error.message},null,2)}};
</script></html>`;
}
