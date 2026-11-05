#include "../shim/d3d12.c"
static unsigned checks;
#define CHECK(x) do { checks++; if (!(x)) { printf("BLEND_CONTRACT_FAIL line=%d\n",__LINE__); return 1; } } while (0)
static size_t append(unsigned char *stream,size_t at,UINT type,const void *value,size_t size,size_t align) {
    memcpy(stream+at,&type,4);size_t inner=(at+4+align-1)&~(align-1);memcpy(stream+inner,value,size);return(inner+size+7)&~(size_t)7;
}
int main(void) {
    timestamp_only=append_only=1;
    fh5_blend_trace=1;
    D3D12_GRAPHICS_PIPELINE_STATE_DESC d={0},saved,copy,expected;Fixups fx;
    d.PS=(D3D12_SHADER_BYTECODE){(void*)0x1234,123};d.VS=(D3D12_SHADER_BYTECODE){(void*)0x5678,456};
    d.DepthStencilState.DepthEnable=TRUE;d.DepthStencilState.DepthFunc=D3D12_COMPARISON_FUNC_EQUAL;d.RasterizerState.DepthBias=123;
    d.BlendState.RenderTarget[0].BlendEnable=TRUE;d.BlendState.RenderTarget[0].SrcBlend=D3D12_BLEND_SRC1_COLOR;
    d.BlendState.RenderTarget[0].RenderTargetWriteMask=15;saved=d;
    SetLastError(12345);trace_unused_blend(0,&d.BlendState,0,DXGI_FORMAT_UNKNOWN,FALSE);CHECK(GetLastError()==12345);
    CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);
    fh5_unused_blend=1;CHECK(fix_graphics_desc(&d,&copy,&fx)==&copy);CHECK(fx.blend&&!fx.ps&&!fx.stream&&!fx.depth_new);
    expected=saved;expected.BlendState.RenderTarget[0].BlendEnable=FALSE;CHECK(!memcmp(&copy,&expected,sizeof copy));CHECK(!memcmp(&d,&saved,sizeof d));free_fixups(&fx);
    // Active RT0 always preserves real dual-source blending.
    d.NumRenderTargets=1;d.RTVFormats[0]=DXGI_FORMAT_R8G8B8A8_UNORM;CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);
    // RT0's common blend state also applies to an active later target.
    d.NumRenderTargets=2;d.RTVFormats[0]=DXGI_FORMAT_UNKNOWN;d.RTVFormats[1]=DXGI_FORMAT_R8G8B8A8_UNORM;CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);
    d.BlendState.IndependentBlendEnable=TRUE;CHECK(fix_graphics_desc(&d,&copy,&fx)==&copy);CHECK(!copy.BlendState.RenderTarget[0].BlendEnable);CHECK(!memcmp(&copy.BlendState.RenderTarget[1],&d.BlendState.RenderTarget[1],sizeof d.BlendState.RenderTarget[1]));free_fixups(&fx);
    d=saved;keep_unused_blend=1;CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);keep_unused_blend=0;
    // Each factor can trigger the backend bug; ordinary/disabled blends stay intact.
    for(unsigned factor=0;factor<4;factor++)for(unsigned blend=1;blend<=19;blend++) {
        d=saved;d.BlendState.RenderTarget[0].SrcBlend=D3D12_BLEND_ONE;
        D3D12_BLEND *fields[]={&d.BlendState.RenderTarget[0].SrcBlend,&d.BlendState.RenderTarget[0].DestBlend,&d.BlendState.RenderTarget[0].SrcBlendAlpha,&d.BlendState.RenderTarget[0].DestBlendAlpha};*fields[factor]=(D3D12_BLEND)blend;
        BOOL changed=is_src1((D3D12_BLEND)blend);CHECK((fix_graphics_desc(&d,&copy,&fx)==&copy)==changed);free_fixups(&fx);
        d.BlendState.RenderTarget[0].BlendEnable=FALSE;CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);
    }
    // Normalize no-layout streams, including omitted formats (D3D12 default: zero targets).
    for(unsigned include_formats=0;include_formats<2;include_formats++)for(unsigned targets=0;targets<2;targets++) {
        if(!include_formats&&targets)continue;
        unsigned char bytes[512]={0},original[512];d=saved;struct D3D12_RT_FORMAT_ARRAY formats={{DXGI_FORMAT_R8G8B8A8_UNORM},targets};
        size_t size=append(bytes,0,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_BLEND,&d.BlendState,sizeof d.BlendState,4);
        size=append(bytes,size,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_PS,&d.PS,sizeof d.PS,8);
        if(include_formats)size=append(bytes,size,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_RENDER_TARGET_FORMATS,&formats,sizeof formats,4);
        memcpy(original,bytes,sizeof bytes);D3D12_PIPELINE_STATE_STREAM_DESC in={size,bytes},out;
        CHECK(rewrite_stream(&in,&out,&fx)==(targets==0));CHECK(!memcmp(bytes,original,sizeof bytes));
        if(!targets){CHECK(fx.blend&&!fx.ps);D3D12_BLEND_DESC normalized;memcpy(&normalized,(char*)out.pPipelineStateSubobjectStream+4,sizeof normalized);CHECK(!normalized.RenderTarget[0].BlendEnable);
            normalized.RenderTarget[0].BlendEnable=TRUE;memcpy((char*)out.pPipelineStateSubobjectStream+4,&normalized,sizeof normalized);CHECK(!memcmp(out.pPipelineStateSubobjectStream,bytes,size));}
        free_fixups(&fx);fh5_unused_blend=0;CHECK(!rewrite_stream(&in,&out,&fx));free_fixups(&fx);fh5_unused_blend=1;
        in.SizeInBytes=10;CHECK(!rewrite_stream(&in,&out,&fx));free_fixups(&fx);
    }
    puts("BLEND_CONTRACT_OK absent_target_only original_pipeline_and_shader_bytes_preserved");printf("checks=%u\n",checks);return 0;
}
