import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ConfigError, type Logger, pathExists } from '@hopak/common';

export interface CertPair {
  key: string;
  cert: string;
}

export interface EnsureDevCertOptions {
  certDir: string;
  log?: Logger;
  hostname?: string;
}

const KEY_FILENAME = 'dev.key';
const CERT_FILENAME = 'dev.crt';
const KEY_VALIDITY_DAYS = '365';
const RSA_KEY_BITS = 'rsa:2048';
const GITIGNORE_CONTENTS = '*\n!.gitignore\n';

async function readCertPair(keyPath: string, certPath: string): Promise<CertPair> {
  const [key, cert] = await Promise.all([readFile(keyPath, 'utf8'), readFile(certPath, 'utf8')]);
  return { key, cert };
}

async function runOpenssl(keyPath: string, certPath: string, hostname: string): Promise<void> {
  const proc = Bun.spawn(
    [
      'openssl',
      'req',
      '-x509',
      '-newkey',
      RSA_KEY_BITS,
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      KEY_VALIDITY_DAYS,
      '-nodes',
      '-subj',
      `/CN=${hostname}`,
      '-addext',
      `subjectAltName=DNS:${hostname},DNS:localhost,IP:127.0.0.1`,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const exitCode = await proc.exited;
  if (exitCode === 0) return;

  const stderr = await new Response(proc.stderr).text();
  throw new ConfigError(
    [
      `Could not generate dev HTTPS certificate (openssl exit ${exitCode}).`,
      '',
      'Hopak uses openssl to create a self-signed cert for local HTTPS.',
      'Install openssl, or provide your own key/cert via https.key and https.cert in hopak.config.ts.',
      '',
      stderr.trim(),
    ].join('\n'),
  );
}

async function writeCertGitignore(certDir: string, log: Logger | undefined): Promise<void> {
  try {
    await writeFile(join(certDir, '.gitignore'), GITIGNORE_CONTENTS, 'utf8');
  } catch (cause) {
    log?.warn('Failed to write .gitignore in cert directory', {
      path: certDir,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export async function ensureDevCert(options: EnsureDevCertOptions): Promise<CertPair> {
  const hostname = options.hostname ?? 'localhost';
  const keyPath = join(options.certDir, KEY_FILENAME);
  const certPath = join(options.certDir, CERT_FILENAME);

  if ((await pathExists(keyPath)) && (await pathExists(certPath))) {
    return readCertPair(keyPath, certPath);
  }

  await mkdir(dirname(keyPath), { recursive: true });
  options.log?.info('Generating self-signed dev certificate', { path: options.certDir });
  await runOpenssl(keyPath, certPath, hostname);
  await writeCertGitignore(options.certDir, options.log);
  return readCertPair(keyPath, certPath);
}
