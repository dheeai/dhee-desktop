/** Offline recognition and conservative, timestamped comparison with the expected script. */
import { execFile } from 'node:child_process';
import { isAbsolute, basename } from 'node:path';
import { stat } from 'node:fs/promises';
import { z } from 'zod';

const wordSchema = z
  .object({
    text: z.string().max(200),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    probability: z.number().finite().min(0).max(1),
  })
  .refine((w) => w.end >= w.start, 'Invalid word timestamps');
export type SpeechFinding = {
  id: 'transcript';
  status: 'pass' | 'fail' | 'unchecked';
  detail: string;
};
interface Difference {
  kind: 'insert' | 'delete' | 'replace';
  expected?: string;
  heard?: string;
  startSec?: number;
  endSec?: number;
  confidence?: number;
}
const tokens = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
export function compareSpeech(expected: string, rawWords: unknown) {
  const validated = z.array(wordSchema).max(1000).parse(rawWords);
  const heard = validated.flatMap((w) =>
    tokens(w.text).map((text) => ({ ...w, text })),
  );
  const wanted = tokens(expected);
  if (!wanted.length || wanted.length > 1000 || heard.length > 1000)
    throw Error(
      'Script and transcript must contain at most 1000 words, with a nonempty script',
    );
  const rows = Array.from(
    { length: wanted.length + 1 },
    () => new Uint16Array(heard.length + 1),
  );
  for (let i = 0; i <= wanted.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= heard.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= wanted.length; i += 1)
    for (let j = 1; j <= heard.length; j += 1)
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (wanted[i - 1] === heard[j - 1].text ? 0 : 1),
      );
  const differences: Difference[] = [];
  let i = wanted.length;
  let j = heard.length;
  while (i || j) {
    if (i && j && wanted[i - 1] === heard[j - 1].text) {
      i -= 1;
      j -= 1;
    } else if (i && j && rows[i][j] === rows[i - 1][j - 1] + 1) {
      const w = heard[j - 1];
      differences.push({
        kind: 'replace',
        expected: wanted[i - 1],
        heard: w.text,
        startSec: w.start,
        endSec: w.end,
        confidence: w.probability,
      });
      i -= 1;
      j -= 1;
    } else if (j && rows[i][j] === rows[i][j - 1] + 1) {
      const w = heard[j - 1];
      differences.push({
        kind: 'insert',
        heard: w.text,
        startSec: w.start,
        endSec: w.end,
        confidence: w.probability,
      });
      j -= 1;
    } else {
      differences.push({ kind: 'delete', expected: wanted[i - 1] });
      i -= 1;
    }
  }
  differences.reverse();
  const clearMismatch =
    differences.length > 0 &&
    differences.every((d) => d.kind !== 'delete' && (d.confidence ?? 0) >= 0.8);
  const confidentMatch =
    differences.length === 0 &&
    heard.length > 0 &&
    heard.every((w) => w.probability >= 0.5);
  const finding: SpeechFinding = {
    id: 'transcript',
    status: 'unchecked',
    detail: confidentMatch
      ? 'Recognized words match the expected script after punctuation/case normalization; this does not certify speaker identity.'
      : `${differences.length} script/transcript differences${clearMismatch ? ' detected' : ' require review because recognition is uncertain'}. ${differences
          .slice(0, 8)
          .map(
            (d) =>
              `${d.kind}: ${d.expected ?? '∅'} → ${d.heard ?? '∅'}${d.startSec === undefined ? '' : ` at ${d.startSec.toFixed(2)}s`}`,
          )
          .join(
            '; ',
          )}. ASR may misrecognize speech; no automatic trimming or approval.`,
  };
  if (confidentMatch) finding.status = 'pass';
  else if (clearMismatch) finding.status = 'fail';
  return {
    finding,
    expected,
    transcript: validated.map((w) => w.text.trim()).join(' '),
    differences: differences.slice(0, 100),
    differenceCount: differences.length,
    truncated: differences.length > 100,
  };
}
const PYTHON = `import sys,json,os\nos.environ['HF_HUB_OFFLINE']='1'\nos.environ['TRANSFORMERS_OFFLINE']='1'\nimport numpy as np\nfrom faster_whisper import WhisperModel\nmodel=WhisperModel(sys.argv[1],device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)\naudio=np.frombuffer(sys.stdin.buffer.read(),dtype='<f4')\nsegments,info=model.transcribe(audio,language='en',beam_size=5,word_timestamps=True,vad_filter=False,condition_on_previous_text=False)\nwords=[dict(text=w.word,start=w.start,end=w.end,probability=w.probability) for s in segments for w in (s.words or [])]\nprint(json.dumps(dict(words=words,language=info.language)))\n`;
export async function checkSpeech(
  pcm: Buffer | undefined,
  expected: string | undefined,
  signal?: AbortSignal,
) {
  const unavailable = (detail: string) => ({
    finding: {
      id: 'transcript' as const,
      status: 'unchecked' as const,
      detail,
    },
  });
  if (!expected) return unavailable('No expected script was supplied.');
  if (!pcm?.length)
    return unavailable('No audio is available for speech recognition.');
  const model = process.env.DHEE_ASR_MODEL_PATH;
  if (!model)
    return unavailable(
      'Offline ASR model is not configured (DHEE_ASR_MODEL_PATH).',
    );
  try {
    signal?.throwIfAborted();
    if (!isAbsolute(model) || !(await stat(model)).isDirectory())
      throw Error('Offline ASR model must be an existing absolute directory');
    const output = await new Promise<string>((_resolve, reject) => {
      const child = execFile(
        process.env.DHEE_ASR_PYTHON || 'python3',
        ['-c', PYTHON, model],
        {
          signal,
          timeout: 180000,
          killSignal: 'SIGKILL',
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            HF_HUB_OFFLINE: '1',
            TRANSFORMERS_OFFLINE: '1',
          },
        },
        (error, stdout) =>
          error
            ? reject(
                Error(
                  'Offline speech recognizer failed or timed out; check its Python runtime and local model.',
                ),
              )
            : _resolve(stdout),
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end(pcm);
    });
    const decoded = z
      .object({ words: z.array(wordSchema).max(1000), language: z.string() })
      .parse(JSON.parse(output));
    if (decoded.words.some((w) => w.end > pcm.length / 4 / 16000 + 0.5))
      throw Error('Recognizer timestamps exceed the checked audio');
    return {
      ...compareSpeech(expected, decoded.words),
      model: basename(model),
      engine: 'faster-whisper CPU int8; offline; English; no script prompt',
    };
  } catch (error) {
    signal?.throwIfAborted();
    return unavailable(
      error instanceof Error
        ? error.message
        : 'Speech recognition unavailable.',
    );
  }
}
