#ifndef MACXUS_FH5_NVAPI_PROVIDER_H
#define MACXUS_FH5_NVAPI_PROVIDER_H
#include <bcrypt.h>

/* The launcher pins this PE and its Unix companion, then materializes these
 * same verified PE bytes in the dedicated bottle. Hash the loaded module's
 * backing file: a basename, path or PE timestamp alone is not provider identity.
 * No vendor binary is redistributed by the source pack. */
#define FH5_NVAPI_PROVIDER_SIZE 200256u
static const BYTE fh5_nvapi_provider_digest[32] = {
    0x2f,0x22,0x29,0xd4,0xf5,0xd5,0xe7,0x77,0xce,0xd6,0xd0,0x70,0x6b,0x7c,0xa7,0x4d,
    0x35,0x86,0x49,0x9b,0x3e,0x54,0xef,0x39,0x5c,0x52,0x71,0x18,0x5c,0xc6,0x88,0x9f
};
static BOOL fh5_nvapi_check_provider(HMODULE module)
{
    DWORD saved = GetLastError(), length, got = 0;
    WCHAR path[1024];
    HANDLE file = INVALID_HANDLE_VALUE;
    BYTE *bytes = NULL, *object = NULL, *mapped = NULL, digest[32];
    BCRYPT_ALG_HANDLE algorithm = NULL;
    BCRYPT_HASH_HANDLE hash = NULL;
    ULONG object_size = 0, written = 0;
    LARGE_INTEGER size;
    BOOL ok = FALSE;
    length = GetModuleFileNameW(module, path, sizeof(path) / sizeof(*path));
    if (!length || length >= sizeof(path) / sizeof(*path)) goto done;
    file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE || GetFileType(file) != FILE_TYPE_DISK ||
        !GetFileSizeEx(file, &size) || size.QuadPart != FH5_NVAPI_PROVIDER_SIZE) goto done;
    bytes = HeapAlloc(GetProcessHeap(), 0, FH5_NVAPI_PROVIDER_SIZE);
    if (!bytes) goto done;
    for (DWORD offset = 0; offset < FH5_NVAPI_PROVIDER_SIZE; offset += got) {
        if (!ReadFile(file, bytes + offset, FH5_NVAPI_PROVIDER_SIZE - offset, &got, NULL) || !got) goto done;
    }
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0) < 0 ||
        BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (BYTE *)&object_size, sizeof(object_size), &written, 0) < 0 ||
        written != sizeof(object_size) || !object_size || object_size > 1024 * 1024) goto done;
    object = HeapAlloc(GetProcessHeap(), 0, object_size);
    if (!object || BCryptCreateHash(algorithm, &hash, object, object_size, NULL, 0, 0) < 0 ||
        BCryptHashData(hash, bytes, FH5_NVAPI_PROVIDER_SIZE, 0) < 0 ||
        BCryptFinishHash(hash, digest, sizeof(digest), 0) < 0) goto done;
    if (memcmp(digest, fh5_nvapi_provider_digest, sizeof(digest))) goto done;
    /* This pinned PE has one executable section, no text relocations, and
     * identical raw/RVA offsets. Check mapped code too: replacing the backing
     * file after loading a foreign DLL must not establish provider identity. */
    mapped = HeapAlloc(GetProcessHeap(), 0, 0x40e6);
    SIZE_T copied = 0;
    if (!mapped || !ReadProcessMemory(GetCurrentProcess(), (BYTE *)module + 0x1000,
                                     mapped, 0x40e6, &copied) || copied != 0x40e6) goto done;
    ok = !memcmp(mapped, bytes + 0x1000, 0x40e6);
done:
    if (hash) BCryptDestroyHash(hash);
    if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    if (object) HeapFree(GetProcessHeap(), 0, object);
    if (bytes) HeapFree(GetProcessHeap(), 0, bytes);
    if (mapped) HeapFree(GetProcessHeap(), 0, mapped);
    if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    SetLastError(saved);
    return ok;
}
static BOOL fh5_nvapi_check_entry(HMODULE module, FARPROC entry)
{
    /* Pin the verified module for the lifetime of our returned adapters. */
    HMODULE pinned = NULL;
    return (BYTE *)entry == (BYTE *)module + 0x1120 &&
        GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                          (LPCWSTR)entry, &pinned) && pinned == module;
}
#endif
