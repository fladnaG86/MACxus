#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
static unsigned notes;
static BYTE fixture_instructions[60];
static void observer_note(unsigned api,unsigned long long caller,const char *format,...){(void)api;(void)caller;(void)format;notes++;SetLastError(99);}
#define FH5_DATA_FIXTURE
#include "../shim/fh5_descriptor_data.h"
static unsigned checks,allocated,destructed,released;static int allocate_fail,bad_capacity;
static BYTE observed_config[0x310];static uint64_t observed_size;
#define CHECK(x) do{checks++;if(!(x)){printf("DATA_FIXTURE_FAIL line=%d checks=%u\n",__LINE__,checks);return 1;}}while(0)
static void put64(BYTE *p,unsigned offset,uint64_t v){memcpy(p+offset,&v,8);}
static void *fake_new(size_t size){allocated++;return allocate_fail?NULL:calloc(1,size);}
static void *fake_ctor(void *self,UINT flags,void *base,UINT64 size,const void *config){if(flags||base)return NULL;memcpy(observed_config,config,sizeof(observed_config));observed_size=size;put64(self,0,(uintptr_t)fh5_data_image+0x656c7b8);put64(self,0x48,bad_capacity?5630620:10222964);return self;}
static void fake_dtor(void *p){(void)p;destructed++;}
static void fake_delete(void *p,size_t size){if(size!=0xa70)abort();released++;free(p);}
static void *native_fill(void *destination,int value,size_t count){void *r=memset(destination,value,count);SetLastError(777);return r;}
static void init_config(BYTE *config){memset(config,0,0x310);put64(config,0,24);put64(config,8,48);put64(config,16,96);put64(config,0x100,48);put64(config,0x108,96);put64(config,0x110,288);memcpy(config+0x200,fh5_data_reservations,sizeof(fh5_data_reservations));put64(config,0x308,24);}
static void init_pool(BYTE *pool,void *metadata){memset(pool,0,0x48);void *old=calloc(1,0xa70);put64(old,0,(uintptr_t)fh5_data_image+0x656c7b8);put64(old,0x48,5630620);put64(pool,8,(uintptr_t)old);pool[0x28]=1;DWORD increment=24;memcpy(pool+0x2c,&increment,4);put64(pool,0x30,1000000);put64(pool,0x40,(uintptr_t)metadata);}
static void init_image(BYTE *b){IMAGE_DOS_HEADER *d=(void*)b;d->e_magic=IMAGE_DOS_SIGNATURE;d->e_lfanew=0x100;IMAGE_NT_HEADERS64 *n=(void*)(b+0x100);n->Signature=IMAGE_NT_SIGNATURE;n->FileHeader.Machine=IMAGE_FILE_MACHINE_AMD64;n->FileHeader.TimeDateStamp=0x6989f558;n->OptionalHeader.Magic=IMAGE_NT_OPTIONAL_HDR64_MAGIC;n->OptionalHeader.SizeOfImage=FH5_DATA_IMAGE_SIZE;
 for(unsigned i=0;i<20;i++)b[0xa21a50+i]=(BYTE)(0x21u+i*7u);
 for(unsigned i=0;i<60;i++)b[0xa21b95+i]=fixture_instructions[i]=(BYTE)(0x5au+i*3u);
 b[0xa21cc9]=0xe8;int32_t displacement=0x5374e04-0xa21cce;memcpy(b+0xa21cca,&displacement,4);
 if(!fh5_data_sha256(b+0xa21a50,20,fh5_data_front_hash)||!fh5_data_sha256(b+0xa21b95,60,fh5_data_code_hash)||!fh5_data_sha256(b+0xa21cc9,5,fh5_data_call_hash))abort();}

int main(void){
 BYTE *image=VirtualAlloc(NULL,FH5_DATA_IMAGE_SIZE,MEM_RESERVE,PAGE_NOACCESS);CHECK(image);CHECK(VirtualAlloc(image,4096,MEM_COMMIT,PAGE_READWRITE));CHECK(VirtualAlloc(image+0xa21000,4096,MEM_COMMIT,PAGE_READWRITE));CHECK(VirtualAlloc(image+0x9c6b000,4096,MEM_COMMIT,PAGE_READWRITE));CHECK(VirtualAlloc(image+0x5374000,4096,MEM_COMMIT,PAGE_READWRITE));init_image(image);fh5_data_image=image;fh5_data_functions=(struct fh5_data_ops){fake_new,fake_ctor,fake_dtor,fake_delete};fh5_data_real_memset=native_fill;fh5_data_enabled=TRUE;CHECK(fh5_data_image_matches(image));
 BYTE *metadata=malloc(4000000);CHECK(metadata);BYTE pool[0x48],frame[0x400]={0};init_pool(pool,metadata);uintptr_t self=(uintptr_t)pool;memcpy(frame+8+0x360,&self,8);init_config(frame+8+0x30);BYTE original_config[0x310];memcpy(original_config,frame+8+0x30,sizeof(original_config));
 uintptr_t old=fh5_data_u64(pool,8);CHECK(fh5_data_adjust((uintptr_t)frame,metadata,1,4000000)==-1);CHECK(fh5_data_adjust((uintptr_t)frame,metadata,0,3999999)==-1);
 for(unsigned i=0;i<60;i++){image[0xa21b95+i]^=1;CHECK(fh5_data_adjust((uintptr_t)frame,metadata,0,4000000)==-1);CHECK(fh5_data_u64(pool,8)==old);image[0xa21b95+i]^=1;}
 put64((BYTE*)old,0x70,24);CHECK(fh5_data_adjust((uintptr_t)frame,metadata,0,4000000)==-4);put64((BYTE*)old,0x70,0);
 put64(image,FH5_DATA_TABLE_RVA+16,1);CHECK(fh5_data_adjust((uintptr_t)frame,metadata,0,4000000)==-5);put64(image,FH5_DATA_TABLE_RVA+16,0);
 frame[8+0x30+0x200]^=1;CHECK(fh5_data_adjust((uintptr_t)frame,metadata,0,4000000)==-7);frame[8+0x30+0x200]^=1;
 allocate_fail=1;CHECK(fh5_data_adjust((uintptr_t)frame,metadata,0,4000000)==-9);CHECK(fh5_data_u64(pool,8)==old);allocate_fail=0;
 bad_capacity=1;CHECK(fh5_data_adjust((uintptr_t)frame,metadata,0,4000000)==-11);CHECK(fh5_data_u64(pool,8)==old);bad_capacity=0;
 CHECK(fh5_data_adjust((uintptr_t)frame,metadata,0,4000000)==1);CHECK(fh5_data_u64(pool,8)!=old);CHECK(observed_size==24000000);CHECK(!memcmp(frame+8+0x30,original_config,sizeof(original_config)));for(unsigned i=0;i<5;i++)CHECK(fh5_data_u64(observed_config,0x200+i*8)==fh5_data_reservations[i]*3/4);CHECK(!memcmp(image+0xa21b95,fixture_instructions,60));fh5_data_discard((void*)(uintptr_t)fh5_data_u64(pool,8));
 /* Execute a synthetic Win64 caller with the exact frame and original call
  * bytes. Only this fixture's generated code is executable; no game is loaded. */
 init_pool(pool,metadata);BYTE config[0x310];init_config(config);BYTE *stub=image+0xa21c50;memset(stub,0x90,0x7e);unsigned at=0;
 BYTE enter[]={0x55,0x56,0x57,0x48,0x81,0xec,0x40,0x03,0,0,0x48,0x89,0x8c,0x24,0x60,0x03,0,0,0x48,0x8b,0xf2,0x48,0x8d,0x7c,0x24,0x30,0xb9,0x62,0,0,0,0xf3,0x48,0xa5,0x48,0x8b,0x8c,0x24,0x60,0x03,0,0,0x48,0x8b,0x49,0x40,0x31,0xd2,0x41,0xb8,0x00,0x09,0x3d,0x00};memcpy(stub,enter,sizeof(enter));at=0xa21cc9-0xa21c50;BYTE call[5]={0xe8};int32_t displacement=0x5374e04-0xa21cce;memcpy(call+1,&displacement,4);memcpy(stub+at,call,5);BYTE leave[]={0x48,0x81,0xc4,0x40,0x03,0,0,0x5f,0x5e,0x5d,0xc3};memcpy(image+0xa21cce,leave,sizeof(leave));
 BYTE *thunk=image+0x5374e04;thunk[0]=0x48;thunk[1]=0xb8;uintptr_t callback=(uintptr_t)fh5_data_memset;memcpy(thunk+2,&callback,8);thunk[10]=0xff;thunk[11]=0xe0;
 DWORD protect;CHECK(VirtualProtect(image+0xa21000,4096,PAGE_EXECUTE_READ,&protect));CHECK(VirtualProtect(image+0x5374000,4096,PAGE_EXECUTE_READ,&protect));CHECK(FlushInstructionCache(GetCurrentProcess(),image+0xa21000,4096));CHECK(FlushInstructionCache(GetCurrentProcess(),image+0x5374000,4096));
 typedef void *(__cdecl *stub_fn)(void*,void*);stub_fn run=(stub_fn)(void*)stub;unsigned before_notes=notes;void *result=run(pool,config);CHECK(result==metadata);CHECK(GetLastError()==777);CHECK(notes==before_notes+1);CHECK(fh5_data_u64((BYTE*)(uintptr_t)fh5_data_u64(pool,8),0x48)==10222964);CHECK(!memcmp(config,original_config,sizeof(config)));CHECK(!memcmp(image+0xa21b95,fixture_instructions,60));MEMORY_BASIC_INFORMATION m;CHECK(VirtualQuery(image+0xa21000,&m,sizeof(m))==sizeof(m));CHECK(m.Protect==PAGE_EXECUTE_READ);
 fh5_data_discard((void*)(uintptr_t)fh5_data_u64(pool,8));BYTE ordinary[32];before_notes=notes;CHECK(fh5_data_memset(ordinary,0x5a,sizeof(ordinary))==ordinary);CHECK(notes==before_notes);CHECK(GetLastError()==777);CHECK(ordinary[0]==0x5a&&ordinary[31]==0x5a);CHECK(destructed==released);free(metadata);CHECK(VirtualFree(image,0,MEM_RELEASE));printf("DATA_FIXTURE_OK checks=%u allocations=%u releases=%u native_frame_exercised=1 text_unchanged=1\n",checks,allocated,released);return 0;
}
