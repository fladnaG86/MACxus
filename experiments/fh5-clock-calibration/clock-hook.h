#ifndef MACXUS_CLOCK_HOOK_H
#define MACXUS_CLOCK_HOOK_H
/* Experimental overlay only. The baseline pack keeps calibration unsupported. */
static INIT_ONCE mx_calibration_once = INIT_ONCE_STATIC_INIT;
static HRESULT (WINAPI *mx_calibration_call)(UINT64, UINT64 *, UINT64 *);
static BOOL WINAPI mx_calibration_load(PINIT_ONCE once, PVOID arg, PVOID *context)
{
    (void)once; (void)arg; (void)context;
    WCHAR path[MAX_PATH]; char enabled[2];
    if (GetEnvironmentVariableA("MACXUS_GPU_CLOCK_CALIBRATION", enabled, sizeof(enabled)) != 1 || enabled[0] != '1') return TRUE;
    UINT n = GetSystemDirectoryW(path, MAX_PATH);
    const WCHAR suffix[] = L"\\macxus-clock.dll";
    if (!n || n + sizeof(suffix) / sizeof(*suffix) > MAX_PATH) return TRUE;
    memcpy(path + n, suffix, sizeof(suffix));
    HMODULE module = LoadLibraryW(path);
    if (module) mx_calibration_call = (void *)GetProcAddress(module, "MacxusGetClockCalibration");
    return TRUE;
}
static HRESULT mx_get_calibration(ID3D12CommandQueue *queue, UINT64 *gpu, UINT64 *cpu)
{
    InitOnceExecuteOnce(&mx_calibration_once, mx_calibration_load, NULL, NULL);
    if (!mx_calibration_call) return E_NOTIMPL;
    if (!gpu || !cpu || gpu == cpu) return E_INVALIDARG;
    UINT64 frequency = 0;
    HRESULT hr = hook_GetTimestampFrequency(queue, &frequency);
    if (FAILED(hr)) return hr;
    return mx_calibration_call(frequency, gpu, cpu);
}
#endif
