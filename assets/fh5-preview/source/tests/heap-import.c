#define INITGUID
#include <windows.h>
#include <d3d12.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
static unsigned notes,checks;
#define CHECK(x) do { checks++; if (!(x)) { printf("FAIL line=%u\n",__LINE__); return 1; } } while(0)
#define OBS_CALLER 1234
static void observer_note(unsigned api,UINT64 caller,const char *format,...) { (void)api;(void)caller;(void)format;notes++; SetLastError(999); }
#include "../shim/heap_import_trace.h"
static int variant;
static HRESULT STDMETHODCALLTYPE original(ID3D12Device3 *device,const void *address,REFIID iid,void **out)
{
    if (device!=(void*)0x100 || address!=(void*)0x20000 || iid!=&IID_ID3D12Heap) return E_INVALIDARG;
    SetLastError(543);
    if (variant==0) return E_NOTIMPL;
    if (out) *out=(void*)0x300;
    return S_OK;
}
int main(int argc, char **argv)
{
    if (argc == 3 && !strcmp(argv[1], "--native")) {
        HMODULE shim=LoadLibraryA(argv[2]); if(!shim)return 10;
        HRESULT (WINAPI *create)(IUnknown*,D3D_FEATURE_LEVEL,REFIID,void**)=(void*)GetProcAddress(shim,"D3D12CreateDevice");
        ID3D12Device3 *device=NULL;
        if(!create || FAILED(create(NULL,D3D_FEATURE_LEVEL_11_0,&IID_ID3D12Device3,(void**)&device)))return 11;
        void *address=VirtualAlloc(NULL,65536,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);
        if(!address)return 12;
        ID3D12Heap *imported=NULL,*ordinary=NULL;
        HRESULT import=device->lpVtbl->OpenExistingHeapFromAddress(device,address,&IID_ID3D12Heap,(void**)&imported);
        D3D12_HEAP_DESC desc={0};desc.SizeInBytes=65536;desc.Properties.Type=D3D12_HEAP_TYPE_UPLOAD;desc.Properties.CreationNodeMask=desc.Properties.VisibleNodeMask=1;desc.Flags=D3D12_HEAP_FLAG_ALLOW_ONLY_BUFFERS;
        HRESULT allocation=device->lpVtbl->CreateHeap(device,&desc,&IID_ID3D12Heap,(void**)&ordinary);
        printf("HEAP NATIVE import_hr=%08lx ordinary_heap_hr=%08lx imported=%u ordinary=%u\n",(unsigned long)import,(unsigned long)allocation,imported!=NULL,ordinary!=NULL);
        if(SUCCEEDED(import)&&imported)imported->lpVtbl->Release(imported);
        if(SUCCEEDED(allocation)&&ordinary)ordinary->lpVtbl->Release(ordinary);
        VirtualFree(address,0,MEM_RELEASE);device->lpVtbl->Release(device);
        return FAILED(allocation)?13:0;
    }
    fh5_real_OpenExistingHeapFromAddress=original;
    for(unsigned enabled=0;enabled<2;enabled++) for(variant=0;variant<2;variant++) {
        fh5_heap_trace=enabled; void *out=(void*)0xabc; unsigned before=notes;
        HRESULT hr=fh5_OpenExistingHeapFromAddress((void*)0x100,(void*)0x20000,&IID_ID3D12Heap,&out);
        CHECK(hr==(variant?S_OK:E_NOTIMPL) && out==(variant?(void*)0x300:(void*)0xabc));
        CHECK(GetLastError()==543 && notes==before+enabled);
    }
    CHECK(fh5_heap_calls[0]==2);
    for(unsigned i=0;i<2000;i++) fh5_heap_note(1,S_OK,4096,65536,0,TRUE,0);
    CHECK(notes<100 && fh5_heap_calls[1]==2000);
    printf("HEAP IMPORT CHECKS %u FAILURES 0\n",checks);return 0;
}
