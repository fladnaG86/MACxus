#ifndef MACXUS_GPU_CLOCK_REPORTING_H
#define MACXUS_GPU_CLOCK_REPORTING_H

/* Real calibration is opt-in; the disabled path remains unsupported.
 * API 32 has its own counters and must not index observer_rates[32]. */
static LONG clock_reporting_calls[2];
static void clock_reporting_note(unsigned operation, HRESULT result, UINT64 frequency,
                                 BOOL gpu_output, BOOL cpu_output, UINT64 caller)
{
    DWORD saved = GetLastError();
    char enabled[2];
    if (GetEnvironmentVariableA("MACXUS_GPU_CLOCK_TRACE", enabled, sizeof(enabled)) == 1 && enabled[0] == '1') {
        DWORD count = (DWORD)InterlockedIncrement(&clock_reporting_calls[operation]);
        if (count <= 8 || !(count & (count - 1))) {
            LARGE_INTEGER qpc_frequency = {0};
            QueryPerformanceFrequency(&qpc_frequency);
            observer_note(32, caller,
                "clock_operation=%u count=%lu hr=%08lx gpu_frequency=%llu qpc_frequency=%llu gpu_output=%u cpu_output=%u calibration_implemented=%u",
                operation, (unsigned long)count, (unsigned long)result,
                (unsigned long long)frequency, (unsigned long long)qpc_frequency.QuadPart,
                gpu_output, cpu_output, operation == 1 && SUCCEEDED(result));
        }
    }
    SetLastError(saved);
}

static HRESULT STDMETHODCALLTYPE hook_GetTimestampFrequency(ID3D12CommandQueue *queue, UINT64 *frequency)
{
    (void)queue;
    HRESULT result = E_INVALIDARG;
    if (frequency) {
        char text[32];
        DWORD length = GetEnvironmentVariableA("MACXUS_GPU_TIMESTAMP_FREQUENCY", text, sizeof(text));
        result = E_FAIL;
        if (length && length < sizeof(text)) {
            *frequency = _strtoui64(text, NULL, 10);
            result = *frequency ? S_OK : E_FAIL;
        }
    }
    clock_reporting_note(0, result, SUCCEEDED(result) ? *frequency : 0,
                         frequency != NULL, FALSE, OBS_CALLER);
    return result;
}

#include "clock-hook.h"

static HRESULT STDMETHODCALLTYPE hook_GetClockCalibration(ID3D12CommandQueue *queue, UINT64 *gpu, UINT64 *cpu)
{
    HRESULT result = mx_get_calibration(queue, gpu, cpu);
    clock_reporting_note(1, result, 0, gpu != NULL, cpu != NULL, OBS_CALLER);
    return result;
}
#endif
