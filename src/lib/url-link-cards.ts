import { load } from 'cheerio';
import { escapeHtml } from './native-content.ts';

export interface CardPost { title: string; description?: string; path?: string; publicPath?: string | null; cover?: string | null; coverPath?: string | null }
export interface CardMetadata { title: string; description?: string; image?: string }
const excluded = '.se_oglink,.se-oglink,figure,pre,code,li,blockquote,table,h1,h2,h3,h4,h5,h6,[contenteditable="false"],[data-dwnc-no-autolink]';
const childExcluded = 'p,div,figure,pre,code,ul,ol,li,blockquote,table,img,video,audio,iframe,hr,[data-dwnc-no-autolink],[contenteditable="false"]';
export function standaloneCardUrl(text: string): string | null {
  const label = text.trim();
  if (!/^(?:https?:\/\/|www\.)[^\s<>"'\u200B-\u200D\uFEFF]+$/iu.test(label) || /[.,!?;:。！？、，；：”’」』】》〉]$/u.test(label)) return null;
  const depth:Record<string,number>={'(':0,'[':0,'{':0},closing:Record<string,string>={')':'(',']':'[','}':'{'};
  for(const char of label){if(char in depth)depth[char]++;else if(char in closing){if(!depth[closing[char]])return null;depth[closing[char]]--}}
  try {
    const href=/^www\./iu.test(label)?'https://'+label:label,url=new URL(href);
    const lastLabel=href.replace(/^https?:\/\//iu,'').split(/[/?#]/u)[0].replace(/:\d+$/u,'').split('.').at(-1)||'';
    return url.hostname.includes('.')&&!url.username&&!url.password&&!(/[a-z]/iu.test(lastLabel)&&/[^\x00-\x7f]/u.test(lastLabel))?url.href:null;
  } catch { return null; }
}
export function standaloneCardCandidates(html: string) {
  const $ = load(html, null, false);
  // Legacy fragments may have a URL directly at the body root. Treat each
  // root run bounded by a block or BR as a paragraph, without touching prose.
  let run:any[]=[];const normalized:any[]=[];
  const flush=()=>{
    if(!run.length)return;
    const text=run.map(node=>$(node).text()).join('');
    if(standaloneCardUrl(text)){
      const paragraph=$('<p></p>');
      for(const node of run)paragraph.append(node);
      normalized.push(paragraph[0]);
    }else normalized.push(...run);
    run=[];
  };
  for(const node of $.root().contents().toArray()){
    if(node.type==='text'||node.type==='tag'&&['a','span','b','strong','em','i','u','s','font'].includes(node.name))run.push(node);
    else{flush();normalized.push(node)}
  }
  flush();
  // Cheerio's before() filters text nodes; rebuild the root sequence instead of
  // detaching a loose URL into a paragraph that was never attached to the root.
  $.root().empty().append(normalized);
  const candidates: { element: any; url: string }[] = [];
  $('p,div').each((_, element) => {
    const block = $(element);
    if (block.closest(excluded).length || block.find(childExcluded).length) return;
    const textBlock=block.clone();textBlock.find('br').replaceWith('\n');
    const url = standaloneCardUrl(textBlock.text());
    if (!url || block.find('a').toArray().some(a => {try{return new URL($(a).attr('href') ?? '', 'https://dwnc.me').href !== url}catch{return true}})) return;
    candidates.push({element, url});
  });
  return {$, candidates};
}
export function cardHtml(url: string, metadata?: CardMetadata): string {
  const safe = standaloneCardUrl(url); if (!safe) throw new Error('ADMIN_E_QUERY');
  const image = metadata?.image && /^\/media\/[a-zA-Z0-9_./-]+$/u.test(metadata.image) && !metadata.image.includes('..') ? metadata.image : null;
  return `<figure data-ke-type="opengraph"><a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${image ? `<span class="og-image"><img src="${escapeHtml(image)}" alt=""></span>` : ''}<span class="og-text"><span class="og-title">${escapeHtml(metadata?.title || url)}</span><span class="og-desc">${escapeHtml(metadata?.description || '')}</span><span class="og-host">${escapeHtml(new URL(safe).hostname)}</span></span></a></figure>`;
}
function internalMetadata(url: URL, posts: CardPost[]): CardMetadata | null | undefined {
  if (!['dwnc.me','www.dwnc.me','admin.dwnc.me'].includes(url.hostname)) return undefined;
  const post = posts.find(post => (post.path ?? post.publicPath) === url.pathname);
  return post ? {title:post.title,description:post.description,image:post.cover ?? post.coverPath ?? undefined} : null;
}
// Do not fetch IP literals, local/service names, credentials, or non-web ports.
// Workers' public fetch also rejects connections to private network addresses.
export function publicMetadataUrl(value: string): URL | null {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.port && !['80','443'].includes(url.port)
      || !host.includes('.') || /[:\[\]]/u.test(host) || /^[\d.]+$/u.test(host)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/u.test(host) || host.endsWith('.')) return null;
    return url;
  } catch { return null; }
}
export function publicAddress(address:string):boolean {
  if(address.includes(':')) return /^[23][0-9a-f]{3}:/iu.test(address) && !/^2001:(?:db8|0):/iu.test(address) && !/^2002:/iu.test(address);
  const parts=address.split('.').map(Number);if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b]=parts;return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));
}
async function publicDns(host:string,fetcher:typeof fetch,signal:AbortSignal):Promise<boolean> {
  const answers=await Promise.all(['A','AAAA'].map(async type=>{
    const response=await fetcher('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type='+type,{signal,redirect:'error',headers:{accept:'application/dns-json'}});
    if(!response.ok||Number(response.headers.get('content-length')??0)>32768)throw new Error('DNS unavailable');
    const reader=response.body?.getReader();if(!reader)throw new Error('DNS unavailable');let text='',bytes=0;const decoder=new TextDecoder();
    try {while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>32768)throw new Error('DNS response too large');text+=decoder.decode(part.value,{stream:true})}}finally{await reader.cancel()}
    const result=JSON.parse(text);if(result.Status!==0)throw new Error('DNS unavailable');
    return (result.Answer??[]).filter((answer:{type:number})=>answer.type===1||answer.type===28).map((answer:{data:string})=>answer.data);
  }));
  const addresses=answers.flat();return addresses.length>0&&addresses.every(publicAddress);
}
const metadataCache = new Map<string,{until:number; value:CardMetadata | null}>();
export async function externalCardMetadata(value: string, fetcher: typeof fetch = fetch): Promise<CardMetadata | null> {
  const cached = metadataCache.get(value); if (cached && cached.until > Date.now()) return cached.value;
  let result: CardMetadata | null = null;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3500);
  try {
    let url = publicMetadataUrl(value);
    for (let redirects=0; url && redirects<=3; redirects++) {
      if(!await publicDns(url.hostname,fetcher,controller.signal))break;
      const response = await fetcher(url.href,{redirect:'manual',signal:controller.signal,headers:{accept:'text/html,application/xhtml+xml'}});
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel(); const location=response.headers.get('location');
        url=location?publicMetadataUrl(new URL(location,url).href):null; continue;
      }
      if (!response.ok || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(response.headers.get('content-type')??'') || Number(response.headers.get('content-length')??0)>262144) {await response.body?.cancel();break}
      const reader=response.body?.getReader();if(!reader)break;
      const decoder=new TextDecoder();let html='',bytes=0;
      try {while(true){const {done,value:chunk}=await reader.read();if(done)break;bytes+=chunk.length;if(bytes>262144)break;html+=decoder.decode(chunk,{stream:true});if(/<\/head\s*>/iu.test(html))break}} finally {await reader.cancel()}
      const $=load(html), title=($('meta[property="og:title"]').attr('content')||$('title').first().text()).trim().slice(0,300);
      const description=($('meta[property="og:description"]').attr('content')||$('meta[name="description"]').attr('content')||'').trim().slice(0,500);
      if(title)result={title,description};break;
    }
  } catch {} finally {clearTimeout(timer)}
  if(metadataCache.size>=256)metadataCache.delete(metadataCache.keys().next().value!);
  metadataCache.set(value,{until:Date.now()+(result?3600000:60000),value:result});
  return result;
}
export async function resolveCardHtml(value:string, posts:CardPost[], fetcher:typeof fetch=fetch, fetchExternal=true) {
  const normalized=standaloneCardUrl(value);if(!normalized)throw new Error('ADMIN_E_QUERY');
  const internal=internalMetadata(new URL(normalized),posts);
  return cardHtml(value,internal===undefined?(fetchExternal?await externalCardMetadata(normalized,fetcher):metadataCache.get(normalized)?.value)??undefined:internal??undefined);
}
export async function prepareUrlLinkCards(html:string, posts:CardPost[], fetcher:typeof fetch=fetch, fetchExternal=true):Promise<string> {
  const {$,candidates}=standaloneCardCandidates(html);if(!candidates.length)return html;
  // Bounded concurrency avoids one metadata request per paragraph in flight.
  const cache=new Map<string,string>();let next=0;
  const deadline=Date.now()+3500;
  const boundedFetch:typeof fetch=(input,init)=>{const remaining=deadline-Date.now();if(remaining<=0)return Promise.reject(new Error('metadata deadline'));return fetcher(input,{...init,signal:AbortSignal.any([init?.signal??AbortSignal.timeout(remaining),AbortSignal.timeout(remaining)])})};
  await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{while(next<candidates.length){const item=candidates[next++];let card=cache.get(item.url);if(!card){card=await resolveCardHtml(item.url,posts,boundedFetch,fetchExternal);cache.set(item.url,card)}const figure=$(card);for(const attribute of ['id','style','align','dir','lang']){const value=$(item.element).attr(attribute);if(value!==undefined)figure.attr(attribute,value)}$(item.element).replaceWith(figure)}}));
  return $.root().html()??html;
}
