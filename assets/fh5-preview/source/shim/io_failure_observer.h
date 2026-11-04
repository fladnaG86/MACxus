#ifndef MACXUS_IO_FAILURE_OBSERVER_H
#define MACXUS_IO_FAILURE_OBSERVER_H
/* Each registration gets a distinct static callback thunk. Native Context and
 * callback environment remain unchanged; no handle-to-callback lookup or free
 * races. Slots are immutable until process exit; overflow uses the native
 * callback directly. The diagnostic module is pinned for callback lifetime. */
static BOOL observer_async_io_enabled;
#define OBSERVER_IO_SLOTS 4096
struct observer_io_registration { PTP_WIN32_IO_CALLBACK callback;DWORD file_kind;unsigned socket_id; };
static struct observer_io_registration observer_io_registrations[OBSERVER_IO_SLOTS];
static LONG64 observer_io_next_slot=-1;
static INIT_ONCE observer_io_pin_once=INIT_ONCE_STATIC_INIT;
static VOID observer_io_complete(unsigned slot,PTP_CALLBACK_INSTANCE instance,PVOID context,PVOID overlapped,ULONG result,ULONG_PTR bytes,PTP_IO io)
{
    DWORD saved=GetLastError();struct observer_io_registration registration=observer_io_registrations[slot];
    BOOL critical=result==1450 || result==0xc000009a || result==0x800705aa;
    if(critical || observer_sample(27,result && result!=ERROR_OPERATION_ABORTED && result!=ERROR_HANDLE_EOF))
        observer_note(27,0,"registration=%u file_kind=%lu socket_id=%u io_result=%lu bytes=%llu critical=%u",slot+1,registration.file_kind,registration.socket_id,result,(unsigned long long)bytes,critical);
    SetLastError(saved);
    registration.callback(instance,context,overlapped,result,bytes,io);
}
#define IO_SLOT(n) static VOID CALLBACK observer_io_cb_##n(PTP_CALLBACK_INSTANCE instance,PVOID context,PVOID overlapped,ULONG result,ULONG_PTR bytes,PTP_IO io) { observer_io_complete(n,instance,context,overlapped,result,bytes,io); }
#include "io_callback_slots.inc"
#undef IO_SLOT
static const PTP_WIN32_IO_CALLBACK observer_io_callbacks[]={
#define IO_SLOT(n) observer_io_cb_##n,
#include "io_callback_slots.inc"
#undef IO_SLOT
};
static BOOL CALLBACK observer_io_pin(PINIT_ONCE once,PVOID context,PVOID *out)
{
    HMODULE module;(void)once;(void)context;(void)out;
    return GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,(LPCWSTR)(uintptr_t)observer_io_cb_0,&module);
}
static PTP_IO (WINAPI *observer_real_create_io)(HANDLE,PTP_WIN32_IO_CALLBACK,PVOID,PTP_CALLBACK_ENVIRON);
static BOOL (WINAPI *observer_real_overlapped_result)(HANDLE,LPOVERLAPPED,LPDWORD,DWORD,BOOL);
static HANDLE (WINAPI *observer_real_event_w)(LPSECURITY_ATTRIBUTES,BOOL,BOOL,LPCWSTR);
static HANDLE (WINAPI *observer_real_event_a)(LPSECURITY_ATTRIBUTES,BOOL,BOOL,LPCSTR);
static HANDLE (WINAPI *observer_real_create_thread)(LPSECURITY_ATTRIBUTES,SIZE_T,LPTHREAD_START_ROUTINE,LPVOID,DWORD,LPDWORD);
static PTP_IO WINAPI observer_create_io(HANDLE file,PTP_WIN32_IO_CALLBACK callback,PVOID context,PTP_CALLBACK_ENVIRON environment)
{
    DWORD before=GetLastError();LONG64 slot=-1;BOOL tracked=FALSE;
    if(callback && InitOnceExecuteOnce(&observer_io_pin_once,observer_io_pin,NULL,NULL)){
        slot=InterlockedIncrement64(&observer_io_next_slot);
        if(slot>=0 && slot<OBSERVER_IO_SLOTS){
            observer_io_registrations[slot]=(struct observer_io_registration){callback,GetFileType(file),observer_socket_id((SOCKET)(UINT_PTR)file,FALSE,0,0,0)};
            MemoryBarrier();tracked=TRUE;
        }
    }
    SetLastError(before);
    PTP_IO io=observer_real_create_io(file,tracked?observer_io_callbacks[slot]:callback,context,environment);
    DWORD saved=GetLastError();
    if(!io || observer_sample(26,callback && !tracked))observer_note(26,OBS_CALLER,"ok=%u error=%lu tracked=%u registration=%llu",io!=NULL,io?0:saved,tracked,tracked?(unsigned long long)slot+1:0);
    SetLastError(saved);return io;
}
static BOOL WINAPI observer_overlapped_result(HANDLE file,LPOVERLAPPED overlapped,LPDWORD transferred,DWORD timeout,BOOL alertable)
{
    BOOL result=observer_real_overlapped_result(file,overlapped,transferred,timeout,alertable);DWORD saved=GetLastError();BOOL ordinary=saved==ERROR_IO_INCOMPLETE || saved==WAIT_TIMEOUT || saved==WAIT_IO_COMPLETION || saved==ERROR_OPERATION_ABORTED;
    if(saved==1450 || observer_sample(28,!result && !ordinary))observer_note(28,OBS_CALLER,"ok=%u error=%lu bytes=%lu timeout=%lu alertable=%u",result,result?0:saved,result&&transferred?*transferred:0,timeout,alertable);
    SetLastError(saved);return result;
}
static HANDLE WINAPI observer_event_w(LPSECURITY_ATTRIBUTES attributes,BOOL manual,BOOL initial,LPCWSTR name)
{
    HANDLE result=observer_real_event_w(attributes,manual,initial,name);DWORD saved=GetLastError();
    if(!result && observer_sample(29,TRUE))observer_note(29,OBS_CALLER,"ok=0 error=%lu wide=1 manual=%u initial=%u",saved,manual,initial);
    SetLastError(saved);return result;
}
static HANDLE WINAPI observer_event_a(LPSECURITY_ATTRIBUTES attributes,BOOL manual,BOOL initial,LPCSTR name)
{
    HANDLE result=observer_real_event_a(attributes,manual,initial,name);DWORD saved=GetLastError();
    if(!result && observer_sample(29,TRUE))observer_note(29,OBS_CALLER,"ok=0 error=%lu wide=0 manual=%u initial=%u",saved,manual,initial);
    SetLastError(saved);return result;
}
static HANDLE WINAPI observer_create_thread(LPSECURITY_ATTRIBUTES attributes,SIZE_T stack,LPTHREAD_START_ROUTINE routine,LPVOID context,DWORD flags,LPDWORD id)
{
    HANDLE result=observer_real_create_thread(attributes,stack,routine,context,flags,id);DWORD saved=GetLastError();
    if(!result && observer_sample(30,TRUE))observer_note(30,OBS_CALLER,"ok=0 error=%lu stack=%llu flags=%lu",saved,(unsigned long long)stack,flags);
    SetLastError(saved);return result;
}
#endif
