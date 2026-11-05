#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <stdio.h>
#include <unistd.h>
int main(int argc,const char **argv){@autoreleasepool{
 BOOL inside=argc>1&&!strcmp(argv[1],"--inside");
 id<MTLDevice>d=MTLCreateSystemDefaultDevice();id<MTL4CommandQueue>q=[d newMTL4CommandQueue];
 id<MTL4CommandAllocator>a=[d newCommandAllocator];id<MTL4CommandBuffer>cb=[d newCommandBuffer];
 MTL4CounterHeapDescriptor*hd=[MTL4CounterHeapDescriptor new];hd.type=MTL4CounterHeapTypeTimestamp;hd.count=4096;
 NSError*error=nil;id<MTL4CounterHeap>h=[d newCounterHeapWithDescriptor:hd error:&error];
 if(!h){printf("HEAP_FAIL code=%ld\n",(long)error.code);return 2;}
 id<MTLBuffer>src=[d newBufferWithLength:4<<20 options:MTLResourceStorageModeShared];
 id<MTLBuffer>dst=[d newBufferWithLength:4<<20 options:MTLResourceStorageModeShared];
 id<MTLBuffer>out=[d newBufferWithLength:256 options:MTLResourceStorageModeShared];
 memset(src.contents,0x5a,src.length);
 MTLResidencySetDescriptor*rd=[MTLResidencySetDescriptor new];id<MTLResidencySet>rs=[d newResidencySetWithDescriptor:rd error:&error];
 [rs addAllocation:src];[rs addAllocation:dst];[rs addAllocation:out];[rs commit];[q addResidencySet:rs];
 [cb beginCommandBufferWithAllocator:a];[cb writeTimestampIntoHeap:h atIndex:0];usleep(250000);
 id<MTL4ComputeCommandEncoder>e=[cb computeCommandEncoder];
 for(int i=0;i<8;i++)[e copyFromBuffer:src sourceOffset:0 toBuffer:dst destinationOffset:0 size:src.length];

 id<MTLFence>f=[d newFence];[e updateFence:f afterEncoderStages:MTLStageBlit|MTLStageDispatch|MTLStageAccelerationStructure];
 if(!inside){[e endEncoding];[cb writeTimestampIntoHeap:h atIndex:1];}
 [cb resolveCounterHeap:h withRange:NSMakeRange(0,2) intoBuffer:MTL4BufferRangeMake(out.gpuAddress,16) waitFence:f updateFence:nil];
 if(inside){[e endEncoding];[cb writeTimestampIntoHeap:h atIndex:1];}[cb endCommandBuffer];
 id<MTLSharedEvent>done=[d newSharedEvent];[q commit:&cb count:1];[q signalEvent:done value:1];
 if(![done waitUntilSignaledValue:1 timeoutMS:10000]){puts("TIMEOUT");return 3;}
 uint64_t*values=out.contents;NSData*n=[h resolveCounterRange:NSMakeRange(0,2)];uint64_t native[2]={0};if(n.length>=16)memcpy(native,n.bytes,16);
 printf("METAL4 frequency=%llu entry_size=%lu t0=%llu t1=%llu native0=%llu native1=%llu payload=%d inside=%d\n",[d queryTimestampFrequency],(unsigned long)[d sizeOfCounterHeapEntry:MTL4CounterHeapTypeTimestamp],values[0],values[1],native[0],native[1],((unsigned char*)dst.contents)[0]==0x5a,inside);
 return values[0]>0&&values[1]>values[0]&&values[1]-values[0]<100000000&&values[0]==native[0]&&values[1]==native[1]?0:4;
}}
