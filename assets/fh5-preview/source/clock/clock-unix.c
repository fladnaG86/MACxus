#include <dlfcn.h>
#include "clock-abi.h"

static int32_t sample_clock(void *opaque)
{
    struct mx_clock_sample *p = opaque;
    if (!p || p->version != MX_CLOCK_VERSION || p->size != sizeof(*p)) return MX_STATUS_INVALID;
    /* Use the device held by the injected, fingerprinted Metal 4 query bridge.
     * No other device, CPU-only fallback, environment pointer or IPC channel. */
    int32_t (*sample)(struct mx_clock_sample *) = dlsym(RTLD_DEFAULT, "macxus_metal4_calibrate_v1");
    return sample ? sample(p) : MX_STATUS_UNSUPPORTED;
}
int32_t (*const __wine_unix_call_funcs[])(void *) = { sample_clock };
