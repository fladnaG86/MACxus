#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#include "../shim/nvapi_provider.h"
typedef void *(__cdecl *query_fn)(unsigned);
int main(int argc, char **argv)
{
    if (argc != 4 && argc != 5) return 10;
    BOOL expected = !strcmp(argv[3], "accepted");
    if (!LoadLibraryA(argv[1])) return 11;
    FARPROC (WINAPI *real_getproc)(HMODULE,LPCSTR) = (void *)GetProcAddress(GetModuleHandleA("kernel32.dll"), "GetProcAddress");
    HMODULE module = LoadLibraryA(argv[2]); if (!module) return 12;
    if (argc == 5) {
        char moved[2048];
        if (snprintf(moved, sizeof(moved), "%s.loaded", argv[2]) >= (int)sizeof(moved) ||
            !MoveFileExA(argv[2], moved, MOVEFILE_REPLACE_EXISTING) || !CopyFileA(argv[4], argv[2], FALSE)) return 22;
    }
    SetLastError(987); BOOL accepted = fh5_nvapi_check_provider(module);
    if (accepted != expected || GetLastError() != 987) return 13;
    query_fn native = (void *)real_getproc(module, "nvapi_QueryInterface");
    query_fn intercepted = (void *)GetProcAddress(module, "nvapi_QueryInterface");
    if (!native || !intercepted || (native != intercepted) != expected) return 14;
    if (!expected && (native(0x617bff9f) != intercepted(0x617bff9f) || native(0x07f9b368) != intercepted(0x07f9b368))) return 15;
    if (expected) {
        int (__cdecl *init)(void) = native(0x0150e828);
        if (!init || init()) return 16;
        void *session = NULL, *base = NULL, *global = NULL;
        int (__cdecl *create)(void **) = native(0x0694d52e);
        int (__cdecl *destroy)(void *) = native(0xdad9cff8);
        int (__cdecl *load)(void *) = native(0x375dbd6b);
        int (__cdecl *get_base)(void *,void **) = native(0xda8466a0);
        int (__cdecl *get_global)(void *,void **) = intercepted(0x617bff9f);
        if (!create || !destroy || !load || !get_base || !get_global || create(&session)) return 17;
        int bad = load(session) || get_base(session,&base) || get_global(session,&global) || base != global;
        destroy(session); if (bad) return 18;
        typedef struct { unsigned version; uint64_t data[9]; } memory_ex;
        typedef struct { unsigned version; unsigned data[7]; } memory;
        int (__cdecl *enumerate)(void **,unsigned *) = native(0xe5ac921f);
        int (__cdecl *get_ex)(void *,memory_ex *) = native(0xc0599498);
        int (__cdecl *get)(void *,memory *) = intercepted(0x07f9b368);
        void *gpus[64] = {0}; unsigned count = 0;
        if (!enumerate || !get_ex || !get || enumerate(gpus,&count) || !count || count > 64) return 19;
        memory_ex ex = {0}; ex.version = 0x10050;
        memory old = {0}; old.version = 0x30020;
        if (get_ex(gpus[0],&ex) || get(gpus[0],&old)) return 20;
        // Available memory may change between queries; immutable capacities agree.
        for (unsigned i = 0; i < 4; i++) {
            uint64_t value = ex.data[i] / 1024;
            if (old.data[i] != (value > UINT32_MAX ? UINT32_MAX : (unsigned)value)) return 21;
        }
        printf("NVAPI NATIVE MEMORY dedicated_KiB=%u shared_KiB=%u current_KiB=%u\n",old.data[0],old.data[3],old.data[4]);
    }
    printf("NVAPI PROVIDER CHECKS 5 FAILURES 0 accepted=%u wrapped=%u\n",accepted,native!=intercepted); return 0;
}
