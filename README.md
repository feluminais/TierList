<h1 align="center">TierList</h1>

<p align="center">A tier list maker where the result stays data rather than a picture.</p>

<p align="center">
  <a href="https://github.com/feluminais/TierList/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/feluminais/TierList/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a>
  &nbsp; · &nbsp;
  <a href="apps/web/README.md">Web app</a>
  &nbsp; · &nbsp;
  <a href="apps/mobile/README.md">Mobile app</a>
  &nbsp; · &nbsp;
  <a href="#project-layout">Project layout</a>
  &nbsp; · &nbsp;
  <a href="https://github.com/feluminais/TierList/issues">Issues</a>
</p>

TierList is a board you drag tiles onto, tier by tier. A list is a versioned document, not a flattened image: tiles keep their
crop, rotation and pen strokes as edits to the source image, and every placement is a position in a tier. The same document
renders as a Skia canvas in the editor and as plain HTML on a shared page, which loads no canvas and opens fast.

You can make a list in the editor, export it as a PNG, a JPG or the document itself as JSON, and publish it. Someone else
opens the share link, fills in their own copy of the template, and the compare page shows where two filled lists agree and
where they would argue.

## Quick start

You need Node 24 or later and pnpm 11 (the version is pinned in `package.json`). Install, then start the web app:

```bash
git clone https://github.com/feluminais/TierList
cd TierList
pnpm install
pnpm --filter web dev
```

Open `http://localhost:3000/editor`. Without an API the editor keeps the document on the page and saves nothing. To save
lists, upload images and share, run the API next to it. This one uses an in-memory database, so everything disappears
when it stops:

```bash
pnpm --filter @tl/api exec tsx scratch-dev-api.ts
NEXT_PUBLIC_API_URL=http://localhost:8788 pnpm --filter web dev
```

## The board

Tiles can be any size, for the whole list or for one tier. Tier labels, colors and the tile aspect (square, portrait or
landscape) are settings of the document. An item is an image or a text tile, and the tray holds what is not ranked yet.

- **Crop, rotate and draw.** Images are edited without leaving the board. The edits are stored against the source image,
  so a stroke keeps its proportions at any tile size and the original is never rewritten.
- **Export.** PNG or JPG at a size you pick, or the document as JSON.
- **Autosave.** With an API configured, the editor saves as you work. Images upload to the API and are served back by id.

## Share, fill and compare

- **Share.** Publishing a list gives it a share code. The page at `/l/<code>` is rendered on the server as plain HTML.
- **Fill in.** A shared list works as a template: anyone can open their own copy and rank the same items.
- **Compare.** `/compare` takes several share codes and sorts the items into agreed, close, contested and incomplete.
- **Browse.** `/browse` lists published lists by category (Anime, Games, Movies, TV, Music, Food, Sports, Internet, Other)
  and by search.
- **Report.** A shared page has a report button. An operator reviews reports with a command-line tool (see
  [The API](#the-api)).

There are no accounts. A browser owns its lists through a device token kept in `localStorage`, and `/lists` shows the lists
that token owns.

## The API

`services/api` is a [Hono](https://hono.dev) server over PostgreSQL with [Drizzle](https://orm.drizzle.team). It serves the
lists, assets, share codes, browse pages and reports, validates every document it writes, rate-limits by client address and
logs one JSON object per line.

To run it against a real database:

```bash
docker compose -f services/api/docker-compose.yml up -d   # optional Postgres 17 for local work
export DATABASE_URL=postgres://tierlist:tierlist@localhost:5432/tierlist
export ALLOWED_ORIGINS=http://localhost:3000
pnpm --filter @tl/api db:migrate
pnpm --filter @tl/api dev
```

| Variable | Used by | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | API | Postgres connection string. Required. |
| `ALLOWED_ORIGINS` | API | Comma-separated browser origins allowed to call it. Required. |
| `PORT` | API | Port to listen on. Defaults to 8787. |
| `TRUSTED_PROXY_HOPS` | API | How many reverse proxies sit in front of it. Set it behind a proxy, or every client shares one rate-limit bucket. |
| `ASSET_STORAGE_ROOT` | API | Directory for uploaded images. Defaults to `data/assets` under the working directory. |
| `NEXT_PUBLIC_API_URL` | web | Base URL of the API. Unset means the editor saves nothing. |
| `NEXT_PUBLIC_SITE_URL` | web | The site's public origin, used for links and metadata. Defaults to `http://localhost:3000`. |
| `EXPO_PUBLIC_API_URL` | mobile | Base URL of the API for the Expo app. |

Reports are handled from the command line:

```bash
pnpm --filter @tl/api moderate reports            # list open reports (--all includes resolved ones)
pnpm --filter @tl/api moderate dismiss <id>       # mark a report handled
pnpm --filter @tl/api moderate unlist <code>      # take a share off the browse pages
pnpm --filter @tl/api moderate remove <code>      # withdraw a share so its link stops working
```

## Tech stack

- **Language and tooling:** TypeScript, pnpm workspaces, Turborepo, Vitest
- **Web:** Next.js 16, React 19, Tailwind CSS 4
- **Board rendering:** [React Native Skia](https://shopify.github.io/react-native-skia/), on the web through react-native-web and CanvasKit
- **Mobile:** Expo 57 and Expo Router, React Native 0.86
- **API:** Hono, Drizzle ORM, PostgreSQL (PGlite in tests)

## Develop

```bash
pnpm build        # turbo run build
pnpm test         # turbo run test
pnpm typecheck    # turbo run typecheck
pnpm lint         # turbo run lint
```

Run one package with `pnpm --filter <name> <script>`, for example `pnpm --filter @tl/core test`. The API tests run on PGlite
and need no database. CI runs the typecheck, the tests, the web app's lint and build, and a `pnpm audit` of production
dependencies on every push and pull request.

The workspace uses `nodeLinker: hoisted` because the Android native build needs short paths, and it pins `react`,
`react-dom`, `react-native` and `@shopify/react-native-skia` so that only one copy of each exists. The reasons are in
`pnpm-workspace.yaml`.

## Project layout

| Path | What it is |
| --- | --- |
| `apps/web` | The Next.js app: landing page, editor, share, browse, compare and lists pages. [README](apps/web/README.md) |
| `apps/mobile` | The Expo app. It renders the same board; the chrome, uploads and edit sheet are web-only. [README](apps/mobile/README.md) |
| `packages/core` | The document model: types, actions and reducer, validation, schema migration, categories and comparison. No UI. |
| `packages/editor-core` | Board layout, hit testing, drag and drop, history, cropping, strokes and export planning, without a renderer. |
| `packages/editor` | The Skia board, the edit canvas and image export. |
| `packages/app-core` | React hooks shared by both apps: API client, autosave, uploads, sharing and drafts. |
| `packages/api-client` | The typed client for the API. |
| `services/api` | The Hono API, its Drizzle schema and migrations, and the moderation command. |

## Status

TierList is pre-release: nothing is published or tagged, and the packages are private to the workspace. The mobile app is a
host for the board and is not feature-complete; its Android package name is a placeholder.

## Contributing

Run `pnpm test`, `pnpm typecheck` and `pnpm lint` before opening a pull request. Bug reports and feature requests go to
[Issues](https://github.com/feluminais/TierList/issues).

## License

No license file has been added yet.
