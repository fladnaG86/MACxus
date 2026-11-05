#ifndef MACXUS_CLOCK_MATH_H
#define MACXUS_CLOCK_MATH_H
#include "clock-abi.h"

struct mx_clock_bracket { uint64_t absolute_before, continuous, absolute_after; };

/* Metal CPU samples use absolute nanoseconds; this Preview's QPC is continuous
 * nanoseconds / 100. Intersect two offset intervals on every call, rather than
 * retaining an offset that becomes stale across sleep. Fail on an offset jump.
 * Resolved Metal 4 GPU counters use frequency ticks, sampled GPU time uses ns. */
static int32_t mx_map_clocks(struct mx_clock_sample *out,
                            struct mx_clock_bracket before,
                            struct mx_clock_bracket after,
                            uint64_t cpu_ns, uint64_t gpu_ns)
{
    if (!out || out->version != MX_CLOCK_VERSION || out->size != sizeof(*out) ||
        !out->expected_frequency) return MX_STATUS_INVALID;
    if (before.absolute_before > before.absolute_after ||
        after.absolute_before > after.absolute_after ||
        before.absolute_after > cpu_ns || cpu_ns > after.absolute_before ||
        before.continuous > after.continuous || !gpu_ns) return MX_STATUS_RETRY;
    __int128 lower0 = (__int128)before.continuous - before.absolute_after;
    __int128 upper0 = (__int128)before.continuous - before.absolute_before;
    __int128 lower1 = (__int128)after.continuous - after.absolute_after;
    __int128 upper1 = (__int128)after.continuous - after.absolute_before;
    __int128 lower = lower0 > lower1 ? lower0 : lower1;
    __int128 upper = upper0 < upper1 ? upper0 : upper1;
    if (lower > upper) return MX_STATUS_RETRY;
    /* Refuse wide preemption/error intervals instead of advertising weak pairs. */
    if (upper - lower > 100000) return MX_STATUS_RETRY;
    __int128 continuous = (__int128)cpu_ns + lower + (upper - lower) / 2;
    if (continuous < before.continuous || continuous > after.continuous ||
        continuous < 0 || continuous > UINT64_MAX) return MX_STATUS_RETRY;
    __uint128_t ticks = (__uint128_t)gpu_ns * out->expected_frequency / 1000000000;
    if (!ticks || ticks > UINT64_MAX) return MX_STATUS_RETRY;
    struct mx_clock_sample result = *out;
    result.gpu_ticks = (uint64_t)ticks;
    result.qpc_ticks = (uint64_t)continuous / 100;
    result.uncertainty_ns = (uint64_t)(upper - lower) + 100;
    *out = result;
    return MX_STATUS_SUCCESS;
}
#endif
