import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { isHtmlSourcePaste, htmlPasteDetectorScript, prepareHtmlSourcePaste } from '../src/lib/html-source-paste.ts';
import { sanitizeNativeHtml } from '../src/lib/native-content.ts';
const browser=runInNewContext(`${htmlPasteDetectorScript};isHtmlSourcePaste`);
for(const [value,expected]of [
 ['<p>내용</p>',true],['<custom-wrapper><p>내용</p></custom-wrapper>',true],['<!doctype html><html><head><title>제목</title></head><body><p>본문</p></body></html>',true],['<font color="red">글자</font>',true],['<center>가운데</center>',true],['<br>',true],['<img src="https://external.test/photo.png">',true],
 ['a < b && c > d',false],['const value = "<p>code</p>";',false],['```html\n<p>example</p>\n```',false],['설명 <p>예시</p>',false],['<T>value</T>',false],['<p>',false],['&lt;p&gt;내용&lt;/p&gt;',false]
]){assert.equal(isHtmlSourcePaste(value),expected,value);assert.equal(browser(value),expected,value);}
assert.deepEqual(prepareHtmlSourcePaste('<p>내용</p>'),{html:'<p>내용</p>',omitted:false});
const formatted='<p style="text-align:center;color:#123456"><strong>굵게</strong> <u>밑줄</u></p><table><tr><td colspan="2">표</td></tr></table>';
assert.equal(prepareHtmlSourcePaste(formatted).html,sanitizeNativeHtml('<p style="text-align:center;color:#123456"><strong>굵게</strong> <u>밑줄</u></p><table><tbody><tr><td colspan="2">표</td></tr></tbody></table>'));
const unsafe='<!doctype html><html><head><title>제외제목</title><style>body{background:url(https://external.test)}</style></head><body><unsupported><p onclick="bad()">본문<strong>중요</strong><img src="https://external.test/x" onerror="bad()"><a href="javascript:bad()">링크글자</a></p></unsupported><script>throw new Error("active")</script><textarea>입력글자</textarea></body></html>';
const result=prepareHtmlSourcePaste(unsafe);assert.equal(result.omitted,true);assert.match(result.html,/본문<strong>중요<\/strong>/);assert.match(result.html,/링크글자/);assert.match(result.html,/입력글자/);assert.doesNotMatch(result.html,/script|style|onclick|onerror|javascript|img|external|제외제목|unsupported|active/);
assert.throws(()=>prepareHtmlSourcePaste('comparison x < y'),/HTML_PASTE/);assert.throws(()=>prepareHtmlSourcePaste('<p>'+'x'.repeat(1_000_000)+'</p>'),/HTML_PASTE/);
console.log(JSON.stringify({suite:'html-source-paste',status:'PASS',behavior:'conservative source detection, matching browser detector, existing formatting sanitizer, wrapper text kept and active resources omitted'}));
