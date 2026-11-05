#include "../shim/d3d12.c"
static unsigned checks;
#define CHECK(x) do { checks++; if (!(x)) { printf("STREAM_DEBUG_FAIL line=%d\n", __LINE__); return 1; } } while (0)
int main(void)
{
    const char *values[] = {NULL, "", "0", "1", "2", "3", "10", "20", "true", "1234567890123456"};
    const int levels[] = {0, 0, 0, 1, 2, 0, 0, 0, 0, 0};
    for (unsigned i = 0; i < sizeof(values) / sizeof(*values); i++) {
        CHECK(SetEnvironmentVariableA("HB_TSSHIM_DEBUG", values[i]));
        CHECK(shim_debug_level() == levels[i]);
    }
    SYSTEM_INFO info; GetSystemInfo(&info);
    unsigned char *memory = VirtualAlloc(NULL, info.dwPageSize * 2, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
    CHECK(memory != NULL); DWORD old;
    CHECK(VirtualProtect(memory + info.dwPageSize, info.dwPageSize, PAGE_NOACCESS, &old));
    timestamp_only = append_only = 1; dbg = 1;
    unsigned char shader[32] = {'D', 'X', 'B', 'C', 1, 2, 3, 4, 5, 6, 7, 8}; UINT64 expected;
    memcpy(&expected, shader + 4, sizeof expected);
    for (UINT type = 0; type <= 28; type++) {
        SIZE_T align, size = stream_inner_size(type, &align);
        if (!size) continue;
        SIZE_T at = (sizeof(UINT) + align - 1) & ~(align - 1);
        SIZE_T length = (at + size + 7) & ~(SIZE_T)7;
        unsigned char *stream = memory + info.dwPageSize - length;
        memset(stream, 0, length); memcpy(stream, &type, sizeof type);
        BOOL shader_record = (type >= D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_VS && type <= D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_GS)
            || type == D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_AS || type == D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_MS;
        if (shader_record) {
            D3D12_SHADER_BYTECODE code = {shader, sizeof shader}; memcpy(stream + at, &code, sizeof code);
        }
        if (type == D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_CACHED_PSO) {
            // Valid opaque cache shape; it must never be read as shader bytes.
            D3D12_CACHED_PIPELINE_STATE cache = {(void *)1, 4096}; memcpy(stream + at, &cache, sizeof cache);
        }
        D3D12_PIPELINE_STATE_STREAM_DESC in = {length, stream}, out = {0}; Fixups fix;
        CHECK(!rewrite_stream(&in, &out, &fix));
        for (unsigned slot = 0; slot < 8; slot++) {
            unsigned expected_slot = type <= 5 ? type - 1 : type - 18;
            CHECK(fix.hash[slot] == (shader_record && slot == expected_slot ? expected : 0));
        }
        free_fixups(&fix);
        // Truncated subobjects must fail before any payload/hash read.
        in.SizeInBytes = at + size - 1;
        CHECK(!rewrite_stream(&in, &out, &fix)); free_fixups(&fix);
    }
    CHECK(VirtualFree(memory, 0, MEM_RELEASE));
    printf("STREAM_DEBUG_OK checks=%u guard_page=1 shader_types_only=1 zero_disables_debug=1\n", checks);
    return 0;
}
