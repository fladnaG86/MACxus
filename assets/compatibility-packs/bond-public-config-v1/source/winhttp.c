/* Copyright (c) 2026 MACxus contributors. SPDX-License-Identifier: MIT
 * Explicit 007 compatibility control. No network diagnostics or credential logs.
 * The unmodified, fingerprinted runtime WinHTTP is installed beside this DLL.
 */
#define _WINHTTP_INTERNAL_
#include <windows.h>
#include <winhttp.h>
#include <stdlib.h>
#include <wchar.h>

static BOOL enabled;
static SRWLOCK lock = SRWLOCK_INIT;
struct handle { HINTERNET value; BOOL connection, eligible; };
static struct handle handles[256];
typedef HINTERNET (WINAPI *ConnectFn)(HINTERNET,LPCWSTR,INTERNET_PORT,DWORD);
typedef HINTERNET (WINAPI *OpenFn)(HINTERNET,LPCWSTR,LPCWSTR,LPCWSTR,LPCWSTR,LPCWSTR*,DWORD);
typedef BOOL (WINAPI *SendFn)(HINTERNET,LPCWSTR,DWORD,LPVOID,DWORD,DWORD,DWORD_PTR);
typedef BOOL (WINAPI *CloseFn)(HINTERNET);
typedef BOOL (WINAPI *CredentialsFn)(HINTERNET,DWORD,DWORD,LPCWSTR,LPCWSTR,LPVOID);
typedef BOOL (WINAPI *QueryHeadersFn)(HINTERNET,DWORD,LPCWSTR,LPVOID,LPDWORD,LPDWORD);
typedef BOOL (WINAPI *QueryOptionFn)(HINTERNET,DWORD,LPVOID,LPDWORD);
static ConnectFn connect_fn; static OpenFn open_fn;
static SendFn send_fn; static CloseFn close_fn; static QueryOptionFn query_option_fn; static QueryHeadersFn query_headers_fn; static CredentialsFn credentials_fn;

static struct handle *find(HINTERNET value) {
    for (unsigned i=0;i<256;i++) if (handles[i].value==value) return &handles[i];
    return NULL;
}
static void remember(HINTERNET value, BOOL connection, BOOL eligible) {
    if (!value) return;
    struct handle *old=find(value);
    if (old) {*old=(struct handle){value,connection,eligible};return;}
    for (unsigned i=0;i<256;i++) if (!handles[i].value) {
        handles[i]=(struct handle){value,connection,eligible}; return;
    }
    /* Saturation preserves the original transport. */
}
/* HTTP field/scheme names and DNS comparison use ASCII rules, independently
 * of a game's CRT locale (notably Turkish I/i case conversion). */
static BOOL ascii_equal(LPCWSTR left,LPCWSTR right,SIZE_T n) {
    for(SIZE_T i=0;i<n;i++){
        WCHAR a=left[i],b=right[i];if(a>='A'&&a<='Z')a+='a'-'A';if(b>='A'&&b<='Z')b+='a'-'A';
        if(a!=b)return FALSE;
    }
    return TRUE;
}
static BOOL blob_host(LPCWSTR host) {
    static const WCHAR suffix[]=L".blob.core.windows.net";
    SIZE_T n=host?wcslen(host):0, length=sizeof(suffix)/sizeof(*suffix)-1;
    return n>length && ascii_equal(host+n-length,suffix,length);
}
static BOOL activate(void) {
    WCHAR env[2], exe[MAX_PATH];
    if (GetEnvironmentVariableW(L"MACXUS_007_PUBLIC_CONFIG",env,2)!=1 || env[0]!='1') return FALSE;
    DWORD n=GetModuleFileNameW(NULL,exe,MAX_PATH);
    if (!n || n>=MAX_PATH) return FALSE;
    WCHAR *base=wcsrchr(exe,'\\'); base=base?base+1:exe;
    return wcslen(base)==17 && ascii_equal(base,L"007FirstLight.exe",17);
}
/* Azure-supported and other recognized schemes are retained conservatively.
 * Empty values are retained too; the successful comparison did not remove them.
 */
static BOOL unsupported(LPCWSTR value,SIZE_T n) {
    while (n && (*value==' ' || *value=='\t')) {value++;n--;}
    if (!n) return FALSE;
    static const WCHAR *known[]={L"XBL3.0",L"Bearer",L"SharedKey",L"SharedKeyLite",L"Basic",L"Digest",L"Negotiate",L"NTLM",L"SharedAccessSignature",L"DPoP",L"PoP"};
    for (unsigned i=0;i<sizeof(known)/sizeof(*known);i++) {
        SIZE_T k=wcslen(known[i]);
        if (n>=k && ascii_equal(value,known[i],k) && (n==k || value[k]==' ' || value[k]=='\t')) return FALSE;
    }
    return TRUE;
}
static BOOL header_char(WCHAR c) {
    return (c>='a'&&c<='z') || (c>='A'&&c<='Z') || (c>='0'&&c<='9') ||
        (c<128 && wcschr(L"!#$%&'*+-.^_`|~",c)!=NULL);
}
/* Validate the entire block before changing it. Preserve unrelated lines exactly.
 * In particular, do not repair malformed or ambiguous HTTP header blocks here.
 */
static WCHAR *filter_headers(LPCWSTR text,DWORD length,SIZE_T *bytes) {
    *bytes=0; if (!text) return NULL;
    SIZE_T count=(length==(DWORD)-1 || !length)?wcslen(text):length;
    if (!count || count>65536) return NULL;
    BOOL changed=FALSE; WCHAR *out=NULL; SIZE_T used=0;
    for (unsigned pass=0;pass<2;pass++) {
        unsigned authorization_count=0;
        for (SIZE_T p=0;p<count;) {
            SIZE_T start=p,colon=count;
            while (p<count && text[p]!='\r' && text[p]!='\n') {
                if (!text[p] || (text[p]<32 && text[p]!='\t') || text[p]==127) goto invalid;
                if (colon==count) {
                    if (text[p]==':') colon=p;
                    else if (!header_char(text[p])) goto invalid;
                }
                p++;
            }
            SIZE_T end=p;
            if (colon==count || colon==start) goto invalid;
            if (p<count) {
                if (text[p]!='\r' || p+1>=count || text[p+1]!='\n') goto invalid;
                p+=2;
            }
            BOOL authorization=colon-start==13 && ascii_equal(text+start,L"Authorization",13);
            if (authorization && ++authorization_count>1) goto invalid;
            BOOL omit=authorization && unsupported(text+colon+1,end-colon-1);
            if (omit) changed=TRUE;
            else if (pass) {memcpy(out+used,text+start,(p-start)*sizeof(WCHAR));used+=p-start;}
        }
        if (!pass) {
            if (!changed) return NULL;
            *bytes=(count+1)*sizeof(WCHAR); out=calloc(1,*bytes);
            if (!out) {*bytes=0;return NULL;}
        }
    }
    return out;
invalid:
    if (out) {SecureZeroMemory(out,*bytes);free(out);} *bytes=0; return NULL;
}
/* Recheck the effective URL at send time: a reused WinHTTP request may have
 * followed a redirect since it was opened. No URL or credential is retained. */
static BOOL current_target(HINTERNET request) {
    WCHAR url[8192]={0};DWORD bytes=sizeof(url);BOOL valid=FALSE;
    if (!query_option_fn(request,WINHTTP_OPTION_URL,url,&bytes) || bytes>=sizeof(url) || bytes%sizeof(WCHAR)) goto done;
    url[bytes/sizeof(WCHAR)]=0;
    if (!ascii_equal(url,L"https://",8)) goto done;
    WCHAR *host=url+8,*slash=wcschr(host,'/');if(!slash || slash[1]=='/')goto done;
    if (wcschr(host,'?') || wcschr(host,'#') || wcschr(host,'\\')) goto done;
    for(WCHAR *c=host;c<slash;c++)if(*c=='@' || *c=='[' || *c==']')goto done;
    WCHAR *colon=wcschr(host,':');
    if(colon && colon<slash){if(slash-colon!=4 || wcsncmp(colon,L":443",4))goto done;*colon=0;}
    else *slash=0;
    valid=blob_host(host);
 done:SecureZeroMemory(url,sizeof(url));return valid;
}
/* Omitting an inline override must not expose an already installed credential.
 * Ask only for presence; never retrieve a credential value. Unknown errors
 * preserve the complete original request. */
static BOOL no_stored_authorization(HINTERNET request) {
    DWORD size=0;
    SetLastError(0);
    BOOL result=query_headers_fn(request,WINHTTP_QUERY_AUTHORIZATION|WINHTTP_QUERY_FLAG_REQUEST_HEADERS,NULL,NULL,&size,NULL);
    return !result && GetLastError()==ERROR_WINHTTP_HEADER_NOT_FOUND;
}
HINTERNET WINAPI WinHttpConnect(HINTERNET session,LPCWSTR host,INTERNET_PORT port,DWORD reserved) {
    HINTERNET result=connect_fn(session,host,port,reserved); DWORD error=GetLastError();
    if (enabled && result) {
        AcquireSRWLockExclusive(&lock);remember(result,TRUE,port==443 && blob_host(host));ReleaseSRWLockExclusive(&lock);
    }
    SetLastError(error);return result;
}
HINTERNET WINAPI WinHttpOpenRequest(HINTERNET connection,LPCWSTR verb,LPCWSTR object,LPCWSTR version,LPCWSTR referrer,LPCWSTR *accept,DWORD flags) {
    HINTERNET result=open_fn(connection,verb,object,version,referrer,accept,flags); DWORD error=GetLastError();
    if (enabled && result) {
        /* Query-bearing URLs are excluded entirely, including signed URLs. */
        BOOL shape=(flags&WINHTTP_FLAG_SECURE) && (!verb || !wcscmp(verb,L"GET") || !wcscmp(verb,L"HEAD")) &&
            object && object[0]=='/' && object[1]!='/' && !wcschr(object,'?') && !wcschr(object,'#') && !wcschr(object,'\\');
        AcquireSRWLockExclusive(&lock);struct handle *parent=find(connection);
        remember(result,FALSE,shape && parent && parent->connection && parent->eligible);ReleaseSRWLockExclusive(&lock);
    }
    SetLastError(error);return result;
}
BOOL WINAPI WinHttpSendRequest(HINTERNET request,LPCWSTR headers,DWORD length,LPVOID body,DWORD body_length,DWORD total,DWORD_PTR context) {
    DWORD before=GetLastError(); BOOL eligible=FALSE;
    if (enabled) {AcquireSRWLockShared(&lock);struct handle *entry=find(request);eligible=entry && !entry->connection && entry->eligible;ReleaseSRWLockShared(&lock);}
    SIZE_T bytes=0; WCHAR *filtered=eligible && current_target(request) && no_stored_authorization(request)?filter_headers(headers,length,&bytes):NULL;
    SetLastError(before);
    BOOL result=send_fn(request,filtered?filtered:headers,filtered?(DWORD)wcslen(filtered):length,body,body_length,total,context);
    DWORD error=GetLastError();
    if (filtered) {SecureZeroMemory(filtered,bytes);free(filtered);}
    SetLastError(error);return result;
}
/* Explicit WinHTTP credentials can be materialized only inside send_request,
 * before its inline override is applied. Their absence from the header table
 * does not prove that omitting an override is safe. Preserve these requests. */
BOOL WINAPI WinHttpSetCredentials(HINTERNET request,DWORD target,DWORD scheme,LPCWSTR user,LPCWSTR password,LPVOID params) {
    DWORD before=GetLastError();
    if(enabled){AcquireSRWLockExclusive(&lock);struct handle *entry=find(request);if(entry && !entry->connection)entry->eligible=FALSE;ReleaseSRWLockExclusive(&lock);}
    SetLastError(before);return credentials_fn(request,target,scheme,user,password,params);
}
BOOL WINAPI WinHttpCloseHandle(HINTERNET handle) {
    DWORD before=GetLastError();
    if (enabled) {AcquireSRWLockExclusive(&lock);struct handle *entry=find(handle);if(entry)SecureZeroMemory(entry,sizeof(*entry));ReleaseSRWLockExclusive(&lock);}
    SetLastError(before);return close_fn(handle);
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID reserved) {
    (void)reserved;if (reason!=DLL_PROCESS_ATTACH) return TRUE;
    WCHAR path[MAX_PATH];DisableThreadLibraryCalls(instance);
    UINT n=GetSystemDirectoryW(path,MAX_PATH);if (!n || n+12>=MAX_PATH) return FALSE;
    wcscat(path,L"\\mxhttp.dll");HMODULE original=LoadLibraryW(path);if (!original) return FALSE;
    connect_fn=(ConnectFn)GetProcAddress(original,"WinHttpConnect");open_fn=(OpenFn)GetProcAddress(original,"WinHttpOpenRequest");
    send_fn=(SendFn)GetProcAddress(original,"WinHttpSendRequest");close_fn=(CloseFn)GetProcAddress(original,"WinHttpCloseHandle");
    query_option_fn=(QueryOptionFn)GetProcAddress(original,"WinHttpQueryOption");
    query_headers_fn=(QueryHeadersFn)GetProcAddress(original,"WinHttpQueryHeaders");
    credentials_fn=(CredentialsFn)GetProcAddress(original,"WinHttpSetCredentials");
    enabled=activate();return connect_fn && open_fn && send_fn && close_fn && query_option_fn && query_headers_fn && credentials_fn;
}
