import type { SnapConfig } from '@metamask/snaps-cli';

const environment = {
  SOLANA_EXPLORER: process.env.SOLANA_EXPLORER,
  DAPP_ORIGIN_PRODUCTION: 'https://gardiometamasksnap.web.app/',
  DAPP_ORIGIN_DEVELOPMENT: 'http://localhost:8000/',
}

const config: SnapConfig = {
  bundler: 'webpack',
  input: 'src/index.ts',
  server: { port: 8080 },
  polyfills: {
    buffer: true,
    stream: true,
    crypto: true,
  },
  environment,
  stats: {
    builtIns: {
      // The following builtins can be ignored. They are used by some of the
      // dependencies, but are not required by this snap.
      ignore: [
        'events',
        'http',
        'https',
        'zlib',
        'util',
        'url',
        'string_decoder',
        'punycode',
      ],
    },
  },
};

export default config;
