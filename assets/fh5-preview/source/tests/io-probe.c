#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <stdio.h>
#include <string.h>
static unsigned checks;
#define CHECK(x) do{checks++;if(!(x)){printf("IO_PROBE_FAIL line=%d error=%lu\n",__LINE__,GetLastError());return 1;}}while(0)
struct state {HANDLE ready;OVERLAPPED ov;PTP_IO io,seen_io;void *seen_context,*seen_overlapped;ULONG result;ULONG_PTR bytes;LONG calls;BOOL instance;};
static VOID CALLBACK complete(PTP_CALLBACK_INSTANCE instance,void *context,void *overlapped,ULONG result,ULONG_PTR bytes,PTP_IO io){
 struct state *s=context;s->instance=instance!=NULL;s->seen_context=context;s->seen_overlapped=overlapped;s->seen_io=io;s->result=result;s->bytes=bytes;InterlockedIncrement(&s->calls);SetEvent(s->ready);
}
static DWORD WINAPI thread_routine(void *context){SetEvent(context);return 42;}
static void clear_state(struct state *s){ResetEvent(s->ready);memset(&s->ov,0,sizeof(s->ov));s->calls=0;s->seen_context=NULL;s->seen_io=NULL;}
int main(int argc,char **argv){
 CHECK(argc==2);BOOL observed=strcmp(argv[1],"baseline")!=0;if(observed)CHECK(LoadLibraryA(argv[1])!=NULL);
 const char payload[]="TPIO_PRIVATE_PAYLOAD_MARKER";char path[MAX_PATH],file[MAX_PATH],buffer[128]={0};DWORD count=0;
 CHECK(GetTempPathA(MAX_PATH,path)>0);CHECK(GetTempFileNameA(path,"tpi",0,file)!=0);
 HANDLE f=CreateFileA(file,GENERIC_WRITE,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,NULL);CHECK(f!=INVALID_HANDLE_VALUE);CHECK(WriteFile(f,payload,sizeof(payload),&count,NULL));CHECK(count==sizeof(payload));CHECK(CloseHandle(f));
 f=CreateFileA(file,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_FLAG_OVERLAPPED,NULL);CHECK(f!=INVALID_HANDLE_VALUE);
 struct state state={0};state.ready=CreateEventW(NULL,TRUE,FALSE,NULL);CHECK(state.ready!=NULL);
 state.io=CreateThreadpoolIo(f,complete,&state,NULL);CHECK(state.io!=NULL);StartThreadpoolIo(state.io);
 BOOL ok=ReadFile(f,buffer,sizeof(payload),NULL,&state.ov);CHECK(ok || GetLastError()==ERROR_IO_PENDING);
 CHECK(WaitForSingleObject(state.ready,5000)==WAIT_OBJECT_0);WaitForThreadpoolIoCallbacks(state.io,FALSE);
 CHECK(state.calls==1 && state.instance);CHECK(state.seen_context==&state && state.seen_overlapped==&state.ov && state.seen_io==state.io);CHECK(state.result==0 && state.bytes==sizeof(payload));CHECK(!memcmp(buffer,payload,sizeof(payload)));
 CloseThreadpoolIo(state.io);CHECK(CloseHandle(state.ready));CHECK(CloseHandle(f));
 WSADATA w;CHECK(WSAStartup(MAKEWORD(2,2),&w)==0);
 SOCKET receiver=WSASocketW(AF_INET,SOCK_DGRAM,IPPROTO_UDP,NULL,0,WSA_FLAG_OVERLAPPED);CHECK(receiver!=INVALID_SOCKET);SOCKET sender=socket(AF_INET,SOCK_DGRAM,IPPROTO_UDP);CHECK(sender!=INVALID_SOCKET);
 struct sockaddr_in addr={0};addr.sin_family=AF_INET;addr.sin_addr.s_addr=htonl(INADDR_LOOPBACK);int addr_len=sizeof(addr);CHECK(bind(receiver,(struct sockaddr*)&addr,sizeof(addr))==0);CHECK(getsockname(receiver,(struct sockaddr*)&addr,&addr_len)==0);
 state=(struct state){0};state.ready=CreateEventW(NULL,TRUE,FALSE,NULL);CHECK(state.ready!=NULL);state.io=CreateThreadpoolIo((HANDLE)receiver,complete,&state,NULL);CHECK(state.io!=NULL);
 WSABUF data={sizeof(buffer),buffer};DWORD received=0,flags=0;StartThreadpoolIo(state.io);
 CHECK(WSARecvFrom(receiver,&data,1,&received,&flags,NULL,NULL,&state.ov,NULL)==SOCKET_ERROR);CHECK(WSAGetLastError()==WSA_IO_PENDING);CHECK(CancelIoEx((HANDLE)receiver,&state.ov));
 CHECK(WaitForSingleObject(state.ready,5000)==WAIT_OBJECT_0);WaitForThreadpoolIoCallbacks(state.io,FALSE);CHECK(state.calls==1 && state.instance);CHECK(state.result==ERROR_OPERATION_ABORTED);CHECK(state.seen_context==&state && state.seen_overlapped==&state.ov && state.seen_io==state.io);
 clear_state(&state);received=flags=0;StartThreadpoolIo(state.io);CHECK(WSARecvFrom(receiver,&data,1,&received,&flags,NULL,NULL,&state.ov,NULL)==SOCKET_ERROR);CHECK(WSAGetLastError()==WSA_IO_PENDING);
 CHECK(sendto(sender,payload,sizeof(payload),0,(struct sockaddr*)&addr,sizeof(addr))==sizeof(payload));CHECK(WaitForSingleObject(state.ready,5000)==WAIT_OBJECT_0);WaitForThreadpoolIoCallbacks(state.io,FALSE);
 CHECK(state.calls==1 && state.result==0 && state.bytes==sizeof(payload));CHECK(state.seen_context==&state && state.seen_overlapped==&state.ov && state.seen_io==state.io);CHECK(!memcmp(buffer,payload,sizeof(payload)));
 CloseThreadpoolIo(state.io);CHECK(CloseHandle(state.ready));CHECK(closesocket(sender)==0);CHECK(closesocket(receiver)==0);CHECK(WSACleanup()==0);
 f=CreateFileA(file,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_FLAG_OVERLAPPED,NULL);CHECK(f!=INVALID_HANDLE_VALUE);OVERLAPPED ov={0};ov.hEvent=CreateEventA(NULL,TRUE,FALSE,NULL);CHECK(ov.hEvent!=NULL);memset(buffer,0,sizeof(buffer));ok=ReadFile(f,buffer,sizeof(payload),NULL,&ov);CHECK(ok || GetLastError()==ERROR_IO_PENDING);CHECK(GetOverlappedResultEx(f,&ov,&received,5000,FALSE));CHECK(received==sizeof(payload) && !memcmp(buffer,payload,sizeof(payload)));CHECK(CloseHandle(ov.hEvent));CHECK(CloseHandle(f));CHECK(DeleteFileA(file));
 SetLastError(12345);PTP_IO invalid=CreateThreadpoolIo(INVALID_HANDLE_VALUE,complete,&state,NULL);DWORD invalid_error=GetLastError();CHECK(invalid==NULL);printf("NATIVE_ERRORS invalid_io=%lu ",invalid_error);
 HANDLE mutex=CreateMutexW(NULL,FALSE,L"TPIO_PRIVATE_OBJECT_MARKER_W");CHECK(mutex!=NULL);CHECK(CreateEventW(NULL,FALSE,FALSE,L"TPIO_PRIVATE_OBJECT_MARKER_W")==NULL);printf("event_w=%lu ",GetLastError());CHECK(CloseHandle(mutex));
 mutex=CreateMutexA(NULL,FALSE,"TPIO_PRIVATE_OBJECT_MARKER_A");CHECK(mutex!=NULL);CHECK(CreateEventA(NULL,FALSE,FALSE,"TPIO_PRIVATE_OBJECT_MARKER_A")==NULL);printf("event_a=%lu\n",GetLastError());CHECK(CloseHandle(mutex));
 HANDLE ready=CreateEventA(NULL,FALSE,FALSE,NULL);CHECK(ready!=NULL);HANDLE thread=CreateThread(NULL,0,thread_routine,ready,0,NULL);CHECK(thread!=NULL);CHECK(WaitForSingleObject(ready,5000)==WAIT_OBJECT_0);CHECK(WaitForSingleObject(thread,5000)==WAIT_OBJECT_0);DWORD code=0;CHECK(GetExitCodeThread(thread,&code));CHECK(code==42);CHECK(CloseHandle(thread));CHECK(CloseHandle(ready));
 printf("IO_PROBE_OK checks=%u callback_context_and_identity=1 file_and_udp_payloads=1 cancellation_preserved=1\n",checks-(observed?1:0));return 0;
}
