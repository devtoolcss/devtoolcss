# cleanclone

Cleanclone inlines matched CSS rules for each element into

1. `style=`
2. `<style>#id:pseudo-class{}</style>`

This resolves huge stylesheets into short, directly readable properties, providing clean context for cloning/rewriting.

Cleanclone also crawls resources and rewrites links. With `--recursive`, this gives you a static clone of a whole site (with javascript and css files removed).

## Demo

https://github.com/user-attachments/assets/bc27a8a2-8a6f-469c-a29c-955cab2d4ebc

## Try once

```
npx cleanclone --debug --url {url}
```

## Install

```
npm i -g cleanclone
```

from source (latest):

```
# at packages/cleanclone
npm i
npm link
```

## Usage

```
cleanclone --url {url} [options]
```
