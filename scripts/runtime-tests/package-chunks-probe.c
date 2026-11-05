/* SPDX-License-Identifier: MIT
 * Synthetic installed layouts through the real package ABI. No game/account. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "xpackage.h"
#include "xgameerr.h"

static unsigned checks, failures, visits;
static IXPackageImpl4 *package;
static WCHAR root[MAX_PATH];
static BOOL stop, reenter;
static XPackageChunkSelectorType expected_type;
static UINT32 ids[16];
static char values[16][64];
static XPackageChunkAvailability states[16];
static const char *identifier = "12345678123456789abcdef012345678";
static const char *config = "<Game><Identity Name=\"Nexus.Chunks\" Publisher=\"CN=Probe\" Version=\"1.2.3.4\"/>"
    "<StoreId>B00000000001</StoreId><Executables/></Game>";
#define CHECK(name, expression) do { ++checks; if (!(expression)) { ++failures; printf("FAIL %s line=%d\n", name, __LINE__); } } while (0)

static void write_file( const WCHAR *name, const char *text )
{
    WCHAR path[MAX_PATH];
    HANDLE file;
    DWORD written;
    swprintf(path, MAX_PATH, L"%ls\\%ls", root, name);
    file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    CHECK("fixture-open", file != INVALID_HANDLE_VALUE);
    if (file == INVALID_HANDLE_VALUE) return;
    CHECK("fixture-write", WriteFile(file, text, strlen(text), &written, NULL) && written == strlen(text));
    CloseHandle(file);
}

static void layout( const char *xml )
{
    write_file(L"layout_12345678-1234-5678-9abc-def012345678.xml", xml);
}

static BOOLEAN WINAPI visit( void *context, const XPackageChunkSelector *selector, XPackageChunkAvailability availability )
{
    CHECK("callback-context", context == &visits);
    CHECK("callback-type", selector->type == expected_type);
    CHECK("callback-bounds", visits < 16);
    if (visits < 16)
    {
        states[visits] = availability;
        if (selector->type == XPackageChunkSelectorType_Chunk) ids[visits] = selector->chunkId;
        else snprintf(values[visits], sizeof(values[visits]), "%s", selector->language);
    }
    visits++;
    if (reenter)
    {
        unsigned saved = visits;
        BOOL saved_stop = stop;
        reenter = FALSE; visits = 0; stop = TRUE;
        CHECK("reentrant-enum", IXPackageImpl4_XPackageEnumerateChunkAvailability(package, identifier, expected_type, &visits, visit) == S_OK && visits == 1);
        visits = saved; stop = saved_stop;
    }
    return !stop;
}

static void enumerate( XPackageChunkSelectorType type, HRESULT result, unsigned count )
{
    visits = 0; expected_type = type;
    memset(ids, 0, sizeof(ids)); memset(values, 0, sizeof(values)); memset(states, 0xff, sizeof(states));
    CHECK("enum-result", IXPackageImpl4_XPackageEnumerateChunkAvailability(package, identifier, type, &visits, visit) == result);
    CHECK("enum-count", visits == count);
}

static const char *valid_layout = "<Package><Features><Feature Id=\"High\" Tags=\"hq\"/></Features>"
    "<!-- <Chunk Id=\"999\"/> --><Chunk Id=\"Registration\"><FileGroup SourcePath=\".\" Include=\"MicrosoftGame.config\"/></Chunk>"
    "<Chunk Id=\"7\"><FileGroup SourcePath=\"Z:\\build\\never-exists\" DestinationPath=\"\\data\" Include=\"BASE.BIN\"/></Chunk>"
    "<Chunk Id=\"8\" Languages=\"en-US;fr-FR;en-US\" Tags=\"Map;Common;Map\"><FileGroup SourcePath=\"data\" Include=\"lang.bin\"/></Chunk>"
    "<Chunk Id=\"9\" Languages=\"fr-FR\" Tags=\"Map\"><FileGroup SourcePath=\"data\" Include=\"optional.bin\"/></Chunk>"
    "<Chunk Id=\"4294967295\" Tags=\"hq\"><FileGroup SourcePath=\".\" DestinationPath=\"/data\" Include=\"sub/quality.bin\"/></Chunk></Package>";

static void tests( void )
{
    WCHAR path[MAX_PATH];
    HRESULT invalid = HRESULT_FROM_WIN32(ERROR_INVALID_DATA);
    const char *bad[] = {
        "<Package><Chunk Id=\"1\"/><FileGroup SourcePath=\".\" Include=\"missing.bin\"/></Package>",
        "<Package><Chunk Id=\"1\"/><Unknown><FileGroup SourcePath=\".\" Include=\"missing.bin\"/></Unknown></Package>",
        "<Package><Chunk Id=\"1\"/><Features><Feature Id=\"Hidden\"><FileGroup SourcePath=\".\" Include=\"missing.bin\"/></Feature></Features></Package>",
        "<Package><Chunk Id=\"1\"/><Chunk Id=\"1\"/></Package>",
        "<Package><Chunk Id=\"-1\"/></Package>",
        "<Package><Chunk Id=\"4294967296\"/></Package>",
        "<Package><Chunk Id=\"7tail\"/></Package>",
        "<Package><Chunk Id=\"name\"/></Package>",
        "<Package><Chunk/></Package>",
        "<Package><Chunk Id=\"1\" Languages=\"en-US;;fr-FR\"/></Package>",
        "<Package><Chunk Id=\"1\" Tags=\"tag;\"/></Package>",
        "<Package><Chunk Id=\"1\"><FileGroup SourcePath=\".\" Include=\"../outside.bin\"/></Chunk></Package>",
        "<Package><Chunk Id=\"1\"><FileGroup SourcePath=\".\" DestinationPath=\"\\..\\outside\" Include=\"data.bin\"/></Chunk></Package>",
        "<Package><Chunk Id=\"1\"><FileGroup SourcePath=\".\" DestinationPath=\"\\\\server\\share\" Include=\"data.bin\"/></Chunk></Package>",
        "<!DOCTYPE Package [<!ENTITY x SYSTEM 'file:///no-such-chunk-fixture'>]><Package>&x;</Package>",
        "<Package><Chunk Id=\"1\"></Package>",
        "<Wrong><Chunk Id=\"1\"/></Wrong>",
        "<Package><Chunk Id=\"Registration\"/><Chunk Id=\"Registration\"/></Package>",
    };
    unsigned i;
    layout(valid_layout);
    {
        WCHAR directory[MAX_PATH];
        const char *names[] = {"Nexus.Chunks", "Nexus.Unrelated"};
        char xml[1024];
        swprintf(directory, MAX_PATH, L"%ls\\DLC", root); CHECK("dlc-root", CreateDirectoryW(directory, NULL));
        for (i = 0; i < 2; i++)
        {
            swprintf(directory, MAX_PATH, L"%ls\\DLC\\%u", root, i); CHECK("dlc-directory", CreateDirectoryW(directory, NULL));
            swprintf(path, MAX_PATH, L"DLC\\%u\\MicrosoftGame.config", i);
            snprintf(xml, sizeof(xml), "<Game><Identity Name=\"Nexus.Dlc%u\" Publisher=\"CN=Probe\" Version=\"1.2.3.4\"/>"
                "<StoreId>D0000000000%u</StoreId><AllowedProducts><AllowedProduct>B00000000001</AllowedProduct></AllowedProducts>"
                "<DesktopRegistration><MainPackageDependency Name=\"%s\"/></DesktopRegistration></Game>", i, i, names[i]);
            write_file(path, xml);
            swprintf(path, MAX_PATH, L"DLC\\%u\\appxmanifest.xml", i);
            snprintf(xml, sizeof(xml), "<Package><Identity Name=\"Nexus.Dlc%u\" Publisher=\"CN=Probe\" Version=\"1.2.3.4\"/>"
                "<Dependencies><MainPackageDependency Name=\"%s\"/></Dependencies></Package>", i, names[i]);
            write_file(path, xml);
            swprintf(path, MAX_PATH, L"DLC\\%u\\layout_abcdefa%u-cdef-abcd-efab-cdefabcdefab.xml", i, i);
            write_file(path, "<Package><Chunk Id=\"88\"><FileGroup SourcePath=\".\" Include=\"dlc.bin\"/></Chunk></Package>");
            swprintf(path, MAX_PATH, L"DLC\\%u\\dlc.bin", i); write_file(path, "synthetic content");
        }
        visits = 0; expected_type = XPackageChunkSelectorType_Chunk;
        CHECK("own-content-enumeration", IXPackageImpl4_XPackageEnumerateChunkAvailability(package,
            "abcdefa0cdefabcdefabcdefabcdefab", expected_type, &visits, visit) == S_OK && visits == 1 && ids[0] == 88);
        visits = 0;
        CHECK("unrelated-content-refused", IXPackageImpl4_XPackageEnumerateChunkAvailability(package,
            "abcdefa1cdefabcdefabcdefabcdefab", expected_type, &visits, visit) == E_GAMEPACKAGE_NO_PACKAGE_IDENTIFIER && !visits);
    }
    expected_type = XPackageChunkSelectorType_Chunk; visits = 0;
    CHECK("uppercase-identifier", IXPackageImpl4_XPackageEnumerateChunkAvailability(package, "12345678123456789ABCDEF012345678", expected_type, &visits, visit) == S_OK && visits == 4);
    enumerate(XPackageChunkSelectorType_Chunk, S_OK, 4);
    CHECK("numeric-ids-not-positions", ids[0] == 7 && ids[1] == 8 && ids[2] == 9 && ids[3] == 0xffffffffu);
    CHECK("real-payload-ready", states[0] == XPackageChunkAvailability_Ready && states[3] == XPackageChunkAvailability_Ready);
    enumerate(XPackageChunkSelectorType_Language, S_OK, 2);
    CHECK("languages-deduplicated", !strcmp(values[0], "en-US") && !strcmp(values[1], "fr-FR"));
    enumerate(XPackageChunkSelectorType_Tag, S_OK, 3);
    CHECK("tag-values", !strcmp(values[0], "Map") && !strcmp(values[1], "Common") && !strcmp(values[2], "hq"));
    enumerate(XPackageChunkSelectorType_Feature, S_OK, 1);
    CHECK("feature-tag-binding", !strcmp(values[0], "High") && states[0] == XPackageChunkAvailability_Ready);
    stop = TRUE; enumerate(XPackageChunkSelectorType_Chunk, S_OK, 1); stop = FALSE;
    reenter = TRUE; enumerate(XPackageChunkSelectorType_Chunk, S_OK, 4);
    swprintf(path, MAX_PATH, L"%ls\\data\\optional.bin", root);
    CHECK("remove-optional-fixture", DeleteFileW(path));
    enumerate(XPackageChunkSelectorType_Chunk, S_OK, 4);
    CHECK("missing-not-ready", states[2] == XPackageChunkAvailability_Unavailable && states[0] == XPackageChunkAvailability_Ready);
    enumerate(XPackageChunkSelectorType_Tag, S_OK, 3);
    CHECK("shared-tag-minimum-availability", states[0] == XPackageChunkAvailability_Unavailable);
    enumerate(XPackageChunkSelectorType_Language, S_OK, 2);
    CHECK("language-minimum-availability", states[0] == XPackageChunkAvailability_Ready && states[1] == XPackageChunkAvailability_Unavailable);
    write_file(L"data\\optional.bin", "synthetic");
    enumerate(XPackageChunkSelectorType_Chunk, S_OK, 4);
    CHECK("no-stale-availability-cache", states[2] == XPackageChunkAvailability_Ready);
    CHECK("null-callback", IXPackageImpl4_XPackageEnumerateChunkAvailability(package, identifier, XPackageChunkSelectorType_Chunk, NULL, NULL) == E_INVALIDARG);
    visits = 0;
    CHECK("unknown-kind", IXPackageImpl4_XPackageEnumerateChunkAvailability(package, identifier, (XPackageChunkSelectorType)99, &visits, visit) == E_INVALIDARG && !visits);
    CHECK("empty-id", IXPackageImpl4_XPackageEnumerateChunkAvailability(package, "", XPackageChunkSelectorType_Chunk, &visits, visit) == E_INVALIDARG && !visits);
    CHECK("null-id", IXPackageImpl4_XPackageEnumerateChunkAvailability(package, NULL, XPackageChunkSelectorType_Chunk, &visits, visit) == E_INVALIDARG && !visits);
    CHECK("unknown-package", IXPackageImpl4_XPackageEnumerateChunkAvailability(package, "ffffffffffffffffffffffffffffffff", XPackageChunkSelectorType_Chunk, &visits, visit) == E_GAMEPACKAGE_NO_PACKAGE_IDENTIFIER && !visits);
    for (i = 0; i < sizeof(bad)/sizeof(bad[0]); i++)
    {
        layout(bad[i]);
        enumerate(XPackageChunkSelectorType_Chunk, invalid, 0);
    }
    layout("<Package><Chunk Id=\"Registration\"><FileGroup SourcePath=\".\" Include=\"MicrosoftGame.config\"/></Chunk></Package>");
    enumerate(XPackageChunkSelectorType_Chunk, S_OK, 0);
    enumerate(XPackageChunkSelectorType_Language, S_OK, 0);
    layout("<Package/>"); enumerate(XPackageChunkSelectorType_Chunk, S_OK, 0);
    layout("<Package><Chunk Id=\"1\"><FileGroup SourcePath=\".\" Include=\"*.unknown\"/></Chunk></Package>");
    enumerate(XPackageChunkSelectorType_Chunk, S_OK, 1);
    CHECK("missing-wildcard-unavailable", states[0] == XPackageChunkAvailability_Unavailable);
    layout("<Package><Chunk Id=\"1\"><FileGroup SourcePath=\".\" Include=\"*.config\"/></Chunk></Package>");
    enumerate(XPackageChunkSelectorType_Chunk, S_OK, 1);
    CHECK("existing-wildcard-ready", states[0] == XPackageChunkAvailability_Ready);
    layout(valid_layout);
    write_file(L"layout_22345678-1234-5678-9abc-def012345678.xml", "<Package/>");
    enumerate(XPackageChunkSelectorType_Chunk, invalid, 0);
    swprintf(path, MAX_PATH, L"%ls\\layout_22345678-1234-5678-9abc-def012345678.xml", root); DeleteFileW(path);
    layout(valid_layout);
    enumerate(XPackageChunkSelectorType_Chunk, S_OK, 4);
    /* Larger real layouts must not inherit the content helper's old 256-group
     * bound. Conversely, hostile counts/text are rejected before callbacks. */
    {
        char *large = malloc(16 * 1024 * 1024 + 32);
        SIZE_T used;
        CHECK("large-fixture-allocation", large != NULL);
        if (large)
        {
            used = sprintf(large, "<Package><Chunk Id=\"42\">");
            for (i = 0; i < 300; i++) used += sprintf(large + used, "<FileGroup SourcePath=\"data\" Include=\"base.bin\"/>");
            strcpy(large + used, "</Chunk></Package>"); layout(large);
            enumerate(XPackageChunkSelectorType_Chunk, S_OK, 1);
            CHECK("large-extracted-layout-ready", ids[0] == 42 && states[0] == XPackageChunkAvailability_Ready);
            used = sprintf(large, "<Package>");
            for (i = 0; i < 4097; i++) used += sprintf(large + used, "<Chunk Id=\"%u\"/>", i);
            strcpy(large + used, "</Package>"); layout(large);
            enumerate(XPackageChunkSelectorType_Chunk, HRESULT_FROM_WIN32(ERROR_MORE_DATA), 0);
            /* Large layouts are now accepted up to the dedicated 16 MiB bound;
             * identity/related-content XML retains its separate 1 MiB limit. */
            memset(large, ' ', 1100000); memcpy(large, "<Package>", 9); strcpy(large + 1100000, "</Package>"); layout(large);
            enumerate(XPackageChunkSelectorType_Chunk, S_OK, 0);
            memset(large, ' ', 16 * 1024 * 1024 + 1); memcpy(large, "<Package>", 9);
            strcpy(large + 16 * 1024 * 1024 + 1, "</Package>"); layout(large);
            enumerate(XPackageChunkSelectorType_Chunk, invalid, 0);
            used = sprintf(large, "<Package><Chunk Id=\"1\" Tags=\"");
            memset(large + used, 'a', 1100); strcpy(large + used + 1100, "\"/></Package>"); layout(large);
            enumerate(XPackageChunkSelectorType_Chunk, invalid, 0);
            free(large);
        }
    }
    layout("<Package><Chunk Id=\"1\"><FileGroup SourcePath=\"data\" Include=\"*.bin\" Exclude=\"lang.bin\"/></Chunk></Package>");
    enumerate(XPackageChunkSelectorType_Chunk, E_NOTIMPL, 0);
    layout("<Package><Chunk Id=\"Registration\"><FileGroup SourcePath=\".\" Include=\"not-installed.bin\"/></Chunk><Chunk Id=\"1\"><FileGroup SourcePath=\"data\" Include=\"base.bin\"/></Chunk></Package>");
    enumerate(XPackageChunkSelectorType_Chunk, S_OK, 1);
    CHECK("registration-unavailable-not-hidden", states[0] == XPackageChunkAvailability_Unavailable);
    layout(valid_layout);
}

static void child( void )
{
    struct options { UINT32 tag; BOOL inline_config; const char *config; } options = {1, TRUE, config};
    HRESULT (WINAPI *query)(const GUID *, REFIID, void **);
    HRESULT (WINAPI *initialize)(ULONG, ULONG, char, const void *);
    HMODULE dll = LoadLibraryW(L"xgameruntime.dll");
    WCHAR *sep;
    CHECK("self-path", GetModuleFileNameW(NULL, root, MAX_PATH));
    sep = wcsrchr(root, '\\'); if (!sep) { CHECK("self-directory", FALSE); return; } *sep = 0;
    sep = wcsrchr(root, '\\'); if (!sep) { CHECK("fixture-root", FALSE); return; } *sep = 0;
    CHECK("runtime-loaded", dll != NULL); if (!dll) return;
    query = (void *)GetProcAddress(dll, "QueryApiImpl");
    initialize = (void *)GetProcAddress(dll, "InitializeApiImplEx2");
    CHECK("exports", query && initialize); if (!query || !initialize) return;
    CHECK("initialize", initialize(0, 0, 0, &options) == S_OK);
    CHECK("package-query", query(&CLSID_XPackageImpl, &IID_IXPackageImpl4, (void **)&package) == S_OK && package);
    if (package) { tests(); IXPackageImpl4_Release(package); }
}

int main( int argc, char **argv )
{
    if (argc == 2 && !strcmp(argv[1], "--child")) child();
    else
    {
        WCHAR temporary[MAX_PATH], folder[MAX_PATH], own[MAX_PATH], executable[MAX_PATH], command[MAX_PATH + 40];
        STARTUPINFOW startup = {0};
        PROCESS_INFORMATION process = {0};
        DWORD code = 99, wait;
        CHECK("temp", GetTempPathW(MAX_PATH, temporary));
        swprintf(root, MAX_PATH, L"%lsnexus-chunks-%lu-%lu", temporary, GetCurrentProcessId(), GetTickCount());
        CHECK("root", CreateDirectoryW(root, NULL));
        swprintf(folder, MAX_PATH, L"%ls\\Binaries", root); CHECK("binaries", CreateDirectoryW(folder, NULL));
        swprintf(folder, MAX_PATH, L"%ls\\data", root); CHECK("data", CreateDirectoryW(folder, NULL));
        swprintf(folder, MAX_PATH, L"%ls\\data\\sub", root); CHECK("subdirectory", CreateDirectoryW(folder, NULL));
        write_file(L"MicrosoftGame.config", config);
        write_file(L"appxmanifest.xml", "<Package><Identity Name=\"Nexus.Chunks\" Publisher=\"CN=Probe\" Version=\"1.2.3.4\"/><Applications/></Package>");
        write_file(L"data\\base.bin", "synthetic"); write_file(L"data\\lang.bin", "synthetic");
        write_file(L"data\\optional.bin", "synthetic"); write_file(L"data\\sub\\quality.bin", "synthetic");
        layout(valid_layout);
        CHECK("own", GetModuleFileNameW(NULL, own, MAX_PATH));
        swprintf(executable, MAX_PATH, L"%ls\\Binaries\\probe.exe", root);
        CHECK("copy", CopyFileW(own, executable, TRUE));
        swprintf(command, sizeof(command)/sizeof(command[0]), L"\"%ls\" --child", executable);
        startup.cb = sizeof(startup);
        CHECK("child-start", CreateProcessW(executable, command, NULL, NULL, FALSE, 0, NULL, NULL, &startup, &process));
        if (process.hProcess)
        {
            wait = WaitForSingleObject(process.hProcess, 30000);
            CHECK("child-finished", wait == WAIT_OBJECT_0);
            if (wait != WAIT_OBJECT_0) TerminateProcess(process.hProcess, 77);
            GetExitCodeProcess(process.hProcess, &code); CHECK("child-pass", code == 0);
            CloseHandle(process.hProcess); CloseHandle(process.hThread);
        }
    }
    printf("CHUNK METADATA CHECKS %u FAILURES %u\n", checks, failures);
    return failures ? 1 : 0;
}
