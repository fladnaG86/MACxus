/* Synthetic, account-free tests of the production add-on adapter and real async ABI. */
#define main inherited_store_probe_main
#include "../../../../scripts/runtime-tests/store-entitlements-probe.c"
#undef main
#include "addon-tests.inc"
int main(void)
{
    setvbuf(stdout, NULL, _IONBF, 0);
    int original = inherited_store_probe_main();
    HRESULT hr = RoInitialize(RO_INIT_MULTITHREADED);
    bridge_started = CreateEventW(NULL, TRUE, FALSE, NULL);
    bridge_gate = CreateEventW(NULL, TRUE, FALSE, NULL);
    addon_data_tests(); addon_async_tests();
    IXStoreImpl6 *api = NULL;
    CHECK("addon-runtime-interface", runtime_query(&CLSID_XStoreImpl, &IID_IXStoreImpl6, (void **)&api) == S_OK && api);
    if (api) {
        CHECK("addon-runtime-null-async", IXStoreImpl6_XStoreQueryAddOnLicensesAsync(api, NULL, NULL) == E_INVALIDARG);
        IXStoreImpl6_Release(api);
    }
    CloseHandle(bridge_started); CloseHandle(bridge_gate);
    if (SUCCEEDED(hr)) RoUninitialize();
    printf("FH5 ADDON CHECKS %u FAILURES %u\n", checks, failures);
    return original || failures ? 1 : 0;
}
