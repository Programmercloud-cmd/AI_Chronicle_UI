# Component contract: app-shell

## Purpose

Provide the minimal React/Vite application shell, snapshot client, routing, theme, navigation, loading, and diagnostic error surface shared by all views.

## Inputs and outputs

- Fetch one immutable `/api/snapshot` value on application load; retain it consistently until explicit reload.
- Routes: Current, History, Roadmap, and milestone detail placeholder boundaries.
- Desktop-first sparse header/navigation, light/dark theme preference, skip link, keyboard focus, and accessible loading/error/retry states.

## Interfaces

- Typed web snapshot boundary derived from server output; no canonical authoring/browser state.
- Feature views plug into route outlets without owning fetch/theme/navigation state.
- Production Vite assets integrate with the local Fastify server/package build without remote CDN dependencies.

## Non-goals

- Current/Roadmap content, History SVG/layout rendering, milestone/evidence detail, authoring, search, zoom, or mobile redesign.

## Tests and acceptance

- Shell navigation, one-snapshot consistency, reload/error/diagnostics, theme persistence, focus/keyboard semantics, no absolute path exposure.
- Build and browser smoke on local server; no console errors; independent critic ACCEPT.
