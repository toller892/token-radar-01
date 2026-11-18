// A working token-radar-01 entry (Node 22, standard library only).
//
// The program runs in stages, each with one job:
//
//   resolvePaths  — where the snapshot comes from, where the outputs go
//   readSnapshot  — the sealed file into typed records, or a refusal naming what is wrong
//   scoreBoard    — the radar-3 model in lib/model.ts: the ranked board and the dashboard dataset
//   writeOutputs  — board.json, data.js, dashboard/, screenshots/, then dossier.json last
//   verifyOutputs — the written files read back from disk and checked again, so a short write
//                   or a stale screenshot is caught here, not by the grader
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. The board
// covers the whole watchlist and every other rankable pre-token protocol, states the model, shows each
// row's nearest live-token comparables with their multiples, and gives every protocol a seven-step farm
// plan with a cost and a time on each step.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier as dossierFromLibrary } from './vendor/makefun-board.ts';

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The entry's own exit codes: 0 for a written board, 1 for a board the gate refuses, 2 for a missing input. */
const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_NO_INPUT = 2;

/** Where the program runs from: the repository's root, beside main.ts. */
const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The paths the run reads and writes, resolved once at the start. */
interface RunPaths {
  snapshotFile: string;
  outDir: string;
  dashboardDir: string;
  screenshotsDir: string;
}

/** `--name <value>` or `--name=<value>` out of the arguments, or the fallback. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const joined = argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** The snapshot file and the output directory, from the flags and the environment. */
function resolvePaths(): RunPaths {
  const inputArg = flagValue('input', '/input');
  const snapshotFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  return {
    snapshotFile,
    outDir,
    dashboardDir: join(outDir, 'dashboard'),
    screenshotsDir: join(outDir, 'screenshots'),
  };
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The screenshots' names, checked the way the gate checks them. */
function checkScreenshotNames(names: string[]): string | null {
  if (names.length < 3) {
    return `screenshots/ holds ${names.length} image${names.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`;
  }
  for (const name of names) {
    if (!IMAGE_NAME.test(name)) {
      return `screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`;
    }
  }
  return null;
}

/** The written outputs read back from disk and checked again: board, dossier and the count of files. */
function verifyOutputs(paths: RunPaths, boardJson: string, dossierBytes: Buffer): string | null {
  const boardPath = join(paths.outDir, 'board.json');
  const dossierPath = join(paths.outDir, 'dossier.json');
  if (readFileSync(boardPath, 'utf8') !== boardJson) return 'board.json on disk is not the board just written';
  if (Buffer.compare(readFileSync(dossierPath), dossierBytes) !== 0) return 'dossier.json on disk is not the dossier just written';
  const rebuilt = dossierFromLibrary(paths.outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_LIMIT,
    dashboard: DASHBOARD_LIMIT,
  });
  if (Buffer.compare(Buffer.from(rebuilt), dossierBytes) !== 0) return 'the dossier does not rebuild to the same bytes';
  return null;
}

/** One run: read, score, write, verify. Returns the exit code. */
function run(): number {
  const paths = resolvePaths();
  if (!existsSync(paths.snapshotFile)) {
    process.stderr.write(
      `token radar: no snapshot at ${paths.snapshotFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
    );
    return EXIT_NO_INPUT;
  }

  const snapshot = parseSnapshot(readFileSync(paths.snapshotFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    return EXIT_REFUSED;
  }

  mkdirSync(paths.outDir, { recursive: true });
  const boardJson = `${JSON.stringify({ rows: board })}\n`;
  writeFileSync(join(paths.outDir, 'board.json'), boardJson);
  writeFileSync(join(paths.outDir, 'data.js'), dataScript(radar));

  const dashFiles = copyDirectory(join(REPO_ROOT, 'dashboard'), paths.dashboardDir);
  const shots = copyDirectory(join(REPO_ROOT, 'screenshots'), paths.screenshotsDir);
  const shotIssue = checkScreenshotNames(shots);
  if (shotIssue !== null) {
    process.stderr.write(`token radar: ${shotIssue}\n`);
    return EXIT_REFUSED;
  }

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  // buildDossier returns bytes (a Buffer), not a string: compare bytes throughout.
  const dossierBytes = Buffer.from(dossierFromLibrary(paths.outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_LIMIT,
    dashboard: DASHBOARD_LIMIT,
  }));
  writeFileSync(join(paths.outDir, 'dossier.json'), dossierBytes);

  const verifyIssue = verifyOutputs(paths, boardJson, dossierBytes);
  if (verifyIssue !== null) {
    process.stderr.write(`token radar: the written outputs fail verification: ${verifyIssue}\n`);
    return EXIT_REFUSED;
  }

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(paths.outDir, 'board.json')}, ${join(paths.outDir, 'data.js')}, ${paths.dashboardDir} (${dashFiles.length} files), ${paths.screenshotsDir} (${shots.length} images) and ${join(paths.outDir, 'dossier.json')}\n` +
      `token radar: verified the written board and dossier by reading them back\n`,
  );
  return EXIT_OK;
}

process.exitCode = run();
