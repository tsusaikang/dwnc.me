#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
uhdr="$1";jpeg="$2";jpeg_build="$3";uhdr_build="$4"
em++ -O3 -std=c++17 -fexceptions -I"$uhdr" -I"$uhdr/lib/include" -I"$jpeg" -I"$jpeg_build" \
 "$root/scripts/image-codecs/hdr-codec.cpp" "$uhdr_build/libuhdr.a" "$jpeg_build/libjpeg.a" \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sEXPORT_NAME=createHdrCodec \
 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=1073741824 \
 -sSTACK_SIZE=1048576 -sFILESYSTEM=0 -sDYNAMIC_EXECUTION=0 -sDISABLE_EXCEPTION_CATCHING=0 \
 '-sEXPORTED_FUNCTIONS=["_malloc","_free","_dwnc_process","_dwnc_clear","_dwnc_result_ptr","_dwnc_result_size","_dwnc_width","_dwnc_height","_dwnc_input_width","_dwnc_input_height","_dwnc_hdr","_dwnc_p3","_dwnc_capacity","_dwnc_error"]' \
 '-sEXPORTED_RUNTIME_METHODS=["HEAPU8","UTF8ToString"]' \
 -o "$root/public/image-codecs/hdr-codec.js"
chmod 644 "$root/public/image-codecs/hdr-codec.js" "$root/public/image-codecs/hdr-codec.wasm"
