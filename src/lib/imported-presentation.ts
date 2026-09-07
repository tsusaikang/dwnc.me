import { load } from 'cheerio';
import { sanitizeLegacyHtml } from './native-content.ts';
import corrections from '../data/imported-formatting-corrections.json' with { type: 'json' };
import { mountEngineDiagram } from './engine-diagram-client.js';
import {
  ENGINE_DIAGRAM_BASELINE, ENGINE_DIAGRAM_HTML,
  ENGINE_STATIC_BASELINE, ENGINE_STATIC_HTML,
  ENGINE_DIAGRAM_RENDERED_BASELINE, ENGINE_STATIC_RENDERED_BASELINE,
} from './engine-diagram-content.ts';

export { ENGINE_DIAGRAM_CSS } from './engine-diagram-content.ts';

export type ImportedIdentity = { source: 'naver' | 'tistory'; sourceId: string };

// Markdown's historical indented block left the closing summary inside the
// diagram wrapper. Repairing the diagram must keep those authored paragraphs.
function renderedDiagramReplacement(expected: string) {
  const $ = load(expected, null, false);
  const tail = $('#v6crank3d > .v6x-wrap').nextAll().toArray().map(node => $(node).prop('outerHTML')).join('\n');
  return ENGINE_DIAGRAM_HTML + (tail ? '\n' + tail : '');
}
const engineReplacements = [
  { expected: ENGINE_DIAGRAM_BASELINE, replacement: ENGINE_DIAGRAM_HTML },
  { expected: ENGINE_STATIC_BASELINE, replacement: ENGINE_STATIC_HTML },
  { expected: ENGINE_DIAGRAM_RENDERED_BASELINE, replacement: renderedDiagramReplacement(ENGINE_DIAGRAM_RENDERED_BASELINE) },
  { expected: ENGINE_STATIC_RENDERED_BASELINE, replacement: ENGINE_STATIC_HTML },
];
// D1's public import applies this sanitizer after Markdown rendering. Its style
// serialization differs from static HTML, so recognize that exact known form too.
const importedEngineReplacements = engineReplacements.map(({expected,replacement}) => ({
  expected: load(sanitizeLegacyHtml(expected), null, false).root().html() ?? expected,
  replacement,
}));

// Presentation repairs only match unchanged, publicly projected legacy fragments.
// New writing and edited fragments are never replaced with the old authored text.
export function prepareImportedPresentation(html: string, identity?: ImportedIdentity): string {
  if (!identity) return html;
  const entry = corrections.find((item) => item.source === identity.source && item.sourceId === identity.sourceId);
  const engine = identity.source === 'tistory' && identity.sourceId === '165';
  if (!entry && !engine) return html;
  const $ = load(html, null, false);
  const pairs = entry?.corrections ?? [];
  const replacements = engine ? [...engineReplacements, ...importedEngineReplacements] : pairs;
  for (const { expected, replacement } of replacements) {
    const tag = expected.match(/^<([a-z][a-z0-9]*)\b/i)?.[1];
    if (!tag) continue;
    $(tag).each((_, node) => {
      if ($(node).prop('outerHTML') === expected) $(node).replaceWith(replacement);
    });
  }
  return $.root().html() ?? html;
}

// This is application code, never script supplied by a post. It scopes every lookup
// to the reviewed component and makes no network, storage or evaluation calls.
export const ENGINE_DIAGRAM_BOOTSTRAP = `(${mountEngineDiagram.toString()})(document.querySelector('[data-engine-diagram]'));`;

// Shared by static articles, dynamic articles, and the administrator's preview.
// Inline author choices remain more specific than these defaults.
export const IMPORTED_PRESENTATION_CSS = String.raw`
@font-face{font-family:NanumGothic;src:url('/fonts/nanum/NanumGothic.woff') format('woff');font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:NanumGothic;src:url('/fonts/nanum/NanumGothicBold.ttf') format('truetype');font-weight:700;font-style:normal;font-display:swap}
@font-face{font-family:NanumMyeongjo;src:url('/fonts/nanum/NanumMyeongjo.woff') format('woff');font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:NanumMyeongjo;src:url('/fonts/nanum/NanumMyeongjoBold.woff') format('woff');font-weight:700;font-style:normal;font-display:swap}
@font-face{font-family:NanumBarunGothic;src:url('/fonts/nanum/NanumBarunGothic.woff') format('woff');font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:NanumBarunGothic;src:url('/fonts/nanum/NanumBarunGothicBold.woff') format('woff');font-weight:700;font-style:normal;font-display:swap}
.prose{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue","Apple SD Gothic Neo",Arial,sans-serif;font-size:clamp(1.02rem,1.35vw,1.1rem);line-height:1.98;overflow-wrap:break-word}
.prose :is(strong,b){font-family:inherit}
.prose :is(img,video,iframe,svg){max-width:100%;box-sizing:border-box}
.prose :is(img,video){height:auto}
.prose pre{overflow-x:auto;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.prose code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.prose table{max-width:100%;border-collapse:collapse;display:block;overflow-x:auto}
.prose :is(th,td){padding:10px;border:1px solid var(--line,#deded9)}
.prose :is(ul,ol){padding-inline-start:1.5em}
.prose ul{list-style:disc}.prose ol{list-style:decimal}
.prose li>ul{list-style:circle}.prose li>ol{list-style:decimal}
.prose .naver-content :is(span,p,div){font-family:inherit;line-height:inherit}
.prose .naver-content span{font-size:inherit}
.prose .legacy-content{font-size:16px;line-height:1.75}
.prose .naver-content--smarteditor-one{font-family:"se-nanumgothic",Arial,"나눔고딕",NanumGothic,sans-serif,Meiryo;font-size:15px;line-height:1.8}
.prose .naver-content--smarteditor-one .se-text-paragraph{line-height:1.8}
.prose .naver-content--smarteditor-one .se-fs-{font-size:15px}
.prose .naver-content--smarteditor-3{font-family:"나눔고딕",NanumGothic,"se_NanumGothic",AppleSDGothicNeo,sans-serif,simhei;font-size:16px;line-height:1.9}
.prose .naver-content .se_fs_T3{font-size:16px;line-height:1.9}
.prose .naver-content .se_fs_T1{font-size:28px;line-height:normal}
.prose .naver-content .se_fs_T2{font-size:19px;line-height:1.9}
.prose .naver-content :is(.se_fs_D1,.se_fs_D2){font-size:18px;line-height:normal}
.prose .naver-content .se_fs_H1{font-size:38px;line-height:1.45}
.prose .naver-content .se_fs_H2{font-size:30px;line-height:1.45}
.prose .naver-content .se_fs_H3{font-size:19px;line-height:1.45}
.prose .naver-content .se_ff_nanumgothic{font-family:"나눔고딕",NanumGothic,"se_NanumGothic",AppleSDGothicNeo,sans-serif,simhei}
.prose .naver-content .se_ff_nanumbarungothic{font-family:NanumBarunGothic,"나눔바른고딕",sans-serif}
.prose .naver-content .se_ff_nanummyeongjo{font-family:NanumMyeongjo,"나눔명조",serif}
.prose .naver-content .se_ff_sans-serif{font-family:sans-serif}
.prose .naver-content :is(.se_align-left,.se-text-paragraph-align-left){text-align:left}
.prose .naver-content :is(.se_align-center,.se-text-paragraph-align-center){text-align:center}
.prose .naver-content :is(.se_align-right,.se-text-paragraph-align-right){text-align:right}
.prose .naver-content :is(.se_align-justify,.se-text-paragraph-align-justify){text-align:justify}
.prose .naver-content .se-ff-nanumgothic{font-family:NanumGothic,"나눔고딕",sans-serif}
.prose .naver-content .se-fs-fs16{font-size:16px}
.prose .naver-content .se-fs-fs19{font-size:19px}
.prose .naver-content .se-fs-fs28{font-size:28px}
.prose .naver-content :is(.se-component,.se_component_wrap){margin-block:1.55em}
.prose .naver-content :is(.se-imageStrip-container,.se-imageGroup-container,.se_imageStripView){display:flex;align-items:flex-start;gap:4px;max-width:100%}
.prose .naver-content :is(.se-imageStrip-container,.se-imageGroup-container,.se_imageStripView)>*{flex:1 1 0;min-width:0;max-width:100%}
.prose .naver-content .se_imageStripArea{display:block;width:auto}
.prose .naver-content .se_imageStripView>.se_mediaArea{display:flex;flex-wrap:nowrap;align-items:flex-start;gap:4px;min-width:0;width:100%}
.prose .naver-content .se_imageStripView>.se_mediaArea>.se_imageStripArea{flex:0 1 auto;min-width:0}
.prose .naver-content :is(.se-imageStrip-container,.se-imageGroup-container,.se_imageStripView) img{display:block;width:100%;height:auto}
.prose .naver-content :is(.se-caption,.se_mediaCaption){margin-top:9px;font-size:13px;line-height:1.5;text-align:center;color:var(--ink-soft,#666)}
.prose .naver-content :is(.se_quote,.se_quotation,.se-quote){margin:1.5em 0;padding:1em 1.2em;border-inline-start:3px solid #aaa}
.prose .naver-content :is(.se_quote,.se_quotation,.se-quote) blockquote{font-family:inherit;font-size:inherit;color:inherit;margin:0;padding:0;border:0}
.prose .naver-content :is(.se_horizontalLine,.se-horizontalLine){margin:1.5em auto;max-width:100%}
.prose .naver-content :is(.se_horizontalLineView,.se-module-horizontalLine){border:0;border-top:1px solid #bbb;min-height:1px}
.prose .legacy-content .alignCenter{margin-inline:auto;text-align:center}
.prose .legacy-content .alignLeft{margin-inline:0 auto;text-align:left}
.prose .legacy-content .alignRight{margin-inline:auto 0;text-align:right}
.prose .legacy-content :is(.imageblock,.imageslideblock){max-width:100%}
.prose .legacy-content :is(.imageblock,.image-container) img{display:block;margin-inline:auto}
.prose .legacy-content figcaption{font-size:13px;line-height:1.5;text-align:center}
.prose .legacy-content blockquote[data-ke-style="style1"]{position:relative;border:0;margin:1.5em 0;padding:34px 0 0;text-align:center;font-family:inherit;font-size:20px;font-style:normal;line-height:30.6667px;color:#333}
.prose .legacy-content blockquote[data-ke-style="style1"]:before{content:"“";position:absolute;top:0;inset-inline:0;text-align:center;font:36px/34px Georgia,serif;color:#777}
.prose .legacy-content blockquote[data-ke-style="style2"]{margin:1.5em 0;padding:.8em 1.2em;border-inline-start:3px solid #999;font-family:inherit;font-size:inherit;color:inherit}
.prose .legacy-content blockquote[data-ke-style="style3"]{margin:1.5em 0;padding:21px 25px 20px;border:1px solid #ddd;background:#fcfcfc;text-align:left;font-family:inherit;font-size:inherit;line-height:1.75;color:#666}
.prose .legacy-content hr[data-ke-style]{position:relative;display:block;height:20px;margin:20px auto;padding:0;border:0;max-width:100%;font-size:0;line-height:0;background:none}
.prose .legacy-content hr[data-ke-style="style1"]{width:64px;background:radial-gradient(circle at 5px 2px,#777 0 2px,transparent 2.2px),radial-gradient(circle at 32px 2px,#777 0 2px,transparent 2.2px),radial-gradient(circle at 59px 2px,#777 0 2px,transparent 2.2px)}
.prose .legacy-content hr[data-ke-style="style3"]{width:64px;background:linear-gradient(135deg,transparent 0 46%,#999 47% 52%,transparent 53%) 0 0/16px 8px repeat-x,linear-gradient(45deg,transparent 0 46%,#999 47% 52%,transparent 53%) 8px 0/16px 8px repeat-x}
.prose .legacy-content hr[data-ke-style="style5"]{width:100%;background:linear-gradient(#555,#555) 0 1px/100% 1px no-repeat}
.prose .legacy-content hr:is([data-ke-style="style7"],[data-ke-style="style8"]){width:200px}
.prose .legacy-content hr:is([data-ke-style="style7"],[data-ke-style="style8"]):before{content:"";position:absolute;top:9px;left:0;width:100%;height:1px;background:#d0d0d0}
.prose .legacy-content hr[data-ke-style="style7"]:after{content:"";position:absolute;left:calc(50% - 6px);top:3px;width:12px;height:12px;border:1px solid #d0d0d0;background:white;transform:rotate(45deg)}
.prose .legacy-content hr[data-ke-style="style8"]:before{background:linear-gradient(to right,#d0d0d0 0 42.5%,transparent 42.5% 58%,#d0d0d0 58%)}
.prose .legacy-content hr[data-ke-style="style8"]:after{content:"";position:absolute;left:calc(50% - 4px);top:5px;width:8px;height:8px;border:1px solid #d0d0d0;border-radius:50%;background:white}
.prose .naver-content .quotation_bubble{border:1px solid #ddd;border-radius:12px;padding:20px}
.prose figure[data-ke-type="opengraph"]>a{display:grid;grid-template-columns:minmax(110px,.34fr) minmax(0,1fr);border:1px solid var(--line,#ddd);text-decoration:none;color:inherit;overflow:hidden}
.prose figure[data-ke-type="opengraph"]>a:not(:has(.og-image)){grid-template-columns:1fr}
.prose figure[data-ke-type="opengraph"] .og-image img{width:100%;height:100%;object-fit:cover}
.prose figure[data-ke-type="opengraph"] .og-text{padding:16px;min-width:0}
.prose figure[data-ke-type="opengraph"] .og-title{font-weight:700}
.prose figure[data-ke-type="opengraph"] .og-desc{font-size:14px;line-height:1.5}
.prose figure[data-ke-type="opengraph"] .og-host{font-size:12px;line-height:1.5}
.prose figure:is(.alignLeft,.alignCenter,.alignRight){max-width:100%}
.prose figure.alignCenter{margin-inline:auto}.prose figure.alignLeft{margin-inline:0 auto}.prose figure.alignRight{margin-inline:auto 0}
`;
