#ifndef MACXUS_FH5_HEAP_IMPORT_TRACE_H
#define MACXUS_FH5_HEAP_IMPORT_TRACE_H
/* Read-only opt-in diagnostic. No new capability, allocations, fallback or
 * success is supplied. Allocation counts are context, not proof of fallback. */
static BOOL fh5_heap_trace;
static LONG fh5_heap_calls[6];
static void fh5_heap_note(unsigned op, HRESULT result, UINT64 size, UINT64 alignment,
                          unsigned flags, BOOL output_supplied, UINT64 caller)
{
    if (!fh5_heap_trace) return;
    DWORD saved = GetLastError();
    DWORD count = (DWORD)InterlockedIncrement(&fh5_heap_calls[op]);
    if (count <= 64 || !(count & (count - 1)))
        observer_note(34, caller, "heap_operation=%u count=%lu hr=%08lx size=%llu alignment=%llu flags=%u output_supplied=%u imports=%ld",
            op, (unsigned long)count, (unsigned long)result, (unsigned long long)size,
            (unsigned long long)alignment, flags, output_supplied,
            (long)InterlockedCompareExchange(&fh5_heap_calls[0], 0, 0));
    SetLastError(saved);
}
static HRESULT (STDMETHODCALLTYPE *fh5_real_OpenExistingHeapFromAddress)(ID3D12Device3 *, const void *, REFIID, void **);
static HRESULT STDMETHODCALLTYPE fh5_OpenExistingHeapFromAddress(ID3D12Device3 *device, const void *address, REFIID iid, void **out)
{
    HRESULT result = fh5_real_OpenExistingHeapFromAddress(device, address, iid, out);
    // API has no size argument. Report only alignment, never an address or data.
    fh5_heap_note(0, result, 0, address && !((uintptr_t)address & 65535) ? 65536 : address && !((uintptr_t)address & 4095) ? 4096 : 0,
                  0, out != NULL, OBS_CALLER);
    return result;
}
#endif
