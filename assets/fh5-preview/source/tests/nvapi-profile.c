#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

static BOOL native_current, native_base = TRUE, swap_query;
static int base_status;
static LONG base_queries, base_calls;
static unsigned checks;
#define CHECK(x) do { checks++; if (!(x)) { printf("FAIL line=%u\n", __LINE__); return 1; } } while (0)
static void *const session_handle = (void *)(uintptr_t)0x100;
static void *const profile_handle = (void *)(uintptr_t)0x200;
static void *const sentinel = (void *)(uintptr_t)0x300;

static int __cdecl native_profile(void *session, void **profile)
{
    InterlockedIncrement(&base_calls);
    SetLastError(333);
    if (!session || session != session_handle) return -8;
    if (!profile) return -5;
    if (base_status) return base_status;
    *profile = profile_handle;
    return 0;
}
static int __cdecl native_global(void *session, void **profile)
{ return native_profile(session, profile); }
static void * __cdecl query_a(unsigned id)
{
    if (id == 0xda8466a0) {
        InterlockedIncrement(&base_queries);
        SetLastError(222);
        return native_base ? (void *)native_profile : NULL;
    }
    SetLastError(111);
    if (id == 0x617bff9f) return native_current ? (void *)native_global : NULL;
    return sentinel;
}
static void * __cdecl query_b(unsigned id) { (void)id; SetLastError(555); return sentinel; }
static FARPROC WINAPI native_getproc(HMODULE module, LPCSTR name)
{
    SetLastError(777);
    if (!module) return NULL;
    if ((ULONG_PTR)name <= 65535) return (void *)native_global;
    if (strcmp(name, "nvapi_QueryInterface")) return (void *)native_global;
    return (void *)(module == (HMODULE)2 || swap_query ? query_b : query_a);
}
static DWORD WINAPI fixture_module_name(HMODULE module, LPWSTR output, DWORD capacity)
{
    SetLastError(888);
    if (module == (HMODULE)4) return 0;
    if (module == (HMODULE)5) return capacity;
    const WCHAR *text = module == (HMODULE)3 ? L"C:\\fixture\\other.dll" : L"C:\\fixture\\NvApi64.DLL";
    DWORD length = (DWORD)wcslen(text);
    if (length >= capacity) return capacity;
    memcpy(output, text, (length + 1) * sizeof(WCHAR));
    return length;
}
#define GetModuleFileNameW fixture_module_name
/* Provider fingerprinting has a separate real-file/loaded-DLL probe. */
#define MACXUS_FH5_NVAPI_PROVIDER_H
static BOOL fh5_nvapi_check_provider(HMODULE module) { return module != (HMODULE)7; }
static BOOL fh5_nvapi_check_entry(HMODULE module, FARPROC entry) { (void)module; (void)entry; return TRUE; }
#include "../shim/nvapi_profile.h"
#undef GetModuleFileNameW

static void reset(void)
{
    fh5_nvapi_module = NULL; fh5_nvapi_provider_query = NULL;
    fh5_nvapi_real_getproc = native_getproc;
    native_current = swap_query = FALSE; native_base = TRUE; base_status = 0;
    base_queries = base_calls = 0;
}
static DWORD WINAPI concurrent(void *unused)
{
    (void)unused;
    for (unsigned i = 0; i < 256; i++) {
        FARPROC address = fh5_nvapi_getproc((HMODULE)1, "nvapi_QueryInterface");
        if (GetLastError() != 777 || address != (void *)fh5_nvapi_query) return 1;
        fh5_nvapi_query_fn query = (void *)address;
        fh5_nvapi_profile_fn get = (void *)query(0x617bff9f);
        if (GetLastError() != 111 || !get) return 2;
        void *profile = sentinel;
        if (get(session_handle, &profile) || profile != profile_handle || GetLastError() != 333) return 3;
    }
    return 0;
}
int main(void)
{
    const char *off[] = { NULL, "", "0", "11", "true" };
    for (unsigned i = 0; i < sizeof(off) / sizeof(*off); i++) {
        reset(); SetEnvironmentVariableA("MACXUS_FH5_NVAPI_PROFILE", off[i]);
        SetLastError(919); fh5_nvapi_configure(); CHECK(GetLastError() == 919 && !fh5_nvapi_enabled);
        CHECK(fh5_nvapi_getproc((HMODULE)1, "nvapi_QueryInterface") == (void *)query_a);
        CHECK(GetLastError() == 777);
    }
    reset(); SetEnvironmentVariableA("MACXUS_FH5_NVAPI_PROFILE", "1");
    SetLastError(919); fh5_nvapi_configure(); CHECK(GetLastError() == 919 && fh5_nvapi_enabled);
    for (unsigned i = 3; i <= 5; i++) {
        CHECK(fh5_nvapi_getproc((HMODULE)(uintptr_t)i, "nvapi_QueryInterface") == (void *)query_a);
        CHECK(GetLastError() == 777 && !fh5_nvapi_module);
    }
    CHECK(fh5_nvapi_getproc((HMODULE)7, "nvapi_QueryInterface") == (void *)query_a);
    CHECK(GetLastError() == 777 && !fh5_nvapi_module);
    CHECK(!fh5_nvapi_getproc(NULL, "nvapi_QueryInterface") && GetLastError() == 777);
    CHECK(fh5_nvapi_getproc((HMODULE)1, MAKEINTRESOURCEA(1)) == (void *)native_global && GetLastError() == 777);
    CHECK(fh5_nvapi_getproc((HMODULE)1, "OtherExport") == (void *)native_global && GetLastError() == 777);
    CHECK(!fh5_nvapi_module);
    fh5_nvapi_query_fn query = (void *)fh5_nvapi_getproc((HMODULE)1, "nvapi_QueryInterface");
    CHECK(query == fh5_nvapi_query && GetLastError() == 777);
    CHECK(query(0xffffffff) == sentinel && GetLastError() == 111 && !base_queries);
    native_current = TRUE;
    CHECK(query(0x617bff9f) == (void *)native_global && GetLastError() == 111 && !base_queries);
    native_current = FALSE; native_base = FALSE;
    CHECK(!query(0x617bff9f) && GetLastError() == 111 && base_queries == 1);
    native_base = TRUE;
    fh5_nvapi_profile_fn get = (void *)query(0x617bff9f);
    CHECK(get == fh5_nvapi_default_profile && GetLastError() == 111);
    void *profile = sentinel;
    CHECK(get(session_handle, &profile) == 0 && profile == profile_handle && GetLastError() == 333);
    profile = sentinel; CHECK(get(NULL, &profile) == -8 && profile == sentinel && GetLastError() == 333);
    CHECK(get(session_handle, NULL) == -5 && GetLastError() == 333);
    base_status = -77; CHECK(get(session_handle, &profile) == -77 && profile == sentinel && GetLastError() == 333);
    base_status = 0; native_base = FALSE; SetLastError(919);
    CHECK(get(session_handle, &profile) == -3 && profile == sentinel && GetLastError() == 919);
    native_base = TRUE;
    CHECK(fh5_nvapi_getproc((HMODULE)2, "nvapi_QueryInterface") == (void *)query_b && GetLastError() == 777);
    swap_query = TRUE;
    CHECK(fh5_nvapi_getproc((HMODULE)1, "nvapi_QueryInterface") == (void *)query_b && GetLastError() == 777);
    swap_query = FALSE;
    CHECK(query(0x2926aaad) == sentinel && GetLastError() == 111);
    reset(); fh5_nvapi_configure();
    HANDLE workers[8];
    for (unsigned i = 0; i < 8; i++) { workers[i] = CreateThread(NULL, 0, concurrent, NULL, 0, NULL); CHECK(workers[i]); }
    CHECK(WaitForMultipleObjects(8, workers, TRUE, 30000) == WAIT_OBJECT_0);
    for (unsigned i = 0; i < 8; i++) { DWORD code = 99; CHECK(GetExitCodeThread(workers[i], &code) && !code); CHECK(CloseHandle(workers[i])); }
    SetEnvironmentVariableA("MACXUS_FH5_NVAPI_PROFILE", NULL);
    printf("NVAPI PROFILE CHECKS %u FAILURES 0 concurrent_calls=2048\n", checks);
    return 0;
}
