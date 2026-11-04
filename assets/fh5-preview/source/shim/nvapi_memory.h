#ifndef MACXUS_FH5_NVAPI_MEMORY_H
#define MACXUS_FH5_NVAPI_MEMORY_H
#include <stdint.h>
#include <stddef.h>

/* Minimal public NVAPI ABI declarations. Legacy fields are KiB; Ex fields
 * are bytes, except eviction/promotion counts. No budgets are invented. */
typedef struct {
    uint32_t version;
    uint64_t dedicated, available, system, shared, current;
    uint64_t evicted, evictions, promoted, promotions;
} fh5_nvapi_memory_ex;
typedef struct {
    uint32_t version, dedicated, available, system, shared, current, evicted, evictions;
} fh5_nvapi_memory_legacy;
typedef int (__cdecl *fh5_nvapi_memory_ex_fn)(void *, fh5_nvapi_memory_ex *);
_Static_assert(sizeof(fh5_nvapi_memory_ex) == 80, "NVAPI Ex V1 size");
_Static_assert(offsetof(fh5_nvapi_memory_ex, dedicated) == 8, "NVAPI Ex V1 alignment");
_Static_assert(sizeof(fh5_nvapi_memory_legacy) == 32, "NVAPI legacy V3 size");

static uint32_t fh5_nvapi_u32(uint64_t value)
{ return value > UINT32_MAX ? UINT32_MAX : (uint32_t)value; }

static int __cdecl fh5_nvapi_memory(void *gpu, void *output)
{
    DWORD before = GetLastError();
    if (!output) return -5; /* NVAPI_INVALID_ARGUMENT */
    uint32_t version;
    memcpy(&version, output, sizeof(version));
    unsigned size = version == 0x10014 ? 20 : version == 0x20018 ? 24 : version == 0x30020 ? 32 : 0;
    if (!size) return -9; /* NVAPI_INCOMPATIBLE_STRUCT_VERSION */
    fh5_nvapi_query_fn query = fh5_nvapi_provider();
    fh5_nvapi_memory_ex_fn get = query ? (void *)query(0xc0599498) : NULL;
    SetLastError(before);
    if (!get) return -3;
    fh5_nvapi_memory_ex extended = {0};
    extended.version = 0x10050;
    int status = get(gpu, &extended);
    if (status) return status; /* caller's output remains unchanged */
    fh5_nvapi_memory_legacy result = { version,
        fh5_nvapi_u32(extended.dedicated / 1024), fh5_nvapi_u32(extended.available / 1024),
        fh5_nvapi_u32(extended.system / 1024), fh5_nvapi_u32(extended.shared / 1024),
        fh5_nvapi_u32(extended.current / 1024), fh5_nvapi_u32(extended.evicted / 1024),
        fh5_nvapi_u32(extended.evictions) };
    memcpy(output, &result, size);
    return status;
}
#endif
