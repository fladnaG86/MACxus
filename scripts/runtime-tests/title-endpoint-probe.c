/* Production endpoint rules and policy relocation, using only synthetic URLs. */
#include <windows.h>
#include <wininet.h>
#include <stdio.h>
#include <wchar.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <stdint.h>
#undef assert
#define assert(x) do { if (!(x)) { fprintf(stderr, "regression failure at line %d: %s\n", __LINE__, #x); return 42; } } while (0)
typedef WCHAR *HSTRING;
typedef struct {int unused;} IUser;
#define TRACE(...) ((void)0)
#include "title-endpoint-structs.inc"
struct XUser {UINT32 endpointsLen,policiesLen;struct endpoint *endpoints;struct policy *policies;};
typedef struct XUser *XUserHandle;
static struct XUser current;
static struct XUser *impl_from_IUser(IUser *iface){(void)iface;return &current;}
static HRESULT user_wait_init(struct XUser *user){(void)user;return S_OK;}
static const WCHAR *WindowsGetStringRawBuffer(HSTRING string,UINT32 *length){if(length)*length=string?(UINT32)wcslen(string):0;return string?string:L"";}
#include "title-endpoint-adapter.inc"
int main(void){
 const struct {const WCHAR *pattern,*host;BOOLEAN expected;} wildcards[]={
  {L"*",L"api.example.test",TRUE}, {L"*",L"",TRUE},
  {L"api.*",L"api.example.test",TRUE}, {L"api.*",L"api.",TRUE},
  {L"*.example.test",L"API.EXAMPLE.TEST",TRUE},
  {L"*.EXAMPLE.TEST",L"api.example.test",TRUE},
  {L"*.example.test",L"a.example.test.b.example.test",TRUE},
  {L"a*b",L"abxb",TRUE}, {L"a**b*",L"abxb.extra",TRUE},
  {L"api.?xample.test",L"api.example.test",TRUE},
  {L"api.example.test*",L"api.example.test",TRUE},
  {L"*.example.test",L"notexample.test",FALSE},
  {L"*.example.test",L"api.example.test.attacker.test",FALSE},
  {L"api.*",L"attacker.api.example.test",FALSE},
  {L"api.?xample.test",L"api.xample.test",FALSE},
  {L"api.example.test",L"api.example.test.extra",FALSE},
 };
 for(unsigned i=0;i<sizeof(wildcards)/sizeof(*wildcards);i++)
  assert(match_wildcard(wildcards[i].pattern,wcslen(wildcards[i].pattern),wildcards[i].host,wcslen(wildcards[i].host))==wildcards[i].expected);
 struct policy *initial=calloc(1,sizeof(*initial)),*grown,*appended;
 assert(initial!=NULL);initial[0]=(struct policy){7,77};
 struct endpoint endpoints[2]={
  {.protocol=L"https",.host=L"game.example.test",.relyingParty=L"default-audience",.policy=initial},
  {.protocol=L"https",.host=L"game.example.test",.path=L"/v2",.relyingParty=L"title-audience"}
 };
 struct endpoint result;
 current=(struct XUser){2,1,endpoints,initial};
 assert(append_endpoint_policies(&current,1,&appended)==S_OK);
 grown=current.policies;assert(current.policiesLen==2&&appended==grown+1&&endpoints[0].policy==grown);
 *appended=(struct policy){9,99};endpoints[1].policy=appended;
 assert(append_endpoint_policies(&current,UINT32_MAX,&appended)==E_OUTOFMEMORY&&current.policies==grown&&endpoints[0].policy==grown);
 assert(user_GetEndpointInfo(NULL,"https://game.example.test/v2/start",&result)==S_OK);
 assert(!wcscmp(result.relyingParty,L"title-audience")&&result.policy==grown+1);
 assert(user_GetEndpointInfo(NULL,"https://game.example.test/v1/start",&result)==S_OK);
 assert(!wcscmp(result.relyingParty,L"default-audience")&&result.policy==grown&&result.policy->version==7);
 endpoints[1].path=NULL;
 assert(user_GetEndpointInfo(NULL,"https://game.example.test/",&result)==S_OK&&!wcscmp(result.relyingParty,L"title-audience"));
 endpoints[0].host=L"*.example.test";endpoints[0].wildcard=TRUE;
 assert(user_GetEndpointInfo(NULL,"https://game.example.test/",&result)==S_OK&&!wcscmp(result.relyingParty,L"title-audience"));
 assert(user_GetEndpointInfo(NULL,"wss://game.example.test/socket",&result)==S_OK&&!wcscmp(result.relyingParty,L"title-audience"));
 endpoints[0].host=L"*";endpoints[0].relyingParty=L"catchall-audience";
 assert(user_GetEndpointInfo(NULL,"https://other.invalid/",&result)==S_OK&&!wcscmp(result.relyingParty,L"catchall-audience"));
 assert(user_GetEndpointInfo(NULL,"https://game.example.test/",&result)==S_OK&&!wcscmp(result.relyingParty,L"title-audience"));
 endpoints[0].host=L"*.EXAMPLE.TEST";endpoints[0].relyingParty=L"wildcard-audience";
 assert(user_GetEndpointInfo(NULL,"https://OTHER.example.test/",&result)==S_OK&&!wcscmp(result.relyingParty,L"wildcard-audience"));
 endpoints[0].host=L"*.example.test";
 assert(FAILED(user_GetEndpointInfo(NULL,"https://notexample.test/",&result)));
 assert(FAILED(user_GetEndpointInfo(NULL,"http://game.example.test/",&result)));
 endpoints[1].policy=NULL;
 assert(user_GetEndpointInfo(NULL,"https://game.example.test/",&result)==S_OK&&result.policy==NULL);
 free(current.policies);puts("Endpoint regressions passed: wildcard backtracking/case, metadata precedence, policy relocation/ownership, WebSocket scheme and host boundaries");return 0;
}
