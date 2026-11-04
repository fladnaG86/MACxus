#include <windows.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>

typedef HRESULT (WINAPI *calibrate_fn)(UINT64, UINT64 *, UINT64 *);
static DWORD WINAPI threaded_samples(void *opaque)
{
    calibrate_fn fn = (calibrate_fn)opaque;
    UINT64 previous_gpu = 0, previous_cpu = 0;
    for (unsigned i = 0; i < 1024; i++) {
        UINT64 gpu = 0, cpu = 0;
        if (fn(24000000, &gpu, &cpu) != S_OK || !gpu || !cpu ||
            gpu < previous_gpu || cpu < previous_cpu) return 1;
        previous_gpu = gpu; previous_cpu = cpu;
    }
    return 0;
}
static int compare(const void *a, const void *b)
{
    UINT64 x = *(const UINT64 *)a, y = *(const UINT64 *)b;
    return (x > y) - (x < y);
}
int main(int argc, char **argv)
{
    setbuf(stdout, NULL);
    HMODULE h = LoadLibraryW(L"macxus-clock.dll");
    if (!h) { printf("LOAD_FAIL %lu\n", GetLastError()); return 1; }
    calibrate_fn fn = (void *)GetProcAddress(h, "MacxusGetClockCalibration");
    if (!fn) return 2;
    UINT64 gpu = 123, cpu = 456;
    if (fn(24000000, NULL, &cpu) != E_INVALIDARG || cpu != 456 ||
        fn(24000000, &gpu, NULL) != E_INVALIDARG || gpu != 123 ||
        fn(24000000, &gpu, &gpu) != E_INVALIDARG || gpu != 123 ||
        fn(0, &gpu, &cpu) != E_INVALIDARG || gpu != 123 || cpu != 456) return 3;
    HRESULT unsupported = fn(1, &gpu, &cpu);
    if (unsupported != E_NOTIMPL || gpu != 123 || cpu != 456) return 4;
    if (argc > 1 && !strcmp(argv[1], "--missing-bridge")) {
        HRESULT hr = fn(24000000, &gpu, &cpu);
        printf("MISSING_BRIDGE hr=%08lx outputs_preserved=%d\n", (unsigned long)hr, gpu == 123 && cpu == 456);
        return hr != E_NOTIMPL || gpu != 123 || cpu != 456;
    }
    UINT64 previous_gpu = 0, previous_cpu = 0, durations[1024];
    LARGE_INTEGER frequency;
    QueryPerformanceFrequency(&frequency);
    if (frequency.QuadPart != 10000000) return 5;
    for (unsigned i = 0; i < 1024; i++) {
        LARGE_INTEGER before, after;
        QueryPerformanceCounter(&before);
        HRESULT hr = fn(24000000, &gpu, &cpu);
        QueryPerformanceCounter(&after);
        if (hr != S_OK || cpu < (UINT64)before.QuadPart || cpu > (UINT64)after.QuadPart ||
            gpu < previous_gpu || cpu < previous_cpu || !gpu || !cpu) {
            printf("CLOCK_FAIL case=%u hr=%08lx bracket=%d monotonic=%d\n", i, (unsigned long)hr,
                   cpu >= (UINT64)before.QuadPart && cpu <= (UINT64)after.QuadPart,
                   gpu >= previous_gpu && cpu >= previous_cpu); return 6;
        }
        if (i && !(i % 32)) {
            /* Compare elapsed time in the two returned clock domains. */
            UINT64 gpu_ns = (gpu - previous_gpu) * 1000000000 / 24000000;
            UINT64 cpu_ns = (cpu - previous_cpu) * 100;
            UINT64 drift = gpu_ns > cpu_ns ? gpu_ns - cpu_ns : cpu_ns - gpu_ns;
            if (drift > 100000) { printf("DRIFT_FAIL ns=%llu\n", (unsigned long long)drift); return 7; }
        }
        durations[i] = (UINT64)(after.QuadPart - before.QuadPart);
        previous_gpu = gpu; previous_cpu = cpu;
        if (!((i + 1) % 32)) Sleep(2);
    }
    qsort(durations, 1024, sizeof(*durations), compare);
    printf("CLOCK_OK samples=1024 bracketed=1024 monotonic=1024 gpu_frequency=24000000 qpc_frequency=10000000 call_median_ns=%llu call_p99_ns=%llu call_max_ns=%llu\n",
           (unsigned long long)durations[512] * 100, (unsigned long long)durations[1013] * 100,
           (unsigned long long)durations[1023] * 100);
    HANDLE workers[8];
    for (unsigned i = 0; i < 8; i++) {
        workers[i] = CreateThread(NULL, 0, threaded_samples, (void *)fn, 0, NULL);
        if (!workers[i]) return 8;
    }
    if (WaitForMultipleObjects(8, workers, TRUE, 30000) != WAIT_OBJECT_0) return 9;
    for (unsigned i = 0; i < 8; i++) {
        DWORD code = 1;
        if (!GetExitCodeThread(workers[i], &code) || code) return 10;
        CloseHandle(workers[i]);
    }
    puts("CLOCK_THREADS threads=8 samples=8192 monotonic=8192");
    FreeLibrary(h);
    return 0;
}
