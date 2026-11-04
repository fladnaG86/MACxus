#ifndef MACXUS_CLOCK_ABI_H
#define MACXUS_CLOCK_ABI_H
#include <stdint.h>

/* Only fixed-width values cross Wine's PE/Unix boundary. No retained pointers. */
struct mx_clock_sample {
    uint32_t version, size;
    uint64_t expected_frequency;
    uint64_t gpu_ticks, qpc_ticks, uncertainty_ns;
};
#define MX_CLOCK_VERSION 1
#define MX_STATUS_SUCCESS ((int32_t)0)
#define MX_STATUS_INVALID ((int32_t)0xc000000d)
#define MX_STATUS_UNSUPPORTED ((int32_t)0xc00000bb)
#define MX_STATUS_RETRY ((int32_t)0xc000022d)
_Static_assert(sizeof(struct mx_clock_sample) == 40, "Clock ABI size");
#endif
