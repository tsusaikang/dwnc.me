import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CONTENT_ROOT_SELECTOR = '#postViewArea, [id^="post-view"]';
const PUBLIC_VISIBILITY = '전체공개';
const PRIVATE_VISIBILITY = '비공개';
const V2_DIRECTORY_NAME = 'recapture-v2';
const HTML_CHUNK_CHARACTERS = 48_000;
const IMMUTABLE_TEMP_MARKER = '.capture-tmp-';
const IMMUTABLE_TEMP_STALE_MS = 60 * 60 * 1000;
const IMMUTABLE_QUARANTINE_DIRECTORY = '.capture-quarantine';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function assertRecord(record) {
  if (!record || !/^\d{8,}$/.test(String(record.source_id ?? ''))) {
    throw new Error('Naver record has an invalid source_id.');
  }
  if (![PUBLIC_VISIBILITY, PRIVATE_VISIBILITY].includes(record.visibility)) {
    throw new Error(`Unsupported Naver visibility for ${record.source_id}.`);
  }
  const expectedUrl = `https://blog.naver.com/tsusai/${record.source_id}`;
  if (record.source_url !== expectedUrl) {
    throw new Error(`Unexpected Naver source URL for ${record.source_id}.`);
  }
}

function storagePaths(root, record) {
  assertRecord(record);
  const isPrivate = record.visibility === PRIVATE_VISIBILITY;
  const directory = isPrivate
    ? path.join(root, 'migration/private/naver', record.source_id, 'raw')
    : path.join(root, 'migration/raw/naver', record.source_id);

  return {
    isPrivate,
    directory,
    wrapper: path.join(directory, 'wrapper.html'),
    page: path.join(directory, 'page.html'),
    content: path.join(directory, 'content.html'),
    manifest: path.join(directory, 'manifest.json'),
  };
}

function storagePathsV2(root, record) {
  const legacy = storagePaths(root, record);
  const directory = path.join(legacy.directory, V2_DIRECTORY_NAME);
  return {
    ...legacy,
    directory,
    wrapper: path.join(directory, 'wrapper.html'),
    content: path.join(directory, 'content.html'),
    manifest: path.join(directory, 'manifest.json'),
    legacy,
  };
}

async function readExistingManifest(root, record) {
  const paths = storagePaths(root, record);
  try {
    const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'));
    if (manifest.source_id !== String(record.source_id) || manifest.visibility !== record.visibility) {
      throw new Error(`Existing manifest identity mismatch for ${record.source_id}.`);
    }
    return { manifest, paths };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function waitForPostRoot(tab, frame, sourceId, attempts = 15) {
  let previousLength = -1;
  let stableChecks = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const root = frame.locator(CONTENT_ROOT_SELECTOR).first();
    if (await root.count()) {
      const currentLength = await root.evaluate((element) => element.innerHTML.length);
      stableChecks = currentLength > 0 && currentLength === previousLength ? stableChecks + 1 : 0;
      if (stableChecks >= 1) return;
      previousLength = currentLength;
    }
    await tab.playwright.waitForTimeout(500);
  }
  throw new Error(`Naver post content root did not load for ${sourceId}.`);
}

async function inspectOuterHtml(locator) {
  return locator.evaluate((element) => {
    const utf8Encode = (value) => {
      let output = '';
      for (let index = 0; index < value.length; index += 1) {
        let code = value.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
          const low = value.charCodeAt(index + 1);
          if (low >= 0xDC00 && low <= 0xDFFF) {
            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
            index += 1;
          }
        }
        if (code < 0x80) {
          output += String.fromCharCode(code);
        } else if (code < 0x800) {
          output += String.fromCharCode(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
        } else if (code < 0x10000) {
          output += String.fromCharCode(
            0xE0 | (code >> 12),
            0x80 | ((code >> 6) & 0x3F),
            0x80 | (code & 0x3F),
          );
        } else {
          output += String.fromCharCode(
            0xF0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3F),
            0x80 | ((code >> 6) & 0x3F),
            0x80 | (code & 0x3F),
          );
        }
      }
      return output;
    };
    const sha256Hex = (ascii) => {
      const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
      const maxWord = 2 ** 32;
      const words = [];
      const hash = [];
      const constants = [];
      const isComposite = {};
      let primeCounter = 0;
      for (let candidate = 2; primeCounter < 64; candidate += 1) {
        if (!isComposite[candidate]) {
          for (let multiple = candidate * candidate; multiple < 313; multiple += candidate) {
            isComposite[multiple] = true;
          }
          if (primeCounter < 8) hash[primeCounter] = ((candidate ** 0.5) * maxWord) | 0;
          constants[primeCounter] = ((candidate ** (1 / 3)) * maxWord) | 0;
          primeCounter += 1;
        }
      }

      const bitLength = ascii.length * 8;
      ascii += '\x80';
      while (ascii.length % 64 !== 56) ascii += '\x00';
      for (let index = 0; index < ascii.length; index += 1) {
        words[index >> 2] |= ascii.charCodeAt(index) << ((3 - index) % 4) * 8;
      }
      words[words.length] = (bitLength / maxWord) | 0;
      words[words.length] = bitLength;

      let offset = 0;
      while (offset < words.length) {
        const schedule = words.slice(offset, offset += 16);
        const previous = hash.slice(0);
        for (let round = 0; round < 64; round += 1) {
          const w15 = schedule[round - 15];
          const w2 = schedule[round - 2];
          const a = hash[0];
          const e = hash[4];
          const word = schedule[round] = round < 16
            ? schedule[round]
            : (
              schedule[round - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + schedule[round - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0;
          const temp1 = (
            hash[7]
            + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
            + ((e & hash[5]) ^ ((~e) & hash[6]))
            + constants[round]
            + word
          ) | 0;
          const temp2 = (
            (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))
          ) | 0;
          hash.unshift((temp1 + temp2) | 0);
          hash[4] = (hash[4] + temp1) | 0;
          hash.pop();
        }
        for (let index = 0; index < 8; index += 1) hash[index] = (hash[index] + previous[index]) | 0;
      }

      let result = '';
      for (const value of hash) {
        for (let byte = 3; byte >= 0; byte -= 1) {
          result += ((value >> (byte * 8)) & 255).toString(16).padStart(2, '0');
        }
      }
      return result;
    };
    const html = element.outerHTML;
    const encoded = utf8Encode(html);
    const tagName = element.tagName.toLowerCase();
    return {
      characters: html.length,
      bytes: encoded.length,
      sha256: sha256Hex(encoded),
      root_tag: tagName,
      root_id: element.id || null,
      root_closed: html.endsWith(`</${tagName}>`),
    };
  }, undefined, { timeoutMs: 30_000 });
}

async function readOuterHtmlChunked(tab, locator, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const before = await inspectOuterHtml(locator);
      const chunks = [];
      for (let start = 0; start < before.characters; start += HTML_CHUNK_CHARACTERS) {
        const end = Math.min(start + HTML_CHUNK_CHARACTERS, before.characters);
        const chunk = await locator.evaluate(
          (element, range) => element.outerHTML.slice(range.start, range.end),
          { start, end },
          { timeoutMs: 30_000 },
        );
        if (typeof chunk !== 'string' || chunk.length !== end - start) {
          throw new Error(`${label} chunk ${start}-${end} was truncated in transit.`);
        }
        chunks.push(chunk);
      }

      const after = await inspectOuterHtml(locator);
      const html = chunks.join('');
      const local = {
        characters: html.length,
        bytes: Buffer.byteLength(html),
        sha256: sha256(html),
        root_closed: html.endsWith(`</${before.root_tag}>`),
      };
      const stable = before.characters === after.characters
        && before.bytes === after.bytes
        && before.sha256 === after.sha256;
      const matchesBrowser = local.characters === before.characters
        && local.bytes === before.bytes
        && local.sha256 === before.sha256;
      if (!stable || !matchesBrowser || !before.root_closed || !after.root_closed || !local.root_closed) {
        throw new Error(`${label} changed during chunked capture or failed completeness verification: ${JSON.stringify({
          stable,
          matchesBrowser,
          before,
          after,
          local,
        })}`);
      }
      return {
        html,
        chunk_characters: HTML_CHUNK_CHARACTERS,
        chunks: chunks.length,
        browser_before: before,
        browser_after: after,
        local,
        verified_complete: true,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await tab.playwright.waitForTimeout(750 * attempt);
    }
  }
  throw new Error(`${label} could not be captured completely: ${lastError?.message ?? lastError}`);
}

async function readWrapperHtmlVerified(tab, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const observe = () => tab.playwright.evaluate(() => {
        const html = document.documentElement.outerHTML;
        return {
          html,
          characters: html.length,
          root_tag: document.documentElement.tagName.toLowerCase(),
          root_id: document.documentElement.id || null,
          root_closed: html.endsWith('</html>'),
        };
      }, undefined, { timeoutMs: 30_000 });
      const beforeResult = await observe();
      const afterResult = await observe();
      const decorate = (result) => ({
        characters: result.characters,
        bytes: Buffer.byteLength(result.html),
        sha256: sha256(result.html),
        root_tag: result.root_tag,
        root_id: result.root_id,
        root_closed: result.root_closed,
        sha256_method: 'node-sha256-of-complete-browser-return',
      });
      const before = decorate(beforeResult);
      const after = decorate(afterResult);
      const local = {
        characters: beforeResult.html.length,
        bytes: Buffer.byteLength(beforeResult.html),
        sha256: sha256(beforeResult.html),
        root_closed: beforeResult.html.endsWith('</html>'),
      };
      const stable = before.characters === after.characters
        && before.bytes === after.bytes
        && before.sha256 === after.sha256;
      if (!stable || !before.root_closed || !after.root_closed || !local.root_closed) {
        throw new Error(`${label} changed during capture or was incomplete.`);
      }
      return {
        html: beforeResult.html,
        chunk_characters: HTML_CHUNK_CHARACTERS,
        chunks: 1,
        browser_before: before,
        browser_after: after,
        local,
        verified_complete: true,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await tab.playwright.waitForTimeout(500 * attempt);
    }
  }
  throw new Error(`${label} could not be captured completely: ${lastError?.message ?? lastError}`);
}

function legacyHtmlCompleteness(html, browserInnerCharacters, expectedRoot = null) {
  const rootMatch = html.match(/^\s*<([a-z][a-z0-9:-]*)\b/i);
  const rootTag = expectedRoot || rootMatch?.[1]?.toLowerCase() || null;
  const closing = rootTag ? `</${rootTag}>` : null;
  const trimmed = html.trimEnd();
  const closeIndex = closing ? trimmed.lastIndexOf(closing) : -1;
  const startIndex = html.indexOf('>');
  const rootClosed = Boolean(closing) && closeIndex >= 0 && closeIndex + closing.length === trimmed.length;
  const innerCharacters = rootClosed && startIndex >= 0 ? html.slice(startIndex + 1, closeIndex).length : null;
  return {
    root_tag: rootTag,
    root_closed: rootClosed,
    inner_characters: innerCharacters,
    browser_observed_inner_characters: browserInnerCharacters ?? null,
    browser_inner_characters_match: Number.isInteger(browserInnerCharacters)
      ? innerCharacters === browserInnerCharacters
      : null,
  };
}

export async function inspectLegacyNaverCapture(root, record) {
  const paths = storagePaths(root, record);
  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'));
  const [wrapper, page, content] = await Promise.all([
    readFile(paths.wrapper, 'utf8'),
    readFile(paths.page, 'utf8'),
    readFile(paths.content, 'utf8'),
  ]);
  const fileCheck = (value, metadata) => ({
    bytes: Buffer.byteLength(value),
    sha256: sha256(value),
    bytes_match: Buffer.byteLength(value) === metadata.bytes,
    sha256_match: sha256(value) === metadata.sha256,
  });
  const contentCompleteness = legacyHtmlCompleteness(content, manifest.detail?.html_length);
  return {
    source_id: String(record.source_id),
    visibility: record.visibility,
    wrapper: {
      ...fileCheck(wrapper, manifest.files.wrapper),
      root_closed: /<\/html>\s*$/i.test(wrapper),
    },
    page: {
      ...fileCheck(page, manifest.files.page),
      root_closed: /<\/html>\s*$/i.test(page),
      canonical: false,
    },
    content: {
      ...fileCheck(content, manifest.files.content),
      ...contentCompleteness,
      canonical_candidate: contentCompleteness.root_closed
        && contentCompleteness.browser_inner_characters_match
        && Buffer.byteLength(content) === manifest.files.content.bytes
        && sha256(content) === manifest.files.content.sha256,
    },
  };
}

export async function captureRenderedNaverPost(tab, record) {
  assertRecord(record);
  await tab.goto(record.source_url);
  await tab.playwright.waitForLoadState({ state: 'domcontentloaded', timeoutMs: 30_000 });
  await tab.playwright.locator('iframe#mainFrame').waitFor({ state: 'attached', timeoutMs: 3_000 });

  const wrapperHtml = await tab.playwright.evaluate(
    () => `<!DOCTYPE html>\n${document.documentElement.outerHTML}`,
    undefined,
    { timeoutMs: 30_000 },
  );
  const frame = tab.playwright.frameLocator('iframe#mainFrame');
  await frame.locator('body').waitFor({ state: 'attached', timeoutMs: 3_000 });
  await waitForPostRoot(tab, frame, record.source_id);

  const root = frame.locator(CONTENT_ROOT_SELECTOR).first();
  const detail = await root.evaluate((body) => {
    const count = (selector) => body.querySelectorAll(selector).length;
    const images = Array.from(body.querySelectorAll('img'));
    const links = Array.from(body.querySelectorAll('a'));
    const selectedImageUrl = (image) => image.getAttribute('data-lazy-src')
      || image.getAttribute('data-origin-src')
      || image.getAttribute('data-src')
      || image.getAttribute('src')
      || '';

    const imageRecords = images.map((image, index) => ({
      index,
      src: image.getAttribute('src'),
      lazy_src: image.getAttribute('data-lazy-src'),
      origin_src: image.getAttribute('data-origin-src'),
      data_src: image.getAttribute('data-src'),
      srcset: image.getAttribute('srcset'),
      alt: image.getAttribute('alt'),
      title: image.getAttribute('title'),
      width: image.getAttribute('width'),
      height: image.getAttribute('height'),
      class_name: String(image.className || ''),
      selected_source_url: selectedImageUrl(image),
    }));

    const linkRecords = links.map((anchor, index) => ({
      index,
      href: anchor.getAttribute('href'),
      target: anchor.getAttribute('target'),
      rel: anchor.getAttribute('rel'),
      download: anchor.getAttribute('download'),
      class_name: String(anchor.className || ''),
      onclick: anchor.getAttribute('onclick'),
      title: anchor.getAttribute('title'),
      text: (anchor.innerText || '').trim(),
      data_attributes: Object.fromEntries(
        Array.from(anchor.attributes)
          .filter((attribute) => attribute.name.startsWith('data-'))
          .map((attribute) => [attribute.name, attribute.value]),
      ),
    }));
    const attachmentRecords = linkRecords
      .filter((anchor) => {
        const linkType = anchor.data_attributes['data-linktype'];
        const className = anchor.class_name || '';
        const action = [anchor.href, anchor.onclick].filter(Boolean).join(' ');
        return linkType === 'file'
          || /(^|\s)(se-(module-)?file|__se_file|_fileUnit|file_(name|download|btn))(\s|$)/i.test(className)
          || /FileDownload|AttachFile|attachment|download/i.test(action);
      })
      .map((anchor) => ({
        ...anchor,
        data_attributes: { ...anchor.data_attributes },
      }));

    const classNames = Array.from(body.querySelectorAll('[class]'))
      .flatMap((element) => Array.from(element.classList));
    const editorClasses = Object.entries(classNames.reduce((result, name) => {
      if (/^(se|se2|__se)[-_]/i.test(name) || /(^|[-_])(se|post|file|image|video)([-_]|$)/i.test(name)) {
        result[name] = (result[name] || 0) + 1;
      }
      return result;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 120);

    const selectorCounts = {
      se_main_container: count('.se-main-container'),
      se_component: count('.se-component'),
      se_module_text: count('.se-module-text'),
      se_module_image: count('.se-module-image'),
      se_component_wrap: count('.se_component_wrap'),
      se_section_area: count('.se_sectionArea'),
      se2_input_area: count('.se2_inputarea'),
      post_view: count('[id^="post-view"], .post-view, #postViewArea'),
      images: images.length,
      links: links.length,
      attachments: attachmentRecords.length,
      iframes: count('iframe'),
      videos: count('video, iframe[src*="video"], [class*="video"]'),
      maps: count('[class*="map"], iframe[src*="map"]'),
      tables: count('table'),
    };
    const editorGeneration = selectorCounts.se_main_container || selectorCounts.se_component
      ? 'smarteditor-one'
      : selectorCounts.se_component_wrap || selectorCounts.se_section_area
        ? 'smarteditor-3'
        : 'legacy-smarteditor';

    return {
      html_length: body.innerHTML.length,
      text_length: (body.innerText || '').length,
      selector_counts: selectorCounts,
      editor_generation: editorGeneration,
      editor_classes: editorClasses,
      images: imageRecords,
      links: linkRecords,
      attachments: attachmentRecords,
      embeds: Array.from(body.querySelectorAll('iframe,video,audio')).map((element) => ({
        tag: element.tagName,
        src: element.getAttribute('src'),
        class_name: String(element.className || ''),
      })),
      content_html: body.outerHTML,
    };
  }, undefined, { timeoutMs: 30_000 });

  const pageHtml = await frame.locator('body').evaluate(
    (body) => `<!DOCTYPE html>\n${body.ownerDocument.documentElement.outerHTML}`,
    undefined,
    { timeoutMs: 30_000 },
  );

  return {
    source_id: String(record.source_id),
    visibility: record.visibility,
    published_date: record.published_date,
    source_url: record.source_url,
    capture_url: await tab.playwright.locator('iframe#mainFrame').getAttribute('src', { timeoutMs: 30_000 }),
    captured_at: new Date().toISOString(),
    wrapper_html: wrapperHtml,
    page_html: pageHtml,
    detail,
  };
}

export async function captureRenderedNaverPostV2(tab, record) {
  assertRecord(record);
  await tab.goto(record.source_url);
  await tab.playwright.waitForLoadState({ state: 'domcontentloaded', timeoutMs: 30_000 });
  await tab.playwright.locator('iframe#mainFrame').waitFor({ state: 'attached', timeoutMs: 3_000 });

  const frame = tab.playwright.frameLocator('iframe#mainFrame');
  await frame.locator('body').waitFor({ state: 'attached', timeoutMs: 3_000 });
  await waitForPostRoot(tab, frame, record.source_id);

  const root = frame.locator(CONTENT_ROOT_SELECTOR).first();
  const inspection = await root.evaluate((body) => {
    const count = (selector) => body.querySelectorAll(selector).length;
    const selectorCounts = {
      se_main_container: count('.se-main-container'),
      se_component: count('.se-component'),
      se_component_wrap: count('.se_component_wrap'),
      se_section_area: count('.se_sectionArea'),
      images: count('img'),
      links: count('a'),
      attachments: count('a[data-linktype="file"], a[class*="file"], a[href*="FileDownload"]'),
      iframes: count('iframe'),
      videos: count('video, iframe[src*="video"], [class*="video"]'),
    };
    const editorGeneration = selectorCounts.se_main_container || selectorCounts.se_component
      ? 'smarteditor-one'
      : selectorCounts.se_component_wrap || selectorCounts.se_section_area
        ? 'smarteditor-3'
        : 'legacy-smarteditor';
    return {
      inner_html_characters: body.innerHTML.length,
      text_characters: (body.innerText || '').length,
      selector_counts: selectorCounts,
      editor_generation: editorGeneration,
    };
  }, undefined, { timeoutMs: 30_000 });

  const content = await readOuterHtmlChunked(tab, root, `Naver ${record.source_id} article content`);
  const page = await inspectOuterHtml(frame.locator('html').first());
  const wrapperOuter = await readWrapperHtmlVerified(tab, `Naver ${record.source_id} wrapper`);

  if (inspection.inner_html_characters >= content.browser_before.characters) {
    throw new Error(`Naver ${record.source_id} content outerHTML is shorter than its observed innerHTML.`);
  }

  return {
    source_id: String(record.source_id),
    visibility: record.visibility,
    published_date: record.published_date,
    source_url: record.source_url,
    capture_url: await tab.playwright.locator('iframe#mainFrame').getAttribute('src', { timeoutMs: 30_000 }),
    captured_at: new Date().toISOString(),
    inspection,
    wrapper: {
      ...wrapperOuter,
      html: `<!DOCTYPE html>\n${wrapperOuter.html}`,
    },
    page,
    content,
  };
}

function isPathInside(boundary, candidate) {
  const relative = path.relative(path.resolve(boundary), path.resolve(candidate));
  return relative === ''
    || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function assertNoSymlinkPath(boundary, candidate, label = 'capture path') {
  const resolvedBoundary = path.resolve(boundary);
  const resolvedCandidate = path.resolve(candidate);
  if (!isPathInside(resolvedBoundary, resolvedCandidate)) {
    throw new Error(`${label} escapes its allowed storage boundary.`);
  }

  const boundaryStat = await lstat(resolvedBoundary);
  if (boundaryStat.isSymbolicLink() || !boundaryStat.isDirectory()) {
    throw new Error(`${label} has an invalid or symbolic-link storage boundary.`);
  }

  let current = resolvedBoundary;
  const relative = path.relative(resolvedBoundary, resolvedCandidate);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const currentStat = await lstat(current);
    if (currentStat.isSymbolicLink()) {
      throw new Error(`${label} must not contain symbolic links.`);
    }
  }
}

async function readRegularFileNoFollow(filePath, boundary, label = 'capture file') {
  const resolvedPath = path.resolve(filePath);
  await assertNoSymlinkPath(boundary, resolvedPath, label);
  const before = await lstat(resolvedPath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${label} is not a regular non-symbolic-link file.`);
  }

  let handle;
  try {
    handle = await open(resolvedPath, fsConstants.O_RDONLY | NO_FOLLOW);
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) {
      throw new Error(`${label} changed while it was being opened.`);
    }
    return { bytes: await handle.readFile(), stat: after };
  } finally {
    await handle?.close();
  }
}

async function readImmutableTarget(filePath) {
  const before = await lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`Immutable capture target is not a regular non-symbolic-link file: ${filePath}`);
  }

  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | NO_FOLLOW);
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) {
      throw new Error(`Immutable capture target changed while it was being opened: ${filePath}`);
    }
    return await handle.readFile();
  } finally {
    await handle?.close();
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EBADF', 'EPERM', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

function immutableTempPrefix(filePath) {
  return `.${path.basename(filePath)}${IMMUTABLE_TEMP_MARKER}`;
}

function uniqueImmutableTempPath(filePath) {
  const token = randomBytes(12).toString('hex');
  return path.join(
    path.dirname(filePath),
    `${immutableTempPrefix(filePath)}${process.pid}-${Date.now()}-${token}`,
  );
}

async function quarantineByNoReplace(sourcePath, quarantineDirectory, originalName) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const quarantinePath = path.join(
      quarantineDirectory,
      `${originalName}.orphan-${Date.now()}-${randomBytes(10).toString('hex')}`,
    );
    try {
      await link(sourcePath, quarantinePath);
      await unlink(sourcePath);
      return quarantinePath;
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error(`Could not allocate a unique quarantine path for ${originalName}.`);
}

async function quarantineStaleImmutableTemps(filePath, now = Date.now()) {
  const directory = path.dirname(filePath);
  const prefix = immutableTempPrefix(filePath);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const quarantined = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix)) continue;
    const tempPath = path.join(directory, entry.name);
    let tempStat;
    try {
      tempStat = await lstat(tempPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      continue;
    }
    if (now - tempStat.mtimeMs < IMMUTABLE_TEMP_STALE_MS) continue;
    if (!tempStat.isFile() && !tempStat.isSymbolicLink()) continue;

    try {
      if (tempStat.isFile()) {
        try {
          const finalStat = await lstat(filePath);
          if (finalStat.isFile()
            && finalStat.dev === tempStat.dev
            && finalStat.ino === tempStat.ino) {
            await unlink(tempPath);
            await syncDirectory(directory);
            continue;
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }

      const quarantineDirectory = path.join(directory, IMMUTABLE_QUARANTINE_DIRECTORY);
      await mkdir(quarantineDirectory, { recursive: true, mode: 0o700 });
      const quarantineStat = await lstat(quarantineDirectory);
      if (quarantineStat.isSymbolicLink() || !quarantineStat.isDirectory()) {
        continue;
      }
      await chmod(quarantineDirectory, 0o700);

      if (tempStat.isFile() && tempStat.nlink === 1) {
        let handle;
        try {
          handle = await open(tempPath, fsConstants.O_RDWR | NO_FOLLOW);
          const openedStat = await handle.stat();
          if (!openedStat.isFile() || tempStat.dev !== openedStat.dev || tempStat.ino !== openedStat.ino) {
            continue;
          }
          await handle.chmod(0o600);
          await handle.sync();
        } finally {
          await handle?.close();
        }
      }

      quarantined.push(await quarantineByNoReplace(tempPath, quarantineDirectory, entry.name));
      await syncDirectory(quarantineDirectory);
      await syncDirectory(directory);
    } catch {
      // A uniquely named future write is still safe; an unsafe orphan is left untouched for manual review.
    }
  }
  return quarantined;
}

async function writeImmutable(filePath, value, mode = 0o600) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const finalMode = mode & 0o777;
  if (![0o600, 0o644].includes(finalMode)) {
    throw new Error(`Unsupported immutable capture mode ${finalMode.toString(8)} for ${filePath}.`);
  }

  await quarantineStaleImmutableTemps(filePath);
  try {
    const existing = await readImmutableTarget(filePath);
    if (!existing.equals(bytes)) {
      throw new Error(`Immutable capture already exists with different content: ${filePath}`);
    }
    return 'unchanged';
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const directory = path.dirname(filePath);
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error(`Immutable capture directory is not a regular directory: ${directory}`);
  }

  const tempPath = uniqueImmutableTempPath(filePath);
  let tempHandle;
  let tempExists = false;
  try {
    tempHandle = await open(
      tempPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | NO_FOLLOW,
      0o600,
    );
    tempExists = true;
    await tempHandle.chmod(0o600);
    await tempHandle.writeFile(bytes);
    await tempHandle.sync();
    await tempHandle.chmod(finalMode);
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = null;

    try {
      await link(tempPath, filePath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readImmutableTarget(filePath);
      if (!existing.equals(bytes)) {
        throw new Error(`Immutable capture already exists with different content: ${filePath}`);
      }
      return 'unchanged';
    }

    await syncDirectory(directory);
    await unlink(tempPath);
    tempExists = false;
    await syncDirectory(directory);
    return 'created';
  } finally {
    await tempHandle?.close();
    if (tempExists) {
      try {
        await unlink(tempPath);
        tempExists = false;
        await syncDirectory(directory);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
}

export async function saveRenderedNaverCapture(root, record, capture) {
  const paths = storagePaths(root, record);
  await mkdir(paths.directory, { recursive: true, mode: paths.isPrivate ? 0o700 : 0o755 });
  if (paths.isPrivate) {
    await chmod(path.join(root, 'migration/private'), 0o700);
    await chmod(path.join(root, 'migration/private/naver'), 0o700);
    await chmod(path.join(root, 'migration/private/naver', record.source_id), 0o700);
    await chmod(paths.directory, 0o700);
  }

  const wrapperStatus = await writeImmutable(paths.wrapper, capture.wrapper_html);
  const pageStatus = await writeImmutable(paths.page, capture.page_html);
  const contentStatus = await writeImmutable(paths.content, capture.detail.content_html);
  const relative = (filePath) => path.relative(root, filePath);
  const detail = { ...capture.detail };
  delete detail.content_html;

  const manifest = {
    version: 1,
    source: 'naver',
    source_id: String(record.source_id),
    source_url: record.source_url,
    capture_url: capture.capture_url,
    visibility: record.visibility,
    published_date: record.published_date,
    captured_at: capture.captured_at,
    capture_method: 'authenticated-rendered-dom',
    editor_generation: detail.editor_generation,
    source_record: record,
    files: {
      wrapper: {
        path: relative(paths.wrapper),
        bytes: Buffer.byteLength(capture.wrapper_html),
        sha256: sha256(capture.wrapper_html),
      },
      page: {
        path: relative(paths.page),
        bytes: Buffer.byteLength(capture.page_html),
        sha256: sha256(capture.page_html),
      },
      content: {
        path: relative(paths.content),
        bytes: Buffer.byteLength(capture.detail.content_html),
        sha256: sha256(capture.detail.content_html),
      },
    },
    detail,
    normalization_status: 'pending',
    media_status: 'pending',
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestStatus = await writeImmutable(paths.manifest, manifestText);

  return {
    source_id: String(record.source_id),
    visibility: record.visibility,
    editor_generation: detail.editor_generation,
    statuses: {
      wrapper: wrapperStatus,
      page: pageStatus,
      content: contentStatus,
      manifest: manifestStatus,
    },
    manifest_path: relative(paths.manifest),
  };
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireTrue(value, label) {
  if (value !== true) throw new Error(`${label} must be true.`);
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum}.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function decodeUtf8(bytes, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) {
    throw new Error(`${label} is not canonical UTF-8.`);
  }
  return text;
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(decodeUtf8(bytes, label));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function resolveRecordedPath(root, recordedPath, allowedBoundary, label) {
  if (typeof recordedPath !== 'string'
    || recordedPath.length === 0
    || recordedPath.includes('\0')
    || path.isAbsolute(recordedPath)) {
    throw new Error(`${label} has an invalid recorded path.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, recordedPath);
  if (!isPathInside(allowedBoundary, resolvedPath)) {
    throw new Error(`${label} escapes its allowed storage boundary.`);
  }
  if (path.relative(resolvedRoot, resolvedPath) !== recordedPath) {
    throw new Error(`${label} must use one normalized project-relative path.`);
  }
  return resolvedPath;
}

function assertExactPath(actualPath, expectedPath, label) {
  if (path.resolve(actualPath) !== path.resolve(expectedPath)) {
    throw new Error(`${label} does not match the required physical storage path.`);
  }
}

function serializedRootDetails(html, expectedRoot = null) {
  const withoutDoctype = html.replace(/^\s*<!doctype html>\s*/i, '');
  const rootMatch = withoutDoctype.match(/^\s*<([a-z][a-z0-9:-]*)\b/i);
  const rootTag = rootMatch?.[1]?.toLowerCase() || null;
  const expected = expectedRoot?.toLowerCase() || rootTag;
  return {
    root_tag: rootTag,
    root_closed: Boolean(expected)
      && rootTag === expected
      && withoutDoctype.trimEnd().endsWith(`</${expected}>`),
  };
}

function assertPrivateFileMode(result, paths, label) {
  if (paths.isPrivate && (result.stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must retain private mode 600.`);
  }
}

async function assertPrivateDirectoryModes(root, paths) {
  if (!paths.isPrivate) return;
  const directories = [
    path.join(root, 'migration/private'),
    path.join(root, 'migration/private/naver'),
    path.dirname(paths.legacy.directory),
    paths.legacy.directory,
    paths.directory,
  ];
  for (const directory of directories) {
    await assertNoSymlinkPath(root, directory, 'Private v2 storage directory');
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || (directoryStat.mode & 0o777) !== 0o700) {
      throw new Error('Private v2 storage directories must retain mode 700.');
    }
  }
}

async function verifyV2CanonicalFile({
  root,
  paths,
  manifest,
  legacyManifest,
  name,
}) {
  const metadata = requireObject(manifest.files?.[name], `Existing v2 ${name} metadata`);
  const expectedRole = name === 'wrapper' ? 'canonical-source-wrapper' : 'canonical-article-html';
  if (metadata.canonical !== true || metadata.role !== expectedRole) {
    throw new Error(`Existing v2 ${name} is not declared as the required canonical artifact.`);
  }
  requireInteger(metadata.characters, `Existing v2 ${name} character count`, 1);
  requireInteger(metadata.bytes, `Existing v2 ${name} byte count`, 1);
  requireSha256(metadata.sha256, `Existing v2 ${name} SHA-256`);

  const actualPath = resolveRecordedPath(
    root,
    metadata.path,
    paths.legacy.directory,
    `Existing v2 ${name}`,
  );
  const expectedPath = manifest.capture_method === 'authenticated-rendered-dom-chunked'
    ? paths[name]
    : paths.legacy[name];
  assertExactPath(actualPath, expectedPath, `Existing v2 ${name}`);

  const result = await readRegularFileNoFollow(actualPath, root, `Existing v2 ${name}`);
  assertPrivateFileMode(result, paths, `Existing v2 ${name}`);
  const text = decodeUtf8(result.bytes, `Existing v2 ${name}`);
  if (result.bytes.length !== metadata.bytes
    || text.length !== metadata.characters
    || sha256(result.bytes) !== metadata.sha256) {
    throw new Error(`Existing v2 ${name} failed byte, character, or SHA-256 integrity verification.`);
  }

  const verification = requireObject(metadata.verification, `Existing v2 ${name} verification`);
  requireTrue(verification.local_root_closed, `Existing v2 ${name} local_root_closed`);
  requireTrue(verification.verified_complete, `Existing v2 ${name} verified_complete`);
  const rootDetails = serializedRootDetails(text, name === 'wrapper' ? 'html' : null);
  if (!rootDetails.root_closed) {
    throw new Error(`Existing v2 ${name} does not end with its serialized root element.`);
  }

  if (manifest.capture_method === 'authenticated-rendered-dom-chunked') {
    requireInteger(manifest.chunk_characters, 'Existing v2 chunk_characters', 1);
    if (manifest.chunk_characters !== HTML_CHUNK_CHARACTERS) {
      throw new Error('Existing v2 chunk_characters does not match the capture policy.');
    }
    requireInteger(verification.chunk_characters, `Existing v2 ${name} chunk_characters`, 1);
    requireInteger(verification.chunks, `Existing v2 ${name} chunks`, 1);
    if (verification.chunk_characters !== manifest.chunk_characters) {
      throw new Error(`Existing v2 ${name} chunk size conflicts with the manifest.`);
    }
    for (const field of [
      'browser_stable_before_after',
      'browser_length_match',
      'browser_bytes_match',
      'browser_sha256_match',
    ]) {
      requireTrue(verification[field], `Existing v2 ${name} ${field}`);
    }

    const browser = requireObject(metadata.browser_outer_html, `Existing v2 ${name} browser evidence`);
    requireInteger(browser.characters, `Existing v2 ${name} browser characters`, 1);
    requireInteger(browser.bytes, `Existing v2 ${name} browser bytes`, 1);
    requireSha256(browser.sha256, `Existing v2 ${name} browser SHA-256`);
    requireTrue(browser.root_closed, `Existing v2 ${name} browser root_closed`);
    if (typeof browser.root_tag !== 'string' || !/^[a-z][a-z0-9:-]*$/.test(browser.root_tag)) {
      throw new Error(`Existing v2 ${name} browser root tag is invalid.`);
    }

    let browserOuterHtml = text;
    if (name === 'wrapper') {
      const doctypePrefix = '<!DOCTYPE html>\n';
      if (!text.startsWith(doctypePrefix)) {
        throw new Error('Existing v2 wrapper is missing the canonical DOCTYPE prefix.');
      }
      browserOuterHtml = text.slice(doctypePrefix.length);
      requireTrue(
        browser.file_has_doctype_prefix,
        'Existing v2 wrapper browser evidence file_has_doctype_prefix',
      );
      requireTrue(
        verification.file_sha256_includes_doctype_prefix,
        'Existing v2 wrapper file_sha256_includes_doctype_prefix',
      );
      requireSha256(verification.file_outer_html_sha256, 'Existing v2 wrapper outerHTML SHA-256');
      if (sha256(browserOuterHtml) !== verification.file_outer_html_sha256) {
        throw new Error('Existing v2 wrapper outerHTML SHA-256 evidence does not match disk.');
      }
    }

    if (browserOuterHtml.length !== browser.characters
      || Buffer.byteLength(browserOuterHtml) !== browser.bytes
      || sha256(browserOuterHtml) !== browser.sha256) {
      throw new Error(`Existing v2 ${name} browser evidence does not match the canonical file.`);
    }
    const browserRoot = serializedRootDetails(browserOuterHtml, browser.root_tag);
    if (!browserRoot.root_closed) {
      throw new Error(`Existing v2 ${name} browser root evidence is not closed on disk.`);
    }
    const expectedChunks = Math.max(1, Math.ceil(browser.characters / verification.chunk_characters));
    if (verification.chunks !== expectedChunks) {
      throw new Error(`Existing v2 ${name} chunk count is inconsistent with its browser length.`);
    }
  } else {
    for (const field of ['legacy_manifest_bytes_match', 'legacy_manifest_sha256_match']) {
      requireTrue(verification[field], `Existing v2 ${name} ${field}`);
    }
    const legacyMetadata = requireObject(legacyManifest.files?.[name], `Legacy ${name} metadata`);
    const legacyRecordedPath = resolveRecordedPath(
      root,
      legacyMetadata.path,
      paths.legacy.directory,
      `Legacy ${name}`,
    );
    assertExactPath(legacyRecordedPath, paths.legacy[name], `Legacy ${name}`);
    if (legacyMetadata.bytes !== metadata.bytes || legacyMetadata.sha256 !== metadata.sha256) {
      throw new Error(`Existing v2 ${name} does not match its immutable legacy manifest.`);
    }
    if (name === 'content') {
      requireTrue(
        verification.browser_inner_characters_match,
        'Existing v2 content browser_inner_characters_match',
      );
      requireInteger(legacyManifest.detail?.html_length, 'Legacy browser innerHTML length', 0);
      const completeness = legacyHtmlCompleteness(text, legacyManifest.detail.html_length);
      if (!completeness.root_closed || !completeness.browser_inner_characters_match) {
        throw new Error('Existing v2 content no longer matches its browser-observed innerHTML evidence.');
      }
      if (metadata.browser_observed_inner_html?.characters !== legacyManifest.detail.html_length) {
        throw new Error('Existing v2 content browser-observed length conflicts with the legacy manifest.');
      }
    }
  }

  return { ...result, text, path: actualPath };
}

async function verifyV2LegacyDiagnostic(root, paths, manifest, legacyManifest) {
  const diagnostic = requireObject(
    manifest.diagnostic?.legacy_page_v1,
    'Existing v2 legacy page diagnostic',
  );
  if (diagnostic.canonical !== false) {
    throw new Error('Existing v2 legacy page must remain explicitly non-canonical.');
  }
  requireInteger(diagnostic.bytes, 'Existing v2 legacy page byte count', 1);
  requireSha256(diagnostic.sha256, 'Existing v2 legacy page SHA-256');
  const diagnosticPath = resolveRecordedPath(
    root,
    diagnostic.path,
    paths.legacy.directory,
    'Existing v2 legacy page diagnostic',
  );
  assertExactPath(diagnosticPath, paths.legacy.page, 'Existing v2 legacy page diagnostic');
  const result = await readRegularFileNoFollow(diagnosticPath, root, 'Existing v2 legacy page diagnostic');
  assertPrivateFileMode(result, paths, 'Existing v2 legacy page diagnostic');
  const text = decodeUtf8(result.bytes, 'Existing v2 legacy page diagnostic');
  const actualSha256 = sha256(result.bytes);
  if (result.bytes.length !== diagnostic.bytes || actualSha256 !== diagnostic.sha256) {
    throw new Error('Existing v2 legacy page diagnostic failed disk integrity verification.');
  }

  const legacyPageMetadata = requireObject(legacyManifest.files?.page, 'Legacy page metadata');
  const legacyPageRecordedPath = resolveRecordedPath(
    root,
    legacyPageMetadata.path,
    paths.legacy.directory,
    'Legacy page',
  );
  assertExactPath(legacyPageRecordedPath, paths.legacy.page, 'Legacy page');
  if (legacyPageMetadata.bytes !== diagnostic.bytes || legacyPageMetadata.sha256 !== diagnostic.sha256) {
    throw new Error('Existing v2 legacy page diagnostic conflicts with the legacy manifest.');
  }
  requireTrue(diagnostic.manifest_bytes_match, 'Existing v2 legacy page manifest_bytes_match');
  requireTrue(diagnostic.manifest_sha256_match, 'Existing v2 legacy page manifest_sha256_match');
  const rootClosed = serializedRootDetails(text, 'html').root_closed;
  if (diagnostic.root_closed !== rootClosed
    || diagnostic.known_transport_truncated !== !rootClosed) {
    throw new Error('Existing v2 legacy page diagnostic has inconsistent truncation evidence.');
  }
}

async function readExistingV2(root, record) {
  const paths = storagePathsV2(root, record);
  let manifestResult;
  try {
    manifestResult = await readRegularFileNoFollow(paths.manifest, root, 'Existing v2 manifest');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  assertPrivateFileMode(manifestResult, paths, 'Existing v2 manifest');
  await assertPrivateDirectoryModes(root, paths);
  const manifest = parseJsonBytes(manifestResult.bytes, 'Existing v2 manifest');

  if (manifest.version !== 2
    || manifest.source !== 'naver'
    || manifest.source_id !== String(record.source_id)
    || manifest.source_url !== record.source_url
    || manifest.visibility !== record.visibility) {
    throw new Error(`Existing v2 manifest identity or source policy mismatch for ${record.source_id}.`);
  }
  const allowedMethods = [
    'authenticated-rendered-dom-chunked',
    'authenticated-rendered-dom-v1-verified-complete',
  ];
  if (!allowedMethods.includes(manifest.capture_method)) {
    throw new Error(`Existing v2 manifest has an unsupported capture method for ${record.source_id}.`);
  }

  const policy = requireObject(manifest.canonical_policy, 'Existing v2 canonical policy');
  if (policy.article_html !== 'files.content'
    || policy.source_wrapper !== 'files.wrapper'
    || policy.frame_page !== 'diagnostic.legacy_page_v1'
    || policy.frame_page_canonical !== false
    || typeof policy.rationale !== 'string'
    || policy.rationale.trim().length === 0) {
    throw new Error(`Existing v2 canonical policy is incomplete for ${record.source_id}.`);
  }

  const legacyManifestPath = resolveRecordedPath(
    root,
    manifest.legacy_manifest_path,
    paths.legacy.directory,
    'Existing v2 legacy manifest',
  );
  assertExactPath(legacyManifestPath, paths.legacy.manifest, 'Existing v2 legacy manifest');
  const legacyManifestResult = await readRegularFileNoFollow(
    legacyManifestPath,
    root,
    'Existing v2 legacy manifest',
  );
  assertPrivateFileMode(legacyManifestResult, paths, 'Existing v2 legacy manifest');
  const legacyManifest = parseJsonBytes(legacyManifestResult.bytes, 'Existing v2 legacy manifest');
  if (legacyManifest.version !== 1
    || legacyManifest.source !== 'naver'
    || legacyManifest.source_id !== String(record.source_id)
    || legacyManifest.source_url !== record.source_url
    || legacyManifest.visibility !== record.visibility) {
    throw new Error(`Existing v2 legacy manifest identity mismatch for ${record.source_id}.`);
  }

  if (manifest.capture_method === 'authenticated-rendered-dom-v1-verified-complete') {
    if (manifest.promotion?.copied_or_rewritten_raw_files !== false
      || typeof manifest.verified_at !== 'string'
      || manifest.verified_at.length === 0) {
      throw new Error(`Existing v2 promotion evidence is incomplete for ${record.source_id}.`);
    }
  } else {
    const observation = requireObject(
      manifest.diagnostic?.current_frame_page_observation,
      'Existing v2 current frame observation',
    );
    if (observation.canonical !== false || observation.transferred_to_disk !== false) {
      throw new Error(`Existing v2 current frame observation crosses the canonical boundary for ${record.source_id}.`);
    }
    requireInteger(observation.characters, 'Existing v2 current frame characters', 1);
    requireInteger(observation.bytes, 'Existing v2 current frame bytes', 1);
    requireSha256(observation.sha256, 'Existing v2 current frame SHA-256');
    requireTrue(observation.root_closed, 'Existing v2 current frame root_closed');
  }

  requireObject(manifest.files, 'Existing v2 files');
  await verifyV2CanonicalFile({ root, paths, manifest, legacyManifest, name: 'wrapper' });
  await verifyV2CanonicalFile({ root, paths, manifest, legacyManifest, name: 'content' });
  await verifyV2LegacyDiagnostic(root, paths, manifest, legacyManifest);
  return { manifest, paths };
}

export async function saveLegacyCompletenessManifestV2(root, record) {
  const existing = await readExistingV2(root, record);
  if (existing) {
    return {
      source_id: String(record.source_id),
      visibility: record.visibility,
      status: 'existing-v2',
      manifest_path: path.relative(root, existing.paths.manifest),
    };
  }

  const paths = storagePathsV2(root, record);
  const audit = await inspectLegacyNaverCapture(root, record);
  if (!audit.content.canonical_candidate || !audit.wrapper.root_closed) {
    throw new Error(`Legacy capture cannot be promoted for ${record.source_id}; a chunked recapture is required.`);
  }
  const legacyManifest = JSON.parse(await readFile(paths.legacy.manifest, 'utf8'));
  const [wrapper, page, content] = await Promise.all([
    readFile(paths.legacy.wrapper, 'utf8'),
    readFile(paths.legacy.page, 'utf8'),
    readFile(paths.legacy.content, 'utf8'),
  ]);
  await mkdir(paths.directory, { recursive: true, mode: paths.isPrivate ? 0o700 : 0o755 });
  if (paths.isPrivate) {
    await chmod(path.join(root, 'migration/private'), 0o700);
    await chmod(path.join(root, 'migration/private/naver'), 0o700);
    await chmod(path.join(root, 'migration/private/naver', record.source_id), 0o700);
    await chmod(paths.legacy.directory, 0o700);
    await chmod(paths.directory, 0o700);
  }

  const relative = (filePath) => path.relative(root, filePath);
  const manifest = {
    version: 2,
    source: 'naver',
    source_id: String(record.source_id),
    source_url: record.source_url,
    capture_url: legacyManifest.capture_url,
    visibility: record.visibility,
    published_date: record.published_date,
    captured_at: legacyManifest.captured_at,
    verified_at: new Date().toISOString(),
    capture_method: 'authenticated-rendered-dom-v1-verified-complete',
    editor_generation: legacyManifest.editor_generation,
    canonical_policy: {
      article_html: 'files.content',
      source_wrapper: 'files.wrapper',
      frame_page: 'diagnostic.legacy_page_v1',
      frame_page_canonical: false,
      rationale: 'The article root contains the authored post DOM. The full iframe page duplicates it with volatile platform UI and scripts, so the legacy page is diagnostic only.',
    },
    browser_inspection: {
      inner_html_characters: legacyManifest.detail.html_length,
      text_characters: legacyManifest.detail.text_length,
      selector_counts: legacyManifest.detail.selector_counts,
      editor_generation: legacyManifest.editor_generation,
    },
    files: {
      wrapper: {
        path: relative(paths.legacy.wrapper),
        role: 'canonical-source-wrapper',
        canonical: true,
        characters: wrapper.length,
        bytes: Buffer.byteLength(wrapper),
        sha256: sha256(wrapper),
        verification: {
          legacy_manifest_bytes_match: audit.wrapper.bytes_match,
          legacy_manifest_sha256_match: audit.wrapper.sha256_match,
          local_root_closed: audit.wrapper.root_closed,
          verified_complete: true,
        },
      },
      content: {
        path: relative(paths.legacy.content),
        role: 'canonical-article-html',
        canonical: true,
        characters: content.length,
        bytes: Buffer.byteLength(content),
        sha256: sha256(content),
        browser_observed_inner_html: {
          characters: legacyManifest.detail.html_length,
        },
        verification: {
          legacy_manifest_bytes_match: audit.content.bytes_match,
          legacy_manifest_sha256_match: audit.content.sha256_match,
          browser_inner_characters_match: audit.content.browser_inner_characters_match,
          local_root_closed: audit.content.root_closed,
          verified_complete: true,
        },
      },
    },
    diagnostic: {
      legacy_page_v1: {
        canonical: false,
        path: relative(paths.legacy.page),
        bytes: Buffer.byteLength(page),
        sha256: sha256(page),
        manifest_bytes_match: audit.page.bytes_match,
        manifest_sha256_match: audit.page.sha256_match,
        root_closed: audit.page.root_closed,
        known_transport_truncated: !audit.page.root_closed,
      },
    },
    legacy_manifest_path: relative(paths.legacy.manifest),
    promotion: {
      copied_or_rewritten_raw_files: false,
      basis: 'immutable SHA-256 and byte count, closed serialized root, and exact browser-observed innerHTML character count',
    },
  };
  const fileMode = paths.isPrivate ? 0o600 : 0o644;
  const manifestStatus = await writeImmutable(
    paths.manifest,
    `${JSON.stringify(manifest, null, 2)}\n`,
    fileMode,
  );
  return {
    source_id: String(record.source_id),
    visibility: record.visibility,
    status: 'promoted-v1-complete',
    manifest_status: manifestStatus,
    manifest_path: relative(paths.manifest),
  };
}

export async function saveRenderedNaverCaptureV2(root, record, capture) {
  const paths = storagePathsV2(root, record);
  const legacyManifest = JSON.parse(await readFile(paths.legacy.manifest, 'utf8'));
  const legacyPage = await readFile(paths.legacy.page, 'utf8');
  await mkdir(paths.directory, { recursive: true, mode: paths.isPrivate ? 0o700 : 0o755 });
  if (paths.isPrivate) {
    await chmod(path.join(root, 'migration/private'), 0o700);
    await chmod(path.join(root, 'migration/private/naver'), 0o700);
    await chmod(path.join(root, 'migration/private/naver', record.source_id), 0o700);
    await chmod(paths.legacy.directory, 0o700);
    await chmod(paths.directory, 0o700);
  }

  const fileMode = paths.isPrivate ? 0o600 : 0o644;
  const wrapperStatus = await writeImmutable(paths.wrapper, capture.wrapper.html, fileMode);
  const contentStatus = await writeImmutable(paths.content, capture.content.html, fileMode);
  const relative = (filePath) => path.relative(root, filePath);
  const fileRecord = (filePath, value, snapshot, role) => ({
    path: relative(filePath),
    role,
    canonical: true,
    characters: value.length,
    bytes: Buffer.byteLength(value),
    sha256: sha256(value),
    browser_outer_html: {
      characters: snapshot.browser_before.characters,
      bytes: snapshot.browser_before.bytes,
      sha256: snapshot.browser_before.sha256,
      sha256_method: snapshot.browser_before.sha256_method || 'browser-pure-js-sha256',
      root_tag: snapshot.browser_before.root_tag,
      root_id: snapshot.browser_before.root_id,
      root_closed: snapshot.browser_before.root_closed,
    },
    verification: {
      chunk_characters: snapshot.chunk_characters,
      chunks: snapshot.chunks,
      browser_stable_before_after: snapshot.browser_before.sha256 === snapshot.browser_after.sha256,
      browser_length_match: snapshot.local.characters === snapshot.browser_before.characters,
      browser_bytes_match: snapshot.local.bytes === snapshot.browser_before.bytes,
      browser_sha256_match: snapshot.local.sha256 === snapshot.browser_before.sha256,
      local_root_closed: snapshot.local.root_closed,
      verified_complete: snapshot.verified_complete,
    },
  });
  const wrapperRecord = fileRecord(paths.wrapper, capture.wrapper.html, capture.wrapper, 'canonical-source-wrapper');
  wrapperRecord.browser_outer_html.file_has_doctype_prefix = true;
  wrapperRecord.verification.file_outer_html_sha256 = capture.wrapper.local.sha256;
  wrapperRecord.verification.file_sha256_includes_doctype_prefix = true;

  const manifest = {
    version: 2,
    source: 'naver',
    source_id: String(record.source_id),
    source_url: record.source_url,
    capture_url: capture.capture_url,
    visibility: record.visibility,
    published_date: record.published_date,
    captured_at: capture.captured_at,
    capture_method: 'authenticated-rendered-dom-chunked',
    chunk_characters: HTML_CHUNK_CHARACTERS,
    editor_generation: capture.inspection.editor_generation,
    canonical_policy: {
      article_html: 'files.content',
      source_wrapper: 'files.wrapper',
      frame_page: 'diagnostic.legacy_page_v1',
      frame_page_canonical: false,
      rationale: 'The article root contains the authored post DOM. The full iframe page duplicates it with volatile platform UI and scripts, so the legacy page is diagnostic only.',
    },
    browser_inspection: capture.inspection,
    files: {
      wrapper: wrapperRecord,
      content: fileRecord(paths.content, capture.content.html, capture.content, 'canonical-article-html'),
    },
    diagnostic: {
      current_frame_page_observation: {
        canonical: false,
        transferred_to_disk: false,
        ...capture.page,
      },
      legacy_page_v1: {
        canonical: false,
        path: legacyManifest.files.page.path,
        bytes: Buffer.byteLength(legacyPage),
        sha256: sha256(legacyPage),
        manifest_bytes_match: Buffer.byteLength(legacyPage) === legacyManifest.files.page.bytes,
        manifest_sha256_match: sha256(legacyPage) === legacyManifest.files.page.sha256,
        root_closed: /<\/html>\s*$/i.test(legacyPage),
        known_transport_truncated: !/<\/html>\s*$/i.test(legacyPage),
      },
    },
    legacy_manifest_path: relative(paths.legacy.manifest),
  };

  if (!manifest.files.content.verification.verified_complete
    || !manifest.files.content.verification.browser_sha256_match
    || !manifest.files.wrapper.verification.verified_complete
    || !manifest.files.wrapper.verification.browser_sha256_match) {
    throw new Error(`V2 completeness verification failed for ${record.source_id}.`);
  }
  const manifestStatus = await writeImmutable(
    paths.manifest,
    `${JSON.stringify(manifest, null, 2)}\n`,
    fileMode,
  );

  return {
    source_id: String(record.source_id),
    visibility: record.visibility,
    editor_generation: capture.inspection.editor_generation,
    statuses: { wrapper: wrapperStatus, content: contentStatus, manifest: manifestStatus },
    manifest_path: relative(paths.manifest),
    content_characters: capture.content.local.characters,
    content_bytes: capture.content.local.bytes,
    content_sha256: capture.content.local.sha256,
  };
}

export async function captureAndSaveNaverPost(tab, root, record) {
  const existing = await readExistingManifest(root, record);
  if (existing) {
    return {
      source_id: String(record.source_id),
      visibility: record.visibility,
      editor_generation: existing.manifest.editor_generation,
      status: 'existing',
      manifest_path: path.relative(root, existing.paths.manifest),
    };
  }

  const capture = await captureRenderedNaverPost(tab, record);
  const saved = await saveRenderedNaverCapture(root, record, capture);
  return { ...saved, status: 'captured' };
}

export async function captureAndSaveNaverPostV2(tab, root, record) {
  const existing = await readExistingV2(root, record);
  if (existing) {
    return {
      source_id: String(record.source_id),
      visibility: record.visibility,
      editor_generation: existing.manifest.editor_generation,
      status: 'existing',
      manifest_path: path.relative(root, existing.paths.manifest),
    };
  }

  const capture = await captureRenderedNaverPostV2(tab, record);
  const saved = await saveRenderedNaverCaptureV2(root, record, capture);
  return { ...saved, status: 'captured-v2' };
}

async function selfTestPathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function createSelfTestV2Fixture(root, record, { wrapperRecordedPath, wrapperSymlinkTarget } = {}) {
  const paths = storagePathsV2(root, record);
  await mkdir(paths.directory, { recursive: true, mode: 0o755 });
  const wrapper = '<!DOCTYPE html>\n<html><body>fixture wrapper</body></html>';
  const content = '<div id="postViewArea"><p>fixture content</p></div>';
  const page = '<!DOCTYPE html>\n<html><body>known truncated diagnostic';
  const contentCompleteness = legacyHtmlCompleteness(content, null);
  const relative = (filePath) => path.relative(root, filePath);
  const fileMetadata = (filePath, value) => ({
    path: relative(filePath),
    bytes: Buffer.byteLength(value),
    sha256: sha256(value),
  });

  await writeFile(paths.legacy.wrapper, wrapper, { mode: 0o644 });
  await writeFile(paths.legacy.content, content, { mode: 0o644 });
  await writeFile(paths.legacy.page, page, { mode: 0o644 });
  if (wrapperSymlinkTarget) {
    await unlink(paths.legacy.wrapper);
    await symlink(wrapperSymlinkTarget, paths.legacy.wrapper);
  }

  const legacyManifest = {
    version: 1,
    source: 'naver',
    source_id: String(record.source_id),
    source_url: record.source_url,
    capture_url: `/PostView.naver?blogId=tsusai&logNo=${record.source_id}`,
    visibility: record.visibility,
    published_date: '2000-01-01',
    captured_at: '2000-01-01T00:00:00.000Z',
    capture_method: 'authenticated-rendered-dom',
    editor_generation: 'legacy-smarteditor',
    files: {
      wrapper: fileMetadata(paths.legacy.wrapper, wrapper),
      page: fileMetadata(paths.legacy.page, page),
      content: fileMetadata(paths.legacy.content, content),
    },
    detail: {
      html_length: contentCompleteness.inner_characters,
      text_length: 15,
      selector_counts: {},
    },
  };
  await writeFile(paths.legacy.manifest, `${JSON.stringify(legacyManifest, null, 2)}\n`, { mode: 0o644 });

  const canonicalRecord = (filePath, value, role, extraVerification = {}) => ({
    path: relative(filePath),
    role,
    canonical: true,
    characters: value.length,
    bytes: Buffer.byteLength(value),
    sha256: sha256(value),
    verification: {
      legacy_manifest_bytes_match: true,
      legacy_manifest_sha256_match: true,
      local_root_closed: true,
      verified_complete: true,
      ...extraVerification,
    },
  });
  const wrapperRecord = canonicalRecord(
    paths.legacy.wrapper,
    wrapper,
    'canonical-source-wrapper',
  );
  if (wrapperRecordedPath) wrapperRecord.path = wrapperRecordedPath;
  const contentRecord = canonicalRecord(
    paths.legacy.content,
    content,
    'canonical-article-html',
    { browser_inner_characters_match: true },
  );
  contentRecord.browser_observed_inner_html = {
    characters: contentCompleteness.inner_characters,
  };

  const manifest = {
    version: 2,
    source: 'naver',
    source_id: String(record.source_id),
    source_url: record.source_url,
    capture_url: legacyManifest.capture_url,
    visibility: record.visibility,
    published_date: legacyManifest.published_date,
    captured_at: legacyManifest.captured_at,
    verified_at: '2000-01-01T00:00:01.000Z',
    capture_method: 'authenticated-rendered-dom-v1-verified-complete',
    editor_generation: legacyManifest.editor_generation,
    canonical_policy: {
      article_html: 'files.content',
      source_wrapper: 'files.wrapper',
      frame_page: 'diagnostic.legacy_page_v1',
      frame_page_canonical: false,
      rationale: 'Self-test fixture keeps the legacy frame page diagnostic only.',
    },
    browser_inspection: {
      inner_html_characters: contentCompleteness.inner_characters,
      text_characters: 15,
      selector_counts: {},
      editor_generation: legacyManifest.editor_generation,
    },
    files: { wrapper: wrapperRecord, content: contentRecord },
    diagnostic: {
      legacy_page_v1: {
        canonical: false,
        path: relative(paths.legacy.page),
        bytes: Buffer.byteLength(page),
        sha256: sha256(page),
        manifest_bytes_match: true,
        manifest_sha256_match: true,
        root_closed: false,
        known_transport_truncated: true,
      },
    },
    legacy_manifest_path: relative(paths.legacy.manifest),
    promotion: {
      copied_or_rewritten_raw_files: false,
      basis: 'self-test integrity evidence',
    },
  };
  await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return paths;
}

export async function runNaverCaptureStorageSelfTest() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'dwnc-naver-capture-storage-'));
  const checks = [];
  try {
    const atomicDirectory = path.join(fixtureRoot, 'atomic');
    await mkdir(atomicDirectory, { mode: 0o700 });

    const target = path.join(atomicDirectory, 'immutable.bin');
    assert.equal(await writeImmutable(target, 'canonical bytes', 0o600), 'created');
    assert.equal(await writeImmutable(target, 'canonical bytes', 0o600), 'unchanged');
    await assert.rejects(
      writeImmutable(target, 'different bytes', 0o600),
      /already exists with different content/,
    );
    assert.equal(await readFile(target, 'utf8'), 'canonical bytes');
    assert.equal((await lstat(target)).mode & 0o777, 0o600);
    checks.push('atomic-create-identical-retry-and-no-replace');

    const raceTarget = path.join(atomicDirectory, 'concurrent.bin');
    const race = await Promise.allSettled([
      writeImmutable(raceTarget, 'first contender', 0o600),
      writeImmutable(raceTarget, 'second contender', 0o600),
    ]);
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(race.filter((result) => result.status === 'rejected').length, 1);
    assert.ok(['first contender', 'second contender'].includes(await readFile(raceTarget, 'utf8')));
    checks.push('concurrent-no-replace-commit');

    const partialTarget = path.join(atomicDirectory, 'partial-recovery.bin');
    const staleTemp = path.join(
      atomicDirectory,
      `${immutableTempPrefix(partialTarget)}interrupted-fixture`,
    );
    await writeFile(staleTemp, 'interrupted partial bytes', { mode: 0o644 });
    const staleDate = new Date(Date.now() - IMMUTABLE_TEMP_STALE_MS - 60_000);
    await utimes(staleTemp, staleDate, staleDate);
    assert.equal(await writeImmutable(partialTarget, 'complete canonical bytes', 0o600), 'created');
    assert.equal(await selfTestPathExists(staleTemp), false);
    const quarantineDirectory = path.join(atomicDirectory, IMMUTABLE_QUARANTINE_DIRECTORY);
    const quarantinedNames = await readdir(quarantineDirectory);
    assert.equal(quarantinedNames.length, 1);
    const quarantinedPath = path.join(quarantineDirectory, quarantinedNames[0]);
    assert.equal(await readFile(quarantinedPath, 'utf8'), 'interrupted partial bytes');
    assert.equal((await lstat(quarantinedPath)).mode & 0o777, 0o600);
    assert.equal((await lstat(quarantineDirectory)).mode & 0o777, 0o700);
    checks.push('interrupted-temp-private-quarantine-and-recovery');

    const committedTarget = path.join(atomicDirectory, 'committed-before-temp-cleanup.bin');
    assert.equal(await writeImmutable(committedTarget, 'already committed', 0o644), 'created');
    const committedTempAlias = path.join(
      atomicDirectory,
      `${immutableTempPrefix(committedTarget)}crash-after-link-fixture`,
    );
    await link(committedTarget, committedTempAlias);
    await utimes(committedTempAlias, staleDate, staleDate);
    assert.equal(await writeImmutable(committedTarget, 'already committed', 0o644), 'unchanged');
    assert.equal(await selfTestPathExists(committedTempAlias), false);
    assert.equal(await readFile(committedTarget, 'utf8'), 'already committed');
    assert.equal((await lstat(committedTarget)).mode & 0o777, 0o644);
    checks.push('post-commit-temp-alias-cleanup-without-canonical-mutation');

    const symlinkBacking = path.join(atomicDirectory, 'symlink-backing.bin');
    const symlinkTarget = path.join(atomicDirectory, 'symlink-target.bin');
    await writeFile(symlinkBacking, 'must remain unchanged', { mode: 0o600 });
    await symlink(symlinkBacking, symlinkTarget);
    await assert.rejects(
      writeImmutable(symlinkTarget, 'replacement', 0o600),
      /symbolic-link/,
    );
    assert.equal(await readFile(symlinkBacking, 'utf8'), 'must remain unchanged');
    checks.push('immutable-target-symlink-rejection');

    const boundaryRoot = path.join(fixtureRoot, 'boundary');
    await mkdir(boundaryRoot, { recursive: true, mode: 0o755 });
    const boundaryRecord = {
      source_id: '12345678',
      source_url: 'https://blog.naver.com/tsusai/12345678',
      visibility: PUBLIC_VISIBILITY,
    };
    await createSelfTestV2Fixture(boundaryRoot, boundaryRecord, {
      wrapperRecordedPath: 'outside-canonical-wrapper.html',
    });
    await assert.rejects(
      readExistingV2(boundaryRoot, boundaryRecord),
      /allowed storage boundary|physical storage path/,
    );
    checks.push('v2-recorded-path-boundary-rejection');

    const readSymlinkRoot = path.join(fixtureRoot, 'read-symlink');
    await mkdir(readSymlinkRoot, { recursive: true, mode: 0o755 });
    const readSymlinkRecord = {
      source_id: '87654321',
      source_url: 'https://blog.naver.com/tsusai/87654321',
      visibility: PUBLIC_VISIBILITY,
    };
    const outsideWrapper = path.join(readSymlinkRoot, 'outside-wrapper.html');
    await writeFile(outsideWrapper, '<!DOCTYPE html>\n<html><body>outside</body></html>', { mode: 0o644 });
    await createSelfTestV2Fixture(readSymlinkRoot, readSymlinkRecord, {
      wrapperSymlinkTarget: outsideWrapper,
    });
    await assert.rejects(
      readExistingV2(readSymlinkRoot, readSymlinkRecord),
      /symbolic links/,
    );
    checks.push('v2-canonical-symlink-rejection');

    return { passed: checks.length, checks };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}
