# Build, test, and lint
- Install deps: `yarn install` (packageManager: `yarn@4.9.2`; `npm install` also works with package-lock.json)
- Build: `npm run build` (tsc + tsc-esm-fix), docs: `npm run build:docs`
- Lint: `npm run lint` (tsc + eslint), autofix: `npm run lint:fix`
- Format: `npm run format`
- Tests: `npm test`
- Single test file: `npm test -- --runTestsByPath src/path/to/file.test.ts`
- E2E tests: `npm run test:e2e` (single file: `npm run test:e2e -- --runTestsByPath src/path/to/file.test-e2e.ts`)

# High-level architecture
- `src/index.ts` is the library entrypoint; it re-exports WAProto, Utils, Types, Defaults, WABinary, WAM, and WAUSync and exposes `makeWASocket`.
- Socket layering lives in `src/Socket`: `makeSocket` handles the raw WebSocket + Noise handshake; higher layers (messages send/recv, chats/groups/business/communities/newsletter) compose the lower socket and return `{ ...sock, newApis }`.
- `src/WABinary` contains BinaryNode encoding/decoding, JID helpers, and XML-ish node utilities used across the socket and message layers.
- `src/Signal` wraps libsignal and key management; `Defaults` wires this via `makeSignalRepository`.
- WA protocol types come from `WAProto/WAProto.proto` compiled into `WAProto/index.js`; `proto-extract` regenerates the proto, and `WAProto/GenerateStatics.sh` (script `npm run gen:protobuf`) refreshes JS/TS artifacts.
- The repository also includes a standalone bot entrypoint at `index.js` (Express + Baileys + Gemini/Pollinations); README notes it runs via `node index.js` and expects `GEMINI_API_KEY` plus Render/Uptime Robot setup.

# Key conventions
- TypeScript is ESM-first: imports often include `.js` extensions (see `src/index.ts`) and `tsconfig.json` uses `moduleResolution: "bundler"` with `allowImportingTsExtensions`.
- New socket functionality should follow the established layering pattern (create `makeXSocket`, call the previous layer, and return `{ ...sock, newMethods }`).
- Protobuf updates should go through `proto-extract` (updates `WAProto/WAProto.proto`) and then `npm run gen:protobuf` to regenerate runtime artifacts.
- Tests live under `src/**/*.test.ts`; e2e tests use `**/*.test-e2e.ts` per package.json scripts.
