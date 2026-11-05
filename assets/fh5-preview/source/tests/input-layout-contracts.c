#include "../shim/d3d12.c"
static unsigned checks;
#define CHECK(x) do { checks++; if (!(x)) { printf("CONTRACT_FAIL line=%d\n", __LINE__); return 1; } } while (0)
static void dummy(void) {}
static void set_vtable(void *table, size_t size) { size_t i; for (i=0;i<size/sizeof(void*);i++) ((void**)table)[i]=(void*)dummy; }
int main(void) {
    D3D12_INPUT_ELEMENT_DESC e[5]={0}, out[5], original[5];
    D3D12_INPUT_LAYOUT_DESC in={e,5}; D3D12_GRAPHICS_PIPELINE_STATE_DESC d={0}, copy, expected; Fixups fx;
    ID3D12DeviceVtbl dv; ID3D12Device device={&dv};
    ID3D12GraphicsCommandListVtbl lv; ID3D12GraphicsCommandList list={&lv};
    ID3D12CommandQueueVtbl qv; ID3D12CommandQueue queue={&qv};
    size_t i;
    timestamp_only=append_only=1;
    e[0]=(D3D12_INPUT_ELEMENT_DESC){"N",0,DXGI_FORMAT_R16G16_SNORM,1,D3D12_APPEND_ALIGNED_ELEMENT,D3D12_INPUT_CLASSIFICATION_PER_INSTANCE_DATA,1};
    e[1]=(D3D12_INPUT_ELEMENT_DESC){"P",0,DXGI_FORMAT_R32G32B32_FLOAT,0,0,D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA,0};
    e[2]=(D3D12_INPUT_ELEMENT_DESC){"A",0,DXGI_FORMAT_R32G32B32A32_FLOAT,1,D3D12_APPEND_ALIGNED_ELEMENT,D3D12_INPUT_CLASSIFICATION_PER_INSTANCE_DATA,1};
    e[3]=(D3D12_INPUT_ELEMENT_DESC){"B",0,DXGI_FORMAT_R8_UNORM,0,13,D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA,0};
    e[4]=(D3D12_INPUT_ELEMENT_DESC){"C",0,DXGI_FORMAT_R16_UINT,0,D3D12_APPEND_ALIGNED_ELEMENT,D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA,0};
    memcpy(original,e,sizeof e);
    CHECK(resolve_append_offsets(&in,out));
    CHECK(out[0].AlignedByteOffset==0 && out[2].AlignedByteOffset==4 && out[4].AlignedByteOffset==14);
    CHECK(!memcmp(e,original,sizeof e));
    for(i=0;i<5;i++){ D3D12_INPUT_ELEMENT_DESC preserve=out[i];preserve.AlignedByteOffset=e[i].AlignedByteOffset; CHECK(!memcmp(&preserve,&e[i],sizeof preserve)); }
    d.InputLayout=in;d.VS.pShaderBytecode=(void*)0x1234;d.VS.BytecodeLength=999;d.PS.pShaderBytecode=(void*)0x5678;d.PS.BytecodeLength=777;
    d.BlendState.RenderTarget[0].BlendEnable=TRUE;d.BlendState.RenderTarget[0].SrcBlend=D3D12_BLEND_SRC1_COLOR;
    d.DepthStencilState.DepthEnable=TRUE;d.DepthStencilState.DepthFunc=D3D12_COMPARISON_FUNC_EQUAL;d.RasterizerState.DepthBias=123;
    CHECK(fix_graphics_desc(&d,&copy,&fx)==&copy);
    CHECK(!memcmp(fx.elems,out,sizeof out));expected=copy;expected.InputLayout.pInputElementDescs=e;
    CHECK(!memcmp(&d,&expected,sizeof d)); CHECK(fx.ps==NULL && fx.stream==NULL && !fx.blend && !fx.depth_new); free_fixups(&fx);
    keep_append_offsets=1;CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);keep_append_offsets=0;
    e[0].Format=DXGI_FORMAT_UNKNOWN; CHECK(!resolve_append_offsets(&in,out));
    e[0].Format=DXGI_FORMAT_R16G16_TYPELESS;CHECK(!resolve_append_offsets(&in,out));e[0]=original[0];
    e[0].InputSlot=D3D12_IA_VERTEX_INPUT_RESOURCE_SLOT_COUNT;CHECK(!resolve_append_offsets(&in,out));e[0]=original[0];
    e[0].AlignedByteOffset=UINT_MAX-1;CHECK(!resolve_append_offsets(&in,out));e[0]=original[0];
    in.NumElements=33;CHECK(!resolve_append_offsets(&in,out));in.NumElements=5;
    CHECK(!resolve_append_offsets(NULL,out));
    { // Stream offsets follow the API's pointer-aligned subobject ABI.
      unsigned char bytes[80]={0}, saved[80];UINT type=D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_SAMPLE_MASK, mask=0xa5a51234;
      D3D12_PIPELINE_STATE_STREAM_DESC stream={32,bytes}, changed;
      memcpy(bytes,&type,4);memcpy(bytes+4,&mask,4);type=D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_INPUT_LAYOUT;
      memcpy(bytes+8,&type,4);memcpy(bytes+16,&in,sizeof in);memcpy(saved,bytes,sizeof bytes);
      CHECK(rewrite_stream(&stream,&changed,&fx));CHECK(changed.SizeInBytes==32);
      D3D12_INPUT_LAYOUT_DESC layout;memcpy(&layout,(unsigned char*)changed.pPipelineStateSubobjectStream+16,sizeof layout);
      CHECK(layout.NumElements==5 && layout.pInputElementDescs==fx.elems);
      CHECK(fx.elems[2].AlignedByteOffset==4 && fx.elems[4].AlignedByteOffset==14);
      memcpy((unsigned char*)changed.pPipelineStateSubobjectStream+16,&in,sizeof in);
      CHECK(!memcmp(changed.pPipelineStateSubobjectStream,bytes,32));CHECK(!memcmp(saved,bytes,sizeof bytes));free_fixups(&fx);
      stream.SizeInBytes=20;CHECK(!rewrite_stream(&stream,&changed,&fx));free_fixups(&fx);
      stream.SizeInBytes=32;type=0xffffffff;memcpy(bytes,&type,4);CHECK(!rewrite_stream(&stream,&changed,&fx));free_fixups(&fx);
    }
    set_vtable(&dv,sizeof dv);patch_device_vtbl(&device);
    for(i=0;i<sizeof dv/sizeof(void*);i++) {
      int allowed=i==offsetof(ID3D12DeviceVtbl,CreateQueryHeap)/sizeof(void*)||i==offsetof(ID3D12DeviceVtbl,CreateGraphicsPipelineState)/sizeof(void*);
      CHECK((((void**)&dv)[i]!=(void*)dummy)==allowed);
    }
    set_vtable(&lv,sizeof lv);patch_list_vtbl(&list);
    for(i=0;i<sizeof lv/sizeof(void*);i++) {
      int allowed=i==offsetof(ID3D12GraphicsCommandListVtbl,EndQuery)/sizeof(void*)||i==offsetof(ID3D12GraphicsCommandListVtbl,BeginQuery)/sizeof(void*)||i==offsetof(ID3D12GraphicsCommandListVtbl,ResolveQueryData)/sizeof(void*);
      CHECK((((void**)&lv)[i]!=(void*)dummy)==allowed);
    }
    set_vtable(&qv,sizeof qv);patch_queue_vtbl(&queue);
    for(i=0;i<sizeof qv/sizeof(void*);i++) {
      int allowed=i==offsetof(ID3D12CommandQueueVtbl,GetTimestampFrequency)/sizeof(void*)||i==offsetof(ID3D12CommandQueueVtbl,GetClockCalibration)/sizeof(void*);
      CHECK((((void**)&qv)[i]!=(void*)dummy)==allowed);
    }
    printf("CONTRACT_OK checks=%u; offsets normalized, unrelated pipeline bytes and vtable methods preserved\n",checks);return 0;
}
