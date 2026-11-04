/* Copyright (c) 2026 MACxus contributors. SPDX-License-Identifier: MIT
 * Production-source contracts; no game, accounts, DNS or remote requests.
 */
#include <windows.h>
static const WCHAR *test_exe=L"C:\\game\\007FirstLight.exe";
static DWORD WINAPI fake_exe(HMODULE module,LPWSTR out,DWORD size) {
    (void)module;DWORD n=(DWORD)wcslen(test_exe);if(n>=size)return size;memcpy(out,test_exe,(n+1)*sizeof(WCHAR));return n;
}
#define GetModuleFileNameW fake_exe
#include "winhttp.c"
#undef GetModuleFileNameW
#include <stdio.h>
static unsigned checks, failures;
#define CHECK(x) do {checks++;if(!(x)){failures++;printf("FAIL line %u\n",__LINE__);}}while(0)
static LPCWSTR expected;
static BOOL sent, credential_result=TRUE;
static BOOL WINAPI mock_credentials(HINTERNET h,DWORD target,DWORD scheme,LPCWSTR user,LPCWSTR password,LPVOID params) {
    (void)h;(void)target;(void)scheme;(void)user;(void)password;(void)params;SetLastError(404);return credential_result;
}
static WCHAR effective_url[1024];
static BOOL fail_url, stored_auth;
static BOOL WINAPI mock_headers(HINTERNET h,DWORD level,LPCWSTR name,LPVOID buffer,LPDWORD bytes,LPDWORD index) {
    (void)h;(void)level;(void)name;(void)buffer;(void)bytes;(void)index;
    SetLastError(stored_auth?ERROR_INSUFFICIENT_BUFFER:ERROR_WINHTTP_HEADER_NOT_FOUND);return FALSE;
}
static BOOL WINAPI mock_option(HINTERNET h,DWORD option,LPVOID buffer,LPDWORD bytes) {
    (void)h;if(fail_url || option!=WINHTTP_OPTION_URL)return FALSE;DWORD n=(wcslen(effective_url)+1)*sizeof(WCHAR);if(*bytes<n)return FALSE;memcpy(buffer,effective_url,n);*bytes=n;return TRUE;
}
static BOOL WINAPI mock_send(HINTERNET h,LPCWSTR headers,DWORD n,LPVOID body,DWORD size,DWORD total,DWORD_PTR context) {
    (void)h;(void)n; sent=GetLastError()==12345 && headers && !wcscmp(headers,expected) && body==(void*)123 && size==7 && total==7 && context==321;
    SetLastError(54321);return TRUE;
}
static HINTERNET WINAPI mock_connect(HINTERNET h,LPCWSTR host,INTERNET_PORT port,DWORD reserved) {
    (void)h;(void)host;(void)port;(void)reserved;SetLastError(101);return (HINTERNET)(ULONG_PTR)11;
}
static HINTERNET WINAPI mock_open(HINTERNET h,LPCWSTR verb,LPCWSTR object,LPCWSTR version,LPCWSTR referrer,LPCWSTR *accept,DWORD flags) {
    (void)h;(void)verb;(void)object;(void)version;(void)referrer;(void)accept;(void)flags;SetLastError(202);return (HINTERNET)(ULONG_PTR)22;
}
static BOOL WINAPI mock_close(HINTERNET h) {(void)h;SetLastError(303);return TRUE;}
static void request(LPCWSTR host,INTERNET_PORT port,LPCWSTR verb,LPCWSTR object,DWORD flags,BOOL optin,BOOL omit) {
    SecureZeroMemory(handles,sizeof(handles));enabled=optin;sent=FALSE;
    swprintf(effective_url,1024,L"%ls://%ls:%u%ls",flags&WINHTTP_FLAG_SECURE?L"https":L"http",host,port,object);
    HINTERNET c=WinHttpConnect(NULL,host,port,0);CHECK(GetLastError()==101);
    HINTERNET h=WinHttpOpenRequest(c,verb,object,NULL,NULL,NULL,flags);CHECK(GetLastError()==202);
    LPCWSTR text=L"X-Test: KEEP\r\nAuthorization: Unknown PRIVATE_MARKER\r\nTail: KEEP\r\n";
    expected=omit?L"X-Test: KEEP\r\nTail: KEEP\r\n":text;
    SetLastError(12345);CHECK(WinHttpSendRequest(h,text,(DWORD)-1,(void*)123,7,7,321));CHECK(GetLastError()==54321);CHECK(sent);
    CHECK(WinHttpCloseHandle(h));CHECK(GetLastError()==303);CHECK(!find(h));
    CHECK(WinHttpCloseHandle(c));CHECK(GetLastError()==303);CHECK(!find(c));
}
int main(void) {
    SetEnvironmentVariableW(L"MACXUS_007_PUBLIC_CONFIG",NULL);CHECK(!activate());
    SetEnvironmentVariableW(L"MACXUS_007_PUBLIC_CONFIG",L"1");CHECK(activate());
    test_exe=L"C:\\game\\other.exe";CHECK(!activate());
    test_exe=L"C:\\game\\007FirstLight.exe.extra";CHECK(!activate());
    test_exe=L"C:\\game\\007FIRSTLIGHT.EXE";CHECK(activate());
    SetEnvironmentVariableW(L"MACXUS_007_PUBLIC_CONFIG",L"10");CHECK(!activate());
    SetEnvironmentVariableW(L"MACXUS_007_PUBLIC_CONFIG",L"0");CHECK(!activate());
    SetEnvironmentVariableW(L"MACXUS_007_PUBLIC_CONFIG",NULL);
    CHECK(ascii_equal(L"I",L"i",1));CHECK(!ascii_equal(L"\u0131",L"i",1));
    connect_fn=mock_connect;open_fn=mock_open;send_fn=mock_send;close_fn=mock_close;query_option_fn=mock_option;query_headers_fn=mock_headers;credentials_fn=mock_credentials;
    request(L"public.blob.core.windows.net",443,L"GET",L"/container/file",WINHTTP_FLAG_SECURE,TRUE,TRUE);
    request(L"PUBLIC.BLOB.CORE.WINDOWS.NET",443,L"HEAD",L"/container/file",WINHTTP_FLAG_SECURE,TRUE,TRUE);
    request(L"public.blob.core.windows.net.evil.test",443,L"GET",L"/file",WINHTTP_FLAG_SECURE,TRUE,FALSE);
    request(L"notblob.core.windows.net",443,L"GET",L"/file",WINHTTP_FLAG_SECURE,TRUE,FALSE);
    request(L"public.blob.core.windows.net",80,L"GET",L"/file",0,TRUE,FALSE);
    request(L"public.blob.core.windows.net",443,L"get",L"/file",WINHTTP_FLAG_SECURE,TRUE,FALSE);
    request(L"public.blob.core.windows.net",443,L"POST",L"/file",WINHTTP_FLAG_SECURE,TRUE,FALSE);
    request(L"public.blob.core.windows.net",443,L"GET",L"/file?sig=PRIVATE_MARKER",WINHTTP_FLAG_SECURE,TRUE,FALSE);
    request(L"public.blob.core.windows.net",443,L"GET",L"/file?other=value",WINHTTP_FLAG_SECURE,TRUE,FALSE);
    request(L"public.blob.core.windows.net",443,L"GET",L"//other/file",WINHTTP_FLAG_SECURE,TRUE,FALSE);
    request(L"public.blob.core.windows.net",443,L"GET",L"/file#fragment",WINHTTP_FLAG_SECURE,TRUE,FALSE);
    request(L"public.blob.core.windows.net",443,L"GET",L"/file",WINHTTP_FLAG_SECURE,FALSE,FALSE);
    const WCHAR *keep[]={L"Authorization: Bearer PRIVATE_MARKER\r\n",L"Authorization: XBL3.0 PRIVATE_MARKER\r\n",L"Authorization: SharedKey PRIVATE_MARKER\r\n",L"Authorization: SharedKeyLite PRIVATE_MARKER\r\n",L"Authorization: NTLM PRIVATE_MARKER\r\n",L"Authorization: \t\r\n",L"X-Authorization: Unknown PRIVATE_MARKER\r\n",L" Authorization: Unknown PRIVATE_MARKER\r\n",L"Authorization: Unknown PRIVATE_MARKER\n",L"Authorization: Unknown PRIVATE_MARKER\r",L"NoColon\r\nAuthorization: Unknown PRIVATE_MARKER\r\n"};
    for(unsigned i=0;i<sizeof(keep)/sizeof(*keep);i++){SIZE_T bytes;WCHAR *out=filter_headers(keep[i],(DWORD)-1,&bytes);CHECK(out==NULL);CHECK(bytes==0);}
    const WCHAR *duplicates[]={L"Authorization: Bearer retained\r\nAuthorization: Unknown fixture\r\n",L"Authorization: Unknown fixture\r\nAuthorization: Bearer retained\r\n",L"Authorization: Unknown first\r\naUtHoRiZaTiOn: Unknown second\r\n"};
    for(unsigned i=0;i<sizeof(duplicates)/sizeof(*duplicates);i++){SIZE_T bytes;CHECK(!filter_headers(duplicates[i],(DWORD)-1,&bytes));CHECK(bytes==0);}
    stored_auth=TRUE;request(L"public.blob.core.windows.net",443,L"GET",L"/file",WINHTTP_FLAG_SECURE,TRUE,FALSE);stored_auth=FALSE;
    for(unsigned trial=0;trial<2;trial++){
        SecureZeroMemory(handles,sizeof(handles));enabled=TRUE;remember((HINTERNET)(ULONG_PTR)22,FALSE,TRUE);credential_result=!!trial;
        CHECK(WinHttpSetCredentials((HINTERNET)(ULONG_PTR)22,WINHTTP_AUTH_TARGET_SERVER,WINHTTP_AUTH_SCHEME_BASIC,L"synthetic",L"fixture",NULL)==credential_result);
        CHECK(GetLastError()==404);CHECK(!find((HINTERNET)(ULONG_PTR)22)->eligible);
    }
    const WCHAR *drop[]={L"Authorization: Unknown PRIVATE_MARKER\r\n",L"aUtHoRiZaTiOn: Unknown PRIVATE_MARKER",L"Authorization: abc.def.ghi\r\n",L"Authorization: \"PRIVATE_MARKER\"\r\n"};
    for(unsigned i=0;i<sizeof(drop)/sizeof(*drop);i++){SIZE_T bytes;WCHAR *out=filter_headers(drop[i],(DWORD)-1,&bytes);CHECK(out && !out[0]);CHECK(bytes==(wcslen(drop[i])+1)*sizeof(WCHAR));if(out){SecureZeroMemory(out,bytes);free(out);}}
    WCHAR embedded[]=L"Authorization: Unknown\0X: SECRET";SIZE_T bytes;CHECK(!filter_headers(embedded,sizeof(embedded)/sizeof(*embedded)-1,&bytes));
    WCHAR *large=calloc(65538,sizeof(WCHAR));CHECK(large!=NULL);if(large){wmemset(large,'a',65537);CHECK(!filter_headers(large,65537,&bytes));free(large);}
    SecureZeroMemory(handles,sizeof(handles));for(unsigned i=0;i<256;i++)remember((HINTERNET)(ULONG_PTR)(1000+i),TRUE,TRUE);remember((HINTERNET)(ULONG_PTR)99999,FALSE,TRUE);CHECK(!find((HINTERNET)(ULONG_PTR)99999));
    remember((HINTERNET)(ULONG_PTR)1000,FALSE,FALSE);CHECK(find((HINTERNET)(ULONG_PTR)1000) && !find((HINTERNET)(ULONG_PTR)1000)->connection && !find((HINTERNET)(ULONG_PTR)1000)->eligible);
    wcscpy(effective_url,L"https://public.blob.core.windows.net/file");CHECK(current_target(NULL));
    wcscpy(effective_url,L"https://other.example/file");CHECK(!current_target(NULL));
    wcscpy(effective_url,L"https://public.blob.core.windows.net/file?sig=PRIVATE_MARKER");CHECK(!current_target(NULL));
    wcscpy(effective_url,L"http://public.blob.core.windows.net/file");CHECK(!current_target(NULL));
    wcscpy(effective_url,L"https://public.blob.core.windows.net:444/file");CHECK(!current_target(NULL));
    wcscpy(effective_url,L"https://public.blob.core.windows.net@other.example/file");CHECK(!current_target(NULL));
    fail_url=TRUE;CHECK(!current_target(NULL));
    /* Original WinHTTP builds its effective URL before send. Allocate handles
     * without performing a request; the sender remains our mock. No DNS/network. */
    HMODULE native=LoadLibraryW(L"winhttp.dll");CHECK(native!=NULL);
    if(native){
        typedef HINTERNET(WINAPI *SessionFn)(LPCWSTR,DWORD,LPCWSTR,LPCWSTR,DWORD);
        SessionFn session_fn=(SessionFn)GetProcAddress(native,"WinHttpOpen");
        connect_fn=(ConnectFn)GetProcAddress(native,"WinHttpConnect");open_fn=(OpenFn)GetProcAddress(native,"WinHttpOpenRequest");
        close_fn=(CloseFn)GetProcAddress(native,"WinHttpCloseHandle");query_option_fn=(QueryOptionFn)GetProcAddress(native,"WinHttpQueryOption");
        query_headers_fn=(QueryHeadersFn)GetProcAddress(native,"WinHttpQueryHeaders");
        CHECK(session_fn && connect_fn && open_fn && close_fn && query_option_fn && query_headers_fn);
        if(session_fn && connect_fn && open_fn && close_fn && query_option_fn && query_headers_fn){
            SecureZeroMemory(handles,sizeof(handles));enabled=TRUE;
            HINTERNET session=session_fn(L"MACxus account-free contract",WINHTTP_ACCESS_TYPE_NO_PROXY,NULL,NULL,0);CHECK(session!=NULL);
            HINTERNET connection=WinHttpConnect(session,L"fixture.blob.core.windows.net",443,0);CHECK(connection!=NULL);
            HINTERNET request=WinHttpOpenRequest(connection,L"GET",L"/container/file",NULL,NULL,NULL,WINHTTP_FLAG_SECURE);CHECK(request!=NULL);
            CHECK(current_target(request));expected=L"X-Test: KEEP\r\n";SetLastError(12345);sent=FALSE;
            CHECK(WinHttpSendRequest(request,L"Authorization: Unknown PRIVATE_MARKER\r\nX-Test: KEEP\r\n",(DWORD)-1,(void*)123,7,7,321));CHECK(sent);CHECK(GetLastError()==54321);
            CHECK(WinHttpCloseHandle(request));CHECK(WinHttpCloseHandle(connection));CHECK(close_fn(session));
        }
        FreeLibrary(native);
    }
    printf("007 PUBLIC CONFIG CHECKS %u FAILURES %u\n",checks,failures);return failures?1:0;
}
