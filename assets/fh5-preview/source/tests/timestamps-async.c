/* Account-free D3D12 acceptance for GPU query submission, reset and queue waits. */
#define main basic_timestamp_main
#include "timestamps.c"
#undef main

int main(int argc,char **argv)
{
    if(argc<2||argc>3)return 2;
    BOOL soak=argc==3&&!strcmp(argv[2],"--soak");
    unsigned iterations=soak?6000:32;
    if(basic_timestamp_main(2,argv))return 2;
    HMODULE module=LoadLibraryA(argv[1]);
    typedef HRESULT (WINAPI *create_fn)(IUnknown*,D3D_FEATURE_LEVEL,REFIID,void**);
    create_fn create=(create_fn)(void*)GetProcAddress(module,"D3D12CreateDevice");
    CHECK(create(NULL,D3D_FEATURE_LEVEL_11_0,&IID_ID3D12Device,(void**)&device));
    D3D12_COMMAND_QUEUE_DESC qd={.Type=D3D12_COMMAND_LIST_TYPE_DIRECT};
    ID3D12CommandQueue *other=NULL;
    CHECK(ID3D12Device_CreateCommandQueue(device,&qd,&IID_ID3D12CommandQueue,(void**)&queue));
    CHECK(ID3D12Device_CreateCommandQueue(device,&qd,&IID_ID3D12CommandQueue,(void**)&other));
    CHECK(ID3D12Device_CreateFence(device,0,D3D12_FENCE_FLAG_NONE,&IID_ID3D12Fence,(void**)&done));
    serial=0;
    ID3D12Fence *gate=NULL;
    CHECK(ID3D12Device_CreateFence(device,0,D3D12_FENCE_FLAG_NONE,&IID_ID3D12Fence,(void**)&gate));
    ID3D12CommandAllocator *alloc=NULL;
    ID3D12GraphicsCommandList *list=NULL;
    CHECK(ID3D12Device_CreateCommandAllocator(device,D3D12_COMMAND_LIST_TYPE_DIRECT,&IID_ID3D12CommandAllocator,(void**)&alloc));
    CHECK(ID3D12Device_CreateCommandList(device,0,D3D12_COMMAND_LIST_TYPE_DIRECT,alloc,NULL,&IID_ID3D12GraphicsCommandList,(void**)&list));
    ID3D12QueryHeap *heap=NULL;
    D3D12_QUERY_HEAP_DESC hd={.Type=D3D12_QUERY_HEAP_TYPE_TIMESTAMP,.Count=2};
    CHECK(ID3D12Device_CreateQueryHeap(device,&hd,&IID_ID3D12QueryHeap,(void**)&heap));
    ID3D12Resource *dst=readback(32);
    if(!dst)return 2;
    UINT64 previous=0;
    for(unsigned iteration=0;iteration<iterations;iteration++){
        if(iteration){
            CHECK(ID3D12CommandAllocator_Reset(alloc));
            CHECK(ID3D12GraphicsCommandList_Reset(list,alloc,NULL));
        }
        ID3D12GraphicsCommandList_EndQuery(list,heap,D3D12_QUERY_TYPE_TIMESTAMP,0);
        if(!soak)Sleep(10); /* Recording time must not appear in GPU duration. */
        ID3D12GraphicsCommandList_EndQuery(list,heap,D3D12_QUERY_TYPE_TIMESTAMP,1);
        ID3D12GraphicsCommandList_ResolveQueryData(list,heap,D3D12_QUERY_TYPE_TIMESTAMP,0,2,dst,0);
        ID3D12GraphicsCommandList_ResolveQueryData(list,heap,D3D12_QUERY_TYPE_TIMESTAMP,0,2,dst,16);
        CHECK(ID3D12GraphicsCommandList_Close(list));
        CHECK(ID3D12CommandQueue_Wait(queue,gate,iteration+1));
        ID3D12CommandList *lists[]={(ID3D12CommandList*)list};
        ID3D12CommandQueue_ExecuteCommandLists(queue,1,lists);
        /* This signal is submitted only after Execute returns. A CPU wait
         * inside query resolution would prevent the dependency being supplied. */
        CHECK(ID3D12CommandQueue_Signal(other,gate,iteration+1));
        if(wait_done())return 2;
        void *data=NULL;D3D12_RANGE range={0,32};UINT64 values[4];
        CHECK(ID3D12Resource_Map(dst,0,&range,&data));
        memcpy(values,data,32);ID3D12Resource_Unmap(dst,0,NULL);
        if(!values[0]||values[1]<=values[0]||values[0]<=previous||
           values[0]!=values[2]||values[1]!=values[3]){
            printf("ASYNC_FAIL iteration=%u t0=%llu t1=%llu repeat0=%llu repeat1=%llu previous=%llu\n",
                   iteration,values[0],values[1],values[2],values[3],previous);return 3;
        }
        previous=values[1];
        printf("ASYNC iteration=%u t0=%llu t1=%llu repeated_resolve_equal=1\n",iteration,values[0],values[1]);
    }
    ID3D12Resource_Release(dst);ID3D12QueryHeap_Release(heap);
    ID3D12GraphicsCommandList_Release(list);ID3D12CommandAllocator_Release(alloc);
    ID3D12Fence_Release(gate);ID3D12Fence_Release(done);
    ID3D12CommandQueue_Release(other);ID3D12CommandQueue_Release(queue);ID3D12Device_Release(device);
    printf("ASYNC_OK iterations=%u reset=%u repeated_resolve=%u future_queue_signal=%u\n",
           iterations,iterations-1,iterations,iterations);
    return 0;
}
