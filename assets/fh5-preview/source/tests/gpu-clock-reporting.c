#include <windows.h>
#include <d3d12.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
static unsigned notes, checks;
static unsigned last_api;
static char last_note[1024];
#define OBS_CALLER 0
static void observer_note(unsigned api, UINT64 caller, const char *format, ...)
{
    (void)caller;
    last_api = api;
    notes++;
    va_list args;
    va_start(args, format);
    vsnprintf(last_note, sizeof(last_note), format, args);
    va_end(args);
    SetLastError(9876); /* The observer's side effects must not escape. */
}
#include "../shim/gpu_clock_reporting.h"
#define CHECK(x) do { checks++; if (!(x)) { printf("FAIL line=%u\n", __LINE__); return 1; } } while (0)
int main(void)
{
    UINT64 frequency = 77, gpu = 123, cpu = 456;
    SetEnvironmentVariableA("MACXUS_GPU_TIMESTAMP_FREQUENCY", "24000000");
    SetEnvironmentVariableA("MACXUS_GPU_CLOCK_TRACE", NULL);
    CHECK(hook_GetTimestampFrequency(NULL, &frequency) == S_OK && frequency == 24000000);
    CHECK(hook_GetClockCalibration(NULL, &gpu, &cpu) == E_NOTIMPL);
    CHECK(gpu == 123 && cpu == 456 && notes == 0);
    SetEnvironmentVariableA("MACXUS_GPU_CLOCK_TRACE", "1");
    CHECK(hook_GetTimestampFrequency(NULL, &frequency) == S_OK);
    CHECK(notes == 1 && last_api == 32 && strstr(last_note, "gpu_frequency=24000000"));
    CHECK(strstr(last_note, "clock_operation=0") && strstr(last_note, "calibration_implemented=0"));
    SetLastError(4321);
    CHECK(hook_GetClockCalibration(NULL, &gpu, &cpu) == E_NOTIMPL);
    CHECK(GetLastError() == 4321 && gpu == 123 && cpu == 456);
    CHECK(notes == 2 && strstr(last_note, "clock_operation=1"));
    CHECK(hook_GetClockCalibration(NULL, NULL, NULL) == E_NOTIMPL);
    CHECK(strstr(last_note, "gpu_output=0 cpu_output=0"));
    CHECK(hook_GetTimestampFrequency(NULL, NULL) == E_INVALIDARG);
    SetEnvironmentVariableA("MACXUS_GPU_TIMESTAMP_FREQUENCY", NULL);
    frequency = 77;
    CHECK(hook_GetTimestampFrequency(NULL, &frequency) == E_FAIL && frequency == 77);
    SetEnvironmentVariableA("MACXUS_GPU_TIMESTAMP_FREQUENCY", "0");
    CHECK(hook_GetTimestampFrequency(NULL, &frequency) == E_FAIL && frequency == 0);
    SetEnvironmentVariableA("MACXUS_GPU_CLOCK_TRACE", "10");
    unsigned before = notes;
    CHECK(hook_GetClockCalibration(NULL, &gpu, &cpu) == E_NOTIMPL && notes == before);
    SetEnvironmentVariableA("MACXUS_GPU_CLOCK_TRACE", "1");
    memset(clock_reporting_calls, 0, sizeof(clock_reporting_calls));
    notes = 0;
    for (unsigned i = 0; i < 1024; i++) {
        SetLastError(4321);
        CHECK(hook_GetClockCalibration(NULL, &gpu, &cpu) == E_NOTIMPL);
        CHECK(GetLastError() == 4321 && gpu == 123 && cpu == 456);
    }
    CHECK(notes == 15 && strstr(last_note, "count=1024"));
    printf("CLOCK_REPORTING_OK checks=%u bounded_notes=%u\n", checks, notes);
    return 0;
}
