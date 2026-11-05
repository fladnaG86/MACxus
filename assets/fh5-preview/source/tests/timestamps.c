#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <initguid.h>
#include <d3d12.h>
#include <stdio.h>
#include <stdint.h>

#define CHECK(call) do { HRESULT hr_=(call); if(FAILED(hr_)){printf("ERROR line=%d hr=%08lx\n",__LINE__,(unsigned long)hr_);fflush(stdout);return 2;} } while(0)
static ID3D12Device *device;
static ID3D12CommandQueue *queue;
static ID3D12Fence *done;
static UINT64 serial;
static int wait_done(void){
    HANDLE e=CreateEventA(NULL,FALSE,FALSE,NULL); if(!e)return 2;
    CHECK(ID3D12CommandQueue_Signal(queue,done,++serial));
    CHECK(ID3D12Fence_SetEventOnCompletion(done,serial,e));
    DWORD r=WaitForSingleObject(e,10000);CloseHandle(e);
    if(r!=WAIT_OBJECT_0){printf("ERROR completion wait=%lu\n",r);return 2;}return 0;
}
static ID3D12Resource *readback(UINT64 size){
    ID3D12Resource *r=NULL;
    D3D12_HEAP_PROPERTIES hp={.Type=D3D12_HEAP_TYPE_READBACK};
    D3D12_RESOURCE_DESC desc={.Dimension=D3D12_RESOURCE_DIMENSION_BUFFER,.Width=size,.Height=1,.DepthOrArraySize=1,.MipLevels=1,.SampleDesc={1,0},.Layout=D3D12_TEXTURE_LAYOUT_ROW_MAJOR};
    if(FAILED(ID3D12Device_CreateCommittedResource(device,&hp,D3D12_HEAP_FLAG_NONE,&desc,D3D12_RESOURCE_STATE_COPY_DEST,NULL,&IID_ID3D12Resource,(void**)&r)))return NULL;
    return r;
}
static int within_module(HMODULE m, const void *pointer){
    IMAGE_DOS_HEADER *dos=(IMAGE_DOS_HEADER*)m;
    IMAGE_NT_HEADERS *nt=(IMAGE_NT_HEADERS*)((char*)m+dos->e_lfanew);
    return (uintptr_t)pointer >= (uintptr_t)m && (uintptr_t)pointer < (uintptr_t)m+nt->OptionalHeader.SizeOfImage;
}
int main(int argc,char **argv){
    setbuf(stdout,NULL);
    HMODULE module=LoadLibraryA(argc > 1 ? argv[1] : "d3d12.dll");if(!module){printf("ERROR load %lu\n",GetLastError());return 2;}
    char moduleName[1024];GetModuleFileNameA(module,moduleName,sizeof moduleName);
    printf("module=%s shim=%s\n",moduleName,GetModuleHandleA("apd12.dll")?"yes":"no");
    typedef HRESULT (WINAPI *create_fn)(IUnknown*,D3D_FEATURE_LEVEL,REFIID,void**);
    create_fn create=(create_fn)(void*)GetProcAddress(module,"D3D12CreateDevice");if(!create)return 2;
    CHECK(create(NULL,D3D_FEATURE_LEVEL_11_0,&IID_ID3D12Device,(void**)&device));
    D3D12_COMMAND_QUEUE_DESC qd={.Type=D3D12_COMMAND_LIST_TYPE_DIRECT};
    CHECK(ID3D12Device_CreateCommandQueue(device,&qd,&IID_ID3D12CommandQueue,(void**)&queue));
    CHECK(ID3D12Device_CreateFence(device,0,D3D12_FENCE_FLAG_NONE,&IID_ID3D12Fence,(void**)&done));
    UINT64 frequency=0;CHECK(ID3D12CommandQueue_GetTimestampFrequency(queue,&frequency));printf("frequency=%llu timestamp_hook=%d feature_hook=%d graphics_hook=%d\n",frequency,within_module(module,(void*)queue->lpVtbl->GetTimestampFrequency),within_module(module,(void*)device->lpVtbl->CheckFeatureSupport),within_module(module,(void*)device->lpVtbl->CreateGraphicsPipelineState));
    ID3D12CommandAllocator *alloc=NULL;ID3D12GraphicsCommandList *list=NULL;ID3D12QueryHeap *heap=NULL;
    CHECK(ID3D12Device_CreateCommandAllocator(device,D3D12_COMMAND_LIST_TYPE_DIRECT,&IID_ID3D12CommandAllocator,(void**)&alloc));
    CHECK(ID3D12Device_CreateCommandList(device,0,D3D12_COMMAND_LIST_TYPE_DIRECT,alloc,NULL,&IID_ID3D12GraphicsCommandList,(void**)&list));
    printf("endquery_hook=%d depth_resolve_hook=%d\n",within_module(module,(void*)list->lpVtbl->EndQuery),within_module(module,(void*)list->lpVtbl->ResolveSubresource));
    D3D12_QUERY_HEAP_DESC hd={.Type=D3D12_QUERY_HEAP_TYPE_TIMESTAMP,.Count=2};
    CHECK(ID3D12Device_CreateQueryHeap(device,&hd,&IID_ID3D12QueryHeap,(void**)&heap));
    ID3D12Resource *dst=readback(16);if(!dst)return 2;
    ID3D12Resource *work_source=NULL,*work_destination=NULL;
    char workFlag[8];int gpuWork=GetEnvironmentVariableA("MACXUS_GPU_PROBE_WORK",workFlag,sizeof workFlag)>0;
    if(gpuWork){
        D3D12_HEAP_PROPERTIES hp={.Type=D3D12_HEAP_TYPE_UPLOAD};
        D3D12_RESOURCE_DESC rd={.Dimension=D3D12_RESOURCE_DIMENSION_BUFFER,.Width=4u<<20,.Height=1,.DepthOrArraySize=1,.MipLevels=1,.SampleDesc={1,0},.Layout=D3D12_TEXTURE_LAYOUT_ROW_MAJOR};
        CHECK(ID3D12Device_CreateCommittedResource(device,&hp,D3D12_HEAP_FLAG_NONE,&rd,D3D12_RESOURCE_STATE_GENERIC_READ,NULL,&IID_ID3D12Resource,(void**)&work_source));
        work_destination=readback(4u<<20);if(!work_destination)return 2;
        void *memory=NULL;D3D12_RANGE empty={0,0};CHECK(ID3D12Resource_Map(work_source,0,&empty,&memory));memset(memory,0x5a,4u<<20);ID3D12Resource_Unmap(work_source,0,NULL);
    }
    // CPU pause is deliberately between RECORDING calls, never GPU commands.
    ID3D12GraphicsCommandList_EndQuery(list,heap,D3D12_QUERY_TYPE_TIMESTAMP,0);
    Sleep(250);
    if(gpuWork)for(int i=0;i<8;i++)ID3D12GraphicsCommandList_CopyBufferRegion(list,work_destination,0,work_source,0,4u<<20);
    ID3D12GraphicsCommandList_EndQuery(list,heap,D3D12_QUERY_TYPE_TIMESTAMP,1);
    ID3D12GraphicsCommandList_ResolveQueryData(list,heap,D3D12_QUERY_TYPE_TIMESTAMP,0,2,dst,0);
    CHECK(ID3D12GraphicsCommandList_Close(list));
    ID3D12CommandList *lists[]={(ID3D12CommandList*)list};
    UINT64 values[2][2];
    for(int pass=0;pass<2;pass++){
        if(pass)Sleep(300);
        ID3D12CommandQueue_ExecuteCommandLists(queue,1,lists);if(wait_done())return 2;
        void *ptr=NULL;D3D12_RANGE range={0,16};CHECK(ID3D12Resource_Map(dst,0,&range,&ptr));
        memcpy(values[pass],ptr,16);ID3D12Resource_Unmap(dst,0,NULL);
        printf("pass=%d t0=%llu t1=%llu delta_ms=%.3f\n",pass,values[pass][0],values[pass][1],frequency?1000.0*(double)(values[pass][1]-values[pass][0])/(double)frequency:0);
    }
    printf("same_timestamps_on_replay=%s\n",values[0][0]==values[1][0]&&values[0][1]==values[1][1]?"yes":"no");
    if(argc>2 && !strcmp(argv[2],"--ring")){
        // Every source timestamp is initialized; only another *recorded*, unsubmitted
        // list uses the upload ring before the original list is replayed.
        const UINT count=524288;
        ID3D12CommandAllocator *fill_alloc=NULL;ID3D12GraphicsCommandList *fill=NULL;ID3D12QueryHeap *fill_heap=NULL;
        CHECK(ID3D12Device_CreateCommandAllocator(device,D3D12_COMMAND_LIST_TYPE_DIRECT,&IID_ID3D12CommandAllocator,(void**)&fill_alloc));
        CHECK(ID3D12Device_CreateCommandList(device,0,D3D12_COMMAND_LIST_TYPE_DIRECT,fill_alloc,NULL,&IID_ID3D12GraphicsCommandList,(void**)&fill));
        D3D12_QUERY_HEAP_DESC fill_hd={.Type=D3D12_QUERY_HEAP_TYPE_TIMESTAMP,.Count=count};
        CHECK(ID3D12Device_CreateQueryHeap(device,&fill_hd,&IID_ID3D12QueryHeap,(void**)&fill_heap));
        ID3D12Resource *fill_dst=readback(4u<<20);if(!fill_dst)return 2;
        for(UINT i=0;i<count;i++)ID3D12GraphicsCommandList_EndQuery(fill,fill_heap,D3D12_QUERY_TYPE_TIMESTAMP,i);
        for(int i=0;i<2;i++)ID3D12GraphicsCommandList_ResolveQueryData(fill,fill_heap,D3D12_QUERY_TYPE_TIMESTAMP,0,count,fill_dst,0);
        CHECK(ID3D12GraphicsCommandList_Close(fill));
        ID3D12CommandQueue_ExecuteCommandLists(queue,1,lists);if(wait_done())return 2;
        void *ptr=NULL;D3D12_RANGE range={0,16};CHECK(ID3D12Resource_Map(dst,0,&range,&ptr));
        UINT64 after[2];memcpy(after,ptr,16);ID3D12Resource_Unmap(dst,0,NULL);
        printf("after_ring_pressure t0=%llu t1=%llu recorded_payload_overwritten=%s filler_submitted=no\n",after[0],after[1],after[0]!=values[1][0]||after[1]!=values[1][1]?"yes":"no");
        ID3D12Resource_Release(fill_dst);ID3D12QueryHeap_Release(fill_heap);ID3D12GraphicsCommandList_Release(fill);ID3D12CommandAllocator_Release(fill_alloc);
    }
    if(work_source){
        void *memory=NULL;D3D12_RANGE range={0,4u<<20};CHECK(ID3D12Resource_Map(work_destination,0,&range,&memory));
        printf("gpu_copy_verified=%s\n",((unsigned char*)memory)[0]==0x5a&&((unsigned char*)memory)[(4u<<20)-1]==0x5a?"yes":"no");
        ID3D12Resource_Unmap(work_destination,0,NULL);ID3D12Resource_Release(work_source);ID3D12Resource_Release(work_destination);
    }
    ID3D12Resource_Release(dst);ID3D12QueryHeap_Release(heap);ID3D12GraphicsCommandList_Release(list);ID3D12CommandAllocator_Release(alloc);
    ID3D12Fence_Release(done);ID3D12CommandQueue_Release(queue);ID3D12Device_Release(device);
    return 0;
}
