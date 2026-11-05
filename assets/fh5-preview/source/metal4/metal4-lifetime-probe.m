#import <Foundation/Foundation.h>
#ifndef BRIDGE_SOURCE
#define BRIDGE_SOURCE "metal4-query-bridge.m"
#endif
#include BRIDGE_SOURCE
static unsigned destroyed;
@interface Sentinel:NSObject @end
@implementation Sentinel
-(void)dealloc{destroyed++;}
@end
@interface FakeEncoder:NSObject
-(void)setComputePipelineState:(id)p;
-(void)setArgumentTable:(id)p;
-(MTLStages)stages;
-(void)barrierAfterQueueStages:(MTLStages)a beforeStages:(MTLStages)b visibilityOptions:(MTL4VisibilityOptions)c;
-(void)barrierAfterStages:(MTLStages)a beforeQueueStages:(MTLStages)b visibilityOptions:(MTL4VisibilityOptions)c;
-(void)endEncoding;
@end
@implementation FakeEncoder
-(void)setComputePipelineState:(id)p{(void)p;}
-(void)setArgumentTable:(id)p{(void)p;}
-(MTLStages)stages{return MTLStageDispatch;}
-(void)barrierAfterQueueStages:(MTLStages)a beforeStages:(MTLStages)b visibilityOptions:(MTL4VisibilityOptions)c{(void)a;(void)b;(void)c;}
-(void)barrierAfterStages:(MTLStages)a beforeQueueStages:(MTLStages)b visibilityOptions:(MTL4VisibilityOptions)c{(void)a;(void)b;(void)c;}
-(void)endEncoding{}
@end
int main(void){@autoreleasepool{
 for(unsigned iteration=0;iteration<10000;iteration++){
 MX4Compute*p=[MX4Compute alloc];p.underlying=(id)[FakeEncoder new];
 #ifdef TEST_OLD_BRIDGE
 p.state=[NSMutableDictionary new];p.stateOrder=[NSMutableArray new];
#endif
 p.groups=[NSMutableArray new];
 __weak id a,b;
 {Sentinel*x=[Sentinel new];Sentinel*y=[Sentinel new];a=x;b=y;[(id)p setComputePipelineState:(id<MTLComputePipelineState>)x];[(id)p setArgumentTable:(id<MTL4ArgumentTable>)y];}
 if(!a||!b){puts("LIFETIME_FAIL premature_release");return 2;}
 [p endEncoding];
 if(a||b){printf("LIFETIME_FAIL iteration=%u destroyed=%u\n",iteration,destroyed);return 3;}
 }
 printf("LIFETIME_OK released=%u before_outer_pool_drain=1\n",destroyed);return destroyed==20000?0:4;
}}
