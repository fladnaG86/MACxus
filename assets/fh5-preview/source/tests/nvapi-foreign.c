#include <windows.h>
#include <stdint.h>
static int __cdecl base(void *session, void **profile) { if (profile) *profile = session; return 0; }
__declspec(dllexport) void *__cdecl nvapi_QueryInterface(unsigned id) { return id == 0xda8466a0 ? (void *)base : NULL; }
BOOL WINAPI DllMain(HINSTANCE module,DWORD reason,void *reserved) { (void)module;(void)reason;(void)reserved;return TRUE; }
