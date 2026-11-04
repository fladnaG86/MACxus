// Owned signatures and pixels only: investigate converter restrictions, not a
// Windows conformance verdict or a repair for any particular game shader.
#define MACXUS_ACTIVE_BLEND_PROBE
#define main unused_input_layout_main
#include "input-layout.cpp"
#include <string>
#undef main

int main(int argc,char **argv) {
    std::setbuf(stdout,nullptr);
    if(argc<4||argc>5)return 2;
    unsigned outputs=(unsigned)std::strtoul(argv[2],nullptr,10);
    if(outputs<1||outputs>4)return 2;
    stream_mode=!std::strcmp(argv[3],"stream");
    bool depth=argc==5&&!std::strcmp(argv[4],"depth");
    HMODULE dll=LoadLibraryA(argv[1]);if(!dll)return 3;
    auto create=(HRESULT(WINAPI*)(IUnknown*,D3D_FEATURE_LEVEL,REFIID,void**))GetProcAddress(dll,"D3D12CreateDevice");
    auto serialize=(HRESULT(WINAPI*)(const D3D12_ROOT_SIGNATURE_DESC*,D3D_ROOT_SIGNATURE_VERSION,ID3DBlob**,ID3DBlob**))GetProcAddress(dll,"D3D12SerializeRootSignature");
    if(!create||!serialize)return 4;
    if(FAILED(create(nullptr,D3D_FEATURE_LEVEL_11_0,IID_ID3D12Device,(void**)&dev)))return 5;
    D3D12_COMMAND_QUEUE_DESC q={};q.Type=D3D12_COMMAND_LIST_TYPE_DIRECT;
    if(FAILED(dev->CreateCommandQueue(&q,IID_ID3D12CommandQueue,(void**)&queue))||FAILED(dev->CreateFence(0,D3D12_FENCE_FLAG_NONE,IID_ID3D12Fence,(void**)&fence)))return 6;
    D3D12_ROOT_SIGNATURE_DESC rd={};rd.Flags=D3D12_ROOT_SIGNATURE_FLAG_ALLOW_INPUT_ASSEMBLER_INPUT_LAYOUT;
    ID3DBlob *rs=nullptr,*error=nullptr;if(FAILED(serialize(&rd,D3D_ROOT_SIGNATURE_VERSION_1,&rs,&error)))return 7;
    if(FAILED(dev->CreateRootSignature(0,rs->GetBufferPointer(),rs->GetBufferSize(),IID_ID3D12RootSignature,(void**)&root)))return 8;
    rs->Release();if(error)error->Release();
    std::string source="struct I{float2 p:POSITION;};float4 vs(I i):SV_Position{return float4(i.p,0,1);}struct P{";
    for(unsigned i=0;i<outputs;i++)source+="float4 c"+std::to_string(i)+":SV_Target"+std::to_string(i)+";";
    if(depth)source+="float d:SV_Depth;";
    source+="};P ps(){P o;o.c0=float4(.25,0,0,1);";
    for(unsigned i=1;i<outputs;i++)source+="o.c"+std::to_string(i)+"=float4(.5,.5,.5,.5);";
    if(depth)source+="o.d=.5;";
    source+="return o;}";
    const float vertices[]={-.8f,-.8f,0,.8f,.8f,-.8f};
    Render result;bool ok=draw("active_dual_source",source.c_str(),{elem("POSITION",0,DXGI_FORMAT_R32G32_FLOAT,0,0)},vertices,sizeof(vertices),8,nullptr,0,result);
    if(!ok)return 9;
    const unsigned char *center=&result.pixels[(H/2*W+W/2)*4];
    bool blended=center[0]>=63&&center[0]<=65&&center[1]==0&&center[2]>=127&&center[2]<=129&&center[3]==255;
    bool skipped=center[0]==0&&center[1]==0&&center[2]==255&&center[3]==255;
    std::printf("ACTIVE_BLEND outputs=%u api=%s center=%u,%u,%u,%u blended=%d skipped=%d depth=%d\n",outputs,stream_mode?"stream":"direct",center[0],center[1],center[2],center[3],blended,skipped,depth);
    root->Release();fence->Release();queue->Release();dev->Release();
    return blended?0:skipped?10:11;
}
