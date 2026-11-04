#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <stdio.h>
#include <stdlib.h>
#include <dlfcn.h>
int main(void){@autoreleasepool{
 id<MTLDevice>d=MTLCreateSystemDefaultDevice();id<MTL4CommandQueue>q=[d newMTL4CommandQueue];NSError*error=nil;
 id<MTLBuffer>marker=[d newBufferWithLength:256 options:MTLResourceStorageModeShared];
 id<MTLBuffer>result=[d newBufferWithLength:256 options:MTLResourceStorageModeShared];
 id<MTLBuffer>src=[d newBufferWithLength:4<<20 options:MTLResourceStorageModeShared];
 id<MTLBuffer>dst=[d newBufferWithLength:4<<20 options:MTLResourceStorageModeShared];memset(src.contents,0x5a,src.length);
 uint64_t key=strtoull(getenv("MACXUS_GPU_QUERY_COOKIE"),NULL,16)&0xffffffff00000000ULL;
 uint64_t*m=marker.contents;m[0]=key;m[1]=key|2;m[2]=key|1;m[3]=key|3;m[4]=key|5;
 MTLResidencySetDescriptor*rd=[MTLResidencySetDescriptor new];id<MTLResidencySet>rs=[d newResidencySetWithDescriptor:rd error:&error];
 [rs addAllocation:marker];[rs addAllocation:result];[rs addAllocation:src];[rs addAllocation:dst];[rs commit];[q addResidencySet:rs];
 id<MTL4CommandAllocator>ca=[d newCommandAllocator],pa=[d newCommandAllocator];
 id<MTL4CommandBuffer>consumer=[d newCommandBuffer],producer=[d newCommandBuffer];
 // Host encoding order differs from valid GPU submission order.
 [consumer beginCommandBufferWithAllocator:ca];id<MTL4ComputeCommandEncoder>c=[consumer computeCommandEncoder];
 for(NSUInteger i=0;i<3;i++)[c copyFromBuffer:marker sourceOffset:16+i*8 toBuffer:result destinationOffset:i*8 size:8];
 [c endEncoding];[consumer endCommandBuffer];
 [producer beginCommandBufferWithAllocator:pa];id<MTL4ComputeCommandEncoder>p=[producer computeCommandEncoder];
 [p copyFromBuffer:marker sourceOffset:0 toBuffer:result destinationOffset:32 size:8];
 [p copyFromBuffer:src sourceOffset:0 toBuffer:dst destinationOffset:0 size:src.length];
 [p copyFromBuffer:marker sourceOffset:8 toBuffer:result destinationOffset:40 size:8];
 [p endEncoding];[producer endCommandBuffer];
 id<MTL4CommandBuffer>batch[]={producer,consumer};[q commit:batch count:2];id<MTLSharedEvent>done=[d newSharedEvent];[q signalEvent:done value:1];if(![done waitUntilSignaledValue:1 timeoutMS:10000])return 2;
 uint64_t(*native)(uint64_t)=dlsym(RTLD_DEFAULT,"macxus_metal4_probe_counter");if(!native)return 3;
 uint64_t*t=result.contents,n0=native(key),n1=native(key|2);
 printf("ORDER t0=%llu t1=%llu native0=%llu native1=%llu unwritten=%llu\n",t[0],t[1],n0,n1,t[2]);
 if(!t[0]||t[1]<=t[0]||t[0]!=n0||t[1]!=n1||t[2]||((unsigned char*)dst.contents)[0]!=0x5a)return 4;
 puts("ORDER_OK consumer_encoded_first=1 producer_submitted_first=1 native_unwritten_zero=1");return 0;
}}
