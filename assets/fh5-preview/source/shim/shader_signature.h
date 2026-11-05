/* Read-only DXBC/DXIL pixel-output metadata; no bitcode parsing or rewriting. */
#ifndef MACXUS_SHADER_SIGNATURE_H
#define MACXUS_SHADER_SIGNATURE_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>
struct shader_outputs { unsigned count, mask; };
static inline uint32_t signature_u32(const unsigned char *p) {
    return (uint32_t)p[0] | (uint32_t)p[1]<<8 | (uint32_t)p[2]<<16 | (uint32_t)p[3]<<24;
}
static inline int signature_target_name(const unsigned char *p,size_t n) {
    const char name[]="sv_target";
    if(n<sizeof name)return 0;
    for(size_t i=0;i<sizeof name;i++) {
        unsigned char c=p[i];if(c>='A'&&c<='Z')c+='a'-'A';
        if(c!=(unsigned char)name[i])return 0;
    }
    return 1;
}
/* 1: known pixel signature, including zero colour outputs. 0: malformed,
 * unsupported, missing, non-pixel or ambiguous metadata. Never guess on 0. */
static inline int shader_output_signature(const void *bytes,size_t size,struct shader_outputs *out) {
    const unsigned char *b=(const unsigned char*)bytes,*signature=NULL;
    size_t signature_size=0;unsigned stride=0,stream=0,stage=UINT32_MAX;
    out->count=out->mask=0;
    if(!b||size<32||memcmp(b,"DXBC",4))return 0;
    size_t total=signature_u32(b+24);unsigned parts=signature_u32(b+28);
    if(total<32||total>size||parts>64||32+(size_t)parts*4>total)return 0;
    for(unsigned i=0;i<parts;i++) {
        size_t off=signature_u32(b+32+4*i);
        if(off>total||total-off<8)return 0;
        size_t n=signature_u32(b+off+4);if(n>total-off-8)return 0;
        const unsigned char *data=b+off+8;
        if(!memcmp(b+off,"DXIL",4)||!memcmp(b+off,"SHDR",4)||!memcmp(b+off,"SHEX",4)) {
            if(n<4||stage!=UINT32_MAX)return 0;
            stage=signature_u32(data)>>16;
        }
        unsigned width=0,skip=0;
        if(!memcmp(b+off,"OSG1",4)){width=32;skip=4;}
        if(!memcmp(b+off,"OSG5",4)){width=28;skip=4;}
        if(!memcmp(b+off,"OSGN",4)){width=24;}
        if(width){if(signature)return 0;signature=data;signature_size=n;stride=width;stream=skip;}
    }
    if(stage!=0||!signature||signature_size<8)return 0;
    unsigned count=signature_u32(signature);size_t offset=signature_u32(signature+4);
    if(count>128||offset<8||offset>signature_size||(size_t)count*stride>signature_size-offset)return 0;
    struct shader_outputs found={0,0};
    for(unsigned i=0;i<count;i++) {
        const unsigned char *e=signature+offset+(size_t)i*stride+stream;
        unsigned name=signature_u32(e),index=signature_u32(e+4),system=signature_u32(e+8);
        if(name>=signature_size||!memchr(signature+name,0,signature_size-name))return 0;
        if(system==64||signature_target_name(signature+name,signature_size-name)) {
            if(index>=8||(found.mask&(1u<<index)))return 0;
            found.mask|=1u<<index;found.count++;
        }
    }
    *out=found;return 1;
}
#endif
