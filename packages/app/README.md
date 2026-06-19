# @rivus/app

The Rivus client for **iOS, Android, and Web**, built with [Expo](https://expo.dev) (SDK 56) and [expo-router](https://docs.expo.dev/router/introduction/).

It ships a small vertical slice: a home screen and an items list backed by a typed, runtime-agnostic API client (`src/api`) that talks to [`@rivus/api`](../api) and reuses the shared Zod schemas/types from [`@rivus/core`](../core).

## Scripts

| Script | Description |
| --- | --- |
| `pnpm --filter @rivus/app start` | Start the Expo dev server (choose a target). |
| `pnpm --filter @rivus/app ios` | Open the app in the iOS simulator. |
| `pnpm --filter @rivus/app android` | Open the app on an Android device/emulator. |
| `pnpm --filter @rivus/app web` | Run the app in a browser via Metro. |
| `pnpm --filter @rivus/app export:web` | Static web export (`expo export -p web`). |
| `pnpm --filter @rivus/app test` | Run the hermetic Vitest suite (Node env). |
| `pnpm --filter @rivus/app test:coverage` | Run tests with coverage thresholds. |
| `pnpm --filter @rivus/app type-check` | `tsc --noEmit`. |
| `pnpm --filter @rivus/app clean` | Remove `.expo`, `dist`, and `coverage`. |

> There is intentionally **no `build` script**: `pnpm -r build` skips this package because Metro web bundling is too fragile for CI. Use `export:web` locally when you need a web bundle.

## Configuration

The API base URL is read from `EXPO_PUBLIC_API_URL` (falling back to `http://localhost:4000`). The items screen is authenticated; for a quick end-to-end preview set `EXPO_PUBLIC_DEMO_TOKEN` to a JWT obtained from the API's `/v1/auth/login`.

## Running

- **Screens need the API running.** Start `@rivus/api` (e.g. `pnpm --filter @rivus/api dev`) so the home → items flow has data to render.
- **Native builds require Expo tooling and a device/simulator.** Use the Expo CLI (`pnpm --filter @rivus/app ios|android`) with Xcode / Android Studio or the Expo Go app. CI only runs the Node-based unit tests.

## Architecture notes

- `src/api/client.ts` imports **nothing** from `react-native`/`expo`, so it runs under plain Node and is unit-tested with a mocked `fetch`.
- `metro.config.js` is configured for the pnpm monorepo (`watchFolders` + `nodeModulesPaths`) so Metro can resolve workspace packages through pnpm symlinks.
