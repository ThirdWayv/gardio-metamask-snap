# Gardio Wallet Snap

Gardio MetaMask Snap integrates Gardio hardware wallets with MetaMask to enable secure account access, transaction signing, and message signing.

### Prerequisites
- Node.js >= 18
- Yarn 3.x (recommended) or npm
- MetaMask Snaps CLI: `@metamask/snaps-cli`

```bash
npm install -g @metamask/snaps-cli
```

### Quick Start
```bash
# install deps
yarn install    # or: npm install

# start local dev server (watches and rebuilds)
yarn start      # or: npm start

# build
yarn build
```

### Using the Snap
- Production Snap ID: `npm:@gardio/gardio-snap`
- Local Snap ID: `local:http://localhost:8080`

### Folder Structure
The repository layout follows a simple, TypeScript-based Snap project structure.

```
|-> gardio-metamask-snap
  |-> src
  |     |-> index.ts                 "Snap entry: onRpcRequest, lifecycle hooks"
  |     |-> keyring.ts               "Keyring and account management"
  |     |-> logger.ts                "Lightweight logging utilities"
  |     |-> permissions.ts           "Snap permissions and validation"
  |     |-> stateManagement.ts       "Persisted state helpers"
  |     |-> util.ts                  "General-purpose utilities"
  |
  |-> dist                          "Compiled Snap bundle outputs"
  |     |-> bundle.js
  |     |-> bundle.js.map
  |
  |-> scripts
  |     |-> build-preinstalled-snap.js "Build helper for preinstalled Snap"
  |
  |-> images
  |     |-> icon.svg                 "Snap icon"
  |
  |-> Doc                           "Product docs, guides, and artifacts"
  |     |-> gardio-MetaMask-Snap-Guide.pdf
  |     |-> MetaMask Gardio Snap Development Guide.pdf
  |     |-> MetaMask Gardio Snap Design and Architecture Overview.pdf
  |     |-> Gardio MetaMask Snap User Guide Tutorials
  |           |-> Setup MetaMask and Connect Gardio Snap to MetaMask.mp4
  |           |-> Import Accounts.mp4
  |           |-> Sign Message.mp4
  |           |-> Sign Token Tx.mp4
  |           |-> Sign Tx.mp4
  |
  |-> node_modules                  "Third-party dependencies (generated)"
  |
  |-> CHANGELOG.md                  "Release notes"
  |-> snap.config.ts                "Snaps CLI config"
  |-> snap.manifest.json            "Snap manifest"
  |-> tsconfig.json                 "TypeScript config"
  |-> package.json                  "Project metadata and scripts"
  |-> yarn.lock                     "Yarn lockfile"
  |-> README.md                     "This file"
```

### Publishing
This package is published as `@gardio/gardio-snap`. Ensure you are authenticated to the npm registry and follow your release workflow (version bump, changelog, build, and publish).



### Development Guide (Concise)

This section summarizes the internal development guide for building the Snap, working with the dApp, building WASM, and Solana notes.

#### 1. Prerequisites and Versions
- Install Node.js and npm: [nodejs.org](https://nodejs.org/)
  - Verify: `node -v` and `npm -v`
- Install Yarn: `npm install -g yarn`
  - Verify: `yarn -v`
- Project versions used:
  - Yarn: 3.6.3 (set with `yarn set version 3.6.3`)
  - Node: 22.16.0 (>= 18.0.0 is supported)

#### 2. Gardio Snap
- Repository: [github.com/ThirdWayv/gardio-metamask-snap](https://github.com/ThirdWayv/gardio-metamask-snap)
- npm package: [`@gardio/gardio-snap`](https://www.npmjs.com/package/@gardio/gardio-snap)

Development build:
```bash
yarn
yarn start
```

Production publish:
1) Update version in both `package.json` and `snap.manifest.json` (must match exactly)
2) Build the Snap:
```bash
yarn build
```
3) Login to npm (one-time per environment):
```bash
npm login
```
4) Publish:
```bash
npm publish
```

#### 3. Gardio dApp (Reference)
- Repository: [github.com/ThirdWayv/gardioMetaMaskSnap](https://github.com/ThirdWayv/gardioMetaMaskSnap)

Development build (from `gardioMetaMaskSnap/packages/site`):
```bash
yarn
yarn start
# Opens http://localhost:8000/
```

Deploy (Production):
```bash
yarn build
# install Firebase CLI globally (Yarn 3 doesn't support global add)
npm i -g firebase-tools
firebase login
firebase deploy
```

Refer to the `gardio-MetaMask-Snap-Guide.pdf` in `Doc/` for usage walkthroughs.

#### 4. Build WASM (Reference)
Prerequisites:
- WSL: See internal guide [Automation test bringup](https://thirdwayv.atlassian.net/wiki/spaces/CRYP/pages/2840461313/Automation+test+bringup)
- Emscripten SDK: [github.com/emscripten-core/emsdk](https://github.com/emscripten-core/emsdk)

Install Emscripten (in WSL):
```bash
./emsdk install 3.1.64
./emsdk activate 3.1.64
source emsdk_env.sh
```

Build WalletCore WASM (WalletCore/Build/MetaMask Snap):
- Use branch CRYP-4449: [TWIWalletCore/tree/CRYP-4449](https://github.com/ThirdWayv/TWIWalletCore/tree/CRYP-4449)
```bash
emcmake cmake
make -j20
```
- Output: `crypto_guard_usb_if.wasm` → copy to dApp `gardioMetaMaskSnap/packages/site/public` and rebuild the dApp

#### 5. Solana Support (Notes)
- In WalletCore, define `SOLANA_SUPPORTED` in `CMakeLists.txt` and include `twi_solana_json_parser` (see CRYP-4449)
- For branches with `.env.sample` (e.g., CRYP-4449, CRYP-4505), copy to `.env` and set Solana RPC URL
- MetaMask Flask (as of 12.22.2) does not fully support Solana tx for non-EVM snaps; reference the MetaMask extension repo if custom builds are needed: [metamask-extension](https://github.com/MetaMask/metamask-extension)
- Example: [snap-solana-wallet](https://github.com/MetaMask/snap-solana-wallet)
- Internal Jira to review before Solana tx work:
  - `CRYP-4440`, `CRYP-4449`, `CRYP-4505`, `CRYP-4504`

#### 6. References
- MetaMask Snaps docs: [docs.metamask.io/snaps](https://docs.metamask.io/snaps/)
- MetaMask simple keyring example: [snap-simple-keyring](https://github.com/MetaMask/snap-simple-keyring)
- Jira (internal-only): `https://thirdwayv.atlassian.net/issues/?jql=project%20%3D%20%27CRYP%27%20AND%20textfields%20~%20%22MetaMask%20Snap%22`
- Emscripten SDK: [emsdk](https://github.com/emscripten-core/emsdk)
- Solana wallet snap: [@metamask/solana-wallet-snap](https://www.npmjs.com/package/@metamask/solana-wallet-snap)

