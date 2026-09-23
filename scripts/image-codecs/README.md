# Browser JPEG / HDR codec

The editor's module worker lives at `/image-codecs/hdr-worker.js`. It handles JPEG
bytes locally and returns JPEG bytes. No photograph is sent to another service.
`public/image-codecs/` contains the shipped, versioned runtime assets and licenses;
normal site builds copy those assets and do not install a C++ toolchain.

## Contract

Create a fresh module Worker for each file and terminate it after success/failure.
Send `{ buffer: ArrayBuffer, maxEdge: 2560, quality: 80 }` with the buffer transferred.
The response is `{ ok: true, buffer, metadata }`, where metadata includes oriented
`width`, `height`, `inputWidth`, `inputHeight`, `hdr`, `p3`, and `hdrCapacity`.
Failure is `{ ok: false, error }`. A failure must not fall back to a Canvas JPEG,
which would discard HDR. The original File remains untouched.

The worker exits after one request. Its `finally` also releases input/output WASM
allocations. Main-thread termination covers load errors, timeouts and cancellation.
Processing files sequentially avoids multiple large WASM heaps.

## Image processing

- Input: JPEG, up to the existing 25 MiB upload limit and 50 million pixels.
- Output: longest edge at most 2560, quality 80, 4:2:0 and optimized Huffman.
  Images below the edge limit are not enlarged. The shorter side is rounded to
  an even pixel count when resizing, as required by this HDR encoder.
- SDR: numeric JPEG decode, linear-light Lanczos-3 resize, inverse transfer,
  JPEG encode. Standard sRGB, Display-P3 and supported BT.2100 primaries are
  recognized using upstream ICC handling; the ICC transfer curves must also match
  sRGB (parametric and sampled curves are checked). All original ICC APP2 chunks and EXIF
  orientation are preserved; unrelated camera/debug metadata is not copied.
- HDR: Google libultrahdr reconstructs the original into linear half-float RGB.
  HDR and SDR receive the same resize filter and pixel-center mapping. API-3
  regenerates the gain map from that resized HDR target and the compressed SDR
  base. The original display headroom is explicitly configured; using the
  default 10,000-nit capacity would change rendering on ordinary HDR displays.
  The source content-boost bounds constrain the regenerated monochrome gain
  map, encoded at quality 80 and one-quarter base dimensions.
- Both ISO 21496-1 and legacy XMP metadata are written. The tested source is an
  SDR-base Display-P3 JPEG with a monochrome gain map. Unsupported profiles,
  alternate gain-map color spaces, RGB/per-channel gain maps, non-default lower
  HDR display capacity and malformed HDR cause an explicit failure. Grayscale
  SDR and odd-sized small SDR JPEGs are supported. Odd-sized small HDR inputs
  are subject to upstream raw HDR dimension restrictions and are not claimed
  supported.
- 500 KB–1 MB is a target demonstrated by the selected four photographs, not a
  hard limit. Detail, noise and scene content affect output size.

This is lossy photo optimization. HDR capability and color intent are preserved;
original gain-map pixels, all HDR pixels and original fine detail are not claimed
identical after scaling and encoding. For small JPEGs, the caller may retain the
original if re-encoding does not reduce bytes and no scaling was needed.

## Rebuild

Activate **Emscripten 4.0.14**, then make `cmake` (tested with 4.4.3), `curl`,
`python3`, and a normal build tool available. Run:

```sh
scripts/image-codecs/build.sh
```

The script downloads SHA-256-pinned official source archives for libultrahdr
1.4.0 and libjpeg-turbo 3.0.1 into a fresh temporary directory, builds libjpeg
explicitly, builds the official HDR library, then links `hdr-codec.cpp` into the
shipped ES module / WASM pair. `DWNC_CODEC_BUILD_DIR` can point to a retained
build directory. `link.sh` can relink the local bridge against existing builds.
No private project images or local authentication are build inputs.

The WASM module has memory growth capped at 1 GiB. Threads and dynamic JavaScript
execution are not used. It requires same-origin worker/script/fetch access and
CSP `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self'` and
`connect-src 'self'`. General `unsafe-eval` is unnecessary.

## Local verification

The four approved originals processed successfully through the shipped WASM,
producing approximately 0.58–1.00 MB JPEGs. The results were decoded by the
independent native library to linear Display-P3 HDR; ICC bytes and original HDR
display capacity were identical and decoded values exceeded SDR white. The
WASM results matched the approved native size experiment within three bytes.
Private inputs and detailed results remain in the existing Git-excluded
comparison directory and are not distributed with the site.

A real module Worker also processed all four images under the production-style
CSP without general unsafe-eval. Grayscale SDR, odd-sized P3 SDR and a deliberately
non-sRGB ICC transfer-curve rejection were checked separately.

The editor's ordinary regression suite validates worker transfer, timeout,
cleanup, no silent SDR fallback, and shared attachment/clipboard integration.
