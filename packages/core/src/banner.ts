import { HOPAK_VERSION } from './version';

export interface BannerInputs {
  url: string;
  dialect: string;
}

export function buildBanner(inputs: BannerInputs): string {
  return [
    '',
    `  Hopak.js v${HOPAK_VERSION}`,
    `  ↳ Listening on ${inputs.url}`,
    `  ↳ Database: ${inputs.dialect}`,
    '',
  ].join('\n');
}
