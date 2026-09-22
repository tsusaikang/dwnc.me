// Browser-only upload preparation, shared by file input and clipboard images.
// Animation detection uses container records, never a first-frame canvas guess.
export const imageUploadScript = String.raw`
const uploadImageMaxBytes=25*1024*1024,uploadImageMaxPixels=16000000,uploadJpegQuality=0.85;
function uploadImageError(message){return new Error(message+' 원본 파일은 바뀌지 않았으며 이 사진은 업로드하지 않았습니다.')}
function inspectUploadImage(bytes,mime){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(at,n)=>String.fromCharCode(...bytes.subarray(at,at+n)),bad=()=>{throw uploadImageError('사진 형식이나 파일 내용이 올바르지 않습니다.')};
  if(mime==='image/jpeg'){if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)bad();return{preserve:false}}
  if(mime==='image/gif'){if(!['GIF87a','GIF89a'].includes(text(0,6)))bad();return{preserve:true}}
  if(mime==='image/png'){
    if(bytes.length<33||text(1,3)!=='PNG'||bytes[0]!==137||text(12,4)!=='IHDR')bad();
    let animated=false,precisionAlpha=false,ended=false;
    const depth=bytes[24],color=bytes[25];
    for(let at=8;at+12<=bytes.length;){const size=view.getUint32(at),kind=text(at+4,4);if(size>bytes.length-at-12)bad();if(kind==='acTL')animated=true;if(depth===16&&(color===4||color===6||kind==='tRNS'))precisionAlpha=true;at+=size+12;if(kind==='IEND'){ended=true;break}}
    if(!ended)bad();
    // An 8-bit canvas can round nearly opaque 16-bit alpha to opaque. Keep those
    // rare originals rather than incorrectly removing their transparency.
    return{preserve:animated||precisionAlpha};
  }
  if(mime==='image/webp'){
    if(bytes.length<20||text(0,4)!=='RIFF'||text(8,4)!=='WEBP'||view.getUint32(4,true)+8!==bytes.length)bad();
    let animated=false,found=false;
    for(let at=12;at+8<=bytes.length;){const size=view.getUint32(at+4,true),kind=text(at,4);if(size>bytes.length-at-8)bad();if(kind==='ANIM'||kind==='ANMF'||kind==='VP8X'&&size>=1&&(bytes[at+8]&2))animated=true;if(['VP8 ','VP8L','ANMF'].includes(kind))found=true;at+=8+size+(size%2)}
    if(!found)bad();return{preserve:animated};
  }
  if(mime==='image/avif'){
    let brands=[],sequence=false;
    for(let at=0;at+8<=bytes.length;){let size=view.getUint32(at),header=8;const kind=text(at+4,4);if(size===1){if(at+16>bytes.length)bad();size=Number(view.getBigUint64(at+8));header=16}if(size===0)size=bytes.length-at;if(!Number.isSafeInteger(size)||size<header||size>bytes.length-at)bad();if(kind==='ftyp'){if(size<header+8||(size-header)%4)bad();brands.push(text(at+header,4));for(let p=at+header+8;p<at+size;p+=4)brands.push(text(p,4))}if(kind==='moov')sequence=true;at+=size}
    if(!brands.some(brand=>brand==='avif'||brand==='avis'))bad();return{preserve:sequence||brands.includes('avis')||brands.includes('msf1')};
  }
  throw uploadImageError('사진은 AVIF·GIF·JPEG·PNG·WebP 형식만 지원합니다. HEIC 사진은 JPEG로 내보낸 뒤 올려 주세요.');
}
function uploadImageDimensions(width,height){const ratio=Math.min(1,Math.sqrt(uploadImageMaxPixels/(width*height)));return{width:Math.max(1,Math.floor(width*ratio)),height:Math.max(1,Math.floor(height*ratio))}}
function uploadCanvasBlob(canvas,mime){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob&&blob.type===mime?resolve(blob):reject(uploadImageError('브라우저에서 사진을 변환하지 못했습니다.')),mime,uploadJpegQuality))}
async function uploadBitmapHasTransparency(bitmap){
  const tile=document.createElement('canvas');tile.width=Math.min(1024,bitmap.width);tile.height=Math.min(1024,bitmap.height);
  try{const context=tile.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('canvas');
    for(let y=0;y<bitmap.height;y+=tile.height){for(let x=0;x<bitmap.width;x+=tile.width){const width=Math.min(tile.width,bitmap.width-x),height=Math.min(tile.height,bitmap.height-y);context.clearRect(0,0,tile.width,tile.height);context.drawImage(bitmap,x,y,width,height,0,0,width,height);const pixels=context.getImageData(0,0,width,height).data;for(let i=3;i<pixels.length;i+=4)if(pixels[i]<255)return true}await new Promise(resolve=>setTimeout(resolve,0))}return false;
  }finally{tile.width=tile.height=1}
}
async function normalizeUploadImage(file){
  if(file.size<1||file.size>uploadImageMaxBytes)throw uploadImageError('사진은 한 장당 25MB 이하만 올릴 수 있습니다.');
  let bitmap,canvas;
  try{
    const info=inspectUploadImage(new Uint8Array(await file.arrayBuffer()),file.type);if(info.preserve)return file;
    bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});if(!bitmap.width||!bitmap.height)throw new Error('dimensions');
    const transparent=file.type!=='image/jpeg'&&await uploadBitmapHasTransparency(bitmap),size=uploadImageDimensions(bitmap.width,bitmap.height),resized=size.width!==bitmap.width||size.height!==bitmap.height;
    // Existing transparent PNG pixels need no re-encoding when within the limit.
    if(transparent&&file.type==='image/png'&&!resized)return file;
    canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext('2d');if(!context)throw new Error('canvas');context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(bitmap,0,0,size.width,size.height);
    const mime=transparent?'image/png':'image/jpeg',blob=await uploadCanvasBlob(canvas,mime);
    if(blob.size>uploadImageMaxBytes)throw uploadImageError('투명도를 보존한 사진이 업로드 한도를 넘습니다. 사진 크기를 줄인 뒤 다시 올려 주세요.');
    // Do not enlarge already efficient images or add another lossy generation.
    // Opaque PNGs still normally become JPEG; tiny flat graphics may stay PNG.
    if(!resized&&!transparent&&blob.size>=file.size)return file;
    const stem=(file.name||'image').replace(/\.[^.]*$/u,'')||'image';
    return new File([blob],stem+(transparent?'.png':'.jpg'),{type:mime,lastModified:file.lastModified});
  }catch(error){if(error?.message?.includes('이 사진은 업로드하지 않았습니다.'))throw error;throw uploadImageError('사진을 읽거나 압축하지 못했습니다. 다른 사진으로 다시 시도하거나 JPEG·PNG로 내보낸 뒤 올려 주세요.');}
  finally{bitmap?.close();if(canvas)canvas.width=canvas.height=1}
}
`;
