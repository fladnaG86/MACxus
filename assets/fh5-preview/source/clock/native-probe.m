#import <Foundation/Foundation.h>
#include <stdio.h>
#include "clock-native.h"
int main(void) { @autoreleasepool {
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    id<MTL4CommandQueue> queue = [device newMTL4CommandQueue];
    id<MTLSharedEvent> done = [device newSharedEvent];
    MTL4CounterHeapDescriptor *descriptor = [MTL4CounterHeapDescriptor new];
    descriptor.type = MTL4CounterHeapTypeTimestamp; descriptor.count = 1;
    id<MTL4CounterHeap> heap = [device newCounterHeapWithDescriptor:descriptor error:NULL];
    if (!device || !queue || !done || !heap) return 1;
    mach_timebase_info_data_t base; if (mach_timebase_info(&base)) return 2;
    uint64_t frequency = [device queryTimestampFrequency];
    for (unsigned i = 0; i < 64; i++) {
        id<MTL4CommandAllocator> allocator = [device newCommandAllocator];
        id<MTL4CommandBuffer> command = [device newCommandBuffer];
        if (!allocator || !command) return 3;
        [command beginCommandBufferWithAllocator:allocator];
        [command writeTimestampIntoHeap:heap atIndex:0];
        [command endCommandBuffer];
        struct mx_clock_sample before = {1, sizeof(before), frequency, 0, 0, 0}, after = before;
        uint64_t c0 = mx_ns(mach_continuous_time(), base) / 100;
        if (mx_sample_device(device, &before)) return 4;
        uint64_t c1 = mx_ns(mach_continuous_time(), base) / 100;
        if (before.qpc_ticks < c0 || before.qpc_ticks > c1) return 5;
        [queue commit:&command count:1]; [queue signalEvent:done value:i + 1];
        if (![done waitUntilSignaledValue:i + 1 timeoutMS:10000]) return 6;
        if (mx_sample_device(device, &after)) return 7;
        NSData *data = [heap resolveCounterRange:NSMakeRange(0, 1)];
        uint64_t ticks = 0; if (data.length != 8) return 8; memcpy(&ticks, data.bytes, 8);
        if (before.gpu_ticks > ticks || ticks > after.gpu_ticks) return 9;
    }
    printf("NATIVE_CALIBRATION samples=64 real_query_brackets=64 frequency=%llu\n", (unsigned long long)frequency);
    return 0;
} }
