import fs from 'fs';
import path from 'path';

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export default function loadLocalDevEnv() {
  if (process.env.NODE_ENV === 'production') return;
  if (process.env.dhee_TEST_BRIDGE === '1') return;

  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  contents.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    const assignment = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separatorIndex = assignment.indexOf('=');
    if (separatorIndex <= 0) return;

    const key = assignment.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    if (process.env[key] !== undefined) return;

    process.env[key] = unquoteEnvValue(assignment.slice(separatorIndex + 1));
  });
}
