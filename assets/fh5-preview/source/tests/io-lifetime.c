#include "../shim/d3d12.c"
static int context_value,overlapped_value;
static TP_CALLBACK_ENVIRON callback_environment;
static BOOL correct=TRUE,expect_wrapped=TRUE,fail_factory;
static unsigned calls,checks;
#define CHECK(x) do{checks++;if(!(x)){printf("LIFETIME_FAIL line=%d error=%lu\n",__LINE__,GetLastError());return 1;}}while(0)
static VOID CALLBACK app_callback(PTP_CALLBACK_INSTANCE instance,PVOID context,PVOID overlapped,ULONG result,ULONG_PTR bytes,PTP_IO io)
{
 calls++;if(instance!=(PTP_CALLBACK_INSTANCE)0x1111 || context!=&context_value || overlapped!=&overlapped_value || result!=1450 || bytes!=77 || io!=(PTP_IO)0x2222 || GetLastError()!=12345)correct=FALSE;
}
static PTP_IO WINAPI fake_factory(HANDLE file,PTP_WIN32_IO_CALLBACK callback,PVOID context,PTP_CALLBACK_ENVIRON environment)
{
 if(file!=INVALID_HANDLE_VALUE || context!=&context_value || environment!=&callback_environment || GetLastError()!=54321 || (expect_wrapped?(callback==app_callback):(callback!=app_callback)))correct=FALSE;
 if(fail_factory){SetLastError(1450);return NULL;}
 SetLastError(12345);callback((PTP_CALLBACK_INSTANCE)0x1111,context,&overlapped_value,1450,77,(PTP_IO)0x2222);
 SetLastError(6789);return (PTP_IO)0x2222;
}
int main(void)
{
 InitializeThreadpoolEnvironment(&callback_environment);observer_real_create_io=fake_factory;
 SetLastError(54321);PTP_IO io=observer_create_io(INVALID_HANDLE_VALUE,app_callback,&context_value,&callback_environment);
 CHECK(io==(PTP_IO)0x2222);CHECK(GetLastError()==6789);CHECK(correct && calls==1);CHECK(observer_io_next_slot==0);
 /* Exhausted capacity passes the original callback directly; no dropped callback. */
 observer_io_next_slot=OBSERVER_IO_SLOTS-1;expect_wrapped=FALSE;
 SetLastError(54321);io=observer_create_io(INVALID_HANDLE_VALUE,app_callback,&context_value,&callback_environment);
 CHECK(io==(PTP_IO)0x2222);CHECK(GetLastError()==6789);CHECK(correct && calls==2);CHECK(observer_io_next_slot==OBSERVER_IO_SLOTS);
 fail_factory=TRUE;SetLastError(54321);io=observer_create_io(INVALID_HANDLE_VALUE,app_callback,&context_value,&callback_environment);
 CHECK(io==NULL);CHECK(GetLastError()==1450);CHECK(correct && calls==2);
 printf("IO_LIFETIME_OK checks=%u inline_callback_and_original_context=1 capacity_passthrough=1 error_1450_preserved=1\n",checks);return 0;
}
