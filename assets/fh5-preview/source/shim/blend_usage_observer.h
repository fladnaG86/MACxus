/* Opt-in recording-usage diagnostic. Never retains COM objects or shader bytes,
 * adds GPU commands, or changes pipeline parameters. Counts recorded calls,
 * not submitted work or visible pixels. Capacity/unknown cases remain explicit. */
#ifndef MACXUS_BLEND_USAGE_OBSERVER_H
#define MACXUS_BLEND_USAGE_OBSERVER_H
#include "shader_signature.h"
#include "shader_keywords.h"
#include "render_audit_log.h"
#include "render_layout_metadata.h"
enum { USAGE_PIPE_CAP=65536,USAGE_LIST_CAP=2048 };
struct usage_shape {
    unsigned category,targets,signature_known,outputs,mask;
    unsigned tags,format0,blend,src,dst,src_alpha,dst_alpha;
    unsigned depth_known,depth_on,depth_write,depth_function;
    unsigned input_elements,instance_elements,geometry,tessellation;
    unsigned layout_id;
};
struct usage_pipe { const void *key;unsigned id;struct usage_shape shape; };
enum { USAGE_VERTEX_SLOTS=32 };
struct usage_vertex_binding { UINT known,bound,size,stride; };
struct usage_bindings {
    struct usage_vertex_binding vertex[USAGE_VERTEX_SLOTS];
    UINT index_known,index_bound,index_size,index_format;
};
struct usage_list { const void *key;struct usage_pipe pipeline;struct usage_bindings bindings; };
static struct usage_pipe usage_pipes[USAGE_PIPE_CAP];
static struct usage_list usage_lists[USAGE_LIST_CAP];
static SRWLOCK usage_lock=SRWLOCK_INIT;
static LONG usage_next_id,usage_counts[5][3],usage_overflow;
static LONG render_audit_seen[USAGE_PIPE_CAP][3],render_audit_id_overflow;
static unsigned usage_hash(const void *p,unsigned capacity){return(unsigned)(((uintptr_t)p>>4)*0x9e3779b97f4a7c15ull) & (capacity-1);}
static struct usage_shape usage_classify(const D3D12_BLEND_DESC *blend,UINT targets,DXGI_FORMAT format0,D3D12_SHADER_BYTECODE ps,BOOL corrected) {
    struct usage_shape s={.targets=targets};
    if(fh5_render_audit) {
        const D3D12_RENDER_TARGET_BLEND_DESC *b=&blend->RenderTarget[0];
        s.tags=shader_debug_keywords(ps.pShaderBytecode,ps.BytecodeLength);
        s.format0=format0;s.blend=b->BlendEnable;s.src=b->SrcBlend;s.dst=b->DestBlend;
        s.src_alpha=b->SrcBlendAlpha;s.dst_alpha=b->DestBlendAlpha;
        struct shader_outputs o;
        s.signature_known=shader_output_signature(ps.pShaderBytecode,ps.BytecodeLength,&o);
        s.outputs=o.count;s.mask=o.mask;
    }
    if(corrected){s.category=4;return s;}
    if(!blend_forces_dualsrc(blend))return s;
    struct shader_outputs outputs;
    s.signature_known=shader_output_signature(ps.pShaderBytecode,ps.BytecodeLength,&outputs);
    s.outputs=outputs.count;s.mask=outputs.mask;
    // Only the observed one-RT case is classified against the owned probe.
    s.category=!s.signature_known||targets!=1||format0==DXGI_FORMAT_UNKNOWN ? 3 : s.outputs==2&&s.mask==3 ? 2 : 1;
    return s;
}
static void usage_register(const void *key,struct usage_shape shape) {
    if(!fh5_blend_usage||!key)return;
    DWORD saved=GetLastError();BOOL stored=FALSE;unsigned id=0;
    AcquireSRWLockExclusive(&usage_lock);
    unsigned start=usage_hash(key,USAGE_PIPE_CAP);
    for(unsigned n=0;n<USAGE_PIPE_CAP;n++) {
        struct usage_pipe *p=&usage_pipes[(start+n)&(USAGE_PIPE_CAP-1)];
        if(!p->key||p->key==key){id=(unsigned)InterlockedIncrement(&usage_next_id);*p=(struct usage_pipe){key,id,shape};stored=TRUE;break;}
    }
    ReleaseSRWLockExclusive(&usage_lock);
    if(!stored&&InterlockedIncrement(&usage_overflow)<=4)observer_note(25,0,"usage_capacity kind=pipeline recording_observation_incomplete=1");
    // Sample creation categories independently; do not log object addresses.
    static LONG created[5];
    if(stored&&shape.category){LONG n=InterlockedIncrement(&created[shape.category]);if(n<=8||!(n&(n-1)))observer_note(25,0,"usage_create id=%u category=%u count=%ld targets=%u signature_known=%u outputs=%u mask=%x",id,shape.category,(long)n,shape.targets,shape.signature_known,shape.outputs,shape.mask);}
    SetLastError(saved);
}
static void usage_register_graphics(const void *key,const D3D12_GRAPHICS_PIPELINE_STATE_DESC *d,BOOL corrected) {
    DWORD saved=GetLastError();
    if(fh5_blend_usage&&d) {
        struct usage_shape shape=usage_classify(&d->BlendState,d->NumRenderTargets,d->RTVFormats[0],d->PS,corrected);
        if(fh5_render_audit) {
            shape.tags|=shader_debug_keywords(d->VS.pShaderBytecode,d->VS.BytecodeLength);
            shape.depth_known=1;shape.depth_on=d->DepthStencilState.DepthEnable;
            shape.depth_write=d->DepthStencilState.DepthWriteMask;shape.depth_function=d->DepthStencilState.DepthFunc;
            shape.input_elements=d->InputLayout.NumElements;
            if(d->InputLayout.pInputElementDescs&&d->InputLayout.NumElements<=32)
                for(unsigned i=0;i<d->InputLayout.NumElements;i++)shape.instance_elements+=d->InputLayout.pInputElementDescs[i].InputSlotClass==D3D12_INPUT_CLASSIFICATION_PER_INSTANCE_DATA;
            shape.geometry=d->GS.BytecodeLength!=0;shape.tessellation=d->HS.BytecodeLength!=0||d->DS.BytecodeLength!=0;
            if(shape.tags)shape.layout_id=render_layout_register(&d->InputLayout);
        }
        usage_register(key,shape);
    }
    SetLastError(saved);
}
static void usage_register_stream(const void *key,const D3D12_PIPELINE_STATE_STREAM_DESC *d,BOOL corrected) {
    if(!fh5_blend_usage||!key||!d||!d->pPipelineStateSubobjectStream)return;
    DWORD saved=GetLastError();
    const UINT8 *bytes=d->pPipelineStateSubobjectStream;SIZE_T offset=0;D3D12_BLEND_DESC blend={0};D3D12_SHADER_BYTECODE ps={0},vs={0};struct D3D12_RT_FORMAT_ARRAY formats={{0},0};
    struct usage_shape meta={0};
    D3D12_INPUT_LAYOUT_DESC audit_input={0};
    while(offset<d->SizeInBytes) {
        UINT type;SIZE_T align,size,at;
        if(d->SizeInBytes-offset<sizeof type)goto unknown;
        memcpy(&type,bytes+offset,sizeof type);size=stream_inner_size(type,&align);if(!size)goto unknown;
        at=(offset+sizeof type+align-1)&~(align-1);if(at>d->SizeInBytes||size>d->SizeInBytes-at)goto unknown;
        if(type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_BLEND)memcpy(&blend,bytes+at,sizeof blend);
        if(type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_PS)memcpy(&ps,bytes+at,sizeof ps);
        if(fh5_render_audit) {
            if(type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_VS)memcpy(&vs,bytes+at,sizeof vs);
            if(type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_GS||type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_HS||type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_DS) {
                D3D12_SHADER_BYTECODE shader;memcpy(&shader,bytes+at,sizeof shader);
                if(type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_GS)meta.geometry=shader.BytecodeLength!=0;
                else meta.tessellation|=shader.BytecodeLength!=0;
            }
            if(type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_DEPTH_STENCIL) {
                D3D12_DEPTH_STENCIL_DESC depth;memcpy(&depth,bytes+at,sizeof depth);
                meta.depth_known=1;meta.depth_on=depth.DepthEnable;meta.depth_write=depth.DepthWriteMask;meta.depth_function=depth.DepthFunc;
            }
            if(type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_INPUT_LAYOUT) {
                D3D12_INPUT_LAYOUT_DESC input;memcpy(&input,bytes+at,sizeof input);meta.input_elements=input.NumElements;
                audit_input=input;
                if(input.pInputElementDescs&&input.NumElements<=32)
                    for(unsigned i=0;i<input.NumElements;i++)meta.instance_elements+=input.pInputElementDescs[i].InputSlotClass==D3D12_INPUT_CLASSIFICATION_PER_INSTANCE_DATA;
            }
        }
        if(type==D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_RENDER_TARGET_FORMATS)memcpy(&formats,bytes+at,sizeof formats);
        offset=(at+size+sizeof(void*)-1)&~(sizeof(void*)-1);
    }
    {
        struct usage_shape shape=usage_classify(&blend,formats.NumRenderTargets,formats.RTFormats[0],ps,corrected);
        if(fh5_render_audit) {
            shape.tags|=shader_debug_keywords(vs.pShaderBytecode,vs.BytecodeLength);
            shape.depth_known=meta.depth_known;shape.depth_on=meta.depth_on;shape.depth_write=meta.depth_write;shape.depth_function=meta.depth_function;
            shape.input_elements=meta.input_elements;shape.instance_elements=meta.instance_elements;
            shape.geometry=meta.geometry;shape.tessellation=meta.tessellation;
            if(shape.tags)shape.layout_id=render_layout_register(&audit_input);
        }
        usage_register(key,shape);
    }
    SetLastError(saved);return;
 unknown:usage_register(key,(struct usage_shape){.category=3});SetLastError(saved);
}
/* No GPU addresses or resource contents are retained. Unknown stays distinct
 * from an observed null binding; successful Reset/Create discard old state. */
static struct usage_list *usage_list_locked(const void *list,BOOL create) {
    unsigned start=usage_hash(list,USAGE_LIST_CAP);
    for(unsigned n=0;n<USAGE_LIST_CAP;n++) {
        struct usage_list *entry=&usage_lists[(start+n)&(USAGE_LIST_CAP-1)];
        if(entry->key==list)return entry;
        if(!entry->key){if(create){entry->key=list;return entry;}return NULL;}
    }
    return NULL;
}
static void usage_clear_bindings(const void *list) {
    if(!fh5_blend_usage||!list)return;
    DWORD saved=GetLastError();AcquireSRWLockExclusive(&usage_lock);
    struct usage_list *entry=usage_list_locked(list,TRUE);
    if(entry)memset(&entry->bindings,0,sizeof entry->bindings);
    ReleaseSRWLockExclusive(&usage_lock);SetLastError(saved);
}
static void usage_vertex_bindings(const void *list,UINT first,UINT count,const D3D12_VERTEX_BUFFER_VIEW *views) {
    if(!fh5_blend_usage||!fh5_render_audit||!list||!count)return;
    DWORD saved=GetLastError();AcquireSRWLockExclusive(&usage_lock);
    struct usage_list *entry=usage_list_locked(list,TRUE);
    if(entry&&first<USAGE_VERTEX_SLOTS&&count<=USAGE_VERTEX_SLOTS-first) {
        for(UINT i=0;i<count;i++)entry->bindings.vertex[first+i]=views?
            (struct usage_vertex_binding){1,views[i].BufferLocation!=0,views[i].SizeInBytes,views[i].StrideInBytes}:
            (struct usage_vertex_binding){.known=1};
    } else if(entry)memset(entry->bindings.vertex,0,sizeof entry->bindings.vertex);
    ReleaseSRWLockExclusive(&usage_lock);SetLastError(saved);
}
static void usage_index_binding(const void *list,const D3D12_INDEX_BUFFER_VIEW *view) {
    if(!fh5_blend_usage||!fh5_render_audit||!list)return;
    DWORD saved=GetLastError();AcquireSRWLockExclusive(&usage_lock);
    struct usage_list *entry=usage_list_locked(list,TRUE);
    if(entry){entry->bindings.index_known=1;entry->bindings.index_bound=view&&view->BufferLocation!=0;
        entry->bindings.index_size=view?view->SizeInBytes:0;entry->bindings.index_format=view?view->Format:0;}
    ReleaseSRWLockExclusive(&usage_lock);SetLastError(saved);
}
static void usage_bind(const void *list,const void *pipeline) {
    if(!fh5_blend_usage||!list)return;
    DWORD saved=GetLastError();struct usage_pipe value={0};BOOL stored=FALSE;
    AcquireSRWLockExclusive(&usage_lock);
    if(pipeline){unsigned start=usage_hash(pipeline,USAGE_PIPE_CAP);for(unsigned n=0;n<USAGE_PIPE_CAP;n++){struct usage_pipe*p=&usage_pipes[(start+n)&(USAGE_PIPE_CAP-1)];if(!p->key)break;if(p->key==pipeline){value=*p;break;}}if(!value.key)value.shape.category=3;}
    unsigned start=usage_hash(list,USAGE_LIST_CAP);
    for(unsigned n=0;n<USAGE_LIST_CAP;n++){struct usage_list*p=&usage_lists[(start+n)&(USAGE_LIST_CAP-1)];if(!p->key||p->key==list){p->key=list;p->pipeline=value;stored=TRUE;break;}}
    ReleaseSRWLockExclusive(&usage_lock);
    if(!stored&&InterlockedIncrement(&usage_overflow)<=4)observer_note(25,0,"usage_capacity kind=list recording_observation_incomplete=1");
    SetLastError(saved);
}
struct render_draw_arguments { UINT known,count,instances,start,start_instance,indirect_max;INT base_vertex; };
static void usage_draw(const void *list,unsigned kind,const struct render_draw_arguments *arguments) {
    if(!fh5_blend_usage)return;
    DWORD saved=GetLastError();struct usage_pipe value={0};struct usage_bindings bindings={0};BOOL found=FALSE;
    AcquireSRWLockShared(&usage_lock);unsigned start=usage_hash(list,USAGE_LIST_CAP);
    for(unsigned n=0;n<USAGE_LIST_CAP;n++){struct usage_list*p=&usage_lists[(start+n)&(USAGE_LIST_CAP-1)];if(!p->key)break;if(p->key==list){value=p->pipeline;bindings=p->bindings;found=TRUE;break;}}
    ReleaseSRWLockShared(&usage_lock);
    unsigned category=found&&value.key?value.shape.category:3;
    if(fh5_render_audit&&value.shape.tags&&kind<3) {
        if(value.id>=USAGE_PIPE_CAP) {
            if(InterlockedIncrement(&render_audit_id_overflow)<=4)render_audit_note("op=id_capacity observation_incomplete=1");
        } else if(value.id&&!InterlockedCompareExchange(&render_audit_seen[value.id][kind],1,0)) {
            const struct usage_shape *s=&value.shape;
            struct render_draw_arguments empty={0};const struct render_draw_arguments *a=arguments?arguments:&empty;
            render_audit_note("op=record kind=%u pipeline_id=%u tags=%u category=%u targets=%u format0=%u signature_known=%u outputs=%u mask=%u blend=%u factors=%u,%u,%u,%u depth_known=%u depth=%u,%u,%u input_elements=%u instance_elements=%u geometry=%u tessellation=%u layout_id=%u draw_known=%u count=%u instances=%u start=%u base_vertex=%d start_instance=%u indirect_max=%u",
                kind,value.id,s->tags,s->category,s->targets,s->format0,s->signature_known,s->outputs,s->mask,s->blend,s->src,s->dst,s->src_alpha,s->dst_alpha,
                s->depth_known,s->depth_on,s->depth_write,s->depth_function,s->input_elements,s->instance_elements,s->geometry,s->tessellation,s->layout_id,
                a->known,a->count,a->instances,a->start,a->base_vertex,a->start_instance,a->indirect_max);
            render_audit_note("op=index_binding pipeline_id=%u kind=%u known=%u bound=%u size=%u format=%u",
                value.id,kind,bindings.index_known,bindings.index_bound,bindings.index_size,bindings.index_format);
            if(s->layout_id&&s->layout_id<=RENDER_LAYOUT_CAP) {
                const struct render_layout *layout=&render_layouts[s->layout_id-1];
                UINT seen=0;
                for(unsigned i=0;i<layout->count;i++) {
                    UINT slot=layout->elements[i].slot;
                    if(slot>=USAGE_VERTEX_SLOTS||(seen&(1u<<slot)))continue;
                    seen|=1u<<slot;const struct usage_vertex_binding *binding=&bindings.vertex[slot];
                    render_audit_note("op=vertex_binding pipeline_id=%u kind=%u slot=%u known=%u bound=%u size=%u stride=%u",
                        value.id,kind,slot,binding->known,binding->bound,binding->size,binding->stride);
                }
            }
        }
    }
    if(category){LONG count=InterlockedIncrement(&usage_counts[category][kind]);if(count<=8||!(count&(count-1)))observer_note(25,0,"usage_record kind=%u category=%u count=%ld pipeline_id=%u outputs=%u mask=%x initial_binding_known=%u",kind,category,(long)count,value.id,value.shape.outputs,value.shape.mask,found&&value.key!=NULL);}
    SetLastError(saved);
}
static void (STDMETHODCALLTYPE *usage_real_clear)(ID3D12GraphicsCommandList*,ID3D12PipelineState*);
static void (STDMETHODCALLTYPE *usage_real_bundle)(ID3D12GraphicsCommandList*,ID3D12GraphicsCommandList*);
static void STDMETHODCALLTYPE usage_clear(ID3D12GraphicsCommandList*l,ID3D12PipelineState*p){usage_real_clear(l,p);DWORD saved=GetLastError();usage_clear_bindings(l);usage_bind(l,p);SetLastError(saved);}
static void STDMETHODCALLTYPE usage_bundle(ID3D12GraphicsCommandList*l,ID3D12GraphicsCommandList*b){usage_real_bundle(l,b);DWORD saved=GetLastError();usage_clear_bindings(l);usage_bind(l,NULL);SetLastError(saved);}
static void (STDMETHODCALLTYPE *usage_real_vertex)(ID3D12GraphicsCommandList*,UINT,UINT,const D3D12_VERTEX_BUFFER_VIEW*);
static void (STDMETHODCALLTYPE *usage_real_index)(ID3D12GraphicsCommandList*,const D3D12_INDEX_BUFFER_VIEW*);
static void STDMETHODCALLTYPE usage_vertex(ID3D12GraphicsCommandList*l,UINT first,UINT count,const D3D12_VERTEX_BUFFER_VIEW*v){usage_real_vertex(l,first,count,v);DWORD saved=GetLastError();usage_vertex_bindings(l,first,count,v);SetLastError(saved);}
static void STDMETHODCALLTYPE usage_index(ID3D12GraphicsCommandList*l,const D3D12_INDEX_BUFFER_VIEW*v){usage_real_index(l,v);DWORD saved=GetLastError();usage_index_binding(l,v);SetLastError(saved);}
static void (STDMETHODCALLTYPE *usage_real_set)(ID3D12GraphicsCommandList*,ID3D12PipelineState*);
static HRESULT (STDMETHODCALLTYPE *usage_real_reset)(ID3D12GraphicsCommandList*,ID3D12CommandAllocator*,ID3D12PipelineState*);
static void (STDMETHODCALLTYPE *usage_real_draw)(ID3D12GraphicsCommandList*,UINT,UINT,UINT,UINT);
static void (STDMETHODCALLTYPE *usage_real_indexed)(ID3D12GraphicsCommandList*,UINT,UINT,UINT,INT,UINT);
static void (STDMETHODCALLTYPE *usage_real_indirect)(ID3D12GraphicsCommandList*,ID3D12CommandSignature*,UINT,ID3D12Resource*,UINT64,ID3D12Resource*,UINT64);
static void STDMETHODCALLTYPE usage_set(ID3D12GraphicsCommandList*l,ID3D12PipelineState*p){usage_real_set(l,p);DWORD saved=GetLastError();usage_bind(l,p);SetLastError(saved);}
static HRESULT STDMETHODCALLTYPE usage_reset(ID3D12GraphicsCommandList*l,ID3D12CommandAllocator*a,ID3D12PipelineState*p){HRESULT hr=usage_real_reset(l,a,p);DWORD saved=GetLastError();if(SUCCEEDED(hr)){usage_clear_bindings(l);usage_bind(l,p);}SetLastError(saved);return hr;}
static void STDMETHODCALLTYPE usage_draw_instanced(ID3D12GraphicsCommandList*l,UINT a,UINT b,UINT c,UINT d){struct render_draw_arguments args={.known=1,.count=a,.instances=b,.start=c,.start_instance=d};usage_draw(l,0,&args);usage_real_draw(l,a,b,c,d);}
static void STDMETHODCALLTYPE usage_draw_indexed(ID3D12GraphicsCommandList*l,UINT a,UINT b,UINT c,INT d,UINT e){struct render_draw_arguments args={.known=1,.count=a,.instances=b,.start=c,.start_instance=e,.base_vertex=d};usage_draw(l,1,&args);usage_real_indexed(l,a,b,c,d,e);}
static void STDMETHODCALLTYPE usage_execute_indirect(ID3D12GraphicsCommandList*l,ID3D12CommandSignature*s,UINT n,ID3D12Resource*a,UINT64 ao,ID3D12Resource*c,UINT64 co){struct render_draw_arguments args={.indirect_max=n};usage_draw(l,2,&args);usage_real_indirect(l,s,n,a,ao,c,co);}
static void usage_patch_list(ID3D12GraphicsCommandListVtbl *v) {
    if(!fh5_blend_usage)return;
    if(fh5_render_audit) {
        patch_slot((void**)&v->ClearState,(void*)usage_clear,(void**)&usage_real_clear);
        patch_slot((void**)&v->ExecuteBundle,(void*)usage_bundle,(void**)&usage_real_bundle);
        patch_slot((void**)&v->IASetVertexBuffers,(void*)usage_vertex,(void**)&usage_real_vertex);
        patch_slot((void**)&v->IASetIndexBuffer,(void*)usage_index,(void**)&usage_real_index);
    }
    patch_slot((void**)&v->SetPipelineState,(void*)usage_set,(void**)&usage_real_set);
    patch_slot((void**)&v->Reset,(void*)usage_reset,(void**)&usage_real_reset);
    patch_slot((void**)&v->DrawInstanced,(void*)usage_draw_instanced,(void**)&usage_real_draw);
    patch_slot((void**)&v->DrawIndexedInstanced,(void*)usage_draw_indexed,(void**)&usage_real_indexed);
    patch_slot((void**)&v->ExecuteIndirect,(void*)usage_execute_indirect,(void**)&usage_real_indirect);
}
#endif
