/* Synthetic transport around the compiled production Windows-title helper. */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
typedef struct {int unused;} IJsonObject;
typedef WCHAR *HSTRING;
struct User {char *deviceToken,*proofKey,*titleToken;};
typedef struct User *XUserHandle;
static UINT32 titleId=0x12345678;
static DWORD response_status=200;static int calls,malformed,empty;
static char captured[2048];static IJsonObject object;
static HRESULT xuser_signed_request(XUserHandle user,const char *method,const char *url,const char *auth,const char *headers,const void *body,DWORD size,DWORD *status,BYTE **buffer,SIZE_T *buffer_size){
 assert(!strcmp(method,"POST"));assert(!strcmp(url,"https://title.auth.xboxlive.com/title/authenticate"));assert(!auth);
 assert(strstr(headers,"x-xbl-contract-version: 1\r\n"));assert(user->proofKey&&user->deviceToken);
 assert(size<sizeof(captured));memcpy(captured,body,size);captured[size]=0;calls++;
 *status=response_status;*buffer_size=2;*buffer=malloc(2);memcpy(*buffer,"{}",2);return S_OK;
}
static HRESULT parse_json(const char *s,SIZE_T n,IJsonObject **out){assert(n==2&&s[0]=='{');*out=&object;return malformed?E_FAIL:S_OK;}
static HRESULT get_json_string(IJsonObject *o,const WCHAR *key,HSTRING *out){assert(o==&object&&!lstrcmpW(key,L"Token"));*out=(WCHAR*)(empty?L"":L"new-title-token");return S_OK;}
static char *hstring_to_utf8(HSTRING s){return strdup(*s?"new-title-token":"");}
static void IJsonObject_Release(IJsonObject *o){assert(o==&object);}
static void WindowsDeleteString(HSTRING s){(void)s;}
static void auth_metadata(const char *phase,XUserHandle user,HRESULT hr,DWORD status,BOOL a,BOOL b){(void)user;(void)hr;(void)status;(void)a;(void)b;assert(!strcmp(phase,"windows-title"));}
#include "windows-title-auth-adapter.inc"
static void reset(struct User *u){free(u->titleToken);u->titleToken=strdup("old-title-token");calls=0;response_status=200;malformed=empty=0;titleId=0x12345678;}
int main(void){
 struct User u={"synthetic-device-token","{\"x\":\"same-proof-key\"}",NULL};reset(&u);
 assert(windows_title_auth(&u)==S_OK&&calls==1&&!strcmp(u.titleToken,"new-title-token"));
 assert(strstr(captured,"\"TitleId\":305419896"));assert(strstr(captured,"\"DeviceToken\":\"synthetic-device-token\""));assert(strstr(captured,"\"ProofKey\":{\"x\":\"same-proof-key\"}"));assert(!strstr(captured,"MSAAppId"));
 reset(&u);response_status=400;assert(FAILED(windows_title_auth(&u))&&calls==1&&!strcmp(u.titleToken,"old-title-token"));
 reset(&u);malformed=1;assert(FAILED(windows_title_auth(&u))&&!strcmp(u.titleToken,"old-title-token"));
 reset(&u);empty=1;assert(FAILED(windows_title_auth(&u))&&!strcmp(u.titleToken,"old-title-token"));
 reset(&u);titleId=0;assert(FAILED(windows_title_auth(&u))&&calls==0&&!strcmp(u.titleToken,"old-title-token"));
 reset(&u);u.deviceToken="bad\"token";assert(FAILED(windows_title_auth(&u))&&calls==0);
 u.deviceToken="bad\\token";assert(FAILED(windows_title_auth(&u))&&calls==0);
 u.deviceToken="bad\ntoken";assert(FAILED(windows_title_auth(&u))&&calls==0);
 free(u.titleToken);puts("Windows title helper: success, same-key payload, refusal, malformed/empty result, zero identity and escaping regressions passed");return 0;
}
