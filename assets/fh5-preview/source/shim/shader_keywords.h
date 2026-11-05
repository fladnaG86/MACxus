/* Private material-family metadata only. Never retains names, paths or bytecode. */
#ifndef MACXUS_SHADER_KEYWORDS_H
#define MACXUS_SHADER_KEYWORDS_H
#include "shader_signature.h"
enum { MATERIAL_CHECKPOINT=1, MATERIAL_BANNER=2, MATERIAL_CLOTH=4,
       MATERIAL_ROAD=8, MATERIAL_DECAL=16, MATERIAL_FLAG=32, MATERIAL_SKID=64 };
static inline unsigned shader_debug_keywords(const void *bytes, size_t size)
{
    const unsigned char *b=bytes,*name=NULL;
    size_t length=0;
    if(!b||size<32||memcmp(b,"DXBC",4))return 0;
    size_t total=signature_u32(b+24);unsigned parts=signature_u32(b+28);
    if(total<32||total>size||parts>64||32+(size_t)parts*4>total)return 0;
    for(unsigned i=0;i<parts;i++) {
        size_t offset=signature_u32(b+32+4*i);
        if(offset>total||total-offset<8)return 0;
        size_t amount=signature_u32(b+offset+4);
        if(amount>total-offset-8)return 0;
        if(memcmp(b+offset,"ILDN",4))continue;
        if(name||amount<4)return 0;
        length=(unsigned)b[offset+10]|(unsigned)b[offset+11]<<8;
        if(length>amount-4||length>4096)return 0;
        name=b+offset+12;
    }
    if(!name||!length)return 0;
    const unsigned char *zero=memchr(name,0,length);
    if(zero)length=(size_t)(zero-name);
    /* Directory names must not accidentally classify an unrelated shader. */
    size_t begin=0;
    for(size_t i=0;i<length;i++)if(name[i]=='/'||name[i]=='\\')begin=i+1;
    static const char *const words[]={"checkpoint","banner","cloth","road","decal","flag","skid"};
    unsigned bits=0;
    for(unsigned word=0;word<7;word++) {
        size_t n=strlen(words[word]);
        for(size_t at=begin;at<=length&&n<=length-at;at++) {
            size_t j=0;
            for(;j<n;j++) {
                unsigned char c=name[at+j];if(c>='A'&&c<='Z')c+='a'-'A';
                if(c!=(unsigned char)words[word][j])break;
            }
            if(j==n){bits|=1u<<word;break;}
        }
    }
    return bits;
}
#endif
