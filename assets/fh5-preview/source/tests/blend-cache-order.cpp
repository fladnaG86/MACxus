// Owned shader cache-order control; no game shader source or assets.
#define MACXUS_ACTIVE_BLEND_PROBE
#define MACXUS_CACHE_ORDER_PROBE
#include <vector>
static std::vector<unsigned char> cache_probe_shaders[2];
static bool cache_probe_same_shaders=true;
static bool cache_probe_dual;
#define main unused_input_layout_main
#define MACXUS_ACTIVE_BLEND_ENABLE cache_probe_dual
#include "input-layout.cpp"
#undef main
int main(int argc,char **argv){
 std::setbuf(stdout,nullptr);if(argc!=4)return 2;stream_mode=!std::strcmp(argv[2],"stream");bool invalid_first=!std::strcmp(argv[3],"invalid-first");
 HMODULE dll=LoadLibraryA(argv[1]);if(!dll)return 3;
 auto create=(HRESULT(WINAPI*)(IUnknown*,D3D_FEATURE_LEVEL,REFIID,void**))GetProcAddress(dll,"D3D12CreateDevice");auto serialize=(HRESULT(WINAPI*)(const D3D12_ROOT_SIGNATURE_DESC*,D3D_ROOT_SIGNATURE_VERSION,ID3DBlob**,ID3DBlob**))GetProcAddress(dll,"D3D12SerializeRootSignature");if(!create||!serialize)return 4;
 if(FAILED(create(nullptr,D3D_FEATURE_LEVEL_11_0,IID_ID3D12Device,(void**)&dev)))return 5;
 D3D12_COMMAND_QUEUE_DESC q={};q.Type=D3D12_COMMAND_LIST_TYPE_DIRECT;if(FAILED(dev->CreateCommandQueue(&q,IID_ID3D12CommandQueue,(void**)&queue))||FAILED(dev->CreateFence(0,D3D12_FENCE_FLAG_NONE,IID_ID3D12Fence,(void**)&fence)))return 6;
 D3D12_ROOT_SIGNATURE_DESC rd={};rd.Flags=D3D12_ROOT_SIGNATURE_FLAG_ALLOW_INPUT_ASSEMBLER_INPUT_LAYOUT;ID3DBlob *rs=nullptr,*error=nullptr;if(FAILED(serialize(&rd,D3D_ROOT_SIGNATURE_VERSION_1,&rs,&error)))return 7;if(FAILED(dev->CreateRootSignature(0,rs->GetBufferPointer(),rs->GetBufferSize(),IID_ID3D12RootSignature,(void**)&root)))return 8;rs->Release();if(error)error->Release();
 const char*code="struct I{float2 p:POSITION;};float4 vs(I i):SV_Position{return float4(i.p,0,1);}float4 ps():SV_Target{return float4(.25,0,0,1);}";const float verts[]={-.8f,-.8f,0,.8f,.8f,-.8f};bool good=true;
 for(int i=0;i<3;i++){
  cache_probe_dual=invalid_first?i==0:i==1;Render result;if(!draw("cache_order",code,{elem("POSITION",0,DXGI_FORMAT_R32G32_FLOAT,0,0)},verts,sizeof verts,8,nullptr,0,result))return 9;
  auto c=&result.pixels[(H/2*W+W/2)*4];bool red=c[0]>=63&&c[0]<=65&&c[1]==0&&c[2]==0&&c[3]==255;bool blue=c[0]==0&&c[1]==0&&c[2]==255&&c[3]==255;good&=cache_probe_dual?blue:red;
  std::printf("CACHE_ORDER index=%d dual=%d red=%d skipped=%d center=%u,%u,%u,%u\n",i,cache_probe_dual,red,blue,c[0],c[1],c[2],c[3]);
 }
 std::printf("CACHE_SHADER_BYTES identical=%d\n",cache_probe_same_shaders);
 root->Release();fence->Release();queue->Release();dev->Release();return good&&cache_probe_same_shaders?0:10;
}
