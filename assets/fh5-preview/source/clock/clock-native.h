#ifndef MACXUS_CLOCK_NATIVE_H
#define MACXUS_CLOCK_NATIVE_H
#import <Metal/Metal.h>
#include <mach/mach_time.h>
#include "clock-math.h"

static uint64_t mx_ns(uint64_t ticks, mach_timebase_info_data_t base)
{
    return (uint64_t)((__uint128_t)ticks * base.numer / base.denom);
}
static struct mx_clock_bracket mx_bracket(mach_timebase_info_data_t base)
{
    struct mx_clock_bracket b;
    b.absolute_before = mx_ns(mach_absolute_time(), base);
    b.continuous = mx_ns(mach_continuous_time(), base);
    b.absolute_after = mx_ns(mach_absolute_time(), base);
    return b;
}
static int32_t mx_sample_device(id<MTLDevice> device, struct mx_clock_sample *out)
{
    if (!out || out->version != MX_CLOCK_VERSION || out->size != sizeof(*out) ||
        !out->expected_frequency) return MX_STATUS_INVALID;
    if (!device || ![device respondsToSelector:@selector(queryTimestampFrequency)] ||
        [device queryTimestampFrequency] != out->expected_frequency) return MX_STATUS_UNSUPPORTED;
    mach_timebase_info_data_t base;
    if (mach_timebase_info(&base) != KERN_SUCCESS || !base.denom) return MX_STATUS_UNSUPPORTED;
    struct mx_clock_bracket before = mx_bracket(base);
    MTLTimestamp cpu = 0, gpu_sample = 0;
    [device sampleTimestamps:&cpu gpuTimestamp:&gpu_sample];
    struct mx_clock_bracket after = mx_bracket(base);
    return mx_map_clocks(out, before, after, cpu, gpu_sample);
}
#endif
