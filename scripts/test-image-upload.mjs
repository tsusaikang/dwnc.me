import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { imageUploadScript } from '../src/lib/admin-image-upload.ts';

let alpha=255,dimensions={width:2000,height:1500},encodeBytes=1000,encodeFails=false,closed=0,draws=0,decodes=0;
const canvases=[];
let workerMode='normal',workersCreated=0,workersTerminated=0,workerRequests=0;
class CodecWorker {
  constructor(url,options){assert.equal(url,'/image-codecs/hdr-worker.js');assert.equal(options.type,'module');if(workerMode==='constructor')throw new Error('blocked');workersCreated++}
  postMessage(message,transfer){const transferred=structuredClone(message,{transfer});workerRequests++;assert.equal(transferred.maxEdge,2560);assert.equal(transferred.quality,80);assert.ok(transferred.buffer instanceof ArrayBuffer);assert.equal(message.buffer.byteLength,0,'Input bytes are transferred, not copied');queueMicrotask(()=>{
    if(workerMode==='error'){this.onerror();return}if(workerMode==='messageerror'){this.onmessageerror();return}if(workerMode==='timeout')return;
    const ratio=Math.min(1,2560/Math.max(dimensions.width,dimensions.height)),buffer=new Uint8Array(encodeBytes);buffer.set([255,216,255]);
    this.onmessage({data:encodeFails?{ok:false,error:'synthetic codec failure'}:{ok:true,buffer:buffer.buffer,metadata:{width:workerMode==='oversize'?3000:Math.floor(dimensions.width*ratio),height:Math.floor(dimensions.height*ratio),inputWidth:dimensions.width,inputHeight:dimensions.height,hdr:true,p3:true}}});
  })}
  terminate(){workersTerminated++}
}

const context=vm.createContext({Uint8Array,ArrayBuffer,DataView,Math,Number,String,Error,Promise,File,Blob,Worker:CodecWorker,clearTimeout,setTimeout:(callback,delay)=>setTimeout(callback,workerMode==='timeout'&&delay===120000?0:delay),createImageBitmap:async(_file,options)=>{assert.equal(options.imageOrientation,'from-image');decodes++;return{...dimensions,close(){closed++}}},document:{createElement(tag){assert.equal(tag,'canvas');const c={width:0,height:0,getContext(){return{clearRect(){},drawImage(){draws++},getImageData(){return{data:Uint8Array.of(0,0,0,alpha)}}}},toBlob(callback,mime,quality){assert.equal(quality,0.8);callback(encodeFails?null:new Blob([new Uint8Array(encodeBytes)],{type:mime}))}};canvases.push(c);return c}}});
vm.runInContext(imageUploadScript,context);
const inspect=(bytes,mime)=>context.inspectUploadImage(Uint8Array.from(bytes),mime);
const chunk=(type,data=Buffer.alloc(0))=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);return b};
const png=(extra=[],depth=8,color=6)=>{const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2);ihdr.writeUInt32BE(2,4);ihdr[8]=depth;ihdr[9]=color;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...extra,chunk('IDAT',Buffer.alloc(2000)),chunk('IEND')])};
const riff=(chunks)=>{const body=Buffer.concat(chunks.map(([type,data])=>{const c=Buffer.alloc(8+data.length+(data.length%2));c.write(type);c.writeUInt32LE(data.length,4);data.copy(c,8);return c}));const h=Buffer.alloc(12);h.write('RIFF');h.writeUInt32LE(body.length+4,4);h.write('WEBP',8);return Buffer.concat([h,body])};
const avif=(brand,compat=[],extra='')=>{const f=Buffer.alloc(16+compat.length*4);f.writeUInt32BE(f.length);f.write('ftyp',4);f.write(brand,8);compat.forEach((s,i)=>f.write(s,16+i*4));if(!extra)return f;const tail=Buffer.alloc(8);tail.writeUInt32BE(8);tail.write(extra,4);return Buffer.concat([f,tail])};
assert.equal(inspect(png(),'image/png').preserve,false);
assert.equal(inspect(png([chunk('acTL',Buffer.alloc(8))]),'image/png').preserve,true);
assert.equal(inspect(png([],16),'image/png').preserve,true);
assert.equal(inspect(png([],16,2),'image/png').preserve,false);
assert.equal(inspect(png([chunk('tRNS')],16,2),'image/png').preserve,true);
assert.equal(inspect(riff([['VP8L',Buffer.alloc(1)]]),'image/webp').preserve,false);
for(const chunks of [[['VP8X',Buffer.from([2])],['VP8L',Buffer.alloc(1)]],[['ANIM',Buffer.alloc(6)],['ANMF',Buffer.alloc(1)]]])assert.equal(inspect(riff(chunks),'image/webp').preserve,true);
assert.equal(inspect(avif('avif',['mif1']),'image/avif').preserve,false);
for(const b of [avif('avis'),avif('avif',['avis']),avif('avif',['msf1']),avif('avif',[],'moov')])assert.equal(inspect(b,'image/avif').preserve,true);
assert.equal(inspect(Buffer.from('GIF89a'),'image/gif').preserve,true);
for(const [bytes,mime] of [[Buffer.alloc(9),'image/png'],[png().subarray(0,36),'image/png'],[riff([['VP8L',Buffer.alloc(1)]]).subarray(0,20),'image/webp'],[avif('heic'),'image/avif'],[Buffer.alloc(1),'image/jpeg'],[Buffer.alloc(1),'image/heic']])assert.throws(()=>inspect(bytes,mime),/업로드하지 않았습니다/);
const file=(bytes=png(),name='사진.png',type='image/png')=>new File([bytes],name,{type,lastModified:1234});
let source=file(),output=await context.normalizeUploadImage(source);
assert.equal(output.type,'image/jpeg');assert.equal(output.name,'사진.jpg');assert.equal(output.size,1000);assert.equal(output.lastModified,1234);assert.equal(source.type,'image/png');assert.equal(closed,1);assert.ok(canvases.every(c=>c.width===1&&c.height===1));
alpha=254;output=await context.normalizeUploadImage(source);assert.equal(output,source,'A single almost-opaque pixel prevents JPEG conversion');
alpha=0;dimensions={width:5000,height:4000};output=await context.normalizeUploadImage(source);assert.equal(output.type,'image/png');assert.equal(output.name,'사진.png');
const limit=context.uploadImageDimensions(5000,4000);assert.equal(Math.max(limit.width,limit.height),2560);assert.ok(Math.abs(limit.width/limit.height-1.25)<0.001);assert.equal(context.uploadImageDimensions(1200,800).width,1200,'Small images are never enlarged');assert.equal(context.uploadImageDimensions(1000,10000).height,2560,'Tall narrow images obey the edge limit too');
alpha=255;dimensions={width:2000,height:1500};encodeBytes=10000;output=await context.normalizeUploadImage(source);assert.equal(output,source,'Do not enlarge an efficient small PNG');
source=file(Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(2000)]),'photo.jpeg','image/jpeg');output=await context.normalizeUploadImage(source);assert.equal(output,source);
dimensions={width:6000,height:4000};output=await context.normalizeUploadImage(source);assert.notEqual(output,source,'Pixel limit still applies when resizing produces more bytes');assert.equal(output.type,'image/jpeg');
encodeFails=true;await assert.rejects(context.normalizeUploadImage(source),/HDR와 색상.*업로드하지 않았습니다/);encodeFails=false;
encodeFails=true;await assert.rejects(context.normalizeUploadImage(file()),/업로드하지 않았습니다/);encodeFails=false;
for(const mode of ['constructor','error','messageerror','timeout','oversize']){workerMode=mode;await assert.rejects(context.normalizeUploadImage(source),/HDR와 색상.*업로드하지 않았습니다/)}workerMode='normal';
assert.equal(workersCreated,workersTerminated,'Every created worker is terminated after success or failure');assert.ok(workerRequests>0);assert.ok(source.size>0,'Transferring a read buffer never mutates the original File');

await assert.rejects(context.normalizeUploadImage(new File([new Uint8Array(25*1024*1024+1)],'big.jpg',{type:'image/jpeg'})),/25MB/);
const oldDecodes=decodes;for(const source of [file(png([chunk('acTL',Buffer.alloc(8))])),file(Buffer.from('GIF89a'),'move.gif','image/gif'),file(avif('avis'),'move.avif','image/avif')])assert.equal(await context.normalizeUploadImage(source),source);assert.equal(decodes,oldDecodes,'Animation bypasses first-frame decode');
const ui=await readFile(new URL('../src/lib/admin-ui.ts',import.meta.url),'utf8');
assert.match(ui,/const f=await normalizeUploadImage\(original\).*f\.arrayBuffer\(\)/s);assert.match(ui,/'content-type':f.type,'x-dwnc-file-size':String\(f.size\),'x-dwnc-file-sha256':hash,'x-dwnc-file-name':encodeURIComponent\(f.name\)/);
assert.match(ui,/uploadQueue=files;.*action\(uploadImage\)/);assert.match(ui,/\$\('upload'\).onclick=\(\)=>action\(uploadImage\)/);
console.log(JSON.stringify({suite:'image-upload',status:'PASS',behavior:'container animation/16bit-alpha preservation, actual alpha boundary, 2560px longest edge, JPEG quality, byte-growth avoidance, transformed upload contract, resource cleanup, explicit failure, HDR/P3 worker transfer/timeout/cleanup/no silent fallback, shared picker/paste'}));
