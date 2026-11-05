import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleAuthProbeSources } from './build-title-auth-probes.mjs';

const xuser = [
  'struct policy\n{ POLICY_BODY; };', 'struct endpoint { ENDPOINT_BODY; };',
  'struct XUser\n{ OUTSIDE_STRUCTS; };',
  'static HRESULT windows_title_auth(void) { AUTH_BODY; }',
  'static HRESULT append_endpoint_policies(void) { POLICY_GROWTH; }',
  'static HRESULT load_endpoints(void) { OUTSIDE_LOADER; }',
  'static BOOLEAN match_wildcard(void) { WILDCARD_BODY; }',
  'static HRESULT WINAPI user_GetEndpointInfo(void) { LOOKUP_BODY; }',
  'static HRESULT WINAPI user_GetAuthorization(void) { OUTSIDE_AUTH; }',
].join('\n');
const network = 'static HRESULT WINAPI x_networking_XNetworkingQueryPreferredLocalUdpMultiplayerPort(void) { PORT_BODY; }\n/* The platform has no actual port preference */\nOUTSIDE_NETWORK';

test('title probes compile production request, endpoint and preferred-port bodies', () => {
  const output = titleAuthProbeSources(xuser, network);
  const all = Object.values(output).join('\n');
  for (const body of ['AUTH_BODY', 'POLICY_BODY', 'ENDPOINT_BODY', 'POLICY_GROWTH', 'WILDCARD_BODY', 'LOOKUP_BODY', 'PORT_BODY'])
    assert.ok(all.includes(body), body);
  assert.ok(!all.includes('OUTSIDE_'));
  assert.equal(Object.keys(output).length, 4);
});

test('title probe extraction rejects missing production boundaries', () => {
  for (const marker of ['struct policy\n', 'struct XUser\n', 'static HRESULT windows_title_auth(',
    'static HRESULT append_endpoint_policies(', 'static HRESULT load_endpoints(',
    'static BOOLEAN match_wildcard(', 'static HRESULT WINAPI user_GetAuthorization('])
    assert.throws(() => titleAuthProbeSources(xuser.replaceAll(marker, 'missing'), network), /Unknown title authentication/);
  assert.throws(() => titleAuthProbeSources(xuser, network.replace('/* The platform has no actual port preference', 'missing')), /Unknown title authentication/);
});
