// Owned depth-only pixel shader regression: no game shader source or assets.
#define main unused_input_layout_probe_main
#include "input-layout.cpp"
#undef main

static bool depth_pass(bool unused_blend, std::vector<float>& values) {
    const char *source="float4 vs(uint i:SV_VertexID):SV_Position {float2 p=float2((i==2)?3:-1,(i==1)?3:-1);return float4(p,.25,1);} float4 ps(float4 p:SV_Position):SV_Target {if(p.x>=32)discard;return float4(1,0,0,1);}";
    ID3DBlob *vs=nullptr,*ps=nullptr;
    if(!shader(source,"vs","vs_5_0",&vs)||!shader(source,"ps","ps_5_0",&ps))return false;
    D3D12_GRAPHICS_PIPELINE_STATE_DESC p={};p.pRootSignature=root;
    p.VS={vs->GetBufferPointer(),vs->GetBufferSize()};p.PS={ps->GetBufferPointer(),ps->GetBufferSize()};
    p.SampleMask=~0u;p.PrimitiveTopologyType=D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;
    p.DSVFormat=DXGI_FORMAT_D32_FLOAT;p.SampleDesc.Count=1;
    p.RasterizerState.FillMode=D3D12_FILL_MODE_SOLID;p.RasterizerState.CullMode=D3D12_CULL_MODE_NONE;p.RasterizerState.DepthClipEnable=TRUE;
    p.DepthStencilState.DepthEnable=TRUE;p.DepthStencilState.DepthWriteMask=D3D12_DEPTH_WRITE_MASK_ALL;p.DepthStencilState.DepthFunc=D3D12_COMPARISON_FUNC_ALWAYS;
    p.DepthStencilState.FrontFace={D3D12_STENCIL_OP_KEEP,D3D12_STENCIL_OP_KEEP,D3D12_STENCIL_OP_KEEP,D3D12_COMPARISON_FUNC_ALWAYS};p.DepthStencilState.BackFace=p.DepthStencilState.FrontFace;
    for(auto& b:p.BlendState.RenderTarget){b.SrcBlend=D3D12_BLEND_ONE;b.DestBlend=D3D12_BLEND_ZERO;b.BlendOp=D3D12_BLEND_OP_ADD;b.SrcBlendAlpha=D3D12_BLEND_ONE;b.DestBlendAlpha=D3D12_BLEND_ZERO;b.BlendOpAlpha=D3D12_BLEND_OP_ADD;b.LogicOp=D3D12_LOGIC_OP_NOOP;b.RenderTargetWriteMask=15;}
    p.BlendState.RenderTarget[0].BlendEnable=unused_blend;
    p.BlendState.RenderTarget[0].SrcBlend=D3D12_BLEND_SRC1_COLOR;
    ID3D12PipelineState *state=nullptr;OK(pipeline(p,&state));vs->Release();ps->Release();
    D3D12_HEAP_PROPERTIES hp={};hp.Type=D3D12_HEAP_TYPE_DEFAULT;
    D3D12_RESOURCE_DESC desc={};desc.Dimension=D3D12_RESOURCE_DIMENSION_TEXTURE2D;desc.Width=W;desc.Height=H;desc.DepthOrArraySize=1;desc.MipLevels=1;desc.Format=DXGI_FORMAT_D32_FLOAT;desc.SampleDesc.Count=1;desc.Flags=D3D12_RESOURCE_FLAG_ALLOW_DEPTH_STENCIL;
    D3D12_CLEAR_VALUE clear={};clear.Format=DXGI_FORMAT_D32_FLOAT;clear.DepthStencil.Depth=1;
    ID3D12Resource *target=nullptr,*readback=nullptr;
    OK(dev->CreateCommittedResource(&hp,D3D12_HEAP_FLAG_NONE,&desc,D3D12_RESOURCE_STATE_DEPTH_WRITE,&clear,IID_ID3D12Resource,(void**)&target));
    if(!buffer(D3D12_HEAP_TYPE_READBACK,W*H*sizeof(float),&readback))return false;
    D3D12_DESCRIPTOR_HEAP_DESC hd={};hd.Type=D3D12_DESCRIPTOR_HEAP_TYPE_DSV;hd.NumDescriptors=1;ID3D12DescriptorHeap *heap=nullptr;
    OK(dev->CreateDescriptorHeap(&hd,IID_ID3D12DescriptorHeap,(void**)&heap));auto dsv=heap->GetCPUDescriptorHandleForHeapStart();dev->CreateDepthStencilView(target,nullptr,dsv);
    ID3D12CommandAllocator *alloc=nullptr;ID3D12GraphicsCommandList *list=nullptr;
    OK(dev->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT,IID_ID3D12CommandAllocator,(void**)&alloc));OK(dev->CreateCommandList(0,D3D12_COMMAND_LIST_TYPE_DIRECT,alloc,state,IID_ID3D12GraphicsCommandList,(void**)&list));
    list->SetGraphicsRootSignature(root);D3D12_VIEWPORT viewport={0,0,(float)W,(float)H,0,1};D3D12_RECT rect={0,0,(LONG)W,(LONG)H};
    list->RSSetViewports(1,&viewport);list->RSSetScissorRects(1,&rect);list->OMSetRenderTargets(0,nullptr,FALSE,&dsv);list->ClearDepthStencilView(dsv,D3D12_CLEAR_FLAG_DEPTH,1,0,0,nullptr);list->IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);list->DrawInstanced(3,1,0,0);
    D3D12_RESOURCE_BARRIER barrier={};barrier.Type=D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;barrier.Transition.pResource=target;barrier.Transition.Subresource=D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;barrier.Transition.StateBefore=D3D12_RESOURCE_STATE_DEPTH_WRITE;barrier.Transition.StateAfter=D3D12_RESOURCE_STATE_COPY_SOURCE;list->ResourceBarrier(1,&barrier);
    D3D12_TEXTURE_COPY_LOCATION dst={};dst.pResource=readback;dst.Type=D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;dst.PlacedFootprint.Footprint={DXGI_FORMAT_R32_TYPELESS,W,H,1,W*4};D3D12_TEXTURE_COPY_LOCATION src={};src.pResource=target;src.Type=D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;list->CopyTextureRegion(&dst,0,0,0,&src,nullptr);
    OK(list->Close());ID3D12CommandList *lists[]={(ID3D12CommandList*)list};queue->ExecuteCommandLists(1,lists);if(!wait_gpu())return false;
    void *mapped=nullptr;D3D12_RANGE range={0,W*H*4};OK(readback->Map(0,&range,&mapped));values.assign((float*)mapped,(float*)mapped+W*H);readback->Unmap(0,nullptr);
    unsigned written=0,discarded=0;for(UINT y=0;y<H;y++)for(UINT x=0;x<W;x++){float v=values[y*W+x];if(x<32&&v==.25f)written++;if(x>=32&&v==1)discarded++;}
    std::printf("DEPTH unused_blend=%d written=%u discarded=%u correct=%d\n",unused_blend,written,discarded,written==W*H/2&&discarded==W*H/2);
    list->Release();alloc->Release();heap->Release();readback->Release();target->Release();state->Release();
    return unused_blend || (written==W*H/2&&discarded==W*H/2);
}
int main(int argc,char **argv) {
    std::setbuf(stdout,nullptr);if(argc<2||argc>3)return 2;stream_mode=argc==3&&!std::strcmp(argv[2],"--stream");
    HMODULE dll=LoadLibraryA(argv[1]);if(!dll)return 3;
    auto create=(HRESULT(WINAPI*)(IUnknown*,D3D_FEATURE_LEVEL,REFIID,void**))GetProcAddress(dll,"D3D12CreateDevice");auto serialize=(HRESULT(WINAPI*)(const D3D12_ROOT_SIGNATURE_DESC*,D3D_ROOT_SIGNATURE_VERSION,ID3DBlob**,ID3DBlob**))GetProcAddress(dll,"D3D12SerializeRootSignature");if(!create||!serialize)return 4;
    if(FAILED(create(nullptr,D3D_FEATURE_LEVEL_11_0,IID_ID3D12Device,(void**)&dev)))return 5;
    D3D12_COMMAND_QUEUE_DESC q={};q.Type=D3D12_COMMAND_LIST_TYPE_DIRECT;if(FAILED(dev->CreateCommandQueue(&q,IID_ID3D12CommandQueue,(void**)&queue))||FAILED(dev->CreateFence(0,D3D12_FENCE_FLAG_NONE,IID_ID3D12Fence,(void**)&fence)))return 6;
    D3D12_ROOT_SIGNATURE_DESC rd={};ID3DBlob *blob=nullptr,*error=nullptr;if(FAILED(serialize(&rd,D3D_ROOT_SIGNATURE_VERSION_1,&blob,&error)))return 7;
    if(FAILED(dev->CreateRootSignature(0,blob->GetBufferPointer(),blob->GetBufferSize(),IID_ID3D12RootSignature,(void**)&root)))return 8;
    blob->Release();if(error)error->Release();
    std::vector<float> reference,unused;bool good=depth_pass(false,reference)&&depth_pass(true,unused);
    bool equal=good&&reference==unused;std::printf("BLEND_COMPARE api=%s equal=%d pixels=%u\n",stream_mode?"stream":"direct",equal,W*H);
    root->Release();fence->Release();queue->Release();dev->Release();return equal?0:9;
}
