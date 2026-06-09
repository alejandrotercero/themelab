<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/alejandrotercero/themelab/main/logo.svg">
    <img alt="ThemeLab" src="https://raw.githubusercontent.com/alejandrotercero/themelab/main/logo-light.svg" width="300">
  </picture>
</p>

# themelab

`themelab` lets you edit a React app visually while it is running locally, then write those changes back to the source files in your project.

It works by opening a proxy in front of your dev server and injecting an overlay into the page.

## Fastest path

You do not need to download or clone this repo.

From the root of your React app:

```bash
npm install -D themelab-cli
```

Start your dev server, then in a second terminal run:

```bash
npx themelab
```

If you want to try it without installing first:

```bash
npx themelab-cli@latest
```

## Requirements

- Node.js 20+
- A React project
- A running development server
- Supported app setups: Next.js, Vite, and Create React App

## Install

From the root of the React app you want to edit:

```bash
npm install -D themelab-cli
```

Or run it without installing first:

```bash
npx themelab-cli@latest
```

## Run

After installing locally:

```bash
npx themelab
```

If auto-detection does not pick the right port:

```bash
npx themelab 3000
```

## CLI options

```text
themelab [options] [port]

Arguments:
  port           Dev server port override

Options:
  --no-open      Don't open browser automatically
  --host <host>  Dev server host (default: "localhost")
  --verbose      Enable debug logging
```

## Notes

- Run the command from your app's root directory.
- It only works against development builds, not production builds.
- Only files inside the current project are eligible for writes.
