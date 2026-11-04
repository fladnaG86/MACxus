#include <stdarg.h>
#include "ntstatus.h"
#define WIN32_NO_STATUS
#include "windef.h"
#include "winbase.h"
#include "winternl.h"
#include "wine/unixlib.h"
#include "clock-abi.h"

static INIT_ONCE initialized = INIT_ONCE_STATIC_INIT;
static NTSTATUS init_status;
static BOOL WINAPI initialize(PINIT_ONCE once, PVOID arg, PVOID *context)
{
    (void)once; (void)arg; (void)context;
    init_status = __wine_init_unix_call();
    return TRUE;
}
HRESULT WINAPI MacxusGetClockCalibration(UINT64 frequency, UINT64 *gpu, UINT64 *cpu)
{
    if (!gpu || !cpu || gpu == cpu || !frequency) return E_INVALIDARG;
    LARGE_INTEGER qpc_frequency, before, after;
    if (!QueryPerformanceFrequency(&qpc_frequency) || qpc_frequency.QuadPart != 10000000)
        return E_NOTIMPL;
    InitOnceExecuteOnce(&initialized, initialize, NULL, NULL);
    if (init_status) return E_NOTIMPL;
    struct mx_clock_sample sample = {MX_CLOCK_VERSION, sizeof(sample), frequency, 0, 0, 0};
    if (!QueryPerformanceCounter(&before)) return E_FAIL;
    NTSTATUS status = WINE_UNIX_CALL(0, &sample);
    if (!QueryPerformanceCounter(&after)) return E_FAIL;
    if (status == MX_STATUS_UNSUPPORTED) return E_NOTIMPL;
    if (status) return E_FAIL;
    /* Also enforce the actual guest clock domain on every successful sample. */
    if (before.QuadPart < 0 || after.QuadPart < before.QuadPart ||
        sample.qpc_ticks < (UINT64)before.QuadPart || sample.qpc_ticks > (UINT64)after.QuadPart)
        return E_FAIL;
    *gpu = sample.gpu_ticks;
    *cpu = sample.qpc_ticks;
    return S_OK;
}
