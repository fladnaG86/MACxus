#ifndef MACXUS_RENDER_LAYOUT_METADATA_H
#define MACXUS_RENDER_LAYOUT_METADATA_H
/* Immutable numeric layouts only; no shader names, buffer data or API changes. */
enum { RENDER_LAYOUT_CAP=256 };
struct render_attribute { UINT semantic,index,format,slot,supplied_offset,actual_offset,classification,step; };
struct render_layout { UINT count,normalized;struct render_attribute elements[32]; };
static struct render_layout render_layouts[RENDER_LAYOUT_CAP];
static unsigned render_layout_count;
static LONG render_layout_overflow;
static SRWLOCK render_layout_lock=SRWLOCK_INIT;
static unsigned render_semantic_kind(const char *name)
{
    static const char *const names[]={"POSITION","NORMAL","TANGENT","BINORMAL","COLOR","TEXCOORD","BLENDINDICES","BLENDWEIGHT","INSTANCE"};
    if(!name)return 0;
    for(unsigned i=0;i<9;i++) {
        size_t n=strlen(names[i]),at=0;
        for(;at<n;at++){unsigned char c=(unsigned char)name[at];if(c>='a'&&c<='z')c-='a'-'A';if(c!=(unsigned char)names[i][at])break;}
        if(at==n&&!name[n])return i+1;
    }
    return 0;
}
static unsigned render_layout_register(const D3D12_INPUT_LAYOUT_DESC *input)
{
    if(!input||input->NumElements>32||(input->NumElements&&!input->pInputElementDescs))return 0;
    DWORD saved=GetLastError();struct render_layout value={0};D3D12_INPUT_ELEMENT_DESC resolved[32];
    value.count=input->NumElements;value.normalized=resolve_append_offsets(input,resolved);
    for(unsigned i=0;i<value.count;i++) {
        const D3D12_INPUT_ELEMENT_DESC *e=input->pInputElementDescs+i;
        value.elements[i]=(struct render_attribute){render_semantic_kind(e->SemanticName),e->SemanticIndex,e->Format,e->InputSlot,e->AlignedByteOffset,
            value.normalized?resolved[i].AlignedByteOffset:e->AlignedByteOffset,e->InputSlotClass,e->InstanceDataStepRate};
    }
    unsigned id=0;BOOL added=FALSE;
    AcquireSRWLockExclusive(&render_layout_lock);
    for(unsigned i=0;i<render_layout_count;i++)if(!memcmp(render_layouts+i,&value,sizeof value)){id=i+1;break;}
    if(!id&&render_layout_count<RENDER_LAYOUT_CAP){render_layouts[render_layout_count]=value;id=++render_layout_count;added=TRUE;}
    ReleaseSRWLockExclusive(&render_layout_lock);
    if(added) {
        render_audit_note("op=layout layout_id=%u count=%u normalized=%u",id,value.count,value.normalized);
        for(unsigned i=0;i<value.count;i++) {
            const struct render_attribute *e=value.elements+i;
            render_audit_note("op=attribute layout_id=%u element=%u semantic=%u semantic_index=%u format=%u slot=%u supplied_offset=%u actual_offset=%u classification=%u step=%u",
                id,i,e->semantic,e->index,e->format,e->slot,e->supplied_offset,e->actual_offset,e->classification,e->step);
        }
    } else if(!id&&InterlockedIncrement(&render_layout_overflow)<=4)render_audit_note("op=layout_capacity observation_incomplete=1");
    SetLastError(saved);return id;
}
#endif
