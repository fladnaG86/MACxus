#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "clock-math.h"
static uint64_t state = 12983765;
static uint64_t random_value(void) { state ^= state << 13; state ^= state >> 7; return state ^= state << 17; }
int main(void)
{
    struct mx_clock_sample initial = {1, sizeof(initial), 24000000, 11, 22, 33};
    unsigned checked = 0;
    for (unsigned i = 0; i < 100000; i++) {
        uint64_t absolute = 1000000000 + random_value() % 1000000000000;
        uint64_t offset = random_value() % 10000000000000;
        uint64_t width0 = random_value() % 50000, width1 = random_value() % 50000;
        uint64_t half0 = random_value() % (width0 + 1), half1 = random_value() % (width1 + 1);
        struct mx_clock_bracket a = {absolute - width0, absolute - width0 + half0 + offset, absolute};
        struct mx_clock_bracket b = {absolute + 1000, absolute + 1000 + half1 + offset, absolute + 1000 + width1};
        struct mx_clock_sample result = initial;
        assert(mx_map_clocks(&result, a, b, absolute + 500, 6000000000) == 0);
        assert(result.gpu_ticks == 144000000);
        uint64_t expected_ns = absolute + 500 + offset, actual_ns = result.qpc_ticks * 100;
        uint64_t error = expected_ns > actual_ns ? expected_ns - actual_ns : actual_ns - expected_ns;
        assert(error <= result.uncertainty_ns);
        /* Simulate sleep between the two offset brackets; reject, no writes. */
        b.continuous += 1000000000;
        result = initial;
        assert(mx_map_clocks(&result, a, b, absolute + 500, 6000000000) == MX_STATUS_RETRY);
        assert(!memcmp(&result, &initial, sizeof(result)));
        /* First sample wholly after resume uses the new offset, not stale state. */
        a.continuous += 1000000000;
        assert(mx_map_clocks(&result, a, b, absolute + 500, 6000000000) == 0);
        checked += 3;
    }
    struct mx_clock_bracket a = {1000, 1000, 1000}, b = {2000, 2000, 2000};
    struct mx_clock_sample result = initial;
    assert(mx_map_clocks(NULL, a, b, 1500, 1) == MX_STATUS_INVALID);
    result.expected_frequency = UINT64_MAX;
    struct mx_clock_sample overflow = result;
    assert(mx_map_clocks(&result, a, b, 1500, UINT64_MAX) == MX_STATUS_RETRY);
    assert(!memcmp(&result, &overflow, sizeof(result)));
    printf("CLOCK_MATH checks=%u sleep_jump_rejected=100000 resumed_offset_recomputed=100000\n", checked + 3);
    return 0;
}
