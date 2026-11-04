/* Synthetic IUser ABI regression fixture. No real account, tokens or network.
 * Dispatch tests wait on a gate then fail. String tests use a synthetic,
 * deliberately non-terminated signature; they never send an HTTP request. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <winstring.h>
#include <stdio.h>
#include <string.h>
#include "xtaskqueue.h"
#include "xasyncprovider.h"
#include "xuser.h"
#include "userprovider.h"

struct endpoint {
    HSTRING protocol, host, path, relyingParty, tokenType;
    void *policy;
    BOOL wildcard;
};
/* Only this private prefix is accessed by auth_metadata. */
struct XUser {
    IUser iface;
    LONG refs;
    void *key;
    char *proofKey, *userToken, *deviceToken, *titleToken;
    BYTE unused[2048];
    HANDLE started, gate;
    LONG request_thread;
};
static HSTRING relying_party, token_type;
static BOOL signature_fixture;
static BOOL anonymous_fixture;
static struct { UINT32 version, maxBodyBytes; } signature_policy = {1, 8192};
static LONG checks, failures;
static LONG authorize_calls;
#define CHECK(name, value) do { ++checks; if (!(value)) { ++failures; printf("FAIL %s\n", name); } } while (0)
static ULONG WINAPI addref(IUser *iface) { return InterlockedIncrement(&((struct XUser *)iface)->refs); }
static ULONG WINAPI release(IUser *iface) { return InterlockedDecrement(&((struct XUser *)iface)->refs); }
static HRESULT WINAPI initialize(IUser *iface, XUserAddOptions options) { return E_NOTIMPL; }
static HRESULT WINAPI endpoint_info(IUser *iface, const char *url, struct endpoint *info) {
    ZeroMemory(info, sizeof(*info)); info->relyingParty = relying_party; info->tokenType = token_type;
    if (anonymous_fixture) info->relyingParty = info->tokenType = NULL;
    if (signature_fixture) info->policy = &signature_policy;
    return S_OK;
}
static HRESULT WINAPI authorize(IUser *iface, const WCHAR *party, WCHAR **auth) {
    struct XUser *user = (void *)iface;
    InterlockedIncrement(&authorize_calls);
    if (signature_fixture) {
        *auth = calloc(32, sizeof(WCHAR));
        if (!*auth) return E_OUTOFMEMORY;
        wcscpy(*auth, L"synthetic-offline-token"); return S_OK;
    }
    user->request_thread = GetCurrentThreadId();
    SetEvent(user->started);
    WaitForSingleObject(user->gate, 1500);
    return E_FAIL;
}
static HRESULT WINAPI sign_request(IUser *iface, UINT32 version, const char *method, const char *url, const char *auth, UINT32 size, const void *body, char signature[104]) {
    if (!signature_fixture) return E_NOTIMPL;
    /* IUser writes exactly 104 payload bytes, not a C-string terminator. */
    memset(signature, 'A', 102); signature[102] = '='; signature[103] = '='; return S_OK;
}
static IUserVtbl vtbl = { NULL, addref, release, initialize, endpoint_info, authorize, sign_request };
static LONG callbacks;
static void WINAPI complete(XAsyncBlock *block) { InterlockedIncrement(&callbacks); }
static void test_signature_strings(IXUserImpl *users, IXThreadingImpl *threads) {
    unsigned utf16;
    signature_fixture = TRUE;
    for (utf16 = 0; utf16 < 2; utf16++) {
        struct XUser user = {0};
        XTaskQueueHandle queue = NULL;
        XAsyncBlock block = {0};
        SIZE_T size = 0, used = 0, count;
        ULONGLONG start;
        BYTE *buffer;
        HRESULT hr;
        user.iface.lpVtbl = &vtbl; user.refs = 1; callbacks = 0;
        CHECK("signed-queue", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK);
        block.queue = queue; block.callback = complete;
        hr = utf16 ? IXUserImpl_XUserGetTokenAndSignatureUtf16Async(users, &user, 0, L"GET", L"https://example.invalid", 0, NULL, 0, NULL, &block) :
            IXUserImpl_XUserGetTokenAndSignatureAsync(users, &user, 0, "GET", "https://example.invalid", 0, NULL, 0, NULL, &block);
        CHECK("signed-begin", hr == S_OK);
        IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0);
        start = GetTickCount64();
        while (!callbacks && GetTickCount64() - start < 3000) {
            IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0); Sleep(1);
        }
        CHECK("signed-status", IXThreadingImpl_XAsyncGetStatus(threads, &block, FALSE) == S_OK);
        hr = utf16 ? IXUserImpl_XUserGetTokenAndSignatureUtf16ResultSize(users, &block, &size) :
            IXUserImpl_XUserGetTokenAndSignatureResultSize(users, &block, &size);
        CHECK("signed-result-size", hr == S_OK && size >= 32);
        if (hr != S_OK || size < 32) { IXThreadingImpl_XTaskQueueCloseHandle(threads, queue); continue; }
        buffer = malloc(size + 16); memset(buffer, 0x7f, size + 16);
        if (utf16) {
            XUserGetTokenAndSignatureUtf16Data *result = NULL;
            hr = IXUserImpl_XUserGetTokenAndSignatureUtf16Result(users, &block, size, buffer, &result, &used);
            CHECK("signed-wide-result", hr == S_OK && result == (void *)buffer && used == size);
            if (hr == S_OK && result) {
                count = result->signatureCount;
                CHECK("signed-wide-count-includes-nul", count == 105);
                CHECK("signed-wide-pointer-in-buffer", (BYTE *)result->signature >= buffer && (BYTE *)(result->signature + count) <= buffer + size);
                CHECK("signed-wide-terminated", count && result->signature[count - 1] == 0);
                CHECK("signed-wide-payload-preserved", result->signature[0] == 'A' && result->signature[102] == '=' && result->signature[103] == '=');
            }
        } else {
            XUserGetTokenAndSignatureData *result = NULL;
            hr = IXUserImpl_XUserGetTokenAndSignatureResult(users, &block, size, buffer, &result, &used);
            CHECK("signed-utf8-result", hr == S_OK && result == (void *)buffer && used == size);
            if (hr == S_OK && result) {
                count = result->signatureSize;
                CHECK("signed-utf8-count-includes-nul", count == 105);
                CHECK("signed-utf8-pointer-in-buffer", (BYTE *)result->signature >= buffer && (BYTE *)result->signature + count <= buffer + size);
                CHECK("signed-utf8-terminated", count && result->signature[count - 1] == 0);
                CHECK("signed-utf8-payload-preserved", result->signature[0] == 'A' && result->signature[102] == '=' && result->signature[103] == '=');
            }
        }
        CHECK("signed-result-guard", buffer[size] == 0x7f);
        free(buffer); IXThreadingImpl_XTaskQueueCloseHandle(threads, queue);
        CHECK("signed-user-released", user.refs == 1);
    }
    signature_fixture = FALSE;
}
static void test_anonymous_strings(IXUserImpl *users, IXThreadingImpl *threads) {
    anonymous_fixture = TRUE;
    for (unsigned mode = 0; mode < 4; ++mode) {
        BOOL utf16 = mode & 1;
        struct XUser user = {0};
        XTaskQueueHandle queue = NULL;
        XAsyncBlock block = {0};
        SIZE_T size = 0, used = 0;
        HRESULT hr;
        BYTE *buffer;
        ULONGLONG start;
        signature_fixture = mode >= 2;
        LONG prior_authorizations = authorize_calls;
        user.iface.lpVtbl = &vtbl; user.refs = 1; callbacks = 0;
        CHECK("anonymous-queue", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK);
        block.queue = queue; block.callback = complete;
        hr = utf16 ? IXUserImpl_XUserGetTokenAndSignatureUtf16Async(users, &user, 0, L"GET", L"https://example.invalid", 0, NULL, 0, NULL, &block) :
            IXUserImpl_XUserGetTokenAndSignatureAsync(users, &user, 0, "GET", "https://example.invalid", 0, NULL, 0, NULL, &block);
        CHECK("anonymous-begin", hr == S_OK);
        IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0);
        start = GetTickCount64();
        while (!callbacks && GetTickCount64() - start < 3000) {
            IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0); Sleep(1);
        }
        CHECK("anonymous-completed-once", callbacks == 1 && IXThreadingImpl_XAsyncGetStatus(threads, &block, FALSE) == S_OK);
        CHECK("anonymous-endpoint-does-not-authorize", authorize_calls == prior_authorizations);
        hr = utf16 ? IXUserImpl_XUserGetTokenAndSignatureUtf16ResultSize(users, &block, &size) :
            IXUserImpl_XUserGetTokenAndSignatureResultSize(users, &block, &size);
        CHECK("anonymous-result-size", hr == S_OK && size >= 32);
        if (hr != S_OK || size < 32) { IXThreadingImpl_XTaskQueueCloseHandle(threads, queue); continue; }
        buffer = malloc(size + 16); memset(buffer, 0x7f, size + 16);
        if (utf16) {
            XUserGetTokenAndSignatureUtf16Data *result = NULL;
            hr = IXUserImpl_XUserGetTokenAndSignatureUtf16Result(users, &block, size, buffer, &result, &used);
            CHECK("anonymous-wide-result", hr == S_OK && result == (void *)buffer && used == size);
            if (hr == S_OK && result) {
                CHECK("anonymous-wide-empty-token", result->token && result->tokenCount == 1 && result->token[0] == 0);
                CHECK("anonymous-wide-token-owned", result->token && (BYTE *)result->token >= buffer && (BYTE *)(result->token + result->tokenCount) <= buffer + size);
                CHECK("anonymous-wide-signature-owned", result->signature && result->signature != result->token &&
                    (BYTE *)result->signature >= buffer && (BYTE *)(result->signature + result->signatureCount) <= buffer + size);
                CHECK("anonymous-wide-signature-count", result->signatureCount == (signature_fixture ? 105 : 1));
                CHECK("anonymous-wide-signature-terminated", result->signature && !result->signature[result->signatureCount - 1]);
            }
        } else {
            XUserGetTokenAndSignatureData *result = NULL;
            hr = IXUserImpl_XUserGetTokenAndSignatureResult(users, &block, size, buffer, &result, &used);
            CHECK("anonymous-utf8-result", hr == S_OK && result == (void *)buffer && used == size);
            if (hr == S_OK && result) {
                CHECK("anonymous-utf8-empty-token", result->token && result->tokenSize == 1 && result->token[0] == 0);
                CHECK("anonymous-utf8-token-owned", result->token && (BYTE *)result->token >= buffer && (BYTE *)result->token + result->tokenSize <= buffer + size);
                CHECK("anonymous-utf8-signature-owned", result->signature && result->signature != result->token &&
                    (BYTE *)result->signature >= buffer && (BYTE *)result->signature + result->signatureSize <= buffer + size);
                CHECK("anonymous-utf8-signature-count", result->signatureSize == (signature_fixture ? 105 : 1));
                CHECK("anonymous-utf8-signature-terminated", result->signature && !result->signature[result->signatureSize - 1]);
            }
        }
        CHECK("anonymous-result-guard", buffer[size] == 0x7f);
        free(buffer); IXThreadingImpl_XTaskQueueCloseHandle(threads, queue);
        start = GetTickCount64();
        while (user.refs != 1 && GetTickCount64() - start < 2000) Sleep(1);
        CHECK("anonymous-user-released", user.refs == 1);
    }
    anonymous_fixture = signature_fixture = FALSE;
}
int main(void) {
    HMODULE dll = LoadLibraryA("xgameruntime.dll");
    HRESULT (WINAPI *query)(const GUID *, REFIID, void **);
    IXThreadingImpl *threads;
    IXUserImpl *users;
    UINT test;
    if (!dll || !(query = (void *)GetProcAddress(dll, "QueryApiImpl")) ||
        FAILED(query(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&threads)) ||
        FAILED(query(&CLSID_XUserImpl, &IID_IXUserImpl, (void **)&users))) return 2;
    WindowsCreateString(L"https://example.invalid", 23, &relying_party);
    WindowsCreateString(L"JWT", 3, &token_type);
    for (test = 0; test < 6; ++test) {
        struct XUser user = {0};
        XTaskQueueHandle queue;
        XAsyncBlock block = {0};
        ULONGLONG start, elapsed;
        HRESULT hr;
        user.iface.lpVtbl = &vtbl; user.refs = 1;
        user.started = CreateEventA(NULL, TRUE, FALSE, NULL);
        user.gate = CreateEventA(NULL, TRUE, FALSE, NULL);
        callbacks = 0;
        CHECK("manual-queue", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK);
        block.queue = queue; block.callback = complete;
        hr = test >= 4 ? IXUserImpl_XUserGetGamerPictureAsync(users, &user, XUserGamerPictureSize_Medium, &block) :
            test & 1 ? IXUserImpl_XUserGetTokenAndSignatureUtf16Async(users, &user, 0, L"GET", L"https://example.invalid", 0, NULL, 0, NULL, &block) :
            IXUserImpl_XUserGetTokenAndSignatureAsync(users, &user, 0, "GET", "https://example.invalid", 0, NULL, 0, NULL, &block);
        CHECK("begin", hr == S_OK);
        start = GetTickCount64();
        CHECK("work-dispatch", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0));
        elapsed = GetTickCount64() - start;
        printf("DISPATCH test=%u elapsed_ms=%llu\n", test, elapsed);
        CHECK("dispatch-does-not-wait-for-auth", elapsed < 200);
        CHECK("worker-started", WaitForSingleObject(user.started, 1500) == WAIT_OBJECT_0);
        CHECK("authorization-not-on-dispatch-thread", user.request_thread != GetCurrentThreadId());
        CHECK("pending-before-auth-returns", IXThreadingImpl_XAsyncGetStatus(threads, &block, FALSE) == E_PENDING);
        if (test == 2 || test == 3 || test == 5) {
            IXThreadingImpl_XAsyncCancel(threads, &block);
            /* Existing runtime cancellation is best-effort/no-op. Force a
             * terminal abort to exercise Cleanup while authorization runs. */
            IXThreadingImpl_XAsyncComplete(threads, &block, E_ABORT, 0);
            while (IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0));
            CHECK("cancel-status", IXThreadingImpl_XAsyncGetStatus(threads, &block, FALSE) == E_ABORT);
            CHECK("user-retained-during-canceled-work", user.refs == 2);
        }
        SetEvent(user.gate);
        start = GetTickCount64();
        while ((user.refs != 1 || !callbacks) && GetTickCount64() - start < 2000) {
            IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0); Sleep(1);
        }
        CHECK("completion-once", callbacks == 1);
        CHECK("real-failure-or-cancel", IXThreadingImpl_XAsyncGetStatus(threads, &block, FALSE) == (test == 2 || test == 3 || test == 5 ? E_ABORT : E_FAIL));
        CHECK("user-reference-released", user.refs == 1);
        IXThreadingImpl_XTaskQueueCloseHandle(threads, queue);
        CloseHandle(user.started); CloseHandle(user.gate);
    }
    test_signature_strings(users, threads);
    test_anonymous_strings(users, threads);
    WindowsDeleteString(relying_party); WindowsDeleteString(token_type);
    IXUserImpl_Release(users); IXThreadingImpl_Release(threads);
    printf("CHECKS %ld FAILURES %ld\n", checks, failures);
    return failures ? 1 : 0;
}
