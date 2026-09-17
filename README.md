# @codecogs/eqneditor-lti

The [CodeCogs Equation Editor](https://editor.codecogs.com) as a single **LTI 1.3 Advantage**
tool. One deployment of this server, registered once per platform, reaches Canvas, Blackboard,
Brightspace, Schoology, Moodle, or any other LTI 1.3 platform - instead of a separate native
plugin per LMS, which is what every other adapter in this repo is.

Built on [ltijs](https://github.com/Cvmcosta/ltijs) v7, an actively-maintained open-source LTI
1.3 Advantage implementation, rather than hand-rolled OIDC/JWT handling - this is an
authentication flow, and that is not a place to prefer bespoke code over a maintained library.

## Verified against

**Not tested against a real LMS launch** - there is no Canvas/Moodle/Blackboard/Brightspace/
Schoology sandbox available to register this tool with and launch it from. What *was* actually
run, against a real ltijs v7 install and a real local MongoDB (not mocked):

- The server boots, connects to MongoDB, and starts listening.
- `platformManager.registerPlatform()` succeeds and generates a real RSA keypair for a test
  platform.
- `GET /keys` (the JWKS endpoint) correctly serves that generated public key.
- `GET /login` with realistic OIDC parameters returns `200` rather than crashing - the login
  redirect construction runs successfully against a registered platform.

**Not verified**: an actual signed launch reaching `/launch` (would need a JWKS server for the
fake test platform's own keys, to sign a test `id_token` the way a real LMS would), and the
Deep Linking response your "Insert" step builds. That code follows the shape ltijs' own
`.d.ts` files document (`context.deepLinking.isAvailable()` /
`context.deepLinking.createDeepLinkingForm()`), but has not been exercised end-to-end.

This matters more than the same caveat on the Moodle or Google Workspace adapters in this
repo: **ltijs v7 is a full rewrite** with a materially different API from v5, which is what
most existing tutorials (and most of what anyone, human or LLM, is likely to already know
about ltijs) still describe. Every API call in `src/server.js` was checked against the
installed package's own `.d.ts` files, not written from memory - see the comment at the top of
that file.

## Why this only offers an image, like the Google Workspace adapter

Deep Linking's `'html'` content item type is what actually gets embedded - LTI 1.3 platforms
generally don't have a native LaTeX/MathML content type to place instead, so an `<img>` is the
form guaranteed to mean something on the other end, the same reasoning as the Google Docs/
Slides adapter.

## Structure

```
src/server.js         Provider setup, the two launch handlers, /config and /insert.
src/platforms.js       Loads platforms.json (or PLATFORMS_JSON) and registers each with ltijs.
views/launch.html      The launched page - the same EqEditor UI every other adapter embeds.
platforms.example.json Copy to platforms.json and fill in your own platform registrations.
.env.example            Copy to .env.
```

## How a launch works

1. An instructor opens the tool - either from a **content picker** ("Insert from App", "External
   Tool"), which is a **Deep Linking** launch, or from a persistent **placement** (a course
   navigation link, say), which is a **Resource Link** launch. Both render the same
   `views/launch.html`.
2. The page loads `eqneditor.api.min.js`/`eqneditor.css` from `editor.codecogs.com` exactly
   the way every other adapter does, and builds the same toolbar/text-area/maths-view set.
3. Pressing **Insert** submits a real HTML form to `/insert` (not a `fetch()` - see the comment
   in `views/launch.html` for why: a Deep Linking response is itself a small auto-submitting
   page, and that only works if the browser receives and renders it as one).
4. `/insert` resumes the launch via `Provider.getLaunchContext(ltik)`, then either:
   - **Deep Linking**: builds and returns an LTI Deep Linking response embedding the equation
     as an `<img>`, which the browser auto-submits back to the platform.
   - **Resource Link**: there is nothing to hand back: returns a page showing the rendered
     image and its URL, to copy manually.

## Deploying

1. `npm install`
2. Copy `.env.example` to `.env` and set `MONGO_URL` (a MongoDB instance ltijs will use as its
   platform/session store - no separate encryption key needed for a fresh v7 install; see the
   comment in `.env.example`).
3. Copy `platforms.example.json` to `platforms.json` and register this tool with each platform
   you want to support first (see below) - you need each platform's own issued values before
   this file can be filled in, not the other way round.
4. `npm start`. The server needs to be reachable over HTTPS at a public URL before any real
   platform will launch it - LTI launches arrive inside an iframe, which every platform
   requires to be secure.

### Registering with each platform

Every LTI 1.3 platform's own admin console is where you register *this tool* and get back the
`clientId`/endpoint values `platforms.json` needs - none of this repo's own values matter until
that's done:

- **Canvas**: *Admin &rarr; Developer Keys &rarr; + LTI Key*. Canvas needs your tool's config
  either as a URL (point it at `https://your-deployment/lti/config` once a config endpoint
  exists - not built yet, see "Known gaps") or pasted in as JSON/XML by hand for now.
- **Blackboard**: [Blackboard's REST/LTI developer portal](https://developer.blackboard.com) -
  register an **LTI 1.3** application, not the older Building Block format.
- **Brightspace**: *Admin Tools &rarr; External Learning Tools &rarr; LTI Advantage &rarr;
  Register Tool*.
- **Schoology**: *App Center &rarr; Schoology API &rarr; LTI 1.3* registration flow, or via
  their partner onboarding if this is a district-wide install.
- **Moodle**: *not the way to reach Moodle from this repo* - Moodle can act as an LTI 1.3
  platform too, and would work through this same connector, but [`moodle/tiny_eqneditor`](../moodle)
  is the native plugin built for it, and is the better fit for a Moodle-only deployment (no
  separate server to run, no MongoDB).

Each platform hands back a `clientId`, an OIDC authentication endpoint, a token endpoint, and
either a JWKS URL or a single public key - exactly the fields `platforms.example.json` shows.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `MONGO_URL` | *(required)* | ltijs' platform/session store. |
| `PORT` | `3000` | |
| `EQNEDITOR_SERVER` | `editor.codecogs.com` | Same meaning as every other adapter. |
| `EQNEDITOR_RENDER_URL` | `https://latex.codecogs.com` | Same meaning as every other adapter. |
| `EQNEDITOR_SHOW_LATEX` | `true` | Same meaning as every other adapter. |
| `PLATFORMS_FILE` | `./platforms.json` | Where to load platform registrations from. |
| `PLATFORMS_JSON` | *(unset)* | The same content as `PLATFORMS_FILE`, inline - for a deployment that keeps this in a secret manager instead of a file. Takes priority over `PLATFORMS_FILE` if both are set. |

## Known gaps

- **Not tested against a real launch** - see "Verified against" above. Do this before
  registering with a real platform: ltijs' own docs
  (https://cvmcosta.me/ltijs/#/guides/getting-started) cover local testing against a sandbox
  platform.
- **No tool configuration endpoint.** Canvas in particular can register a tool from a single
  config URL rather than pasted-in JSON; ltijs doesn't build one automatically the way v5's
  `/register` (dynamic registration) route could, though `dynamicRegistration` in
  `ProviderOptions` is worth another look if manual registration proves painful across many
  institutions.
- **No Assignment and Grade Services or Names and Roles Provisioning use.** ltijs exposes both
  (`context.grading`, `context.namesAndRoles`) but this tool has no use for grades or roster
  data - it only inserts content, so neither is wired up.
- **No automated tests.** `npm test` does not exist yet.
