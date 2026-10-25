import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Security fixtures intentionally reject symlinked ancestors. macOS exposes
// /var via /private/var, so make the temporary root canonical before creating it.
process.env.TMPDIR = realpathSync(os.tmpdir());

// Archive safety tests exercise the GNU tar recipe used by the Linux backend.
// BSD tar has different listing/exclusion semantics; do not weaken that recipe
// or its assertions to accommodate another implementation.
if (process.platform === 'darwin') {
  const directory = ['/opt/homebrew/opt/gnu-tar/libexec/gnubin', '/usr/local/opt/gnu-tar/libexec/gnubin']
    .find(directory => existsSync(path.join(directory, 'tar')));
  if (!directory) throw new Error('macOS checks require GNU tar. Install it with: brew install gnu-tar');
  process.env.PATH = directory + path.delimiter + (process.env.PATH ?? '');
}
