![](./assets/logo.svg)

## Install

```
npm i cleanclone
```

## Usage

```
cleanclone --url {url} [options]
```

## Demo

https://github.com/user-attachments/assets/2c6785df-8470-4350-b77a-6980ef1364bb

## About

Cleanclone inlines matched CSS rules for each element into `style=` or `<style>#id:pseudo-class{}</style>`, resolving huge stylesheets into short, directly readable context.

Cleanclone also crawls resources and rewrites links. With `--recursive`, this gives you a static clone of a whole site (with javascript and css files removed).

Under the hood, cleanclone uses Chrome DevTools Protocol (CDP), the interface that powers browser's Inspect, Save as..., and a lot more.

Browsers are the best CSS engine, and we should leverage them beyond manual inspection, especially in the age of LLMs.
