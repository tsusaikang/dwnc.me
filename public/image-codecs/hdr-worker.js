// One worker per upload; the caller terminates it after the result to release WASM memory.
import createCodec from './hdr-codec.js';
let running = false;
self.onmessage = async ({ data }) => {
  if (running) { self.postMessage({ ok: false, error: '사진은 한 번에 한 장씩 처리해 주세요.' }); return; }
  running = true;
  let codec, pointer = 0;
  try {
    const { buffer, maxEdge = 2560, quality = 80 } = data ?? {};
    if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || buffer.byteLength > 25 * 1024 * 1024
      || maxEdge !== 2560 || quality !== 80) throw new Error('사진 처리 요청이 올바르지 않습니다.');
    codec = await createCodec({ locateFile: name => new URL(name, import.meta.url).href });
    pointer = codec._malloc(buffer.byteLength);
    if (!pointer) throw new Error('사진을 처리할 메모리가 부족합니다.');
    codec.HEAPU8.set(new Uint8Array(buffer), pointer);
    if (codec._dwnc_process(pointer, buffer.byteLength, maxEdge, quality)) {
      // Do not silently flatten an unsupported HDR/profile into ordinary SDR.
      throw new Error('이 사진의 HDR·색상 정보를 유지하며 압축하지 못했습니다. 다른 사진으로 다시 시도해 주세요.');
    }
    const size = codec._dwnc_result_size(), start = codec._dwnc_result_ptr();
    if (!start || size < 4 || size > 25 * 1024 * 1024) throw new Error('사진 압축 결과가 올바르지 않습니다.');
    const output = codec.HEAPU8.slice(start, start + size).buffer;
    const metadata = { width: codec._dwnc_width(), height: codec._dwnc_height(),
      inputWidth: codec._dwnc_input_width(), inputHeight: codec._dwnc_input_height(),
      hdr: Boolean(codec._dwnc_hdr()), p3: Boolean(codec._dwnc_p3()), hdrCapacity: codec._dwnc_capacity() };
    self.postMessage({ ok: true, buffer: output, metadata }, [output]);
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || '사진을 압축하지 못했습니다.' });
  } finally {
    if (codec) { if (pointer) codec._free(pointer); codec._dwnc_clear(); }
    self.close();
  }
};
