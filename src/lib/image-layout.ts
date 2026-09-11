// These classes are shared by saved HTML, the editor, preview and public pages.
export const IMAGE_LAYOUT_CLASSES = ['dwnc-image-layout','dwnc-image-item','dwnc-image-left','dwnc-image-center','dwnc-image-right','dwnc-image-original','dwnc-image-paragraph','dwnc-image-full','dwnc-image-cols-2','dwnc-image-cols-3'];
export const IMAGE_LAYOUT_CSS = String.raw`
:is(.prose,.html-editor) .dwnc-image-layout{display:block;box-sizing:border-box;width:min(100%,var(--reading,720px));max-width:none;margin:24px auto;clear:both;text-align:left}
:is(.prose,.html-editor) .dwnc-image-layout.dwnc-image-full{width:var(--image-layout-full-width,min(1200px,calc(100vw - 44px)));margin-inline:calc((100% - var(--image-layout-full-width,min(1200px,calc(100vw - 44px)))) / 2)}
:is(.prose,.html-editor) .dwnc-image-layout.dwnc-image-original{--dwnc-current-layout-width:min(var(--image-layout-full-width,min(1200px,calc(100vw - 44px))),max(min(100%,var(--reading,720px)),var(--dwnc-original-layout-width,720px)));width:var(--dwnc-current-layout-width);margin-inline:calc((100% - var(--dwnc-current-layout-width)) / 2)}
:is(.prose,.html-editor) .dwnc-image-item{min-width:0;max-width:100%;margin:0;padding:0}
:is(.prose,.html-editor) .dwnc-image-layout .dwnc-image-item :is(figure,div,p,span,a){max-width:100%!important;width:auto!important;margin-inline:0!important;float:none!important}
:is(.prose,.html-editor) .dwnc-image-layout .dwnc-image-item figure{padding:0;border:0;margin-block:0}
:is(.prose,.html-editor) .dwnc-image-layout .dwnc-image-item img{display:block!important;width:100%!important;max-width:100%!important;height:auto!important;object-fit:contain!important;margin:0!important;float:none!important}
:is(.prose,.html-editor) .dwnc-image-original .dwnc-image-item img{width:auto!important}
:is(.prose,.html-editor) .dwnc-image-left .dwnc-image-item img{margin-inline:0 auto!important}
:is(.prose,.html-editor) .dwnc-image-center .dwnc-image-item img{margin-inline:auto!important}
:is(.prose,.html-editor) .dwnc-image-right .dwnc-image-item img{margin-inline:auto 0!important}
:is(.prose,.html-editor) .dwnc-image-layout:is(.dwnc-image-cols-2,.dwnc-image-cols-3){display:grid;gap:12px;align-items:start;grid-template-columns:repeat(2,minmax(0,1fr))}
:is(.prose,.html-editor) .dwnc-image-layout.dwnc-image-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.preview-viewport{container-type:inline-size}.preview-viewport .dwnc-image-layout{--image-layout-full-width:100cqw}
.image-layout-dialog{width:min(700px,calc(100vw - 32px));max-height:85vh;overflow:auto;border:1px solid #ccc;border-radius:8px;padding:24px}.image-layout-dialog::backdrop{background:#0005}.image-layout-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;max-height:36vh;overflow:auto;margin:16px 0}.image-layout-choice{display:flex!important;gap:8px;align-items:center;border:2px solid #ddd;padding:8px;min-width:0}.image-layout-choice:has(:checked){border-color:#1769d2;background:#eef5ff}.image-layout-choice img{width:64px;height:55px;object-fit:contain}.image-layout-choice input{width:auto}.image-layout-dialog select{width:auto}.image-layout-dialog p{font-size:13px}.image-layout-error{color:#a22;min-height:1.4em}
@media(max-width:600px){.image-layout-list{grid-template-columns:repeat(2,minmax(0,1fr))}:is(.prose,.html-editor) .dwnc-image-layout:is(.dwnc-image-cols-2,.dwnc-image-cols-3){gap:6px}}
`;
