import fs from 'node:fs/promises';
import path from 'node:path';

// Compile the production adapters with closed, account-free transport fixtures.
export function titleAuthProbeSources(xuser, networking) {
  function section(text, start, end) {
    const a = text.indexOf(start);
    const b = text.indexOf(end, a + start.length);
    if (a < 0 || b <= a) throw new Error('Unknown title authentication adapter source layout');
    return text.slice(a, b);
  }
  return {
    'windows-title-auth-adapter.inc': section(xuser, 'static HRESULT windows_title_auth(', 'static HRESULT append_endpoint_policies('),
    'title-endpoint-structs.inc': section(xuser, 'struct policy\n', 'struct XUser\n'),
    'title-endpoint-adapter.inc': section(xuser, 'static HRESULT append_endpoint_policies(', 'static HRESULT load_endpoints(') + '\n' +
      section(xuser, 'static BOOLEAN match_wildcard(', 'static HRESULT WINAPI user_GetAuthorization('),
    'preferred-udp-port-adapter.inc': section(networking, 'static HRESULT WINAPI x_networking_XNetworkingQueryPreferredLocalUdpMultiplayerPort(', '\n/* The platform has no actual port preference'),
  };
}

export async function buildTitleAuthProbes({ source, tests, project }, run) {
  const directory = path.join(source, 'dlls/xgameruntime');
  const generated = titleAuthProbeSources(await fs.readFile(path.join(directory, 'xuser.c'), 'utf8'),
    await fs.readFile(path.join(directory, 'xnetworking.c'), 'utf8'));
  for (const [name, contents] of Object.entries(generated)) await fs.writeFile(path.join(tests, name), contents);
  for (const name of ['windows-title-auth', 'title-endpoint', 'preferred-udp-port']) {
    run('x86_64-w64-mingw32-gcc', ['-O2', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
      '-I', tests, path.join(project, `scripts/runtime-tests/${name}-probe.c`),
      '-o', path.join(tests, `${name}-probe.exe`), '-lwininet'], project);
  }
}
