#ifndef MACXUS_FH5_DESCRIPTOR_DATA_H
#define MACXUS_FH5_DESCRIPTOR_DATA_H
/* Private exact-build experiment. Reads verified caller-frame data, constructs
 * a replacement empty range allocator using the game's own factory/destructor,
 * then swaps its data pointer before publication. No game instruction writes,
 * generated trampolines, exit interception or stack unwinding. */
#include <stdint.h>
#include <string.h>
#include <bcrypt.h>
#ifdef FH5_DATA_FIXTURE
#define FH5_HASH_CONST
#else
#define FH5_HASH_CONST const
#endif
static FH5_HASH_CONST BYTE fh5_data_code_hash[32]={0xcd,0x78,0xee,0x71,0xc4,0x97,0x32,0x4a,0x22,0x0b,0xdd,0xa2,0xed,0x64,0x3a,0x36,0x53,0x65,0xeb,0x23,0xdd,0x77,0xb2,0xd5,0x0c,0x65,0x6f,0x2d,0xb8,0x7f,0x6c,0x84};
static FH5_HASH_CONST BYTE fh5_data_front_hash[32]={0xf2,0x82,0xae,0xc4,0xa0,0xca,0x8e,0xe5,0x84,0xf7,0xad,0xdc,0x5c,0x52,0xc6,0xa8,0xff,0xa8,0x07,0xd1,0x33,0x85,0x90,0xfd,0x1a,0xf4,0x20,0x2a,0xad,0xfd,0x50,0xf1};
static FH5_HASH_CONST BYTE fh5_data_call_hash[32]={0xe2,0x49,0xa8,0xeb,0x93,0x29,0x72,0xe7,0x80,0x7b,0x2d,0x3e,0x67,0x86,0xfa,0x2e,0x93,0x71,0x7a,0x8c,0xe9,0x7c,0x24,0xe6,0xb5,0x66,0x9b,0xab,0x75,0x6d,0xa2,0xdd};

#define FH5_DATA_IMAGE_SIZE 0xa7db000u
#define FH5_DATA_RETURN_RVA 0xa21cceu
#define FH5_DATA_TABLE_RVA 0x9c6b930u
static BOOL fh5_data_enabled;
static BYTE *fh5_data_image;
static void *(__cdecl *fh5_data_real_memset)(void*,int,size_t);
typedef void *(__cdecl *fh5_data_new_fn)(size_t);
typedef void *(__cdecl *fh5_data_ctor_fn)(void*,UINT,void*,UINT64,const void*);
typedef void (__cdecl *fh5_data_dtor_fn)(void*);
typedef void (__cdecl *fh5_data_delete_fn)(void*,size_t);
struct fh5_data_ops {fh5_data_new_fn allocate;fh5_data_ctor_fn construct;fh5_data_dtor_fn destruct;fh5_data_delete_fn release;};
static struct fh5_data_ops fh5_data_functions;
static const uint64_t fh5_data_reservations[5]={8300000,8000000,65536,2000000,3840};
static BOOL fh5_data_read(uintptr_t at,void *out,SIZE_T size){SIZE_T got=0;return ReadProcessMemory(GetCurrentProcess(),(void*)at,out,size,&got)&&got==size;}
static uint64_t fh5_data_u64(const BYTE *b,unsigned at){uint64_t value;memcpy(&value,b+at,8);return value;}
static BOOL fh5_data_image_identity(BYTE *base)
{
 IMAGE_DOS_HEADER dos;IMAGE_NT_HEADERS64 nt;
 if(!base||!fh5_data_read((uintptr_t)base,&dos,sizeof(dos))||dos.e_magic!=IMAGE_DOS_SIGNATURE||dos.e_lfanew<0||dos.e_lfanew>1048576)return FALSE;
 return fh5_data_read((uintptr_t)base+dos.e_lfanew,&nt,sizeof(nt))&&nt.Signature==IMAGE_NT_SIGNATURE&&nt.FileHeader.Machine==IMAGE_FILE_MACHINE_AMD64&&nt.FileHeader.TimeDateStamp==0x6989f558&&nt.OptionalHeader.Magic==IMAGE_NT_OPTIONAL_HDR64_MAGIC&&nt.OptionalHeader.SizeOfImage==FH5_DATA_IMAGE_SIZE;
}
static BOOL fh5_data_sha256(const BYTE *bytes,ULONG size,BYTE out[32])
{
 BCRYPT_ALG_HANDLE algorithm=NULL;BCRYPT_HASH_HANDLE hash=NULL;BYTE *object=NULL;ULONG object_size=0,written=0;BOOL ok=FALSE;
 if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,NULL,0)<0)goto done;
 if(BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,(BYTE*)&object_size,sizeof(object_size),&written,0)<0||written!=sizeof(object_size)||!object_size)goto done;
 object=HeapAlloc(GetProcessHeap(),0,object_size);if(!object)goto done;
 if(BCryptCreateHash(algorithm,&hash,object,object_size,NULL,0,0)<0)goto done;
 if(BCryptHashData(hash,(BYTE*)bytes,size,0)<0||BCryptFinishHash(hash,out,32,0)<0)goto done;
 ok=TRUE;
 done:if(hash)BCryptDestroyHash(hash);if(object)HeapFree(GetProcessHeap(),0,object);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);return ok;
}
static BOOL fh5_data_region_matches(BYTE *base,unsigned rva,ULONG size,const BYTE expected[32])
{
 BYTE bytes[60],digest[32];return size<=sizeof(bytes)&&fh5_data_read((uintptr_t)base+rva,bytes,size)&&fh5_data_sha256(bytes,size,digest)&&!memcmp(digest,expected,32);
}
static BOOL fh5_data_image_matches(BYTE *base)
{
 return fh5_data_image_identity(base)&&fh5_data_region_matches(base,0xa21a50,20,fh5_data_front_hash)&&fh5_data_region_matches(base,0xa21b95,60,fh5_data_code_hash)&&fh5_data_region_matches(base,0xa21cc9,5,fh5_data_call_hash);
}
static void fh5_data_discard(void *allocator){fh5_data_functions.destruct(allocator);fh5_data_functions.release(allocator,0xa70);}
/* Called only at a verified return site. All captured arguments are read-only.
 * Results: 1 replaced; negative means untouched/refused. */
static int fh5_data_adjust(uintptr_t return_slot,void *destination,int value,size_t count)
{
 BYTE config[0x310],pool[0x48],old_state[0x90];uintptr_t self=0,registered=0;uint64_t expected=10222964;
 if(value||count!=4000000||!fh5_data_image_matches(fh5_data_image))return -1;
 if(return_slot>UINTPTR_MAX-0x370||!fh5_data_read(return_slot+8+0x360,&self,8)||!self||!fh5_data_read(self,pool,sizeof(pool)))return -2;
 DWORD increment,type;memcpy(&increment,pool+0x2c,4);memcpy(&type,pool+0x38,4);
 if(pool[0x28]!=1||increment!=24||type||fh5_data_u64(pool,0x30)!=1000000||fh5_data_u64(pool,0x40)!=(uintptr_t)destination)return -3;
 uintptr_t old=(uintptr_t)fh5_data_u64(pool,8);if(!old||!fh5_data_read(old,old_state,sizeof(old_state))||fh5_data_u64(old_state,0)!=(uintptr_t)fh5_data_image+0x656c7b8||fh5_data_u64(old_state,0x48)!=5630620||fh5_data_u64(old_state,0x70)||fh5_data_u64(old_state,0x78))return -4;
 if(!fh5_data_read((uintptr_t)fh5_data_image+FH5_DATA_TABLE_RVA+16,&registered,8)||registered)return -5;
 if(!fh5_data_read(return_slot+8+0x30,config,sizeof(config)))return -6;
 const uint64_t sizes[3]={24,48,96},limits[3]={48,96,288};
 if(memcmp(config,sizes,sizeof(sizes))||memcmp(config+0x100,limits,sizeof(limits))||memcmp(config+0x200,fh5_data_reservations,sizeof(fh5_data_reservations))||fh5_data_u64(config,0x308)!=24)return -7;
 if(!fh5_data_functions.allocate||!fh5_data_functions.construct||!fh5_data_functions.destruct||!fh5_data_functions.release)return -8;
 for(unsigned i=0;i<5;i++){uint64_t scaled=fh5_data_reservations[i]*3/4;memcpy(config+0x200+8*i,&scaled,8);}
 void *memory=fh5_data_functions.allocate(0xa70);if(!memory)return -9;
 void *replacement=fh5_data_functions.construct(memory,0,NULL,24000000,config);
 if(replacement!=memory){if(replacement==NULL)fh5_data_functions.release(memory,0xa70);return -10;}
 BYTE state[0x90];if(!fh5_data_read((uintptr_t)replacement,state,sizeof(state))||fh5_data_u64(state,0)!=(uintptr_t)fh5_data_image+0x656c7b8||fh5_data_u64(state,0x48)!=expected||fh5_data_u64(state,0x70)||fh5_data_u64(state,0x78)){fh5_data_discard(replacement);return -11;}
 if(InterlockedCompareExchangePointer((void *volatile*)(self+8),replacement,(void*)old)!=(void*)old){fh5_data_discard(replacement);return -12;}
 fh5_data_discard((void*)old);return 1;
}
static __attribute__((noinline)) void *__cdecl fh5_data_memset(void *destination,int value,size_t count)
{
 uintptr_t slot=(uintptr_t)__builtin_frame_address(0)+sizeof(void*);void *caller=__builtin_return_address(0);
 void *result=fh5_data_real_memset(destination,value,count);DWORD saved=GetLastError();
 if(fh5_data_enabled&&(uintptr_t)caller==(uintptr_t)fh5_data_image+FH5_DATA_RETURN_RVA){int adjusted=fh5_data_adjust(slot,destination,value,count);observer_note(31,0,"descriptor_data_result=%d native_increment=24 predicted_capacity=10222964 text_writes=0",adjusted);}
 SetLastError(saved);return result;
}
#ifndef FH5_DATA_FIXTURE
static void fh5_data_install(BYTE *base)
{
 char setting[8];WCHAR path[MAX_PATH];DWORD n;
 if(GetEnvironmentVariableA("MACXUS_FH5_DESCRIPTOR_DATA",setting,sizeof(setting))!=1||setting[0]!='1')return;
 n=GetModuleFileNameW(NULL,path,MAX_PATH);if(!n||n>=MAX_PATH)return;WCHAR *name=wcsrchr(path,L'\\');name=name?name+1:path;
 if(_wcsicmp(name,L"ForzaHorizon5.exe")||!fh5_data_image_identity(base))return;
 fh5_data_image=base;fh5_data_functions=(struct fh5_data_ops){(fh5_data_new_fn)(base+0x4df3a20),(fh5_data_ctor_fn)(base+0xa21570),(fh5_data_dtor_fn)(base+0xa22770),(fh5_data_delete_fn)(base+0x4df3a70)};fh5_data_enabled=TRUE;
}
#endif
#endif
