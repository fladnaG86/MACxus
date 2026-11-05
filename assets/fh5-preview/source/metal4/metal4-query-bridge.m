#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <objc/runtime.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <limits.h>

static id<MTLDevice> gpu;
static id<MTL4CounterHeap> counters;
static NSMutableDictionary<NSNumber*,NSNumber*> *slots;
static IMP originalCompute;
static uint64_t cookie;
static FILE *output;
static size_t traceBytes;
static BOOL capped;
static pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;
enum { SLOT_LIMIT=4096 };
static const MTLStages computeStages=MTLStageDispatch|MTLStageBlit|MTLStageAccelerationStructure;
static void trace(const char *event,uint64_t a,uint64_t b){
 pthread_mutex_lock(&lock);
 if(output){
  BOOL routine=!strcmp(event,"gpu4_write")||!strcmp(event,"gpu4_resolve");
  if(traceBytes<8*1024*1024||!routine){int n=fprintf(output,"{\"event\":\"%s\",\"a\":%llu,\"b\":%llu}\n",event,(unsigned long long)a,(unsigned long long)b);if(n>0)traceBytes+=(size_t)n;fflush(output);}
  else if(!capped){capped=YES;fputs("{\"event\":\"trace_capped\",\"a\":0,\"b\":0}\n",output);fflush(output);}
 }
 pthread_mutex_unlock(&lock);
}
static void fatal(const char *event,uint64_t a,uint64_t b){trace(event,a,b);_Exit(78);}
// CPU translation may encode a resolve before its producer. Slots represent
// query identities; producer-before-consumer ordering is enforced on the GPU.
static NSUInteger slotFor(uint64_t key,BOOL create){
 @synchronized(slots){NSNumber *n=slots[@(key)];if(n)return n.unsignedIntegerValue;
  if(!create)fatal("missing_query",key,0);
  if(slots.count>=SLOT_LIMIT)fatal("query_capacity_exceeded",slots.count,key);
  NSUInteger index=slots.count;slots[@(key)]=@(index);return index;
 }
}
@interface MX4Compute : NSProxy {
 NSUInteger threadgroupLengths[32];
 BOOL threadgroupSet[32];
}
@property(nonatomic,strong) id<MTL4ComputeCommandEncoder> underlying;
@property(nonatomic,strong) id<MTL4CommandBuffer> command;
@property(nonatomic,strong) id<MTLComputePipelineState> savedPipeline;
@property(nonatomic,strong) id<MTL4ArgumentTable> savedTable;
@property(nonatomic,copy) NSString *savedLabel;
@property(nonatomic) BOOL tableSet,imageblockSet;
@property(nonatomic) NSUInteger imageWidth,imageHeight;
@property(nonatomic,strong) NSMutableArray<NSString*> *groups;
@property(nonatomic,strong) id<MTLFence> sourceFence;
@property(nonatomic,strong) id<MTLFence> readyFence;
@property(nonatomic) MTLStages previousStages;
@property(nonatomic) BOOL ended;
-(void)closeWithFence:(BOOL)fence;
-(void)restartWaiting:(BOOL)wait;
@end
@implementation MX4Compute
-(NSMethodSignature*)methodSignatureForSelector:(SEL)s{return [(NSObject*)self.underlying methodSignatureForSelector:s];}
-(BOOL)respondsToSelector:(SEL)s{return class_getInstanceMethod([MX4Compute class],s)!=NULL||[(NSObject*)self.underlying respondsToSelector:s];}
-(BOOL)conformsToProtocol:(Protocol*)p{return [(NSObject*)self.underlying conformsToProtocol:p];}
-(id<MTL4CommandBuffer>)commandBuffer{return self.command;}
-(MTLStages)stages{return self.previousStages|self.underlying.stages;}
-(void)forwardInvocation:(NSInvocation*)inv{
 if([NSStringFromSelector(inv.selector) hasPrefix:@"set"])fatal("unsupported_encoder_state",0,0);
 [inv invokeWithTarget:self.underlying];inv.target=nil;
}
// Retain current object state directly. NSInvocation retainArguments can keep
// obsolete pipelines alive until a caller's outer autorelease pool drains.
-(void)setComputePipelineState:(id<MTLComputePipelineState>)p{self.savedPipeline=p;[self.underlying setComputePipelineState:p];}
-(void)setArgumentTable:(id<MTL4ArgumentTable>)t{self.savedTable=t;self.tableSet=YES;[self.underlying setArgumentTable:t];}
-(void)setThreadgroupMemoryLength:(NSUInteger)length atIndex:(NSUInteger)index{
 if(index>=32)fatal("unsupported_threadgroup_index",index,0);
 threadgroupLengths[index]=length;threadgroupSet[index]=YES;[self.underlying setThreadgroupMemoryLength:length atIndex:index];
}
-(void)setImageblockWidth:(NSUInteger)width height:(NSUInteger)height{
 self.imageblockSet=YES;self.imageWidth=width;self.imageHeight=height;[self.underlying setImageblockWidth:width height:height];
}
-(void)setLabel:(NSString*)label{self.savedLabel=label;self.underlying.label=label;}
-(NSString*)label{return self.underlying.label;}
-(void)pushDebugGroup:(NSString*)s{if(self.groups.count>=64)fatal("debug_group_capacity",64,0);[self.groups addObject:s];[self.underlying pushDebugGroup:s];}
-(void)popDebugGroup{if(!self.groups.count)fatal("debug_group_underflow",0,0);[self.groups removeLastObject];[self.underlying popDebugGroup];}
-(void)closeWithFence:(BOOL)fence{
 self.previousStages|=self.underlying.stages;
 [self.underlying barrierAfterQueueStages:MTLStageAll beforeStages:computeStages visibilityOptions:MTL4VisibilityOptionDevice];
 [self.underlying barrierAfterStages:computeStages beforeQueueStages:MTLStageAll visibilityOptions:MTL4VisibilityOptionDevice];
 if(fence)[self.underlying updateFence:self.sourceFence afterEncoderStages:computeStages];
 for(NSUInteger i=0;i<self.groups.count;i++)[self.underlying popDebugGroup];
 [self.underlying endEncoding];
}
-(void)restartWaiting:(BOOL)wait{
 self.underlying=((id(*)(id,SEL))originalCompute)(self.command,@selector(computeCommandEncoder));
 if(!self.underlying)fatal("encoder_allocation_failed",0,0);
 if(wait)[self.underlying waitForFence:self.readyFence beforeEncoderStages:computeStages];
 if(self.savedPipeline)[self.underlying setComputePipelineState:self.savedPipeline];
 if(self.tableSet)[self.underlying setArgumentTable:self.savedTable];
 for(NSUInteger i=0;i<32;i++)if(threadgroupSet[i])[self.underlying setThreadgroupMemoryLength:threadgroupLengths[i] atIndex:i];
 if(self.imageblockSet)[self.underlying setImageblockWidth:self.imageWidth height:self.imageHeight];
 self.underlying.label=self.savedLabel;
 for(NSString *group in self.groups)[self.underlying pushDebugGroup:group];
}
-(void)copyFromBuffer:(id<MTLBuffer>)source sourceOffset:(NSUInteger)so toBuffer:(id<MTLBuffer>)destination destinationOffset:(NSUInteger)offset size:(NSUInteger)size{
 uint64_t marker=0;
 if(size==8&&source.storageMode==MTLStorageModeShared&&source.contents&&so<=source.length&&source.length-so>=8)memcpy(&marker,(char*)source.contents+so,8);
 if((marker&0xffffffff00000000ULL)!=(cookie&0xffffffff00000000ULL)){
  [self.underlying copyFromBuffer:source sourceOffset:so toBuffer:destination destinationOffset:offset size:size];return;
 }
 self.previousStages|=MTLStageBlit;
 uint64_t key=marker&~1ULL;BOOL resolve=marker&1;NSUInteger index=slotFor(key,YES);
 [self closeWithFence:resolve];
 if(!resolve){[self.command writeTimestampIntoHeap:counters atIndex:index];trace("gpu4_write",key,index);}
 else{
  if(offset>destination.length||destination.length-offset<8)fatal("resolve_bounds",offset,destination.length);
  [self.command resolveCounterHeap:counters withRange:NSMakeRange(index,1) intoBuffer:MTL4BufferRangeMake(destination.gpuAddress+offset,8) waitFence:self.sourceFence updateFence:self.readyFence];
  trace("gpu4_resolve",key,offset);
 }
 [self restartWaiting:resolve];
}
-(void)endEncoding{if(!self.ended){[self closeWithFence:NO];self.ended=YES;self.savedPipeline=nil;self.savedTable=nil;self.savedLabel=nil;[self.groups removeAllObjects];}}
@end
static id compute(id<MTL4CommandBuffer>cb,SEL sel){
 MX4Compute *p=[MX4Compute alloc];p.command=cb;p.groups=[NSMutableArray new];
 p.underlying=((id(*)(id,SEL))originalCompute)(cb,sel);p.sourceFence=[gpu newFence];p.readyFence=[gpu newFence];
 if(!p.underlying||!p.sourceFence||!p.readyFence)fatal("encoder_allocation_failed",0,0);return p;
}
static IMP replace(Class cls,SEL selector,IMP hook){Method m=class_getInstanceMethod(cls,selector);if(!m)return NULL;IMP old=method_getImplementation(m);if(!class_addMethod(cls,selector,hook,method_getTypeEncoding(m)))class_replaceMethod(cls,selector,hook,method_getTypeEncoding(m));return old;}
__attribute__((constructor))static void initialize(void){@autoreleasepool{
 const char*path=getenv("MACXUS_GPU_BRIDGE_LOG"),*token=getenv("MACXUS_GPU_QUERY_COOKIE");if(!path||!token)return;
 cookie=strtoull(token,NULL,16);char pp[PATH_MAX];const char*per=getenv("MACXUS_GPU_BRIDGE_PER_PROCESS");if(per&&!strcmp(per,"1")){int n=snprintf(pp,sizeof pp,"%s.%d.jsonl",path,getpid());if(n<0||(size_t)n>=sizeof pp)_Exit(78);path=pp;}
 output=fopen(path,"w");if(!output)_Exit(78);
 if(!(cookie&0xffffffff00000000ULL))fatal("invalid_cookie",0,0);
 const char*mode=getenv("D3DM_MTL4");if(mode&&!strcmp(mode,"0"))fatal("metal4_required",0,0);
 gpu=MTLCreateSystemDefaultDevice();if(![gpu respondsToSelector:@selector(newCommandBuffer)])fatal("metal4_unsupported",0,0);
 MTL4CounterHeapDescriptor*d=[MTL4CounterHeapDescriptor new];d.type=MTL4CounterHeapTypeTimestamp;d.count=SLOT_LIMIT;NSError*error=nil;counters=[gpu newCounterHeapWithDescriptor:d error:&error];if(!counters)fatal("counter_heap_allocation_failed",error.code,0);
 [counters invalidateCounterRange:NSMakeRange(0,SLOT_LIMIT)];
 if([gpu sizeOfCounterHeapEntry:MTL4CounterHeapTypeTimestamp]!=8)fatal("counter_entry_size",0,0);
 uint64_t frequency=[gpu queryTimestampFrequency];if(!frequency)fatal("counter_frequency",0,0);char f[32];snprintf(f,sizeof f,"%llu",(unsigned long long)frequency);setenv("MACXUS_GPU_TIMESTAMP_FREQUENCY",f,1);
 slots=[NSMutableDictionary new];id<MTL4CommandBuffer>cb=[gpu newCommandBuffer];originalCompute=replace(object_getClass(cb),@selector(computeCommandEncoder),(IMP)compute);if(!originalCompute)fatal("metal4_hook_failed",0,0);
 trace("metal4_installed",frequency,SLOT_LIMIT);
}}

// Probe-only readout: callers must first establish GPU completion.
uint64_t macxus_metal4_probe_counter(uint64_t key){
 NSUInteger index=slotFor(key,NO);NSData*data=[counters resolveCounterRange:NSMakeRange(index,1)];
 uint64_t value=0;if(data.length>=8)memcpy(&value,data.bytes,8);return value;
}

#include "../clock/clock-native.h"
int32_t macxus_metal4_calibrate_v1(struct mx_clock_sample *p) { return mx_sample_device(gpu,p); }
