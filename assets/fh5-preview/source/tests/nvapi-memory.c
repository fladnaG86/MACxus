#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#define MACXUS_FH5_NVAPI_PROVIDER_H
static BOOL fh5_nvapi_check_provider(HMODULE module) { return module == (HMODULE)1; }
static BOOL fh5_nvapi_check_entry(HMODULE module, FARPROC entry) { (void)module; (void)entry; return TRUE; }
#include "../shim/nvapi_profile.h"
static unsigned checks, calls;
static int status;
static BOOL present = TRUE, legacy;
static void *const handle = (void *)(uintptr_t)0x1234;
static fh5_nvapi_memory_ex values;
#define CHECK(x) do { checks++; if (!(x)) { printf("FAIL line=%u\n", __LINE__); return 1; } } while (0)
static int __cdecl get_ex(void *gpu, fh5_nvapi_memory_ex *out)
{
    calls++;
    if (gpu != handle) return -8;
    if (out->version != 0x10050) return -9;
    *out = values; SetLastError(456); return status;
}
static void *__cdecl query(unsigned id)
{
    SetLastError(123);
    if (id == 0xc0599498) return present ? (void *)get_ex : NULL;
    if (id == 0x07f9b368) return legacy ? (void *)get_ex : NULL;
    return NULL;
}
int main(void)
{
    fh5_nvapi_provider_query = query; fh5_nvapi_memory_enabled = TRUE;
    const uint32_t versions[] = {0x10014, 0x20018, 0x30020};
    const uint64_t cases[] = {0, 1, 1023, 1024, 1025, UINT32_MAX, (uint64_t)UINT32_MAX * 1024,
        (uint64_t)UINT32_MAX * 1024 + 1023, ((uint64_t)UINT32_MAX + 1) * 1024, UINT64_MAX};
    for (unsigned v = 0; v < 3; v++) for (unsigned c = 0; c < sizeof(cases) / sizeof(*cases); c++) {
        uint64_t n = cases[c];
        values = (fh5_nvapi_memory_ex){0x10050, n, n / 2, n / 3, n / 4, n / 5, n / 6, n / 7, UINT64_MAX, UINT64_MAX};
        unsigned char buffer[48]; memset(buffer, 0xa5, sizeof(buffer)); memcpy(buffer, &versions[v], 4);
        SetLastError(999); unsigned before = calls;
        CHECK(fh5_nvapi_memory(handle, buffer) == 0 && calls == before + 1 && GetLastError() == 456);
        uint32_t result[8]; memcpy(result, buffer, sizeof(result));
        CHECK(result[0] == versions[v]);
        const uint64_t raw[] = {n / 1024, (n / 2) / 1024, (n / 3) / 1024, (n / 4) / 1024, (n / 5) / 1024, (n / 6) / 1024, n / 7};
        unsigned size = versions[v] & 0xffff;
        for (unsigned i = 1; i < size / 4; i++) CHECK(result[i] == (raw[i-1] > UINT32_MAX ? UINT32_MAX : (uint32_t)raw[i-1]));
        for (unsigned i = size; i < sizeof(buffer); i++) CHECK(buffer[i] == 0xa5);
    }
    uint32_t output[8], copy[8]; memset(output, 0xa5, sizeof(output)); output[0] = 0x30020; memcpy(copy, output, sizeof(copy));
    status = -77; CHECK(fh5_nvapi_memory(handle, output) == -77 && !memcmp(copy, output, sizeof(copy)) && GetLastError() == 456);
    status = 0; CHECK(fh5_nvapi_memory(NULL, output) == -8 && !memcmp(copy, output, sizeof(copy)));
    unsigned before = calls; SetLastError(999);
    CHECK(fh5_nvapi_memory(handle, NULL) == -5 && calls == before && GetLastError() == 999);
    const uint32_t bad[] = {0, 20, 0x10018, 0x20014, 0x30018, 0x40020, 0x10000, UINT32_MAX};
    for (unsigned i = 0; i < sizeof(bad)/sizeof(*bad); i++) {
        output[0] = bad[i]; memcpy(copy, output, sizeof(copy));
        CHECK(fh5_nvapi_memory(handle, output) == -9 && calls == before && GetLastError() == 999 && !memcmp(copy, output, sizeof(copy)));
    }
    output[0] = 0x10014; present = FALSE;
    CHECK(fh5_nvapi_memory(handle, output) == -3 && calls == before && GetLastError() == 999);
    CHECK(!fh5_nvapi_query(0x07f9b368) && GetLastError() == 123);
    present = TRUE; CHECK(fh5_nvapi_query(0x07f9b368) == (void *)fh5_nvapi_memory && GetLastError() == 123);
    legacy = TRUE; CHECK(fh5_nvapi_query(0x07f9b368) == (void *)get_ex);
    legacy = FALSE; fh5_nvapi_memory_enabled = FALSE; CHECK(!fh5_nvapi_query(0x07f9b368));
    fh5_nvapi_memory_enabled = TRUE; fh5_nvapi_enabled = FALSE; CHECK(!fh5_nvapi_query(0x617bff9f));
    SetEnvironmentVariableA("MACXUS_FH5_NVAPI_MEMORY", "1"); SetEnvironmentVariableA("MACXUS_FH5_NVAPI_PROFILE", "0"); fh5_nvapi_configure();
    CHECK(fh5_nvapi_memory_enabled && !fh5_nvapi_enabled);
    SetEnvironmentVariableA("MACXUS_FH5_NVAPI_MEMORY", NULL);
    printf("NVAPI MEMORY CHECKS %u FAILURES 0\n", checks); return 0;
}
