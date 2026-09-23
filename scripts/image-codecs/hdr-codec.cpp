// Browser JPEG processing. Google libultrahdr 1.4.0 handles HDR reconstruction/encoding.
#include "ultrahdr_api.h"
#include "ultrahdr/jpegdecoderhelper.h"
#include "ultrahdr/gainmapmath.h"
#include "ultrahdr/icc.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <csetjmp>
#include <cstdlib>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
std::vector<unsigned char> result;
std::string error;
int width=0,height=0,inputWidth=0,inputHeight=0,hdrFlag=0,p3Flag=0,orientation=1;
float capacity=1;
void check(uhdr_error_info_t s) { if(s.error_code) throw std::runtime_error(s.has_detail?s.detail:"HDR codec failed"); }
using Decoder=std::unique_ptr<uhdr_codec_private_t,decltype(&uhdr_release_decoder)>;
using Encoder=std::unique_ptr<uhdr_codec_private_t,decltype(&uhdr_release_encoder)>;
struct Mark { int id; std::vector<unsigned char> bytes; };
std::vector<Mark> iccs;
unsigned int read16(const unsigned char* p,bool le){return le?p[0]|p[1]<<8:p[0]<<8|p[1];}
unsigned int read32(const unsigned char* p,bool le){return le?p[0]|p[1]<<8|p[2]<<16|(unsigned)p[3]<<24:(unsigned)p[0]<<24|p[1]<<16|p[2]<<8|p[3];}
bool knownHdrMarker=false;
void markers(const unsigned char* p,size_t n){
 iccs.clear();orientation=1;knownHdrMarker=false;
 for(size_t at=2;at+4<=n;){
  if(p[at]!=255)throw std::runtime_error("Invalid JPEG header");
  unsigned m=p[at+1];if(m==0xda||m==0xd9)break;
  size_t length=read16(p+at+2,false);if(length<2||at+2+length>n)throw std::runtime_error("Invalid JPEG marker");
  const auto* b=p+at+4;size_t len=length-2;
  if(m==0xe2&&len>=14&&!memcmp(b,"ICC_PROFILE\0",12))iccs.push_back({int(m),{b,b+len}});
  constexpr char isoNamespace[]="urn:iso:std:iso:ts:21496:-1";
  if(m==0xe2&&len>=sizeof(isoNamespace)&&!memcmp(b,isoNamespace,sizeof(isoNamespace)))knownHdrMarker=true;
  if(m==0xe1&&len>29){std::string s((const char*)b,len);if(s.find("hdr-gain-map")!=std::string::npos||s.find("HDRGainMap")!=std::string::npos)knownHdrMarker=true;}
  if(m==0xe1&&len>=14&&!memcmp(b,"Exif\0\0",6)){
   const auto* t=b+6;size_t tn=len-6;bool le=t[0]=='I'&&t[1]=='I';
   if((le||(t[0]=='M'&&t[1]=='M'))&&read16(t+2,le)==42){size_t off=read32(t+4,le);
    if(off+2<=tn){unsigned count=read16(t+off,le);for(unsigned i=0;i<count&&off+2+12*(i+1)<=tn;i++){
     auto* e=t+off+2+12*i;if(read16(e,le)==274&&read16(e+2,le)==3&&read32(e+4,le)==1){unsigned v=read16(e+8,le);orientation=v<=8?v:1;}
    }}
   }
  }
  at+=length+2;
 }
}
float linear(float x){return x<=.04045f?x/12.92f:powf((x+.055f)/1.055f,2.4f);}
// Check the transfer curve too: matching primaries alone does not imply sRGB TRC.
bool srgbTransfer(){
 if(iccs.empty())return true;
 auto chunks=iccs;std::sort(chunks.begin(),chunks.end(),[](const Mark& a,const Mark& b){return a.bytes[12]<b.bytes[12];});
 std::vector<unsigned char> profile;
 for(size_t i=0;i<chunks.size();i++){auto& b=chunks[i].bytes;if(b[12]!=i+1||b[13]!=chunks.size())return false;profile.insert(profile.end(),b.begin()+14,b.end());}
 if(profile.size()<132||read32(profile.data(),false)>profile.size())return false;
 unsigned count=read32(profile.data()+128,false);if(uint64_t(count)*12+132>profile.size())return false;
 for(const char* name:{"rTRC","gTRC","bTRC"}){
  const unsigned char* curve=nullptr;size_t length=0;
  for(unsigned i=0;i<count;i++){auto* tag=profile.data()+132+i*12;if(!memcmp(tag,name,4)){size_t at=read32(tag+4,false);length=read32(tag+8,false);if(at>profile.size()||length>profile.size()-at)return false;curve=profile.data()+at;break;}}
  if(!curve||length<12)return false;
  auto fixed=[&](int at){return float(int32_t(read32(curve+at,false)))/65536.f;};
  for(float x:{0.f,.01f,.04f,.1f,.25f,.5f,.75f,1.f}){
   float y=0;
   if(!memcmp(curve,"curv",4)){
    unsigned n=read32(curve+8,false);if(uint64_t(n)*2+12>length)return false;
    if(n==0)y=x;else if(n==1)y=powf(x,read16(curve+12,false)/256.f);else{float at=x*(n-1);unsigned a=std::min(unsigned(at),n-2);float f=at-a;y=((1-f)*read16(curve+12+2*a,false)+f*read16(curve+14+2*a,false))/65535.f;}
   }else if(!memcmp(curve,"para",4)){
    unsigned fn=read16(curve+8,false);int sizes[]={1,3,4,5,7};if(fn>4||12+4*sizes[fn]>int(length))return false;
    float g=fixed(12),a=fn?fixed(16):1,b=fn?fixed(20):0,c=fn>=2?fixed(24):0,d=fn>=3?fixed(28):0,e=fn==4?fixed(32):0,f=fn==4?fixed(36):0;
    if(fn==0)y=powf(x,g);else if(fn<=2){if(a==0)return false;y=(x>=-b/a?powf(a*x+b,g):0)+(fn==2?c:0);}else y=x>=d?powf(a*x+b,g)+e:c*x+f;
   }else return false;
   if(!std::isfinite(y)||std::abs(y-linear(x))>.002f)return false;
  }
 }
 return true;
}

float gamma(float x){return x<=.0031308f?x*12.92f:1.055f*powf(x,1/2.4f)-.055f;}
struct Weights {int start;std::vector<float> w;};
std::vector<Weights> weights(int in,int out){
 std::vector<Weights> all(out);double scale=double(in)/out,filter=std::max(1.0,scale),support=3*filter;
 for(int x=0;x<out;x++){
  double center=(x+.5)*scale;int first=std::max(0,int(center-support+.5)),last=std::min(in,int(center+support+.5));double total=0;
  all[x].start=first;for(int k=first;k<last;k++){double d=(k-center+.5)/filter,v=1;if(d!=0){double a=d*3.14159265358979323846;v=std::abs(d)<3?sin(a)/a*sin(a/3)/(a/3):0;}all[x].w.push_back(v);total+=v;}
  for(auto& v:all[x].w)v/=total;
 }
 return all;
}
// Separable Lanczos-3 in linear light, same pixel centers for SDR and HDR.
// One channel at a time keeps the intermediate allocation bounded.
template<class Sample> std::vector<float> resize(int sw,int sh,int dw,int dh,Sample sample){
 auto wx=weights(sw,dw),wy=weights(sh,dh);std::vector<float> dst(size_t(dw)*dh*3),tmp(size_t(dw)*sh);
 for(int c=0;c<3;c++){
  for(int y=0;y<sh;y++)for(int x=0;x<dw;x++){double s=0;auto& v=wx[x];for(size_t k=0;k<v.w.size();k++)s+=sample(v.start+k,y,c)*v.w[k];tmp[size_t(y)*dw+x]=s;}
  for(int y=0;y<dh;y++)for(int x=0;x<dw;x++){double s=0;auto& v=wy[y];for(size_t k=0;k<v.w.size();k++)s+=tmp[size_t(v.start+k)*dw+x]*v.w[k];dst[(size_t(y)*dw+x)*3+c]=std::max(0.0,s);}
 }
 return dst;
}
struct JpegError {jpeg_error_mgr base;jmp_buf jump;};
void jpegError(j_common_ptr info){longjmp(((JpegError*)info->err)->jump,1);}
std::vector<unsigned char> encodeBase(const std::vector<float>& rgb,int w,int h,int quality){
 // Numeric P3/sRGB values are encoded without a color-space conversion by Canvas.
 std::vector<unsigned char> pixels(size_t(w)*h*3);
 for(size_t i=0;i<pixels.size();i++)pixels[i]=std::clamp(int(std::nearbyint(gamma(std::clamp(rgb[i],0.f,1.f))*255)),0,255);
 jpeg_compress_struct enc{};JpegError e{};unsigned char* bytes=nullptr;unsigned long size=0;
 enc.err=jpeg_std_error(&e.base);e.base.error_exit=jpegError;
 if(setjmp(e.jump)){jpeg_destroy_compress(&enc);free(bytes);throw std::runtime_error("JPEG encoding failed");}
 jpeg_create_compress(&enc);jpeg_mem_dest(&enc,&bytes,&size);enc.image_width=w;enc.image_height=h;enc.input_components=3;enc.in_color_space=JCS_RGB;
 jpeg_set_defaults(&enc);jpeg_set_quality(&enc,quality,TRUE);enc.optimize_coding=TRUE;enc.dct_method=JDCT_ISLOW;
 jpeg_start_compress(&enc,TRUE);
 for(auto& m:iccs)jpeg_write_marker(&enc,m.id,m.bytes.data(),m.bytes.size());
 unsigned char exif[]={ 'E','x','i','f',0,0,'M','M',0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,0,0,0,0,0,0,0};exif[25]=orientation;
 jpeg_write_marker(&enc,JPEG_APP0+1,exif,sizeof exif);
 while(enc.next_scanline<enc.image_height){JSAMPROW row=pixels.data()+size_t(enc.next_scanline)*w*3;jpeg_write_scanlines(&enc,&row,1);}
 jpeg_finish_compress(&enc);std::vector<unsigned char> out(bytes,bytes+size);jpeg_destroy_compress(&enc);free(bytes);return out;
}
}
extern "C" {
void dwnc_clear(){std::vector<unsigned char>().swap(result);iccs.clear();error.clear();width=height=inputWidth=inputHeight=hdrFlag=p3Flag=0;capacity=1;}
int dwnc_process(unsigned char* bytes,int size,int edge,int quality){
 dwnc_clear();try{
  if(size<4||size>25*1024*1024||bytes[0]!=255||bytes[1]!=216||edge<2||edge>2560||quality<1||quality>100)throw std::runtime_error("Invalid JPEG input");
  markers(bytes,size);
  auto sdr=std::make_unique<ultrahdr::JpegDecoderHelper>();check(sdr->parseImage(bytes,size));
  int sw=sdr->getDecompressedImageWidth(),sh=sdr->getDecompressedImageHeight();inputWidth=sw;inputHeight=sh;
  if(sw<1||sh<1||uint64_t(sw)*sh>50000000)throw std::runtime_error("JPEG dimensions exceed decoder memory limit");
  double scale=std::min(1.,double(edge)/std::max(sw,sh));
  width=scale==1?sw:std::max(2,int(std::nearbyint(sw*scale/2))*2);height=scale==1?sh:std::max(2,int(std::nearbyint(sh*scale/2))*2);
  bool isHdr=is_uhdr_image(bytes,size)==1;hdrFlag=isHdr;
  if(knownHdrMarker&&!isHdr)throw std::runtime_error("Unsupported or damaged HDR gain map");
  uhdr_color_gamut_t cg=UHDR_CG_BT_709;
  if(sdr->getICCSize()){
   cg=ultrahdr::IccHelper::readIccColorGamut(sdr->getICCPtr(),sdr->getICCSize());
   if(cg!=UHDR_CG_BT_709&&cg!=UHDR_CG_DISPLAY_P3&&cg!=UHDR_CG_BT_2100)throw std::runtime_error("Unsupported JPEG color profile");
  }
  if(!srgbTransfer())throw std::runtime_error("Unsupported JPEG transfer curve");
  p3Flag=cg==UHDR_CG_DISPLAY_P3;
  std::vector<float> target;
  uhdr_gainmap_metadata_t sourceMeta{};
  if(isHdr){
   Decoder dec(uhdr_create_decoder(),uhdr_release_decoder);uhdr_compressed_image_t in{bytes,size_t(size),size_t(size),cg,UHDR_CT_SRGB,UHDR_CR_FULL_RANGE};
   check(uhdr_dec_set_image(dec.get(),&in));check(uhdr_dec_set_out_img_format(dec.get(),UHDR_IMG_FMT_64bppRGBAHalfFloat));check(uhdr_dec_set_out_color_transfer(dec.get(),UHDR_CT_LINEAR));check(uhdr_dec_probe(dec.get()));
   sourceMeta=*uhdr_dec_get_gainmap_metadata(dec.get());capacity=sourceMeta.hdr_capacity_max;
   auto* gain=uhdr_dec_get_gainmap_image(dec.get());ultrahdr::JpegDecoderHelper gainProbe;check(gainProbe.parseImage(gain->data,gain->data_sz));
   if(gainProbe.getNumComponentsInImage()!=1||sourceMeta.hdr_capacity_min!=1)throw std::runtime_error("Unsupported HDR gain map channels or display range");
   for(int c=1;c<3;c++)if(sourceMeta.min_content_boost[c]!=sourceMeta.min_content_boost[0]||sourceMeta.max_content_boost[c]!=sourceMeta.max_content_boost[0]||sourceMeta.gamma[c]!=sourceMeta.gamma[0]||sourceMeta.offset_sdr[c]!=sourceMeta.offset_sdr[0]||sourceMeta.offset_hdr[c]!=sourceMeta.offset_hdr[0])throw std::runtime_error("Unsupported per-channel HDR gain map");
   // This shipping path preserves the supported SDR-base, scalar original gain-map intent.
   if(!sourceMeta.use_base_cg)throw std::runtime_error("Unsupported alternate HDR color space");
   check(uhdr_decode(dec.get()));auto* raw=uhdr_get_decoded_image(dec.get());if(raw->cg!=cg)throw std::runtime_error("HDR color space mismatch");
   auto* half=(uint16_t*)raw->planes[0];target=resize(sw,sh,width,height,[&](int x,int y,int c){return ultrahdr::halfToFloat(half[(size_t(y)*raw->stride[0]+x)*4+c]);});
  }
  check(sdr->decompressImage(bytes,size,sdr->getNumComponentsInImage()==1?ultrahdr::DECODE_STREAM:ultrahdr::DECODE_TO_RGB_CS));auto raw=sdr->getDecompressedImage();
  int channels=raw.fmt==UHDR_IMG_FMT_32bppRGBA8888?4:raw.fmt==UHDR_IMG_FMT_24bppRGB888?3:raw.fmt==UHDR_IMG_FMT_8bppYCbCr400?1:0;
  if(!channels)throw std::runtime_error("Unsupported JPEG pixel format");
  const auto* rgb=(const unsigned char*)raw.planes[0];float linearLut[256];for(int n=0;n<256;n++)linearLut[n]=linear(float(n)/255);
  auto small=resize(sw,sh,width,height,[&](int x,int y,int c){return linearLut[rgb[(size_t(y)*raw.stride[0]+x)*channels+(channels==1?0:c)]];});
  sdr.reset();auto base=encodeBase(small,width,height,quality);std::vector<float>().swap(small);
  if(!isHdr){result=std::move(base);return 0;}
  std::vector<uint16_t> rgba(size_t(width)*height*4);for(size_t i=0;i<target.size()/3;i++){for(int c=0;c<3;c++)rgba[i*4+c]=ultrahdr::floatToHalf(target[i*3+c]);rgba[i*4+3]=ultrahdr::floatToHalf(1);}
  std::vector<float>().swap(target);
  uhdr_raw_image_t hdr{UHDR_IMG_FMT_64bppRGBAHalfFloat,cg,UHDR_CT_LINEAR,UHDR_CR_FULL_RANGE,(unsigned)width,(unsigned)height,{rgba.data(),nullptr,nullptr},{(unsigned)width,0,0}};
  uhdr_compressed_image_t compressed{base.data(),base.size(),base.size(),cg,UHDR_CT_SRGB,UHDR_CR_FULL_RANGE};
  Encoder enc(uhdr_create_encoder(),uhdr_release_encoder);check(uhdr_enc_set_raw_image(enc.get(),&hdr,UHDR_HDR_IMG));check(uhdr_enc_set_compressed_image(enc.get(),&compressed,UHDR_SDR_IMG));
  check(uhdr_enc_set_quality(enc.get(),quality,UHDR_GAIN_MAP_IMG));check(uhdr_enc_set_gainmap_scale_factor(enc.get(),4));check(uhdr_enc_set_using_multi_channel_gainmap(enc.get(),0));
  check(uhdr_enc_set_target_display_peak_brightness(enc.get(),std::clamp(capacity*203,203.f,10000.f)));
  check(uhdr_enc_set_min_max_content_boost(enc.get(),*std::min_element(sourceMeta.min_content_boost,sourceMeta.min_content_boost+3),*std::max_element(sourceMeta.max_content_boost,sourceMeta.max_content_boost+3)));
  check(uhdr_encode(enc.get()));auto* out=uhdr_get_encoded_stream(enc.get());auto* p=(unsigned char*)out->data;result.assign(p,p+out->data_sz);return 0;
 }catch(const std::exception& e){error=e.what();result.clear();return 1;}catch(...){error="JPEG processing failed";result.clear();return 1;}
}
const unsigned char* dwnc_result_ptr(){return result.data();}
int dwnc_result_size(){return result.size();}
int dwnc_width(){return orientation>=5&&orientation<=8?height:width;}
int dwnc_height(){return orientation>=5&&orientation<=8?width:height;}
int dwnc_hdr(){return hdrFlag;}
int dwnc_p3(){return p3Flag;}
int dwnc_input_width(){return orientation>=5&&orientation<=8?inputHeight:inputWidth;}
int dwnc_input_height(){return orientation>=5&&orientation<=8?inputWidth:inputHeight;}
float dwnc_capacity(){return capacity;}
const char* dwnc_error(){return error.c_str();}
}
