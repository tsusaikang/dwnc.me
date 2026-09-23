#!/usr/bin/env bash
# Run after activating Emscripten 4.0.14; cmake and curl must be available.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
codec_build="${DWNC_CODEC_BUILD_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/dwnc-codec.XXXXXX")}"
mkdir -p "$codec_build"
case "$(emcc --version | head -1)" in *'4.0.14'*) ;; *) echo 'Emscripten 4.0.14 is required' >&2; exit 1;; esac
curl -fL https://codeload.github.com/google/libultrahdr/tar.gz/refs/tags/v1.4.0 -o "$codec_build/uhdr.tar.gz"
curl -fL https://codeload.github.com/libjpeg-turbo/libjpeg-turbo/tar.gz/refs/tags/3.0.1 -o "$codec_build/jpeg.tar.gz"
python3 - "$codec_build" <<'PY'
import hashlib,pathlib,sys
root=pathlib.Path(sys.argv[1])
for name,expected in [('uhdr.tar.gz','e7e1252e2c44d8ed6b99ee0f67a3caf2d8a61c43834b13b1c3cd485574c03ab9'),('jpeg.tar.gz','5b9bbca2b2a87c6632c821799438d358e27004ab528abf798533c15d50b39f82')]:
 if hashlib.sha256((root/name).read_bytes()).hexdigest()!=expected:raise SystemExit('Source archive mismatch: '+name)
PY
tar -xzf "$codec_build/uhdr.tar.gz" -C "$codec_build"
tar -xzf "$codec_build/jpeg.tar.gz" -C "$codec_build"
uhdr="$codec_build/libultrahdr-1.4.0"
jpeg="$codec_build/libjpeg-turbo-3.0.1"
emcmake cmake -S "$jpeg" -B "$codec_build/jpeg-build" -DENABLE_SHARED=OFF -DWITH_SIMD=OFF -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build "$codec_build/jpeg-build" --target jpeg-static -j 4
# libjpeg is built explicitly above. Bypass upstream's unrelated Emscripten port probe.
emcmake cmake -S "$uhdr" -B "$codec_build/uhdr-build" -DHAVE_JPEG=TRUE -DUHDR_BUILD_DEPS=OFF -DUHDR_BUILD_EXAMPLES=OFF -DUHDR_WRITE_XMP=ON -DUHDR_WRITE_ISO=ON -DCMAKE_BUILD_TYPE=Release "-DJPEG_INCLUDE_DIR=$jpeg;$codec_build/jpeg-build" "-DJPEG_LIBRARY=$codec_build/jpeg-build/libjpeg.a"
cmake --build "$codec_build/uhdr-build" --target uhdr -j 4
"$root/scripts/image-codecs/link.sh" "$uhdr" "$jpeg" "$codec_build/jpeg-build" "$codec_build/uhdr-build"
