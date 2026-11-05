#ifndef MACXUS_FH5_NVAPI_PROFILE_H
#define MACXUS_FH5_NVAPI_PROFILE_H
#include "nvapi_provider.h"

/* FH5 opts into a default-profile fallback for the pinned Preview provider.
 * This is a title compatibility policy, not a claim that current-global and
 * base profiles are equivalent on arbitrary NVIDIA drivers. Existing native
 * functions always win. Sessions, profile handles, errors and settings remain
 * owned by the provider; this code neither writes settings nor reports a
 * driver version. Public NVAPI IDs: DRS_GetCurrentGlobalProfile/GetBaseProfile. */
typedef void *(__cdecl *fh5_nvapi_query_fn)(unsigned);
typedef int (__cdecl *fh5_nvapi_profile_fn)(void *, void **);
static FARPROC (WINAPI *fh5_nvapi_real_getproc)(HMODULE, LPCSTR);
static BOOL fh5_nvapi_enabled;
static BOOL fh5_nvapi_memory_enabled;
static SRWLOCK fh5_nvapi_lock = SRWLOCK_INIT;
static HMODULE fh5_nvapi_module;
static fh5_nvapi_query_fn fh5_nvapi_provider_query;

static void fh5_nvapi_configure(void)
{
    DWORD error = GetLastError();
    char value[8];
    fh5_nvapi_enabled = GetEnvironmentVariableA("MACXUS_FH5_NVAPI_PROFILE", value, sizeof(value)) == 1 && value[0] == '1';
    fh5_nvapi_memory_enabled = GetEnvironmentVariableA("MACXUS_FH5_NVAPI_MEMORY", value, sizeof(value)) == 1 && value[0] == '1';
    SetLastError(error);
}

static fh5_nvapi_query_fn fh5_nvapi_provider(void)
{
    fh5_nvapi_query_fn result;
    AcquireSRWLockShared(&fh5_nvapi_lock);
    result = fh5_nvapi_provider_query;
    ReleaseSRWLockShared(&fh5_nvapi_lock);
    return result;
}

static int __cdecl fh5_nvapi_default_profile(void *session, void **profile)
{
    DWORD error = GetLastError();
    fh5_nvapi_query_fn query = fh5_nvapi_provider();
    fh5_nvapi_profile_fn base = query ? (void *)query(0xda8466a0) : NULL;
    SetLastError(error);
    if (!base) return -3; /* NVAPI_NO_IMPLEMENTATION; do not fabricate success. */
    return base(session, profile);
}

#include "nvapi_memory.h"

static void *__cdecl fh5_nvapi_query(unsigned id)
{
    DWORD before = GetLastError();
    fh5_nvapi_query_fn query = fh5_nvapi_provider();
    SetLastError(before);
    if (!query) return NULL;
    void *result = query(id);
    DWORD error = GetLastError();
    if (!result && fh5_nvapi_enabled && id == 0x617bff9f && query(0xda8466a0))
        result = (void *)fh5_nvapi_default_profile;
    if (!result && fh5_nvapi_memory_enabled && id == 0x07f9b368 && query(0xc0599498))
        result = (void *)fh5_nvapi_memory;
    SetLastError(error);
    return result;
}

static FARPROC WINAPI fh5_nvapi_getproc(HMODULE module, LPCSTR name)
{
    FARPROC result = fh5_nvapi_real_getproc(module, name);
    DWORD error = GetLastError();
    if ((fh5_nvapi_enabled || fh5_nvapi_memory_enabled) && result && (ULONG_PTR)name > 65535 && !strcmp(name, "nvapi_QueryInterface")) {
        WCHAR path[1024];
        DWORD length = GetModuleFileNameW(module, path, sizeof(path) / sizeof(*path));
        if (length && length < sizeof(path) / sizeof(*path)) {
            const WCHAR *base = wcsrchr(path, L'\\');
            base = base ? base + 1 : path;
            if (!_wcsicmp(base, L"nvapi64.dll") && fh5_nvapi_check_provider(module) && fh5_nvapi_check_entry(module, result)) {
                AcquireSRWLockExclusive(&fh5_nvapi_lock);
                if (!fh5_nvapi_module) {
                    fh5_nvapi_module = module;
                    fh5_nvapi_provider_query = (void *)result;
                }
                /* Never mix handles/function pointers from different providers. */
                if (fh5_nvapi_module == module && (void *)fh5_nvapi_provider_query == (void *)result)
                    result = (void *)fh5_nvapi_query;
                ReleaseSRWLockExclusive(&fh5_nvapi_lock);
            }
        }
    }
    SetLastError(error);
    return result;
}
#endif
