#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <stdio.h>
#include <dlfcn.h>
#include <stdlib.h>
int main(void){@autoreleasepool{
 id<MTLDevice>d=MTLCreateSystemDefaultDevice();NSError*error=nil;
 id<MTL4CommandQueue>q=[d newMTL4CommandQueue];id<MTL4CommandAllocator>a=[d newCommandAllocator];id<MTL4CommandBuffer>cb=[d newCommandBuffer];
 NSString*source=@"#include <metal_stdlib>\nusing namespace metal; kernel void add(device uint *v [[buffer(0)]], threadgroup uint *scratch [[threadgroup(0)]]) {scratch[0]=v[0]+1;v[0]=scratch[0];}";
 id<MTLLibrary>library=[d newLibraryWithSource:source options:nil error:&error];if(!library){printf("LIB_FAIL %ld\n",(long)error.code);return 2;}
 MTL4LibraryFunctionDescriptor*fn=[MTL4LibraryFunctionDescriptor new];fn.library=library;fn.name=@"add";
 MTL4ComputePipelineDescriptor*pd=[MTL4ComputePipelineDescriptor new];pd.computeFunctionDescriptor=fn;
 id<MTL4Compiler>compiler=[d newCompilerWithDescriptor:[MTL4CompilerDescriptor new] error:&error];
 id<MTLComputePipelineState>pipeline=[compiler newComputePipelineStateWithDescriptor:pd compilerTaskOptions:nil error:&error];if(!pipeline){printf("PIPE_FAIL %ld\n",(long)error.code);return 2;}
 id<MTLBuffer>value=[d newBufferWithLength:256 options:MTLResourceStorageModeShared];*((uint32_t*)value.contents)=11;
 id<MTLBuffer>marker=[d newBufferWithLength:256 options:MTLResourceStorageModeShared];id<MTLBuffer>target=[d newBufferWithLength:256 options:MTLResourceStorageModeShared];
 uint64_t key=strtoull(getenv("MACXUS_GPU_QUERY_COOKIE"),NULL,16)&0xffffffff00000000ULL;uint64_t*m=marker.contents;m[0]=key;m[1]=key|2;m[2]=key|1;m[3]=key|3;
 MTL4ArgumentTableDescriptor*ad=[MTL4ArgumentTableDescriptor new];ad.maxBufferBindCount=1;id<MTL4ArgumentTable>table=[d newArgumentTableWithDescriptor:ad error:&error];[table setAddress:value.gpuAddress atIndex:0];
 id<MTLResidencySet>rs=[d newResidencySetWithDescriptor:[MTLResidencySetDescriptor new] error:&error];[rs addAllocation:value];[rs addAllocation:marker];[rs addAllocation:target];[rs commit];[q addResidencySet:rs];
 uint64_t(*native)(uint64_t)=dlsym(RTLD_DEFAULT,"macxus_metal4_probe_counter");if(!native)return 4;
 id<MTLSharedEvent>done=[d newSharedEvent];uint64_t previous=0;
 for(unsigned pass=0;pass<2;pass++){
  if(pass)[a reset];
 [cb beginCommandBufferWithAllocator:a];id<MTL4ComputeCommandEncoder>e=[cb computeCommandEncoder];[e setComputePipelineState:pipeline];[e setArgumentTable:table];[e setThreadgroupMemoryLength:16 atIndex:0];[e pushDebugGroup:@"preserved across query boundaries"];
 [e copyFromBuffer:marker sourceOffset:0 toBuffer:target destinationOffset:32 size:8];
 [e dispatchThreads:MTLSizeMake(1,1,1) threadsPerThreadgroup:MTLSizeMake(1,1,1)];
 [e copyFromBuffer:marker sourceOffset:8 toBuffer:target destinationOffset:40 size:8];
 [e dispatchThreads:MTLSizeMake(1,1,1) threadsPerThreadgroup:MTLSizeMake(1,1,1)];
 [e copyFromBuffer:marker sourceOffset:16 toBuffer:target destinationOffset:0 size:8];
 [e copyFromBuffer:marker sourceOffset:24 toBuffer:target destinationOffset:8 size:8];
 [e dispatchThreads:MTLSizeMake(1,1,1) threadsPerThreadgroup:MTLSizeMake(1,1,1)];
 [e popDebugGroup];[e endEncoding];[cb endCommandBuffer];

  [q commit:&cb count:1];[q signalEvent:done value:pass+1];if(![done waitUntilSignaledValue:pass+1 timeoutMS:10000])return 3;
  uint64_t*t=target.contents;uint64_t n0=native(key),n1=native(key|2);uint32_t actual=*((uint32_t*)value.contents);
  printf("STATE pass=%u value=%u t0=%llu t1=%llu native0=%llu native1=%llu\n",pass,actual,t[0],t[1],n0,n1);
  if(actual!=14+3*pass||t[0]<=previous||t[1]<=t[0]||t[0]!=n0||t[1]!=n1)return 5;previous=t[1];
 }
 puts("STATE_OK pipeline_argument_table_threadgroup_debug_and_rerecord=1");return 0;
}}
