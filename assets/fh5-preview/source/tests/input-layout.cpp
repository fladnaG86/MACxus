#define INITGUID
#include <windows.h>
#include <initguid.h>
#include <d3d12.h>
#include <d3dcompiler.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <cstdint>
#include <vector>
#ifdef MACXUS_ACTIVE_BLEND_PROBE
#include "../shim/shader_signature.h"
#endif
#define OK(x) do{HRESULT h=(x);if(FAILED(h)){std::printf("ERROR line=%d hr=%08lx\n",__LINE__,(unsigned long)h);return false;}}while(0)
static ID3D12Device *dev;
static ID3D12CommandQueue *queue;
static ID3D12Fence *fence;
static UINT64 serial;
static ID3D12RootSignature *root;
static const UINT W=64,H=64;
static bool wait_gpu(){HANDLE event=CreateEventW(nullptr,FALSE,FALSE,nullptr);if(!event)return false;OK(queue->Signal(fence,++serial));OK(fence->SetEventOnCompletion(serial,event));DWORD code=WaitForSingleObject(event,15000);CloseHandle(event);if(code!=WAIT_OBJECT_0){std::printf("ERROR fence=%lu\n",code);return false;}return true;}
static bool buffer(D3D12_HEAP_TYPE heap,UINT64 size,ID3D12Resource **out){D3D12_HEAP_PROPERTIES hp={};hp.Type=heap;D3D12_RESOURCE_DESC d={};d.Dimension=D3D12_RESOURCE_DIMENSION_BUFFER;d.Width=size;d.Height=1;d.DepthOrArraySize=1;d.MipLevels=1;d.SampleDesc.Count=1;d.Layout=D3D12_TEXTURE_LAYOUT_ROW_MAJOR;OK(dev->CreateCommittedResource(&hp,D3D12_HEAP_FLAG_NONE,&d,heap==D3D12_HEAP_TYPE_UPLOAD?D3D12_RESOURCE_STATE_GENERIC_READ:D3D12_RESOURCE_STATE_COPY_DEST,nullptr,IID_ID3D12Resource,(void**)out));return true;}
static bool shader(const char *source,const char *entry,const char *target,ID3DBlob **out){ID3DBlob *error=nullptr;HRESULT hr=D3DCompile(source,std::strlen(source),nullptr,nullptr,nullptr,entry,target,D3DCOMPILE_OPTIMIZATION_LEVEL3,0,out,&error);if(FAILED(hr))std::printf("ERROR shader=%s hr=%08lx %.*s\n",entry,(unsigned long)hr,error?(int)error->GetBufferSize():0,error?(char*)error->GetBufferPointer():"");if(error)error->Release();return SUCCEEDED(hr);}
static D3D12_INPUT_ELEMENT_DESC elem(const char *semantic,UINT index,DXGI_FORMAT format,UINT slot,UINT offset,D3D12_INPUT_CLASSIFICATION kind=D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA){D3D12_INPUT_ELEMENT_DESC e={};e.SemanticName=semantic;e.SemanticIndex=index;e.Format=format;e.InputSlot=slot;e.AlignedByteOffset=offset;e.InputSlotClass=kind;e.InstanceDataStepRate=kind==D3D12_INPUT_CLASSIFICATION_PER_INSTANCE_DATA?1:0;return e;}
static bool stream_mode;
template<typename T> static void subobject(std::vector<unsigned char>& bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE type,const T& value){
 size_t begin=(bytes.size()+sizeof(void*)-1)&~(sizeof(void*)-1);
 size_t at=(begin+sizeof(type)+alignof(T)-1)&~(alignof(T)-1);
 size_t end=(at+sizeof(T)+sizeof(void*)-1)&~(sizeof(void*)-1);
 bytes.resize(end,0);std::memcpy(bytes.data()+begin,&type,sizeof(type));std::memcpy(bytes.data()+at,&value,sizeof(T));
}
static HRESULT pipeline(const D3D12_GRAPHICS_PIPELINE_STATE_DESC& p,ID3D12PipelineState** out){
 if(!stream_mode)return dev->CreateGraphicsPipelineState(&p,IID_ID3D12PipelineState,(void**)out);
 ID3D12Device2* d2=nullptr;HRESULT hr=dev->QueryInterface(IID_ID3D12Device2,(void**)&d2);if(FAILED(hr))return hr;
 std::vector<unsigned char> bytes;
 subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_ROOT_SIGNATURE,p.pRootSignature);
 subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_VS,p.VS);subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_PS,p.PS);
 subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_BLEND,p.BlendState);subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_SAMPLE_MASK,p.SampleMask);
 subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_RASTERIZER,p.RasterizerState);subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_DEPTH_STENCIL,p.DepthStencilState);
 subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_INPUT_LAYOUT,p.InputLayout);subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_PRIMITIVE_TOPOLOGY,p.PrimitiveTopologyType);
 D3D12_RT_FORMAT_ARRAY formats={};formats.NumRenderTargets=p.NumRenderTargets;std::memcpy(formats.RTFormats,p.RTVFormats,sizeof(formats.RTFormats));
 subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_RENDER_TARGET_FORMATS,formats);subobject(bytes,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_SAMPLE_DESC,p.SampleDesc);
 D3D12_PIPELINE_STATE_STREAM_DESC desc={bytes.size(),bytes.data()};hr=d2->CreatePipelineState(&desc,IID_ID3D12PipelineState,(void**)out);d2->Release();return hr;
}
struct Render {UINT64 hash;unsigned colored;double cx,cy;std::vector<unsigned char> pixels;};
static bool draw(const char *name,const char *source,std::vector<D3D12_INPUT_ELEMENT_DESC> elements,const void *vertices,UINT vertex_bytes,UINT stride,const void *instances,UINT instance_bytes,Render &result){
 ID3DBlob *vs=nullptr,*ps=nullptr;if(!shader(source,"vs","vs_5_0",&vs)||!shader(source,"ps","ps_5_0",&ps))return false;
#ifdef MACXUS_CACHE_ORDER_PROBE
 ID3DBlob *owned_shaders[]={vs,ps};
 for(unsigned i=0;i<2;i++) {
  auto bytes=(const unsigned char*)owned_shaders[i]->GetBufferPointer();auto size=owned_shaders[i]->GetBufferSize();
  if(cache_probe_shaders[i].empty())cache_probe_shaders[i].assign(bytes,bytes+size);
  else if(cache_probe_shaders[i].size()!=size||std::memcmp(cache_probe_shaders[i].data(),bytes,size))cache_probe_same_shaders=false;
 }
#endif
#ifdef MACXUS_ACTIVE_BLEND_PROBE
 struct shader_outputs signature={};
 if(!shader_output_signature(ps->GetBufferPointer(),ps->GetBufferSize(),&signature))return false;
 std::printf("OUTPUT_SIGNATURE count=%u mask=%x\n",signature.count,signature.mask);
#endif
 D3D12_GRAPHICS_PIPELINE_STATE_DESC p={};p.pRootSignature=root;p.VS={vs->GetBufferPointer(),vs->GetBufferSize()};p.PS={ps->GetBufferPointer(),ps->GetBufferSize()};p.InputLayout={elements.data(),(UINT)elements.size()};p.SampleMask=~0u;p.PrimitiveTopologyType=D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;p.NumRenderTargets=1;p.RTVFormats[0]=DXGI_FORMAT_R8G8B8A8_UNORM;p.SampleDesc.Count=1;p.RasterizerState.FillMode=D3D12_FILL_MODE_SOLID;p.RasterizerState.CullMode=D3D12_CULL_MODE_NONE;p.RasterizerState.DepthClipEnable=TRUE;p.DepthStencilState.DepthEnable=FALSE;p.DepthStencilState.DepthWriteMask=D3D12_DEPTH_WRITE_MASK_ZERO;p.DepthStencilState.DepthFunc=D3D12_COMPARISON_FUNC_ALWAYS;p.DepthStencilState.StencilReadMask=255;p.DepthStencilState.StencilWriteMask=255;
 p.DepthStencilState.FrontFace={D3D12_STENCIL_OP_KEEP,D3D12_STENCIL_OP_KEEP,D3D12_STENCIL_OP_KEEP,D3D12_COMPARISON_FUNC_ALWAYS};p.DepthStencilState.BackFace=p.DepthStencilState.FrontFace;
 for(auto &b:p.BlendState.RenderTarget){b.SrcBlend=D3D12_BLEND_ONE;b.DestBlend=D3D12_BLEND_ZERO;b.BlendOp=D3D12_BLEND_OP_ADD;b.SrcBlendAlpha=D3D12_BLEND_ONE;b.DestBlendAlpha=D3D12_BLEND_ZERO;b.BlendOpAlpha=D3D12_BLEND_OP_ADD;b.LogicOp=D3D12_LOGIC_OP_NOOP;b.RenderTargetWriteMask=D3D12_COLOR_WRITE_ENABLE_ALL;}
#ifdef MACXUS_ACTIVE_BLEND_PROBE
#ifndef MACXUS_ACTIVE_BLEND_ENABLE
#define MACXUS_ACTIVE_BLEND_ENABLE TRUE
#endif
 p.BlendState.RenderTarget[0].BlendEnable=MACXUS_ACTIVE_BLEND_ENABLE;
 p.BlendState.RenderTarget[0].DestBlend=D3D12_BLEND_SRC1_COLOR;
#endif
#ifdef MACXUS_PIPELINE_DESC_PROBE
 pipeline_desc_probe(p);
#endif
 ID3D12PipelineState *pipeline=nullptr;OK(::pipeline(p,&pipeline));vs->Release();ps->Release();
 ID3D12Resource *vb=nullptr,*ib=nullptr,*readback=nullptr,*target=nullptr;
 if(!buffer(D3D12_HEAP_TYPE_UPLOAD,vertex_bytes,&vb)||!buffer(D3D12_HEAP_TYPE_READBACK,W*H*4,&readback))return false;
 D3D12_RANGE empty={0,0};void *mapped=nullptr;OK(vb->Map(0,&empty,&mapped));std::memcpy(mapped,vertices,vertex_bytes);vb->Unmap(0,nullptr);
 if(instances){if(!buffer(D3D12_HEAP_TYPE_UPLOAD,instance_bytes,&ib))return false;OK(ib->Map(0,&empty,&mapped));std::memcpy(mapped,instances,instance_bytes);ib->Unmap(0,nullptr);}
 D3D12_HEAP_PROPERTIES hp={};hp.Type=D3D12_HEAP_TYPE_DEFAULT;D3D12_RESOURCE_DESC td={};td.Dimension=D3D12_RESOURCE_DIMENSION_TEXTURE2D;td.Width=W;td.Height=H;td.DepthOrArraySize=1;td.MipLevels=1;td.Format=DXGI_FORMAT_R8G8B8A8_UNORM;td.SampleDesc.Count=1;td.Flags=D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET;D3D12_CLEAR_VALUE clear={};clear.Format=td.Format;clear.Color[3]=1;OK(dev->CreateCommittedResource(&hp,D3D12_HEAP_FLAG_NONE,&td,D3D12_RESOURCE_STATE_RENDER_TARGET,&clear,IID_ID3D12Resource,(void**)&target));
#ifdef MACXUS_ACTIVE_BLEND_PROBE
 clear.Color[2]=1;
#endif
 D3D12_DESCRIPTOR_HEAP_DESC hd={};hd.Type=D3D12_DESCRIPTOR_HEAP_TYPE_RTV;hd.NumDescriptors=1;ID3D12DescriptorHeap *heap=nullptr;OK(dev->CreateDescriptorHeap(&hd,IID_ID3D12DescriptorHeap,(void**)&heap));auto rtv=heap->GetCPUDescriptorHandleForHeapStart();dev->CreateRenderTargetView(target,nullptr,rtv);
 ID3D12CommandAllocator *alloc=nullptr;ID3D12GraphicsCommandList *list=nullptr;OK(dev->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT,IID_ID3D12CommandAllocator,(void**)&alloc));OK(dev->CreateCommandList(0,D3D12_COMMAND_LIST_TYPE_DIRECT,alloc,pipeline,IID_ID3D12GraphicsCommandList,(void**)&list));
#ifdef MACXUS_GPU_TIMESTAMP_RENDER
 ID3D12QueryHeap *timestamps=nullptr;ID3D12Resource *timing=nullptr;
 D3D12_QUERY_HEAP_DESC qh={};qh.Type=D3D12_QUERY_HEAP_TYPE_TIMESTAMP;qh.Count=2;
 OK(dev->CreateQueryHeap(&qh,IID_ID3D12QueryHeap,(void**)&timestamps));
 if(!buffer(D3D12_HEAP_TYPE_READBACK,16,&timing))return false;
 list->EndQuery(timestamps,D3D12_QUERY_TYPE_TIMESTAMP,0);Sleep(250);
#endif
 list->SetGraphicsRootSignature(root);D3D12_VIEWPORT viewport={0,0,(float)W,(float)H,0,1};D3D12_RECT rect={0,0,(LONG)W,(LONG)H};list->RSSetViewports(1,&viewport);list->RSSetScissorRects(1,&rect);list->OMSetRenderTargets(1,&rtv,FALSE,nullptr);list->ClearRenderTargetView(rtv,clear.Color,0,nullptr);
 D3D12_VERTEX_BUFFER_VIEW views[2]={{vb->GetGPUVirtualAddress(),vertex_bytes,stride},{ib?ib->GetGPUVirtualAddress():0,instance_bytes,instance_bytes}};list->IASetVertexBuffers(0,ib?2:1,views);list->IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);list->DrawInstanced(3,1,0,0);
 D3D12_RESOURCE_BARRIER barrier={};barrier.Type=D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;barrier.Transition.pResource=target;barrier.Transition.Subresource=D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;barrier.Transition.StateBefore=D3D12_RESOURCE_STATE_RENDER_TARGET;barrier.Transition.StateAfter=D3D12_RESOURCE_STATE_COPY_SOURCE;list->ResourceBarrier(1,&barrier);
 D3D12_TEXTURE_COPY_LOCATION dst={};dst.pResource=readback;dst.Type=D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;dst.PlacedFootprint.Footprint={DXGI_FORMAT_R8G8B8A8_UNORM,W,H,1,W*4};D3D12_TEXTURE_COPY_LOCATION src={};src.pResource=target;src.Type=D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;list->CopyTextureRegion(&dst,0,0,0,&src,nullptr);
#ifdef MACXUS_GPU_TIMESTAMP_RENDER
 list->EndQuery(timestamps,D3D12_QUERY_TYPE_TIMESTAMP,1);
 list->ResolveQueryData(timestamps,D3D12_QUERY_TYPE_TIMESTAMP,0,2,timing,0);
#endif
 OK(list->Close());ID3D12CommandList *lists[]={(ID3D12CommandList*)list};queue->ExecuteCommandLists(1,lists);if(!wait_gpu())return false;
#ifdef MACXUS_GPU_TIMESTAMP_RENDER
 D3D12_RANGE timerange={0,16};void *times=nullptr;OK(timing->Map(0,&timerange,&times));
 UINT64 values[2];std::memcpy(values,times,16);timing->Unmap(0,nullptr);
 if(!values[0]||values[1]<=values[0]||values[1]-values[0]>=100000000){std::printf("TIMING_FAIL case=%s t0=%llu t1=%llu\n",name,values[0],values[1]);return false;}
 std::printf("RENDER_TIMING case=%s t0=%llu t1=%llu\n",name,values[0],values[1]);
 timestamps->Release();timing->Release();
#endif
 D3D12_RANGE range={0,W*H*4};OK(readback->Map(0,&range,&mapped));result.pixels.assign((unsigned char*)mapped,(unsigned char*)mapped+W*H*4);readback->Unmap(0,nullptr);result.hash=1469598103934665603ull;result.colored=0;result.cx=result.cy=0;
 for(UINT y=0;y<H;y++)for(UINT x=0;x<W;x++){auto q=&result.pixels[(y*W+x)*4];for(UINT c=0;c<4;c++){result.hash^=q[c];result.hash*=1099511628211ull;}if(q[0]>32||q[1]>32||q[2]>32){result.colored++;result.cx+=x+.5;result.cy+=y+.5;}}
 if(result.colored){result.cx/=result.colored;result.cy/=result.colored;}
 std::printf("RENDER case=%s pixels=%u centroid=%.3f,%.3f hash=%016llx\n",name,result.colored,result.cx,result.cy,(unsigned long long)result.hash);
 list->Release();alloc->Release();heap->Release();target->Release();readback->Release();if(ib)ib->Release();vb->Release();pipeline->Release();return true;
}
static bool pair(const char *name,const char *source,std::vector<D3D12_INPUT_ELEMENT_DESC> explicit_layout,std::vector<D3D12_INPUT_ELEMENT_DESC> automatic,const void *vertices,UINT bytes,UINT stride,const void *instances=nullptr,UINT instance_bytes=0){
#ifdef MACXUS_GPU_TIMESTAMP_RENDER
 // This mode tests timing/render transitions with explicit layouts in both draws.
 automatic=explicit_layout;
#endif
 Render a,b;char label[80];std::snprintf(label,sizeof(label),"%s_explicit",name);if(!draw(label,source,explicit_layout,vertices,bytes,stride,instances,instance_bytes,a))return false;std::snprintf(label,sizeof(label),"%s_append",name);if(!draw(label,source,automatic,vertices,bytes,stride,instances,instance_bytes,b))return false;unsigned differences=0;for(size_t i=0;i<a.pixels.size();i++)if(a.pixels[i]!=b.pixels[i])differences++;std::printf("COMPARE case=%s explicit_draw_valid=%u byte_differences=%u identical=%u\n",name,a.colored>100,differences,a.pixels==b.pixels);
#ifdef MACXUS_GPU_TIMESTAMP_RENDER
 return a.colored>100&&a.pixels==b.pixels;
#else
 return a.colored>100;
#endif
}
int main(int argc,char **argv){
 std::setbuf(stdout,nullptr);if(argc<2||argc>3)return 2;stream_mode=argc==3&&!std::strcmp(argv[2],"--stream");std::printf("PIPELINE_API %s\n",stream_mode?"stream":"direct");HMODULE dll=LoadLibraryA(argv[1]);if(!dll){std::printf("ERROR load=%lu\n",GetLastError());return 3;}
 char path[1024];GetModuleFileNameA(dll,path,sizeof(path));std::printf("RENDERER %s\n",path);
 auto create=(HRESULT(WINAPI*)(IUnknown*,D3D_FEATURE_LEVEL,REFIID,void**))GetProcAddress(dll,"D3D12CreateDevice");auto serialize=(HRESULT(WINAPI*)(const D3D12_ROOT_SIGNATURE_DESC*,D3D_ROOT_SIGNATURE_VERSION,ID3DBlob**,ID3DBlob**))GetProcAddress(dll,"D3D12SerializeRootSignature");if(!create||!serialize)return 4;
 if(FAILED(create(nullptr,D3D_FEATURE_LEVEL_11_0,IID_ID3D12Device,(void**)&dev)))return 5;
 D3D12_COMMAND_QUEUE_DESC q={};q.Type=D3D12_COMMAND_LIST_TYPE_DIRECT;if(FAILED(dev->CreateCommandQueue(&q,IID_ID3D12CommandQueue,(void**)&queue))||FAILED(dev->CreateFence(0,D3D12_FENCE_FLAG_NONE,IID_ID3D12Fence,(void**)&fence)))return 6;
 D3D12_ROOT_SIGNATURE_DESC rd={};rd.Flags=D3D12_ROOT_SIGNATURE_FLAG_ALLOW_INPUT_ASSEMBLER_INPUT_LAYOUT;ID3DBlob *rs=nullptr,*error=nullptr;if(FAILED(serialize(&rd,D3D_ROOT_SIGNATURE_VERSION_1,&rs,&error)))return 7;if(FAILED(dev->CreateRootSignature(0,rs->GetBufferPointer(),rs->GetBufferSize(),IID_ID3D12RootSignature,(void**)&root)))return 8;rs->Release();if(error)error->Release();bool good=true;
 const char *simple="struct I{float3 unused:NORMAL;float3 p:POSITION;float4 c:COLOR;};struct O{float4 p:SV_Position;float4 c:COLOR;};O vs(I i){O o;o.p=float4(i.p,1);o.c=i.c;return o;}float4 ps(O o):SV_Target{return o.c;}";
 struct V{float n[3],p[3],c[4];};V vertices[]={{{0,0,0},{-.8f,-.8f,0},{1,0,0,1}},{{0,0,0},{0,.8f,0},{1,0,0,1}},{{0,0,0},{.8f,-.8f,0},{1,0,0,1}}};
 std::vector<D3D12_INPUT_ELEMENT_DESC> layout={elem("NORMAL",0,DXGI_FORMAT_R32G32B32_FLOAT,0,0),elem("POSITION",0,DXGI_FORMAT_R32G32B32_FLOAT,0,12),elem("COLOR",0,DXGI_FORMAT_R32G32B32A32_FLOAT,0,24)};auto automatic=layout;automatic[1].AlignedByteOffset=automatic[2].AlignedByteOffset=D3D12_APPEND_ALIGNED_ELEMENT;good&=pair("unused_float_attribute",simple,layout,automatic,vertices,sizeof(vertices),sizeof(V));
 const char *packed="struct I{float2 uv:TEXCOORD0;float4 c:COLOR0;};struct O{float4 p:SV_Position;float4 c:COLOR;};O vs(I i){O o;o.p=float4(i.uv.x*1.6-.8,.8-i.uv.y*1.6,0,1);o.c=i.c;return o;}float4 ps(O o):SV_Target{return o.c;}";
 struct P{int16_t normal[2];uint16_t uv[4][2];uint32_t tangent[3],color;};static_assert(sizeof(P)==36,"packed stride");P packed_vertices[3]={};packed_vertices[0].uv[0][0]=0;packed_vertices[0].uv[0][1]=65535;packed_vertices[1].uv[0][0]=32768;packed_vertices[1].uv[0][1]=0;packed_vertices[2].uv[0][0]=65535;packed_vertices[2].uv[0][1]=65535;for(auto &v:packed_vertices)v.color=0xff0000ff;
 layout={elem("NORMAL",0,DXGI_FORMAT_R16G16_SNORM,0,0)};for(UINT i=0;i<4;i++)layout.push_back(elem("TEXCOORD",i,DXGI_FORMAT_R16G16_UNORM,0,4+i*4));for(UINT i=0;i<3;i++)layout.push_back(elem("TANGENT",i,DXGI_FORMAT_R10G10B10A2_UNORM,0,20+i*4));layout.push_back(elem("COLOR",0,DXGI_FORMAT_R8G8B8A8_UNORM,0,32));automatic=layout;for(size_t i=1;i<automatic.size();i++)automatic[i].AlignedByteOffset=D3D12_APPEND_ALIGNED_ELEMENT;good&=pair("packed_unused_attributes",packed,layout,automatic,packed_vertices,sizeof(packed_vertices),sizeof(P));
 const char *instanced="struct I{float2 p:POSITION;float4 a:ROW0;float4 b:ROW1;float4 c:ROW2;};struct O{float4 p:SV_Position;};O vs(I i){O o;float4 p=float4(i.p,0,1);o.p=float4(dot(i.a,p),dot(i.b,p),dot(i.c,p),1);return o;}float4 ps(O o):SV_Target{return float4(1,0,0,1);}";
 float pos[6]={-.8f,-.8f,0,.8f,.8f,-.8f};struct M{int16_t unused[2];float rows[3][4];};static_assert(sizeof(M)==52,"instance stride");M matrix={{0,0},{{.6062178f,-.35f,0,.1f},{.35f,.6062178f,0,.05f},{0,0,1,0}}};layout={elem("POSITION",0,DXGI_FORMAT_R32G32_FLOAT,0,0),elem("NORMAL",0,DXGI_FORMAT_R16G16_SNORM,1,0,D3D12_INPUT_CLASSIFICATION_PER_INSTANCE_DATA)};for(UINT i=0;i<3;i++)layout.push_back(elem("ROW",i,DXGI_FORMAT_R32G32B32A32_FLOAT,1,4+i*16,D3D12_INPUT_CLASSIFICATION_PER_INSTANCE_DATA));automatic=layout;for(size_t i=2;i<automatic.size();i++)automatic[i].AlignedByteOffset=D3D12_APPEND_ALIGNED_ELEMENT;good&=pair("instance_matrix_unused_prefix",instanced,layout,automatic,pos,sizeof(pos),8,&matrix,sizeof(matrix));
 root->Release();fence->Release();queue->Release();dev->Release();return good?0:9;
}
