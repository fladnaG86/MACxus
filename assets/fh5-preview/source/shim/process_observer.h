#ifndef MACXUS_PROCESS_OBSERVER_H
#define MACXUS_PROCESS_OBSERVER_H
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <psapi.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>

/* Private diagnostic: main-image IAT only. Original functions/results/errors are retained.
 * No request bodies, endpoint strings, tokens, pointer values or account identifiers. */
static uintptr_t observer_image;
static BOOL observer_commit_enabled,observer_udp_ttl_enabled;
#include "commit_accounting.h"
struct observer_rate { LONG calls; LONG last_tick; LONG errors; };
static struct observer_rate observer_rates[32];
static int observer_sample(unsigned api, BOOL abnormal)
{
    struct observer_rate *r=&observer_rates[api];
    LONG count=InterlockedIncrement(&r->calls), now=(LONG)GetTickCount(), old=InterlockedCompareExchange(&r->last_tick,0,0);
    if (abnormal && InterlockedIncrement(&r->errors)<=64) return 1;
    if (count<=16) return 1;
    return (DWORD)(now-old)>=2000 && InterlockedCompareExchange(&r->last_tick,now,old)==old;
}
static unsigned long long observer_caller(void *address)
{
    uintptr_t p=(uintptr_t)address;return p>=observer_image && p-observer_image<0x40000000 ? p-observer_image : 0;
}
#define OBS_CALLER observer_caller(__builtin_return_address(0))
static void observer_note(unsigned api, unsigned long long caller, const char *format, ...)
{
    DWORD saved=GetLastError(),n,written;WCHAR path[MAX_PATH];char line[1024];va_list args;
    n=GetEnvironmentVariableW(L"MACXUS_PROCESS_OBSERVER_LOG",path,MAX_PATH);
    if (!n || n>=MAX_PATH) goto done;
    int at=snprintf(line,sizeof(line),"PROCESS_META api=%u tick=%llu thread=%lu caller_rva=%llx ",api,(unsigned long long)GetTickCount64(),(unsigned long)GetCurrentThreadId(),caller);
    if(at<0 || (unsigned)at>=sizeof(line)) goto done;
    va_start(args,format);int count=vsnprintf(line+at,sizeof(line)-at,format,args);va_end(args);
    if(count<0 || (unsigned)count>=sizeof(line)-at-1) goto done;
    count+=at;line[count++]='\n';
    HANDLE file=CreateFileW(path,FILE_APPEND_DATA|GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file!=INVALID_HANDLE_VALUE){LARGE_INTEGER size;OVERLAPPED overlap={0};
        if(GetFileType(file)==FILE_TYPE_DISK && LockFileEx(file,LOCKFILE_EXCLUSIVE_LOCK|LOCKFILE_FAIL_IMMEDIATELY,0,MAXDWORD,MAXDWORD,&overlap)){
            if(GetFileSizeEx(file,&size) && size.QuadPart+count<=1048576) WriteFile(file,line,count,&written,NULL);
            UnlockFileEx(file,0,MAXDWORD,MAXDWORD,&overlap);
        }
        CloseHandle(file);
    }
 done:SetLastError(saved);
}
static BOOL (WINAPI *observer_real_memory_ex)(LPMEMORYSTATUSEX);
static VOID (WINAPI *observer_real_memory)(LPMEMORYSTATUS);
static BOOL (WINAPI *observer_real_process)(HANDLE,PPROCESS_MEMORY_COUNTERS,DWORD);
static BOOL (WINAPI *observer_real_installed)(PULONGLONG);
static LPVOID (WINAPI *observer_real_virtual_alloc)(LPVOID,SIZE_T,DWORD,DWORD);
static LPVOID (WINAPI *observer_real_heap_alloc)(HANDLE,DWORD,SIZE_T);
static BOOL WINAPI observer_memory_ex(LPMEMORYSTATUSEX m)
{
    BOOL result=observer_real_memory_ex(m);DWORD saved=GetLastError();
    if(observer_sample(1,!result || (m && m->ullAvailPhys<2147483648ull))){
        if(result && m)observer_note(1,OBS_CALLER,"ok=1 error=0 load=%lu total_phys=%llu avail_phys=%llu total_commit=%llu avail_commit=%llu total_virtual=%llu avail_virtual=%llu",m->dwMemoryLoad,m->ullTotalPhys,m->ullAvailPhys,m->ullTotalPageFile,m->ullAvailPageFile,m->ullTotalVirtual,m->ullAvailVirtual);
        else observer_note(1,OBS_CALLER,"ok=0 error=%lu",saved);
    }
    SetLastError(saved);return result;
}
static VOID WINAPI observer_memory(LPMEMORYSTATUS m)
{
    observer_real_memory(m);DWORD saved=GetLastError();
    if(observer_sample(2,FALSE) && m)observer_note(2,OBS_CALLER,"load=%lu total_phys=%llu avail_phys=%llu total_commit=%llu avail_commit=%llu total_virtual=%llu avail_virtual=%llu",m->dwMemoryLoad,(unsigned long long)m->dwTotalPhys,(unsigned long long)m->dwAvailPhys,(unsigned long long)m->dwTotalPageFile,(unsigned long long)m->dwAvailPageFile,(unsigned long long)m->dwTotalVirtual,(unsigned long long)m->dwAvailVirtual);
    SetLastError(saved);
}
static BOOL WINAPI observer_process(HANDLE process,PPROCESS_MEMORY_COUNTERS counters,DWORD size)
{
    BOOL result=observer_real_process(process,counters,size);DWORD saved=GetLastError();
    if(observer_commit_enabled && result && counters && size>=sizeof(*counters) &&
       (process==GetCurrentProcess() || GetProcessId(process)==GetCurrentProcessId())){
        struct guest_commit_snapshot snapshot;
        if(guest_commit_get(&snapshot)){
            ULONGLONG old=counters->PagefileUsage, corrected=snapshot.private_bytes+snapshot.copy_bytes;
            counters->PagefileUsage=(SIZE_T)corrected;
            if(size>=sizeof(PROCESS_MEMORY_COUNTERS_EX))((PROCESS_MEMORY_COUNTERS_EX*)counters)->PrivateUsage=(SIZE_T)corrected;
            if(observer_sample(7,FALSE))observer_note(7,OBS_CALLER,"original_pagefile=%llu guest_private_commit=%llu guest_copy_commit=%llu returned_pagefile=%llu regions=%u scan_us=%llu",old,snapshot.private_bytes,snapshot.copy_bytes,corrected,snapshot.regions,snapshot.duration_us);
        } else if(observer_sample(7,TRUE))observer_note(7,OBS_CALLER,"scan_failed=1 original_preserved=1");
    }
    if(observer_sample(3,!result)){
        BOOL self=process==GetCurrentProcess() || GetProcessId(process)==GetCurrentProcessId();
        if(result && counters && size>=sizeof(*counters))observer_note(3,OBS_CALLER,"ok=1 error=0 self=%u working_set=%llu peak_working_set=%llu pagefile=%llu peak_pagefile=%llu faults=%lu",self,(unsigned long long)counters->WorkingSetSize,(unsigned long long)counters->PeakWorkingSetSize,(unsigned long long)counters->PagefileUsage,(unsigned long long)counters->PeakPagefileUsage,counters->PageFaultCount);
        else observer_note(3,OBS_CALLER,"ok=0 error=%lu self=%u",saved,self);
    }
    SetLastError(saved);return result;
}
static BOOL WINAPI observer_installed(PULONGLONG kb)
{
    BOOL result=observer_real_installed(kb);DWORD saved=GetLastError();
    if(observer_sample(4,!result))observer_note(4,OBS_CALLER,"ok=%u error=%lu installed_kb=%llu",result,result?0:saved,result&&kb?*kb:0);
    SetLastError(saved);return result;
}
static LPVOID WINAPI observer_virtual_alloc(LPVOID base,SIZE_T size,DWORD type,DWORD protect)
{
    LPVOID result=observer_real_virtual_alloc(base,size,type,protect);DWORD saved=GetLastError();
    if(!result && observer_sample(5,TRUE))observer_note(5,OBS_CALLER,"ok=0 error=%lu size=%llu type=%lu protect=%lu",saved,(unsigned long long)size,type,protect);
    SetLastError(saved);return result;
}
static LPVOID WINAPI observer_heap_alloc(HANDLE heap,DWORD flags,SIZE_T size)
{
    LPVOID result=observer_real_heap_alloc(heap,flags,size);DWORD saved=GetLastError();
    if(!result && observer_sample(6,TRUE))observer_note(6,OBS_CALLER,"ok=0 error=%lu size=%llu flags=%lu",saved,(unsigned long long)size,flags);
    SetLastError(saved);return result;
}

struct observer_socket { SOCKET handle;unsigned id;int family,type,protocol;BOOL used; };
static struct observer_socket observer_sockets[256];
static SRWLOCK observer_socket_lock=SRWLOCK_INIT;
static unsigned observer_next_socket;
static unsigned observer_socket_id(SOCKET handle,BOOL create,int family,int type,int protocol)
{
    unsigned id=0;struct observer_socket *empty=NULL;
    AcquireSRWLockExclusive(&observer_socket_lock);
    for(unsigned i=0;i<256;i++){
        struct observer_socket *s=observer_sockets+i;
        if(s->used && s->handle==handle){id=s->id;break;}
        if(!s->used && !empty)empty=s;
    }
    if(!id && create && empty){*empty=(struct observer_socket){handle,++observer_next_socket,family,type,protocol,TRUE};id=empty->id;}
    ReleaseSRWLockExclusive(&observer_socket_lock);return id;
}
static void observer_socket_closed(SOCKET handle)
{
    AcquireSRWLockExclusive(&observer_socket_lock);
    for(unsigned i=0;i<256;i++)if(observer_sockets[i].used && observer_sockets[i].handle==handle){memset(observer_sockets+i,0,sizeof(observer_sockets[i]));break;}
    ReleaseSRWLockExclusive(&observer_socket_lock);
}
static BOOL observer_pending(int code){return code==WSA_IO_PENDING || code==WSAEWOULDBLOCK || code==WSAEINPROGRESS;}
static void observer_net_note(unsigned api,SOCKET handle,int result,int saved,unsigned long long caller,unsigned long long size,unsigned long flags,BOOL overlapped)
{
    int error=result==SOCKET_ERROR?saved:0;
    if(observer_sample(api,error && !observer_pending(error)))observer_note(api,caller,"socket_id=%u result=%d error=%d pending=%u size=%llu flags=%lu overlapped=%u",observer_socket_id(handle,FALSE,0,0,0),result,error,observer_pending(error),size,flags,overlapped);
}
static SOCKET (WSAAPI *observer_real_socket)(int,int,int);
static SOCKET (WSAAPI *observer_real_wsa_socket)(int,int,int,LPWSAPROTOCOL_INFOW,GROUP,DWORD);
static int (WSAAPI *observer_real_bind)(SOCKET,const struct sockaddr*,int);
static int (WSAAPI *observer_real_connect)(SOCKET,const struct sockaddr*,int);
static int (WSAAPI *observer_real_close)(SOCKET);
static int (WSAAPI *observer_real_sendto)(SOCKET,const char*,int,int,const struct sockaddr*,int);
static int (WSAAPI *observer_real_recvfrom)(SOCKET,char*,int,int,struct sockaddr*,int*);
static int (WSAAPI *observer_real_wsa_sendto)(SOCKET,LPWSABUF,DWORD,LPDWORD,DWORD,const struct sockaddr*,int,LPWSAOVERLAPPED,LPWSAOVERLAPPED_COMPLETION_ROUTINE);
static int (WSAAPI *observer_real_wsa_recvfrom)(SOCKET,LPWSABUF,DWORD,LPDWORD,LPDWORD,struct sockaddr*,LPINT,LPWSAOVERLAPPED,LPWSAOVERLAPPED_COMPLETION_ROUTINE);
static int (WSAAPI *observer_real_ioctl)(SOCKET,DWORD,LPVOID,DWORD,LPVOID,DWORD,LPDWORD,LPWSAOVERLAPPED,LPWSAOVERLAPPED_COMPLETION_ROUTINE);
static int (WSAAPI *observer_real_setsockopt)(SOCKET,int,int,const char*,int);
static int (WSAAPI *observer_real_getsockopt)(SOCKET,int,int,char*,int*);
static int (WSAAPI *observer_real_getaddrinfo)(PCSTR,PCSTR,const ADDRINFOA*,PADDRINFOA*);
static SOCKET WSAAPI observer_socket(int family,int type,int protocol)
{
    SOCKET result=observer_real_socket(family,type,protocol);int saved=WSAGetLastError();unsigned id=result==INVALID_SOCKET?0:observer_socket_id(result,TRUE,family,type,protocol);
    if(observer_sample(10,result==INVALID_SOCKET))observer_note(10,OBS_CALLER,"ok=%u error=%d socket_id=%u family=%d type=%d protocol=%d",result!=INVALID_SOCKET,result==INVALID_SOCKET?saved:0,id,family,type,protocol);
    WSASetLastError(saved);return result;
}
static SOCKET WSAAPI observer_wsa_socket(int family,int type,int protocol,LPWSAPROTOCOL_INFOW info,GROUP group,DWORD flags)
{
    SOCKET result=observer_real_wsa_socket(family,type,protocol,info,group,flags);int saved=WSAGetLastError();unsigned id=result==INVALID_SOCKET?0:observer_socket_id(result,TRUE,family,type,protocol);
    if(observer_sample(11,result==INVALID_SOCKET))observer_note(11,OBS_CALLER,"ok=%u error=%d socket_id=%u family=%d type=%d protocol=%d flags=%lu",result!=INVALID_SOCKET,result==INVALID_SOCKET?saved:0,id,family,type,protocol,flags);
    WSASetLastError(saved);return result;
}
static int WSAAPI observer_bind(SOCKET s,const struct sockaddr *address,int length)
{int result=observer_real_bind(s,address,length),saved=WSAGetLastError();observer_net_note(12,s,result,saved,OBS_CALLER,length,0,FALSE);WSASetLastError(saved);return result;}
static int WSAAPI observer_connect(SOCKET s,const struct sockaddr *address,int length)
{int result=observer_real_connect(s,address,length),saved=WSAGetLastError();observer_net_note(13,s,result,saved,OBS_CALLER,length,0,FALSE);WSASetLastError(saved);return result;}
static int WSAAPI observer_close(SOCKET s)
{int result=observer_real_close(s),saved=WSAGetLastError();observer_net_note(14,s,result,saved,OBS_CALLER,0,0,FALSE);if(!result)observer_socket_closed(s);WSASetLastError(saved);return result;}
static int WSAAPI observer_sendto(SOCKET s,const char *buffer,int length,int flags,const struct sockaddr *address,int address_length)
{int result=observer_real_sendto(s,buffer,length,flags,address,address_length),saved=WSAGetLastError();observer_net_note(15,s,result,saved,OBS_CALLER,length,flags,FALSE);WSASetLastError(saved);return result;}
static int WSAAPI observer_recvfrom(SOCKET s,char *buffer,int length,int flags,struct sockaddr *address,int *address_length)
{int result=observer_real_recvfrom(s,buffer,length,flags,address,address_length),saved=WSAGetLastError();observer_net_note(16,s,result,saved,OBS_CALLER,length,flags,FALSE);WSASetLastError(saved);return result;}
static int WSAAPI observer_wsa_sendto(SOCKET s,LPWSABUF buffers,DWORD count,LPDWORD sent,DWORD flags,const struct sockaddr *address,int address_length,LPWSAOVERLAPPED overlapped,LPWSAOVERLAPPED_COMPLETION_ROUTINE callback)
{int result=observer_real_wsa_sendto(s,buffers,count,sent,flags,address,address_length,overlapped,callback),saved=WSAGetLastError();observer_net_note(17,s,result,saved,OBS_CALLER,count,flags,overlapped!=NULL);WSASetLastError(saved);return result;}
static int WSAAPI observer_wsa_recvfrom(SOCKET s,LPWSABUF buffers,DWORD count,LPDWORD received,LPDWORD flags,struct sockaddr *address,LPINT address_length,LPWSAOVERLAPPED overlapped,LPWSAOVERLAPPED_COMPLETION_ROUTINE callback)
{int result=observer_real_wsa_recvfrom(s,buffers,count,received,flags,address,address_length,overlapped,callback),saved=WSAGetLastError();observer_net_note(18,s,result,saved,OBS_CALLER,count,0,overlapped!=NULL);WSASetLastError(saved);return result;}
static int WSAAPI observer_ioctl(SOCKET s,DWORD code,LPVOID input,DWORD input_size,LPVOID output,DWORD output_size,LPDWORD returned,LPWSAOVERLAPPED overlapped,LPWSAOVERLAPPED_COMPLETION_ROUTINE callback)
{int result=observer_real_ioctl(s,code,input,input_size,output,output_size,returned,overlapped,callback),saved=WSAGetLastError();observer_net_note(19,s,result,saved,OBS_CALLER,output_size,code,overlapped!=NULL);WSASetLastError(saved);return result;}
static BOOL observer_dual_udp(SOCKET s)
{
 int type=0,only=1,amount=sizeof(int),length=sizeof(struct sockaddr_storage);struct sockaddr_storage address;
 return getsockopt(s,SOL_SOCKET,SO_TYPE,(char*)&type,&amount)==0 && type==SOCK_DGRAM &&
        getsockname(s,(struct sockaddr*)&address,&length)==0 && address.ss_family==AF_INET6 &&
        (amount=sizeof(only),getsockopt(s,IPPROTO_IPV6,IPV6_V6ONLY,(char*)&only,&amount)==0) && !only;
}
static int WSAAPI observer_setsockopt(SOCKET s,int level,int option,const char *value,int length)
{
 int result=observer_real_setsockopt(s,level,option,value,length),saved=WSAGetLastError();
 if(observer_udp_ttl_enabled && result==SOCKET_ERROR && saved==WSAEINVAL && level==IPPROTO_IP && option==IP_TTL && value && length==sizeof(int)){
  int ttl=0;SIZE_T copied=0;
  if(ReadProcessMemory(GetCurrentProcess(),value,&ttl,sizeof(ttl),&copied) && copied==sizeof(ttl) && ttl>=1 && ttl<=255 &&
     observer_dual_udp(s)){
   result=observer_real_setsockopt(s,IPPROTO_IPV6,IPV6_UNICAST_HOPS,(const char*)&ttl,sizeof(ttl));
   int fallback_error=WSAGetLastError();
   if(observer_sample(23,result==SOCKET_ERROR))observer_note(23,OBS_CALLER,"socket_id=%u ttl=%d result=%d error=%d dual_stack_hop_mapping=1",observer_socket_id(s,FALSE,0,0,0),ttl,result,result==SOCKET_ERROR?fallback_error:0);
   if(!result)saved=fallback_error;
  }
 }
 if(observer_sample(20,result==SOCKET_ERROR))observer_note(20,OBS_CALLER,"socket_id=%u result=%d error=%d level=%d option=%d size=%d",observer_socket_id(s,FALSE,0,0,0),result,result==SOCKET_ERROR?saved:0,level,option,length);
 WSASetLastError(saved);return result;
}
static int WSAAPI observer_getsockopt(SOCKET s,int level,int option,char *value,int *length)
{
 int result=observer_real_getsockopt(s,level,option,value,length),saved=WSAGetLastError(),socket_error=0;
 if(observer_udp_ttl_enabled && result==SOCKET_ERROR && saved==WSAEINVAL && level==IPPROTO_IP && option==IP_TTL && observer_dual_udp(s)){
  int fallback=observer_real_getsockopt(s,IPPROTO_IPV6,IPV6_UNICAST_HOPS,value,length);
  if(!fallback){result=0;saved=WSAGetLastError();}
 }
 if(!result && level==SOL_SOCKET && option==SO_ERROR && value && length && *length>=(int)sizeof(socket_error))memcpy(&socket_error,value,sizeof(socket_error));
 if(observer_sample(21,result==SOCKET_ERROR || socket_error))observer_note(21,OBS_CALLER,"socket_id=%u result=%d error=%d level=%d option=%d socket_error=%d",observer_socket_id(s,FALSE,0,0,0),result,result==SOCKET_ERROR?saved:0,level,option,socket_error);
 WSASetLastError(saved);return result;
}
static int WSAAPI observer_getaddrinfo(PCSTR node,PCSTR service,const ADDRINFOA *hints,PADDRINFOA *out)
{int result=observer_real_getaddrinfo(node,service,hints,out),saved=WSAGetLastError();if(observer_sample(22,result!=0))observer_note(22,OBS_CALLER,"result=%d error=%d",result,result);WSASetLastError(saved);return result;}

#include "io_failure_observer.h"
#include "fh5_descriptor_data.h"
#include "nvapi_profile.h"

struct observer_hook {const char *name;unsigned ordinal,api;void *hook;void **original;BOOL socket;};
#define OBS_ENTRY(name,ord,api,func,real,net) {name,ord,api,(void*)func,(void**)&real,net}
static struct observer_hook observer_hooks[]={
 OBS_ENTRY("GlobalMemoryStatusEx",0,1,observer_memory_ex,observer_real_memory_ex,FALSE),
 OBS_ENTRY("GlobalMemoryStatus",0,2,observer_memory,observer_real_memory,FALSE),
 OBS_ENTRY("K32GetProcessMemoryInfo",0,3,observer_process,observer_real_process,FALSE),
 OBS_ENTRY("GetProcessMemoryInfo",0,3,observer_process,observer_real_process,FALSE),
 OBS_ENTRY("GetPhysicallyInstalledSystemMemory",0,4,observer_installed,observer_real_installed,FALSE),
 OBS_ENTRY("VirtualAlloc",0,5,observer_virtual_alloc,observer_real_virtual_alloc,FALSE),
 OBS_ENTRY("HeapAlloc",0,6,observer_heap_alloc,observer_real_heap_alloc,FALSE),
 OBS_ENTRY("socket",23,10,observer_socket,observer_real_socket,TRUE),
 OBS_ENTRY("WSASocketW",0,11,observer_wsa_socket,observer_real_wsa_socket,TRUE),
 OBS_ENTRY("bind",2,12,observer_bind,observer_real_bind,TRUE),
 OBS_ENTRY("connect",4,13,observer_connect,observer_real_connect,TRUE),
 OBS_ENTRY("closesocket",3,14,observer_close,observer_real_close,TRUE),
 OBS_ENTRY("sendto",20,15,observer_sendto,observer_real_sendto,TRUE),
 OBS_ENTRY("recvfrom",17,16,observer_recvfrom,observer_real_recvfrom,TRUE),
 OBS_ENTRY("WSASendTo",0,17,observer_wsa_sendto,observer_real_wsa_sendto,TRUE),
 OBS_ENTRY("WSARecvFrom",0,18,observer_wsa_recvfrom,observer_real_wsa_recvfrom,TRUE),
 OBS_ENTRY("WSAIoctl",0,19,observer_ioctl,observer_real_ioctl,TRUE),
 OBS_ENTRY("setsockopt",21,20,observer_setsockopt,observer_real_setsockopt,TRUE),
 OBS_ENTRY("getsockopt",7,21,observer_getsockopt,observer_real_getsockopt,TRUE),
 OBS_ENTRY("getaddrinfo",0,22,observer_getaddrinfo,observer_real_getaddrinfo,TRUE),
 OBS_ENTRY("CreateThreadpoolIo",0,26,observer_create_io,observer_real_create_io,FALSE),
 OBS_ENTRY("GetOverlappedResultEx",0,28,observer_overlapped_result,observer_real_overlapped_result,FALSE),
 OBS_ENTRY("CreateEventW",0,29,observer_event_w,observer_real_event_w,FALSE),
 OBS_ENTRY("CreateEventA",0,29,observer_event_a,observer_real_event_a,FALSE),
 OBS_ENTRY("CreateThread",0,30,observer_create_thread,observer_real_create_thread,FALSE),
 OBS_ENTRY("memset",0,31,fh5_data_memset,fh5_data_real_memset,FALSE),
 OBS_ENTRY("GetProcAddress",0,33,fh5_nvapi_getproc,fh5_nvapi_real_getproc,FALSE)
};
static BOOL observer_image_range(SIZE_T image,SIZE_T rva,SIZE_T size){return rva<image && size<=image-rva;}
static BOOL observer_image_string(const BYTE *base,SIZE_T image,SIZE_T rva)
{return observer_image_range(image,rva,1) && memchr(base+rva,0,image-rva)!=NULL;}
static unsigned observer_patch_slot(void **slot,struct observer_hook *hook)
{
    void *current=*slot;DWORD protect,unused;
    if(current==hook->hook)return 0;
    if(!current || (*hook->original && *hook->original!=current))return 0;
    if(!VirtualProtect(slot,sizeof(*slot),PAGE_READWRITE,&protect))return 0;
    if(!*hook->original)InterlockedCompareExchangePointer(hook->original,current,NULL);
    if(*hook->original!=current){VirtualProtect(slot,sizeof(*slot),protect,&unused);return 0;}
    BOOL changed=InterlockedCompareExchangePointer(slot,hook->hook,current)==current;
    BOOL restored=VirtualProtect(slot,sizeof(*slot),protect,&unused);
    observer_note(0,0,"hook_api=%u installed=%u protection_restored=%u",hook->api,changed,restored);
    return changed;
}
static void process_observer_install(void)
{
    DWORD saved=GetLastError();char enabled[8];unsigned installed=0;
    if(GetEnvironmentVariableA("MACXUS_PROCESS_OBSERVER",enabled,sizeof enabled)!=1 || enabled[0]!='1')goto done;
    observer_commit_enabled=GetEnvironmentVariableA("MACXUS_COMMIT_ACCOUNTING",enabled,sizeof enabled)==1 && enabled[0]=='1';
    observer_udp_ttl_enabled=GetEnvironmentVariableA("MACXUS_DUAL_UDP_TTL",enabled,sizeof enabled)==1 && enabled[0]=='1';
    observer_async_io_enabled=GetEnvironmentVariableA("MACXUS_ASYNC_IO_OBSERVER",enabled,sizeof enabled)==1 && enabled[0]=='1';
    fh5_nvapi_configure();
    BYTE *base=(BYTE*)GetModuleHandleW(NULL);IMAGE_DOS_HEADER *dos=(IMAGE_DOS_HEADER*)base;
    if(!base || dos->e_magic!=IMAGE_DOS_SIGNATURE || dos->e_lfanew<0 || dos->e_lfanew>1048576)goto done;
    IMAGE_NT_HEADERS64 *nt=(IMAGE_NT_HEADERS64*)(base+dos->e_lfanew);
    if(nt->Signature!=IMAGE_NT_SIGNATURE || nt->OptionalHeader.Magic!=IMAGE_NT_OPTIONAL_HDR64_MAGIC || nt->OptionalHeader.NumberOfRvaAndSizes<=IMAGE_DIRECTORY_ENTRY_IMPORT)goto done;
    SIZE_T image=nt->OptionalHeader.SizeOfImage;
    IMAGE_DATA_DIRECTORY imports=nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
    if(!imports.VirtualAddress || !observer_image_range(image,imports.VirtualAddress,imports.Size))goto done;
    observer_image=(uintptr_t)base;
    fh5_data_install(base);
    for(SIZE_T at=0;at+sizeof(IMAGE_IMPORT_DESCRIPTOR)<=imports.Size;at+=sizeof(IMAGE_IMPORT_DESCRIPTOR)){
        IMAGE_IMPORT_DESCRIPTOR *d=(IMAGE_IMPORT_DESCRIPTOR*)(base+imports.VirtualAddress+at);
        if(!d->Name)break;
        if(!observer_image_string(base,image,d->Name) || !d->OriginalFirstThunk || !d->FirstThunk)continue;
        const char *dll=(const char*)base+d->Name;BOOL net=!_stricmp(dll,"ws2_32.dll");
        BOOL core=!_stricmp(dll,"kernel32.dll") || !_stricmp(dll,"kernelbase.dll") || !_stricmp(dll,"psapi.dll") || !_strnicmp(dll,"api-ms-win-core-",16) || !_stricmp(dll,"vcruntime140.dll");
        if(!net && !core)continue;
        for(SIZE_T index=0;index<65536;index++){
            SIZE_T offset=index*sizeof(IMAGE_THUNK_DATA64),original=(SIZE_T)d->OriginalFirstThunk+offset,target=(SIZE_T)d->FirstThunk+offset;
            if(!observer_image_range(image,original,sizeof(IMAGE_THUNK_DATA64)) || !observer_image_range(image,target,sizeof(IMAGE_THUNK_DATA64)))break;
            IMAGE_THUNK_DATA64 *thunk=(IMAGE_THUNK_DATA64*)(base+original);if(!thunk->u1.AddressOfData)break;
            unsigned ordinal=IMAGE_SNAP_BY_ORDINAL64(thunk->u1.Ordinal)?IMAGE_ORDINAL64(thunk->u1.Ordinal):0;const char *name=NULL;
            if(!ordinal){SIZE_T rva=(SIZE_T)thunk->u1.AddressOfData;if(!observer_image_range(image,rva,3) || !observer_image_string(base,image,rva+2))continue;name=(const char*)base+rva+2;}
            for(unsigned i=0;i<sizeof(observer_hooks)/sizeof(observer_hooks[0]);i++){
                struct observer_hook *h=observer_hooks+i;
                if(h->api==33 ? !(fh5_nvapi_enabled || fh5_nvapi_memory_enabled) : h->api==31 ? !fh5_data_enabled : h->api>=26 && !observer_async_io_enabled)continue;
                if(h->socket!=net || (ordinal ? !h->ordinal || h->ordinal!=ordinal : strcmp(h->name,name)))continue;
                installed+=observer_patch_slot((void**)(base+target),h);break;
            }
        }
    }
    observer_note(0,0,"main_image_hooks=%u scope=1",installed);
 done:SetLastError(saved);
}
#endif
