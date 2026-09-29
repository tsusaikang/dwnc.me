import assert from 'node:assert/strict';
import sharp from 'sharp';
import createCodec from '../public/image-codecs/hdr-codec.js';
import { removeOrphanHdrXmp } from '../public/image-codecs/jpeg-metadata.js';
const segment = (marker, body) => {const h=Buffer.alloc(4);h[0]=255;h[1]=marker;h.writeUInt16BE(body.length+2,2);return Buffer.concat([h,body]);};
const xmp=segment(0xe1,Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"><GainMap Length="395834"/></x:xmpmeta>'));
const plain=await sharp({create:{width:32,height:24,channels:3,background:{r:40,g:120,b:220}}}).withIccProfile('srgb').jpeg().toBuffer();
const inject=(source,...segments)=>Buffer.concat([source.subarray(0,2),...segments,source.subarray(2)]);
const array=buffer=>Uint8Array.from(buffer).buffer;
const normalize=buffer=>Buffer.from(removeOrphanHdrXmp(array(buffer)));
const orphan=inject(plain,xmp);
assert.deepEqual(normalize(orphan),plain,'Only orphan XMP bytes change; pixel stream, ICC and other metadata are byte-identical');
assert.deepEqual(normalize(plain),plain);
const progressive=await sharp({create:{width:40,height:30,channels:3,background:'#c06030'}}).jpeg({progressive:true}).toBuffer();
assert.deepEqual(normalize(inject(progressive,xmp)),progressive,'All progressive entropy scans are traversed');
// Complete marker segments can contain EOI/SOI patterns (EXIF thumbnails).
const thumbnail=segment(0xe1,Buffer.from([69,120,105,102,0,0,255,216,0,255,217]));
assert.deepEqual(normalize(inject(plain,thumbnail,xmp)),inject(plain,thumbnail));
const protectedInputs=[
  Buffer.concat([orphan,plain]), // actual appended gain-map codestream
  Buffer.concat([orphan,Buffer.from([0])]), // any unexplained trailing bytes
  orphan.subarray(0,-2), // truncated EOI
  inject(orphan,segment(0xe2,Buffer.from('MPF\0contract'))),
  inject(orphan,segment(0xe2,Buffer.from('urn:iso:std:iso:ts:21496:-1\0contract'))),
  inject(orphan,segment(0xe1,Buffer.from('http://ns.adobe.com/xmp/extension/\0contract'))),
];
for(const source of protectedInputs) assert.deepEqual(normalize(source),source,'Potential HDR payload/contract or incomplete JPEG must remain untouched');
const codec=await createCodec();
function process(bytes){const p=codec._malloc(bytes.length);codec.HEAPU8.set(bytes,p);const status=codec._dwnc_process(p,bytes.length,2560,80);const result={status,error:codec.UTF8ToString(codec._dwnc_error()),p3:codec._dwnc_p3(),hdr:codec._dwnc_hdr(),bytes:Buffer.from(codec.HEAPU8.slice(codec._dwnc_result_ptr(),codec._dwnc_result_ptr()+codec._dwnc_result_size()))};codec._free(p);codec._dwnc_clear();return result;}
assert.equal(process(orphan).status,1,'Reproduces old orphan-HDR rejection with shipped WASM');
const output=process(normalize(orphan));assert.equal(output.status,0);assert.equal(output.p3,0);assert.equal(output.hdr,0);
const icc=buffer=>{let at=2;while(at+4<=buffer.length){const m=buffer[at+1];if(m===0xda||m===0xd9)break;const n=buffer.readUInt16BE(at+2);if(m===0xe2&&buffer.subarray(at+4,at+16).toString()==='ICC_PROFILE\0')return buffer.subarray(at+4,at+2+n);at+=n+2;}return null;};
assert.deepEqual(icc(output.bytes),icc(plain),'WASM output retains original ICC bytes');
for(const source of protectedInputs.slice(0,2)) assert.equal(process(normalize(source)).status,1,'Unsupported HDR containers still fail rather than flatten');
console.log(JSON.stringify({suite:'jpeg-metadata',status:'PASS',behavior:'orphan legacy XMP only; complete JPEG including progressive; ICC/pixel preservation; real WASM regression; appended/MPF/ISO/extended/truncated inputs unchanged'}));
