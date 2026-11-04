/* Compile the actual synchronous adapter; no network or game is used. */
#include <windows.h>
#include <assert.h>
#include <stdio.h>
typedef struct { int unused; } IXNetworkingImpl2;
#include "preferred-udp-port-adapter.inc"
int main(void)
{
    UINT16 port = 12345;
    assert(x_networking_XNetworkingQueryPreferredLocalUdpMultiplayerPort(NULL, NULL) == E_INVALIDARG);
    assert(x_networking_XNetworkingQueryPreferredLocalUdpMultiplayerPort(NULL, &port) == S_OK);
    assert(port == 0);
    puts("CHECKS preferred-udp-port: null output rejected; no platform preference returned");
    return 0;
}
