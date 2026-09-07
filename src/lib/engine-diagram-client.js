// Authored public Tistory /165 diagram, reviewed and scoped to this component.
// No network, evaluation, storage or arbitrary post scripts.
export function mountEngineDiagram(root) {
if (!root || root.dataset.engineMounted) return () => {};
const byId = (id) => root.querySelector('[id="'+id+'"]');
const lifetime = new AbortController();
let frame = 0;
const cleanup = () => { cancelAnimationFrame(frame); lifetime.abort(); observer?.disconnect(); delete root.dataset.engineMounted; };
root.dataset.engineMounted = 'true';
'use strict';

// ============ Mode definitions ============
const MODES = {
  v8: {
    label:'V8 (기준)', bank:90, split:0, ghost:false,
    throws:[{x:-3,baseAngle:0},{x:-1,baseAngle:90},{x:1,baseAngle:180},{x:3,baseAngle:270}],
    events:[
      {throwIdx:0,bank:'L',angle:0},{throwIdx:3,bank:'R',angle:90},
      {throwIdx:1,bank:'R',angle:180},{throwIdx:1,bank:'L',angle:270},
      {throwIdx:2,bank:'R',angle:360},{throwIdx:2,bank:'L',angle:450},
      {throwIdx:3,bank:'L',angle:540},{throwIdx:0,bank:'R',angle:630},
    ],
    formula:`8기통 모두 <span class="v6x-num">90°</span> 간격 + 실제 점화순서 1-8-4-3-6-5-7-2 → 뱅크가 번갈아 섞여서 점화`,
    caption:`기준이 되는 V8입니다. 저널(크랭크핀) 4개가 서로 <b>90°씩</b> 떨어져 있고, 뱅크각도 90°라 720°÷8=90°가 정확히
      맞아떨어져서 8개 실린더 전부 90° 간격으로 폭발합니다. 다만 "어느 저널이 몇 번째로 터지는가"는 간격과는 별개 문제인데,
      실제 GM 스몰블록 계열의 대표적인 점화순서 1-8-4-3-6-5-7-2를 그대로 반영해뒀습니다. 홀수 실린더(1,3,5,7)를 L뱅크,
      짝수(2,4,6,8)를 R뱅크로 앞→뒤 순서 배치하는 관례를 따르면 1=L1, 2=R1, 3=L2, 4=R2, 5=L3, 6=R3, 7=L4, 8=R4가 되고,
      점화순서를 풀어보면 L1→R4→R2→L2→R3→L3→L4→R1처럼 <b>한쪽 뱅크를 몰아서 쏘지 않고 거의 매번 뱅크가 번갈아
      섞이도록</b> 되어 있습니다(배기 펄스 분산·크랭크 하중 분산 목적). 간격이 90°로 균등한 것과, 그 90°마다 어느 실린더가
      배정되는지는 서로 독립적인 설계 변수라는 걸 보여주는 예시입니다.`
  },
  naive: {
    label:'그냥 잘랐다면(가상)', bank:90, split:0, ghost:true,
    throws:[{x:-3,baseAngle:0},{x:-1,baseAngle:90},{x:1,baseAngle:180}],
    ghostX:3,
    events:[
      {throwIdx:0,bank:'R',angle:0},{throwIdx:2,bank:'R',angle:180},
      {throwIdx:1,bank:'R',angle:270},{throwIdx:1,bank:'L',angle:360},
      {throwIdx:0,bank:'L',angle:450},{throwIdx:2,bank:'L',angle:630},
    ],
    formula:`저널 간격을 V8 그대로(0°,90°,180°) 두고 4번 저널만 들어내면 → <span class="v6x-num">180-90-90-90-180-90</span>로 앞뒤에 공백`,
    caption:`말씀하신 "저널 하나만 물리적으로 잘라내고 나머지 3개는 원래 V8 자리(0°,90°,180°)에 그대로 둔다면"을
      실제로 계산해본 가상 시나리오입니다. 잘려나간 4번 저널(오른쪽 끝, 회색 점선 상자)이 원래 담당하던 R4(90°)·L4(540°) 두
      점화가 통째로 사라지면서, 그 자리에 <b>180°</b>짜리 공백이 두 군데 생깁니다. 특히 사이클이 시작하자마자(0°→180°) 아무
      점화도 없이 한참을 그냥 도는 구간이 바로 나오는 게 이 가상 시나리오의 핵심 문제입니다. 실제 엔진은 이 방식을 쓰지 않았습니다.`
  },
  real: {
    label:'실제 90° V6(무보정)', bank:90, split:0, ghost:false,
    throws:[{x:-2,baseAngle:0},{x:0,baseAngle:120},{x:2,baseAngle:240}],
    events:[
      {throwIdx:0,bank:'R',angle:0},{throwIdx:0,bank:'L',angle:90},
      {throwIdx:1,bank:'R',angle:240},{throwIdx:1,bank:'L',angle:330},
      {throwIdx:2,bank:'R',angle:480},{throwIdx:2,bank:'L',angle:570},
    ],
    formula:`저널 3개를 새로 <span class="v6x-num">120°</span> 간격 재배치 + 스플릿 0° → 간격 90°/150° 반복 (실제 역사)`,
    caption:`실제로 존재했던 90° V6(뷰익 3.8L, 쉐보레 4.3L 등)입니다. 저널이 3개로 줄면서 그 3개는
      <b>새로 120°씩 고르게</b> 재배치됐습니다(V8의 90° 간격을 그대로 쓴 게 아니에요). 다만 핀을 쪼개는 추가 공정은
      생략(스플릿 0°)했기 때문에, 뱅크각 90°만큼만 반영돼 <b>90°-150° 반복</b>이 나옵니다. 가상 시나리오보다는
      훨씬 낫지만 완전 균등(120°)엔 못 미치는, 실제 "홀수점화" 상태입니다.`
  },
  split: {
    label:'90° V6 스플릿핀', bank:90, split:30, ghost:false,
    throws:[{x:-2,baseAngle:0},{x:0,baseAngle:120},{x:2,baseAngle:240}],
    events:[
      {throwIdx:0,bank:'R',angle:0},{throwIdx:0,bank:'L',angle:120},
      {throwIdx:1,bank:'R',angle:240},{throwIdx:1,bank:'L',angle:360},
      {throwIdx:2,bank:'R',angle:480},{throwIdx:2,bank:'L',angle:600},
    ],
    formula:`120° 저널 배치 + 스플릿 <span class="v6x-num">30°</span> 추가 → 모든 간격 120°로 균등`,
    caption:`위 상태에서 저널마다 핀을 30°씩 쪼개(스플릿) 넣은 개선판입니다(1977년 뷰익, 1985년 쉐보레 4.3L).
      저널 3개의 배치(120°씩)는 그대로 두고, 각 저널 안에서 L·R 핀만 살짝 더 벌려 90°+30°=120°를 만든 거예요.
      3D에서 저널 부분을 보면 핀이 하나가 아니라 살짝 두 개로 갈라져 있는 게 보일 겁니다.`
  },
  sixty: {
    label:'60° V6', bank:60, split:60, ghost:false,
    throws:[{x:-2,baseAngle:0},{x:0,baseAngle:120},{x:2,baseAngle:240}],
    events:[
      {throwIdx:0,bank:'R',angle:0},{throwIdx:0,bank:'L',angle:120},
      {throwIdx:1,bank:'R',angle:240},{throwIdx:1,bank:'L',angle:360},
      {throwIdx:2,bank:'R',angle:480},{throwIdx:2,bank:'L',angle:600},
    ],
    formula:`120° 저널 배치(처음부터 새 설계) + 스플릿 <span class="v6x-num">60°</span> 내장 → 균등 120° (V8 이력 없음)`,
    caption:`요즘 LGX 같은 60° V6입니다. V8에서 잘라낸 적이 없는 클린시트 설계라, 처음부터 저널 3개(120°)와
      필요한 60° 스플릿을 도면에 반영해서 나옵니다. 결과 숫자(120° 균등)는 스플릿핀 버전과 같지만, "일단 싸게 냈다가
      나중에 고친" 역사가 아예 없다는 점이 다릅니다.`
  }
};

let currentMode = 'v8';
let angle = 0;
let playing = true;
let speed = 0.5;
let autoRotate = false;
let lastT = null;

// ============ Tiny 3D engine (no external deps) ============
const canvas = byId('v6x-canvas');
if (!canvas || !canvas.getContext) return () => {};
const ctx = canvas.getContext('2d');
if (!ctx) return () => {};
const wrap = byId('v6x-canvasWrap');

function resizeCanvas(){
  const dpr = Math.min(window.devicePixelRatio||1, 2);
  const w = wrap.clientWidth, h = wrap.clientHeight;
  canvas.width = w*dpr; canvas.height = h*dpr;
  canvas.style.width = w+'px'; canvas.style.height = h+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize', resizeCanvas, {signal: lifetime.signal});
const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resizeCanvas) : null;
observer?.observe(root);

let azimuth = 0.7, polar = 1.15, camDist = 11.5;
const focal = 480;

const VIEW_PRESETS = {
  diag: {azimuth:0.7, polar:1.15},
  side: {azimuth:0.001, polar:1.02},      // looking along -Z, shaft horizontal, stroke motion visible
  end:  {azimuth:Math.PI/2, polar:1.35},  // looking down the shaft axis, journal angles visible like a clock face
};
function setView(name){
  const v = VIEW_PRESETS[name];
  azimuth = v.azimuth; polar = v.polar;
  root.querySelectorAll('.v6x-viewBtns button').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
}
root.querySelectorAll('.v6x-viewBtns button').forEach(btn=>{
  btn.addEventListener('click', ()=>{ autoRotate=false; setView(btn.dataset.view); });
});

function getBasis(){
  const cx = camDist*Math.sin(polar)*Math.sin(azimuth);
  const cy = camDist*Math.cos(polar);
  const cz = camDist*Math.sin(polar)*Math.cos(azimuth);
  const cam = {x:cx, y:cy+0.3, z:cz};
  const target = {x:0,y:0.3,z:0};
  const fx=target.x-cam.x, fy=target.y-cam.y, fz=target.z-cam.z;
  const flen=Math.hypot(fx,fy,fz);
  const f = {x:fx/flen,y:fy/flen,z:fz/flen};
  const upW = {x:0,y:1,z:0};
  let rx=f.y*upW.z-f.z*upW.y, ry=f.z*upW.x-f.x*upW.z, rz=f.x*upW.y-f.y*upW.x;
  const rlen=Math.hypot(rx,ry,rz)||1;
  const right={x:rx/rlen,y:ry/rlen,z:rz/rlen};
  const up = {
    x: right.y*f.z-right.z*f.y,
    y: right.z*f.x-right.x*f.z,
    z: right.x*f.y-right.y*f.x
  };
  return {cam, f, right, up};
}

function project(p, basis){
  const dx=p.x-basis.cam.x, dy=p.y-basis.cam.y, dz=p.z-basis.cam.z;
  const vx = dx*basis.right.x+dy*basis.right.y+dz*basis.right.z;
  const vy = dx*basis.up.x+dy*basis.up.y+dz*basis.up.z;
  const vz = dx*basis.f.x+dy*basis.f.y+dz*basis.f.z; // depth, positive in front
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const safeZ = Math.max(vz, 0.2);
  return {
    x: w/2 + Math.min(focal,w*0.8)*vx/safeZ,
    y: h/2 - Math.min(focal,w*0.8)*vy/safeZ,
    depth: vz,
    scale: Math.min(focal,w*0.8)/safeZ
  };
}

// drag interaction
let dragging=false,lastX=0,lastY=0;
wrap.addEventListener('pointerdown', e=>{dragging=true; lastX=e.clientX; lastY=e.clientY; autoRotate=false;});
window.addEventListener('pointerup', ()=>dragging=false, {signal: lifetime.signal});
window.addEventListener('pointermove', e=>{
  if(!dragging) return;
  const dx=e.clientX-lastX, dy=e.clientY-lastY;
  lastX=e.clientX; lastY=e.clientY;
  azimuth -= dx*0.008;
  polar = Math.min(2.5, Math.max(0.35, polar - dy*0.006));
}, {signal: lifetime.signal});
wrap.addEventListener('dblclick', ()=>{autoRotate=!autoRotate;});

function deg2rad(d){return d*Math.PI/180;}
function lerp(a,b,t){return a+(b-a)*t;}

function hexToRgb(hex){
  const n = parseInt(hex.slice(1),16);
  return {r:(n>>16)&255, g:(n>>8)&255, b:n&255};
}
function shade(hex, factor){
  const c = hexToRgb(hex);
  const r=Math.round(lerp(0,c.r,factor)+lerp(255,0,factor)*0), g=c.g,b=c.b; // placeholder unused
  return `rgb(${Math.round(c.r*factor)},${Math.round(c.g*factor)},${Math.round(c.b*factor)})`;
}

const COL_L='#3b6ea5', COL_R='#c8622a', COL_PIN='#9a9890', COL_SHAFT='#8c8a83', COL_ROD='#b9b6ab';

function isDark(){ return window.matchMedia('(prefers-color-scheme: dark)').matches; }

// ============ Scene state ============
let sceneObjs; // rebuilt per mode: {throws, minX, maxX, bank, split, ghost, ghostX, events}

function buildScene(mode){
  const minX = Math.min(...mode.throws.map(t=>t.x)) - 1.2;
  const maxXraw = mode.ghost ? Math.max(...mode.throws.map(t=>t.x), mode.ghostX) : Math.max(...mode.throws.map(t=>t.x));
  const maxX = maxXraw + 1.2;
  return {mode, minX, maxX};
}

function nearestEventDelta(events, throwIdx, bank, a){
  let minD=9999;
  events.forEach(ev=>{
    if(ev.throwIdx===throwIdx && ev.bank===bank){
      let d=Math.abs(a-ev.angle); d=Math.min(d,720-d);
      if(d<minD) minD=d;
    }
  });
  return minD;
}

function mod360(x){ return ((x%360)+360)%360; }

const CRANK_R = 0.85;   // crank throw radius
const ROD_LEN = 1.95;   // connecting rod length (fixed, > CRANK_R so the mechanism never locks up)

// Exact slider-crank solve: given the pin's (y,z) position and the bore's axis direction,
// find how far along that axis the piston sits so the rod (pin -> piston) has EXACTLY
// length ROD_LEN. This is the real constraint a physical rod enforces, so the rod never
// stretches and the piston's motion is a continuous function of crank angle (no freezing).
function solvePistonDist(pinYZ, dir){
  const dotDP = dir.y*pinYZ.y + dir.z*pinYZ.z;
  const magP2 = pinYZ.y*pinYZ.y + pinYZ.z*pinYZ.z;
  const disc = Math.max(0, dotDP*dotDP - magP2 + ROD_LEN*ROD_LEN);
  return dotDP + Math.sqrt(disc); // take the outward-facing root
}

function computeFrame(a){
  const mode = sceneObjs.mode;
  const bankRad = deg2rad(mode.bank/2);
  // Bank direction = rotate the world "up" vector (0,1,0) around the shaft (X) axis by ±bankRad.
  // This makes the V's bisector point straight up (+Y), matching how the engine actually
  // sits (upright), instead of tipping the whole V onto its side.
  const dL = {x:0, y:Math.cos(bankRad), z:-Math.sin(bankRad)};
  const dR = {x:0, y:Math.cos(bankRad), z:Math.sin(bankRad)};

  // Pin-orbit angle (deg) at which the pin geometrically lines up with a given bank axis.
  const refR = 90 - mode.bank/2;
  const refL = 90 + mode.bank/2;

  const items = [];
  if(mode.ghost) items.push({type:'ghost', x:mode.ghostX});

  const boreMin = ROD_LEN-CRANK_R-0.35, boreMax = ROD_LEN+CRANK_R+0.15, boreR = 0.5;

  // A real crankshaft is NOT one continuous rod -- it's a chain of on-axis main journals
  // (which sit in the block's main bearings) linked by pairs of webs that jog out to each
  // offset pin and back. We collect every pin's exact X-span here so the main-journal
  // segments below can stop exactly at each web instead of running straight through it.
  const pinSpans = []; // {x0, x1, y, z, tag, shared}
  const pinPosByThrow = []; // per-throw {L, R}

  mode.throws.forEach((th, idx)=>{
    // baseAngle is derived (not hand-tuned) so that this throw's R-pin geometrically
    // aligns with the R bank's axis at exactly the crank angle history says it should fire.
    const phase0R = mod360(mode.events.find(e=>e.throwIdx===idx && e.bank==='R').angle);
    const baseAngle = mod360(refR - phase0R);

    // For a split crank the L pin trails the R pin by exactly the split offset (derived from
    // the same geometry, see the message-by-message derivation); for a shared (unsplit) pin
    // there is only one physical pin, used by both banks as it sweeps past each axis in turn.
    const pinDefs = mode.split===0
      ? [{tag:'R', extra:0, xo:0, half:0.32, shared:true}]
      : [{tag:'R', extra:0, xo:-0.22, half:0.16, shared:false},
         {tag:'L', extra:-mode.split, xo:0.22, half:0.16, shared:false}];

    const pinPosByTag = {};
    pinDefs.forEach(pd=>{
      const ang = deg2rad(a + baseAngle + pd.extra);
      const pos = {x:th.x+pd.xo, y:CRANK_R*Math.sin(ang), z:CRANK_R*Math.cos(ang)};
      const color = pd.shared?COL_PIN:(pd.tag==='L'?COL_L:COL_R);
      items.push({type:'pin', pos, len:pd.half*2, r: pd.shared?0.24:0.2, color});
      pinSpans.push({x0:pos.x-pd.half, x1:pos.x+pd.half, y:pos.y, z:pos.z, color});
      if(pd.shared){ pinPosByTag.L = pos; pinPosByTag.R = pos; } else { pinPosByTag[pd.tag] = pos; }
    });
    pinPosByThrow.push(pinPosByTag);
  });

  // Fill every gap between pin spans (and before the first / after the last) with a plain
  // on-axis main-journal cylinder -- these are the segments that actually stop at each web.
  pinSpans.sort((a,b)=>a.x0-b.x0);
  let cursor = sceneObjs.minX;
  pinSpans.forEach(sp=>{
    if(sp.x0 > cursor + 0.01){
      items.push({type:'journal', p1:{x:cursor,y:0,z:0}, p2:{x:sp.x0,y:0,z:0}});
    }
    items.push({type:'web', x:sp.x0, pinYZ:{y:sp.y,z:sp.z}, color:sp.color});
    items.push({type:'web', x:sp.x1, pinYZ:{y:sp.y,z:sp.z}, color:sp.color});
    cursor = Math.max(cursor, sp.x1);
  });
  if(sceneObjs.maxX > cursor + 0.01){
    items.push({type:'journal', p1:{x:cursor,y:0,z:0}, p2:{x:sceneObjs.maxX,y:0,z:0}});
  }

  mode.throws.forEach((th, idx)=>{
    const pinPosByTag = pinPosByThrow[idx];
    ['L','R'].forEach(tag=>{
      const dir = tag==='L'?dL:dR;
      const pinPos = pinPosByTag[tag];
      const xo = pinPos.x - th.x;

      const bp1 = {x:th.x+xo, y:dir.y*boreMin, z:dir.z*boreMin};
      const bp2 = {x:th.x+xo, y:dir.y*boreMax, z:dir.z*boreMax};
      items.push({type:'bore', p1:bp1, p2:bp2, r:boreR, color: tag==='L'?COL_L:COL_R});

      // Cylinder number tag, floating just above the bore's far end: the big number is the
      // engine-wide 1~8 (or 1~6) cylinder number, the small one is the bank-relative R/L
      // number used everywhere else in this tool (and on the timeline rows below).
      const globalNum = tag==='L' ? idx*2+1 : idx*2+2;
      const labelR = boreMax + 0.95; // keep well clear of the piston's TDC position and its firing flash
      const labelPos = {x:th.x+xo, y:dir.y*labelR, z:dir.z*labelR};
      items.push({type:'label', pos:labelPos, text:String(globalNum), sub:tag+(idx+1), color: tag==='L'?COL_L:COL_R});

      const s = solvePistonDist({y:pinPos.y,z:pinPos.z}, dir);
      const pistonPos = {x:th.x+xo, y:dir.y*s, z:dir.z*s};
      const d = nearestEventDelta(mode.events, idx, tag, a);
      items.push({type:'rod', p1:pinPos, p2:pistonPos, color:'#c7c4b9'});
      items.push({type:'piston', pos:pistonPos, dir, color: tag==='L'?COL_L:COL_R, lit: d<10});
    });
  });

  return items;
}

function drawFloorGrid(basis){
  const y0=-2.4;
  ctx.save();
  ctx.strokeStyle = isDark()? 'rgba(255,255,255,0.06)':'rgba(0,0,0,0.07)';
  ctx.lineWidth=1;
  for(let gx=-5; gx<=5; gx++){
    const a=project({x:gx,y:y0,z:-4}, basis);
    const b=project({x:gx,y:y0,z:4}, basis);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
  for(let gz=-4; gz<=4; gz++){
    const a=project({x:-5,y:y0,z:gz}, basis);
    const b=project({x:5,y:y0,z:gz}, basis);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
  ctx.restore();
}

// Solid 3D tube: computes a world-space perpendicular (relative to view direction)
// so the segment renders as a filled, shaded cylinder silhouette instead of a flat line.
function drawTube3D(p1, p2, r, colorHex, basis, alpha=1, capAlpha=null){
  const ax = {x:p2.x-p1.x, y:p2.y-p1.y, z:p2.z-p1.z};
  const alen = Math.hypot(ax.x,ax.y,ax.z) || 0.0001;
  const axn = {x:ax.x/alen, y:ax.y/alen, z:ax.z/alen};
  // view direction: from midpoint to camera
  const mid = {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2, z:(p1.z+p2.z)/2};
  let vd = {x:basis.cam.x-mid.x, y:basis.cam.y-mid.y, z:basis.cam.z-mid.z};
  const vlen = Math.hypot(vd.x,vd.y,vd.z)||0.0001;
  vd = {x:vd.x/vlen, y:vd.y/vlen, z:vd.z/vlen};
  // perp = axis x viewDir (world-space direction of max silhouette width)
  let perp = {
    x: axn.y*vd.z-axn.z*vd.y,
    y: axn.z*vd.x-axn.x*vd.z,
    z: axn.x*vd.y-axn.y*vd.x
  };
  const plen = Math.hypot(perp.x,perp.y,perp.z);
  if(plen < 0.0001){ perp = basis.up; } else { perp = {x:perp.x/plen,y:perp.y/plen,z:perp.z/plen}; }

  const c1a = {x:p1.x+perp.x*r, y:p1.y+perp.y*r, z:p1.z+perp.z*r};
  const c1b = {x:p1.x-perp.x*r, y:p1.y-perp.y*r, z:p1.z-perp.z*r};
  const c2a = {x:p2.x+perp.x*r, y:p2.y+perp.y*r, z:p2.z+perp.z*r};
  const c2b = {x:p2.x-perp.x*r, y:p2.y-perp.y*r, z:p2.z-perp.z*r};

  const s1a=project(c1a,basis), s1b=project(c1b,basis), s2a=project(c2a,basis), s2b=project(c2b,basis);
  const sp1=project(p1,basis), sp2=project(p2,basis);

  // cylindrical shading gradient across the tube's short axis (side a -> side b)
  const grad = ctx.createLinearGradient(s1a.x,s1a.y,s1b.x,s1b.y);
  const c = hexToRgb(colorHex);
  const dk = (f)=>`rgb(${Math.round(c.r*f)},${Math.round(c.g*f)},${Math.round(c.b*f)})`;
  grad.addColorStop(0, dk(0.55));
  grad.addColorStop(0.4, dk(1.15>1?1:1.15));
  grad.addColorStop(0.55, `rgb(${Math.min(255,c.r+70)},${Math.min(255,c.g+70)},${Math.min(255,c.b+70)})`);
  grad.addColorStop(1, dk(0.5));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(s1a.x,s1a.y);
  ctx.lineTo(s2a.x,s2a.y);
  ctx.lineTo(s2b.x,s2b.y);
  ctx.lineTo(s1b.x,s1b.y);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  if(alpha < 1){
    ctx.strokeStyle = colorHex; ctx.globalAlpha = Math.min(1, alpha+0.25); ctx.lineWidth=1;
    ctx.stroke();
  }
  ctx.restore();

  // rounded end caps
  const cAlpha = capAlpha===null ? alpha : capAlpha;
  ctx.save();
  ctx.globalAlpha = cAlpha;
  [sp1,sp2].forEach(sp=>{
    const rad = Math.max(1, r*sp.scale*0.42);
    const cg = ctx.createRadialGradient(sp.x-rad*0.3,sp.y-rad*0.3,rad*0.1,sp.x,sp.y,rad);
    cg.addColorStop(0, `rgb(${Math.min(255,c.r+55)},${Math.min(255,c.g+55)},${Math.min(255,c.b+55)})`);
    cg.addColorStop(1, dk(0.6));
    ctx.beginPath(); ctx.arc(sp.x,sp.y,rad,0,Math.PI*2);
    ctx.fillStyle=cg; ctx.fill();
  });
  ctx.restore();
}

// Crank web/cheek: a counterweight-shaped plate at a fixed X slice, running from the shaft
// centerline out past the pin. Real crank webs taper narrow near the main journal and flare
// into a rounded counterweight lobe on the far side of the pin -- approximated here with an
// asymmetric, tapered outline (not a plain oval) so it reads as a distinct machined part.
function webOutline(pinYZ){
  const dist = Math.hypot(pinYZ.y,pinYZ.z) || 0.0001;
  const uy=pinYZ.y/dist, uz=pinYZ.z/dist;   // shaft-center -> pin axis
  const vy=-uz, vz=uy;                       // perpendicular in-plane direction
  const nearHalf = 0.30;   // distance from shaft center the plate reaches, on the near side
  const farHalf  = dist + 0.34; // reaches a bit past the pin -- the counterweight lobe
  const width = 0.36;

  const N = 20;
  const pts = [];
  for(let i=0;i<N;i++){
    const t = i/N*Math.PI*2;
    const cosT=Math.cos(t), sinT=Math.sin(t);
    const majorLocal = cosT>=0 ? farHalf : nearHalf;
    // taper the tip narrower on the near (shaft) side for a paddle-like silhouette
    const widthLocal = width * (cosT>=0 ? 1 : (1-0.4*(-cosT)));
    const ly = cosT*majorLocal, lv = sinT*widthLocal;
    pts.push({ly, lv, uy, uz, vy, vz});
  }
  return pts;
}

// Builds the crank web as many small flat-shaded triangles/quads, each with its OWN depth,
// instead of one single polygon with one averaged depth. A single-depth flat plate can't sort
// correctly against a rod that crosses in front of part of it and behind another part (that's
// what caused the connecting rod to visually "pierce" the web) -- per-piece depth fixes that,
// because each small piece now competes fairly, point-for-point, against the rod's own pieces.
function buildWebDrawables(x, pinYZ, colorHex, basis){
  const outline = webOutline(pinYZ);
  const thickness = 0.09;
  const c = hexToRgb(colorHex);
  const dk=(f)=>`rgb(${Math.min(255,Math.round(c.r*f))},${Math.min(255,Math.round(c.g*f))},${Math.min(255,Math.round(c.b*f))})`;
  const toWorld=(xf,p)=>({x:xf, y:p.uy*p.ly+p.vy*p.lv, z:p.uz*p.ly+p.vz*p.lv});
  const maxLv = Math.max(...outline.map(p=>Math.abs(p.lv))) || 1;
  const centerLocal = {ly:0, lv:0, uy:outline[0].uy, uz:outline[0].uz, vy:outline[0].vy, vz:outline[0].vz};

  const out = [];
  [x-thickness, x+thickness].forEach((xf,faceIdx)=>{
    const shadeBase = faceIdx===0 ? 0.52 : 0.66;
    for(let i=0;i<outline.length;i++){
      const p1=outline[i], p2=outline[(i+1)%outline.length];
      const w0=toWorld(xf,centerLocal), w1=toWorld(xf,p1), w2=toWorld(xf,p2);
      const s0=project(w0,basis), s1=project(w1,basis), s2=project(w2,basis);
      const depth=(s0.depth+s1.depth+s2.depth)/3;
      const lvAvg = (Math.abs(p1.lv)+Math.abs(p2.lv))/2/maxLv;
      const shade = Math.min(1.25, shadeBase + (1-lvAvg)*0.45);
      out.push({depth, draw:()=>{
        ctx.beginPath();
        ctx.moveTo(s0.x,s0.y); ctx.lineTo(s1.x,s1.y); ctx.lineTo(s2.x,s2.y); ctx.closePath();
        ctx.fillStyle = dk(shade);
        ctx.fill();
      }});
    }
  });

  // rim quads connecting the two faces so the plate reads as a solid slab, not two paper sheets
  for(let i=0;i<outline.length;i++){
    const p1=outline[i], p2=outline[(i+1)%outline.length];
    const a1=toWorld(x-thickness,p1), a2=toWorld(x-thickness,p2);
    const b1=toWorld(x+thickness,p1), b2=toWorld(x+thickness,p2);
    const sa1=project(a1,basis), sa2=project(a2,basis), sb1=project(b1,basis), sb2=project(b2,basis);
    const depth=(sa1.depth+sa2.depth+sb1.depth+sb2.depth)/4;
    out.push({depth, draw:()=>{
      ctx.beginPath();
      ctx.moveTo(sa1.x,sa1.y); ctx.lineTo(sa2.x,sa2.y); ctx.lineTo(sb2.x,sb2.y); ctx.lineTo(sb1.x,sb1.y); ctx.closePath();
      ctx.fillStyle = dk(0.42);
      ctx.fill();
    }});
  }
  return out;
}

function render(a){
  const w=wrap.clientWidth, h=wrap.clientHeight;
  ctx.clearRect(0,0,w,h);
  const basis = getBasis();
  drawFloorGrid(basis);

  const items = computeFrame(a);
  // compute depth for sorting
  const dark = isDark();
  const drawables = [];

  items.forEach(it=>{
    if(it.type==='journal'){
      // on-axis main-bearing segment -- these stop exactly at each web, they do NOT run
      // straight through the whole engine, so nothing visually pierces the shaft anymore.
      const a1=project(it.p1,basis), a2=project(it.p2,basis);
      const depth=(a1.depth+a2.depth)/2;
      drawables.push({depth, draw:()=>{ drawTube3D(it.p1, it.p2, 0.17, COL_SHAFT, basis); }});
    } else if(it.type==='web'){
      // crank web/cheek: a tapered counterweight plate with real thickness, not a tube --
      // this is what makes it visually distinct from the round journals and connecting rod.
      // Broken into per-triangle drawables (see buildWebDrawables) so it sorts correctly
      // against the connecting rod instead of one flat piece incorrectly winning every tie.
      buildWebDrawables(it.x, it.pinYZ, it.color, basis).forEach(d=>drawables.push(d));
    } else if(it.type==='bore'){
      // the physical cylinder wall the piston slides inside — translucent so the
      // piston and its motion stay visible through it, but its solid presence
      // makes clear this is what constrains the piston to a straight line.
      const a1=project(it.p1,basis), a2=project(it.p2,basis);
      const depth=(a1.depth+a2.depth)/2 + 0.35; // draw slightly "behind" its own piston in ties
      drawables.push({depth, draw:()=>{ drawTube3D(it.p1, it.p2, it.r, it.color, basis, 0.16, 0.22); }});
    } else if(it.type==='ghost'){
      const p=project({x:it.x,y:0,z:0}, basis);
      const depth=p.depth;
      drawables.push({depth, draw:()=>{
        const s = 0.55*p.scale;
        ctx.save();
        ctx.strokeStyle = dark? '#888':'#999';
        ctx.setLineDash([4,4]); ctx.lineWidth=1.5; ctx.globalAlpha=0.65;
        ctx.strokeRect(p.x-s,p.y-s,s*2,s*2);
        ctx.setLineDash([]);
        ctx.font='11px sans-serif'; ctx.fillStyle=ctx.strokeStyle; ctx.textAlign='center';
        ctx.fillText('저널 없음', p.x, p.y+s+14);
        ctx.restore();
      }});
    } else if(it.type==='rod'){
      // Split into a few shorter segments so each piece carries its own local depth --
      // a single long tube's one averaged depth is what let the web wrongly draw on top
      // of (or under) parts of the rod it should have interleaved with correctly.
      const SEGS = 4;
      for(let i=0;i<SEGS;i++){
        const t0=i/SEGS, t1=(i+1)/SEGS;
        const q1 = {x:lerp(it.p1.x,it.p2.x,t0), y:lerp(it.p1.y,it.p2.y,t0), z:lerp(it.p1.z,it.p2.z,t0)};
        const q2 = {x:lerp(it.p1.x,it.p2.x,t1), y:lerp(it.p1.y,it.p2.y,t1), z:lerp(it.p1.z,it.p2.z,t1)};
        const s1=project(q1,basis), s2=project(q2,basis);
        const depth=(s1.depth+s2.depth)/2;
        drawables.push({depth, draw:()=>{ drawTube3D(q1, q2, 0.11, '#c7c4b9', basis); }});
      }
    } else if(it.type==='pin'){
      // crank pin (journal): a short cylinder running PARALLEL to the main shaft --
      // this is the physical part the rod's big-end actually clamps around.
      const half = it.len/2;
      const p1 = {x:it.pos.x-half, y:it.pos.y, z:it.pos.z};
      const p2 = {x:it.pos.x+half, y:it.pos.y, z:it.pos.z};
      const a1=project(p1,basis), a2=project(p2,basis);
      const depth=(a1.depth+a2.depth)/2 - 0.03;
      drawables.push({depth, draw:()=>{ drawTube3D(p1, p2, it.r, it.color, basis); }});
    } else if(it.type==='label'){
      // Billboard cylinder-number tag: engine-wide number on top, bank-relative
      // R#/L# underneath, so it's easy to match against the timeline rows below.
      const p = project(it.pos, basis);
      const depth = p.depth - 0.6; // bias toward camera so nearby geometry never occludes it
      drawables.push({depth, draw:()=>{
        const scale = Math.max(0.8, Math.min(1.5, p.scale/420));
        const c = hexToRgb(it.color);
        const mix=(f)=>`rgb(${Math.round(c.r+(255-c.r)*f)},${Math.round(c.g+(255-c.g)*f)},${Math.round(c.b+(255-c.b)*f)})`;
        const dark2=(f)=>`rgb(${Math.round(c.r*f)},${Math.round(c.g*f)},${Math.round(c.b*f)})`;
        const pillW = 54*scale, pillH = 46*scale, rad = 9*scale;
        const px0 = p.x-pillW/2, py0 = p.y-pillH/2;
        ctx.save();
        ctx.textAlign='center'; ctx.textBaseline='middle';
        // drop shadow + glossy colored badge = reads as a solid floating tag, not a flat sticker
        ctx.shadowColor='rgba(0,0,0,0.30)'; ctx.shadowBlur=8*scale; ctx.shadowOffsetY=4*scale;
        const grad = ctx.createLinearGradient(0,py0,0,py0+pillH);
        grad.addColorStop(0, mix(0.42));
        grad.addColorStop(0.5, it.color);
        grad.addColorStop(1, dark2(0.62));
        ctx.beginPath(); ctx.roundRect(px0,py0,pillW,pillH,rad);
        ctx.fillStyle=grad; ctx.fill();
        ctx.shadowColor='transparent';
        // rim
        ctx.lineWidth=1.6; ctx.strokeStyle=dark2(0.5); ctx.stroke();
        // top gloss highlight
        ctx.beginPath(); ctx.roundRect(px0+2.5*scale, py0+2.5*scale, pillW-5*scale, pillH*0.42, rad*0.8);
        ctx.fillStyle='rgba(255,255,255,0.30)'; ctx.fill();
        // text with subtle depth shadow
        ctx.fillStyle='rgba(0,0,0,0.35)';
        ctx.font = `700 ${Math.round(20*scale)}px sans-serif`;
        ctx.fillText(it.text, p.x+1, p.y-9*scale+1.5);
        ctx.font = `700 ${Math.round(13*scale)}px sans-serif`;
        ctx.fillText(it.sub, p.x+1, p.y+12*scale+1.5);
        ctx.fillStyle='#ffffff';
        ctx.font = `700 ${Math.round(20*scale)}px sans-serif`;
        ctx.fillText(it.text, p.x, p.y-9*scale);
        ctx.font = `700 ${Math.round(13*scale)}px sans-serif`;
        ctx.fillText(it.sub, p.x, p.y+12*scale);
        ctx.restore();
      }});
    } else if(it.type==='piston'){
      // piston head: a short, fat slug that visibly fills the bore's cross-section
      // and travels ALONG the bore axis only — this is the part the rod pushes/pulls.
      const half = 0.19;
      const p1 = {x:it.pos.x - it.dir.x*half, y:it.pos.y - it.dir.y*half, z:it.pos.z - it.dir.z*half};
      const p2 = {x:it.pos.x + it.dir.x*half, y:it.pos.y + it.dir.y*half, z:it.pos.z + it.dir.z*half};
      const a1=project(p1,basis), a2=project(p2,basis);
      const depth=(a1.depth+a2.depth)/2 - 0.05;
      drawables.push({depth, draw:()=>{
        drawTube3D(p1, p2, 0.44, it.color, basis);
        if(it.lit){
          // combustion flash: a flickering red-orange starburst instead of a plain white dot
          const pc = project(it.pos,basis);
          const R = Math.max(10, 0.30*pc.scale);
          const flick = 1 + 0.10*Math.sin(a*0.9 + it.pos.x*7);
          ctx.save();
          // outer heat glow
          let g = ctx.createRadialGradient(pc.x,pc.y,0, pc.x,pc.y,R*2.1*flick);
          g.addColorStop(0,'rgba(255,140,50,0.55)');
          g.addColorStop(0.6,'rgba(255,70,20,0.22)');
          g.addColorStop(1,'rgba(255,60,10,0)');
          ctx.fillStyle=g;
          ctx.beginPath(); ctx.arc(pc.x,pc.y,R*2.1*flick,0,Math.PI*2); ctx.fill();
          // spiky flame star
          const spikes=10;
          ctx.beginPath();
          for(let i=0;i<spikes*2;i++){
            const ang = i*Math.PI/spikes + a*0.03;
            const rr = (i%2===0) ? R*(1.05+0.18*Math.sin(a*0.5+i)) : R*0.45;
            const qx = pc.x+Math.cos(ang)*rr, qy = pc.y+Math.sin(ang)*rr;
            if(i===0) ctx.moveTo(qx,qy); else ctx.lineTo(qx,qy);
          }
          ctx.closePath();
          let g2 = ctx.createRadialGradient(pc.x,pc.y,0, pc.x,pc.y,R*1.2);
          g2.addColorStop(0,'#fff6c8');
          g2.addColorStop(0.35,'#ffc23e');
          g2.addColorStop(0.7,'#ff6a1f');
          g2.addColorStop(1,'#e03310');
          ctx.fillStyle=g2; ctx.fill();
          // hot core
          ctx.beginPath(); ctx.arc(pc.x,pc.y,R*0.30,0,Math.PI*2);
          ctx.fillStyle='#fffbe8'; ctx.fill();
          ctx.restore();
        }
      }});
    }
  });

  drawables.sort((x,y)=>y.depth-x.depth); // far first
  drawables.forEach(d=>d.draw());
}

function drawSphere(x,y,r,colorHex,lit){
  const c = hexToRgb(colorHex);
  const grad = ctx.createRadialGradient(x-r*0.35,y-r*0.35,r*0.1,x,y,r*1.05);
  if(lit){
    grad.addColorStop(0, `rgba(255,255,255,0.95)`);
    grad.addColorStop(0.35, `rgb(${Math.min(255,c.r+70)},${Math.min(255,c.g+70)},${Math.min(255,c.b+70)})`);
    grad.addColorStop(1, `rgb(${c.r},${c.g},${c.b})`);
  } else {
    grad.addColorStop(0, `rgb(${Math.min(255,c.r+60)},${Math.min(255,c.g+60)},${Math.min(255,c.b+60)})`);
    grad.addColorStop(1, `rgb(${Math.round(c.r*0.55)},${Math.round(c.g*0.55)},${Math.round(c.b*0.55)})`);
  }
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fillStyle=grad; ctx.fill();
  if(lit){
    ctx.save();
    ctx.shadowColor = colorHex; ctx.shadowBlur = r*2.2;
    ctx.beginPath(); ctx.arc(x,y,r*0.5,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fill();
    ctx.restore();
  }
}

// ============ Timeline ============
// One row per crank journal (throw). Each journal is shared by exactly one cylinder-pair
// (e.g. journal 1 -> cylinders 1&2), so each row gets its own private 0-720° axis showing
// just that pair's two firing events -- this makes the per-journal R/L gap (the thing that
// bank angle + split pin actually control) directly readable, row by row.
const timelineRowsEl = byId('v6x-timelineRows');
const NS="http://www.w3.org/2000/svg";
function el(tag,attrs){const e=document.createElementNS(NS,tag); for(const k in attrs) e.setAttribute(k,attrs[k]); return e;}

function buildTimeline(mode){
  timelineRowsEl.innerHTML='';
  const n = mode.throws.length;
  // Gaps must be measured against the FULL firing order across every journal, not just the
  // two events living on one row -- otherwise the "closing" gap on a row just measures the
  // distance back to that same journal's own other event, which almost never matches the
  // real next combustion event (that one usually belongs to a different journal/row).
  const globalSorted = [...mode.events].sort((a,b)=>a.angle-b.angle);
  const gapAfterOf = (ev)=>{
    const gi = globalSorted.indexOf(ev);
    const nextAngle = gi+1<globalSorted.length ? globalSorted[gi+1].angle : globalSorted[0].angle+720;
    return nextAngle - ev.angle;
  };
  for(let idx=0; idx<n; idx++){
    const c1=idx*2+1, c2=idx*2+2;
    const row = document.createElement('div');
    row.className = 'v6x-tl-row';
    const label = document.createElement('div');
    label.className = 'v6x-tl-row-label';
    label.textContent = `${c1}·${c2}번`;
    row.appendChild(label);

    const svgWrap = document.createElement('div');
    svgWrap.className = 'v6x-tl-row-svg-wrap';
    const svg = el('svg', {viewBox:'0 0 720 40', preserveAspectRatio:'none', class:'v6x-tl-row-svg'});
    svg.appendChild(el('line',{x1:0,y1:20,x2:720,y2:20,stroke:'var(--line)','stroke-width':2}));
    for(let x=0;x<=720;x+=90) svg.appendChild(el('line',{x1:x,y1:15,x2:x,y2:25,stroke:'var(--line)','stroke-width':1}));

    // A dot right at 0° (or 720°) only has half its circle inside the 0-720 viewBox --
    // the other half belongs at the opposite edge, since 0° and 720° are the same instant
    // on a repeating cycle. Draw a dimmed "echo" copy there so nothing looks clipped/cut off.
    const BOUNDARY_R = 11;
    const drawMarker = (x, ev, markId, dim)=>{
      const c=el('circle',{cx:x,cy:20,r:9,fill:'var(--panel)',stroke:ev.bank==='L'?'var(--L)':'var(--R)','stroke-width':2,opacity:dim?0.5:1,id:markId});
      svg.appendChild(c);
      const t=el('text',{x:x,y:10,'text-anchor':'middle','font-size':9,'font-weight':700,fill:ev.bank==='L'?'var(--L)':'var(--R)',opacity:dim?0.5:1});
      t.textContent=ev.bank+(idx+1);
      svg.appendChild(t);
    };
    const evs = mode.events.filter(e=>e.throwIdx===idx).sort((a,b)=>a.angle-b.angle);
    evs.forEach((ev,i)=>{
      drawMarker(ev.angle, ev, `v6x-tl-${idx}-${i}`, false);
      if(ev.angle < BOUNDARY_R) drawMarker(ev.angle+720, ev, `v6x-tl-${idx}-${i}-echo`, true);
      else if(ev.angle > 720-BOUNDARY_R) drawMarker(ev.angle-720, ev, `v6x-tl-${idx}-${i}-echo`, true);
    });
    // Each label shows the gap from THIS event to the very next actual firing anywhere in
    // the engine (which is very often on a different row) -- not a same-row-only distance.
    evs.forEach(ev=>{
      const gap = gapAfterOf(ev);
      const mid = ev.angle + gap/2;
      const t=el('text',{x:mid,y:36,'text-anchor':'middle','font-size':8.5,fill:'var(--sub)'});
      t.textContent=Math.round(gap)+'°';
      svg.appendChild(t);
    });
    const progress=el('line',{x1:0,y1:0,x2:0,y2:40,stroke:'var(--accent)','stroke-width':2,id:`v6x-tlProgress-${idx}`});
    svg.appendChild(progress);

    svgWrap.appendChild(svg);
    row.appendChild(svgWrap);
    timelineRowsEl.appendChild(row);
  }
}
function updateTimeline(a, mode){
  const n = mode.throws.length;
  for(let idx=0; idx<n; idx++){
    const p = byId(`v6x-tlProgress-${idx}`);
    if(p){ p.setAttribute('x1',a); p.setAttribute('x2',a); }
    const evs = mode.events.filter(e=>e.throwIdx===idx).sort((x,y)=>x.angle-y.angle);
    evs.forEach((ev,i)=>{
      let d=Math.abs(a-ev.angle); d=Math.min(d,720-d);
      const fillColor = d<10 ? (ev.bank==='L'?'var(--L)':'var(--R)') : 'var(--panel)';
      const c = byId(`v6x-tl-${idx}-${i}`);
      if(c) c.setAttribute('fill', fillColor);
      const echo = byId(`v6x-tl-${idx}-${i}-echo`);
      if(echo) echo.setAttribute('fill', fillColor);
    });
  }
}

// ============ Mode switching ============
function rebuild(){
  resizeCanvas();
  const mode = MODES[currentMode];
  sceneObjs = buildScene(mode);
  buildTimeline(mode);
  byId('v6x-caption').innerHTML = `<b>${mode.label}</b><br><br>` + mode.caption;
  byId('v6x-formula').innerHTML = mode.formula;
}

root.querySelectorAll('.v6x-modes button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    root.querySelectorAll('.v6x-modes button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    angle = 0;
    rebuild();
  });
});

byId('v6x-playBtn').addEventListener('click', e=>{
  playing=!playing; e.target.textContent = playing?'⏸':'▶';
});
byId('v6x-speed').addEventListener('input', e=>{ speed=parseFloat(e.target.value); });

function tick(t){
  if (!root.isConnected) { cleanup(); return; }
  if (!root.getClientRects().length) { lastT=t; frame=requestAnimationFrame(tick); return; }
  if(lastT===null) lastT=t;
  const dt=(t-lastT)/1000; lastT=t;
  if(playing){ angle = (angle + Math.min(dt, 0.1)*90*speed) % 720; }
  if(autoRotate){ azimuth += dt*0.18; }
  render(angle);
  updateTimeline(angle, MODES[currentMode]);
  byId('v6x-angleReadout').textContent = Math.round(angle)+'° / 720°';
  frame=requestAnimationFrame(tick);
}

rebuild();
frame=requestAnimationFrame(tick);
return cleanup;
}
