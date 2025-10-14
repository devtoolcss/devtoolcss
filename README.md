# DevtoolCSS

**DevtoolCSS** is a monorepo providing utilities and applications for manipulating DevTool's CSS data, currently supporting **Chrome DevTools Protocol (CDP)**. It aims to demonstrate programmatic use of style panel's information.

Currently there are two applications focusing on inlining:

| App                                  | Description                                                               | Release                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UI Export](./packages/uiexport/)    | A Chrome DevTool extension that exports any components with CSS inlined.  | [![Chrome Web Store Version](https://img.shields.io/chrome-web-store/v/igoidllafhdiolciggebbokmhfmpdalo)](https://chromewebstore.google.com/detail/ui-export/igoidllafhdiolciggebbokmhfmpdalo) |
| [cleanclone](./packages/cleanclone/) | A cli crawler that inlilnes CSS, downloads resources, and rewrites links. | [![NPM Version](https://img.shields.io/npm/v/cleanclone)](https://www.npmjs.com/package/cleanclone)                                                                                            |

## Motivation

I was migrating a WordPress site to code. I thought this would be easy with today’s tools, but it turned out that LLM-based cloners hallucinate CSS, and existing inliners can’t handle huge stylesheets.

However, Devtool can always provide the exact styles applied during rendering. Knowing that it’s all powered by Chrome DevTools Protocol (CDP) — thanks to my previous experience working on Chromium — I decided to create this project.

## TODO

1. Modularize: split inlining stuff from `packages/parser` to `packages/inliner`.

   While [DevTools frontend](https://github.com/ChromeDevTools/devtools-frontend) has the most complete parsing logic that handles many quirks, it is too heavy and is entangled with the tool.

2. MCP: Give agents style panel. (Building on top with `packages/parser`.)
