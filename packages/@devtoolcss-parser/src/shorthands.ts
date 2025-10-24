/*!
 * Modified from css-shorthand-propertiess
 * https://github.com/gilmoreorless/css-shorthand-properties
 * MIT Licensed: https://gilmoreorless.mit-license.org/
 */

// TODO: minify this file

// prettier-ignore
export const shorthandMap = {
  "list-style": [
    "list-style-type",
    "list-style-position",
    "list-style-image"
  ],
  "margin": [
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left"
  ],
  "outline": [
    "outline-width",
    "outline-style",
    "outline-color"
  ],
  "padding": [
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left"
  ],
  "background": [
    "background-image",
    "background-position",
    "background-size",
    "background-repeat",
    "background-origin",
    "background-clip",
    "background-attachment",
    "background-color"
  ],
  "background-position": [
    "background-position-x",
    "background-position-y"
  ],
  "border": [
    "border-width",
    "border-style",
    "border-color"
  ],
  "border-color": [
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color"
  ],
  "border-style": [
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style"
  ],
  "border-width": [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width"
  ],
  "border-top": [
    "border-top-width",
    "border-top-style",
    "border-top-color"
  ],
  "border-right": [
    "border-right-width",
    "border-right-style",
    "border-right-color"
  ],
  "border-bottom": [
    "border-bottom-width",
    "border-bottom-style",
    "border-bottom-color"
  ],
  "border-left": [
    "border-left-width",
    "border-left-style",
    "border-left-color"
  ],
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius"
  ],
  "border-image": [
    "border-image-source",
    "border-image-slice",
    "border-image-width",
    "border-image-outset",
    "border-image-repeat"
  ],
  "font": [
    "font-style",
    "font-variant",
    "font-weight",
    "font-stretch",
    "font-size",
    "line-height",
    "font-family"
  ],
  "font-variant": [
    "font-variant-ligatures",
    "font-variant-alternates",
    "font-variant-caps",
    "font-variant-numeric",
    "font-variant-east-asian"
  ],
  "flex": [
    "flex-grow",
    "flex-shrink",
    "flex-basis"
  ],
  "flex-flow": [
    "flex-direction",
    "flex-wrap"
  ],
  "grid": [
    "grid-template-rows",
    "grid-template-columns",
    "grid-template-areas",
    "grid-auto-rows",
    "grid-auto-columns",
    "grid-auto-flow"
  ],
  "grid-template": [
    "grid-template-rows",
    "grid-template-columns",
    "grid-template-areas"
  ],
  "grid-row": [
    "grid-row-start",
    "grid-row-end"
  ],
  "grid-column": [
    "grid-column-start",
    "grid-column-end"
  ],
  "grid-area": [
    "grid-row-start",
    "grid-column-start",
    "grid-row-end",
    "grid-column-end"
  ],
  "grid-gap": [
    "grid-row-gap",
    "grid-column-gap"
  ],
  "mask": [
    "mask-image",
    "mask-mode",
    "mask-position",
    "mask-size",
    "mask-repeat",
    "mask-origin",
    "mask-clip"
  ],
  "mask-border": [
    "mask-border-source",
    "mask-border-slice",
    "mask-border-width",
    "mask-border-outset",
    "mask-border-repeat",
    "mask-border-mode"
  ],
  "columns": [
    "column-width",
    "column-count"
  ],
  "column-rule": [
    "column-rule-width",
    "column-rule-style",
    "column-rule-color"
  ],
  "scroll-padding": [
    "scroll-padding-top",
    "scroll-padding-right",
    "scroll-padding-bottom",
    "scroll-padding-left"
  ],
  "scroll-padding-block": [
    "scroll-padding-block-start",
    "scroll-padding-block-end"
  ],
  "scroll-padding-inline": [
    "scroll-padding-inline-start",
    "scroll-padding-inline-end"
  ],
  "scroll-snap-margin": [
    "scroll-snap-margin-top",
    "scroll-snap-margin-right",
    "scroll-snap-margin-bottom",
    "scroll-snap-margin-left"
  ],
  "scroll-snap-margin-block": [
    "scroll-snap-margin-block-start",
    "scroll-snap-margin-block-end"
  ],
  "scroll-snap-margin-inline": [
    "scroll-snap-margin-inline-start",
    "scroll-snap-margin-inline-end"
  ],
  "cue": [
    "cue-before",
    "cue-after"
  ],
  "pause": [
    "pause-before",
    "pause-after"
  ],
  "rest": [
    "rest-before",
    "rest-after"
  ],
  "text-decoration": [
    "text-decoration-line",
    "text-decoration-style",
    "text-decoration-color"
  ],
  "text-emphasis": [
    "text-emphasis-style",
    "text-emphasis-color"
  ],
  "animation": [
    "animation-name",
    "animation-duration",
    "animation-timing-function",
    "animation-delay",
    "animation-iteration-count",
    "animation-direction",
    "animation-fill-mode",
    "animation-play-state"
  ],
  "transition": [
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transition-delay"
  ],

  // From MDN https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascade/Shorthand_properties#shorthand_properties
  // By ChatGPT

  // Animation Range
  "animation-range": [
    "animation-range-start",
    "animation-range-end"
  ],

  // Logical Borders
  "border-block": [
    "border-block-width",
    "border-block-style",
    "border-block-color"
  ],
  "border-block-start": [
    "border-block-start-width",
    "border-block-start-style",
    "border-block-start-color"
  ],
  "border-block-end": [
    "border-block-end-width",
    "border-block-end-style",
    "border-block-end-color"
  ],
  "border-inline": [
    "border-inline-width",
    "border-inline-style",
    "border-inline-color"
  ],
  "border-inline-start": [
    "border-inline-start-width",
    "border-inline-start-style",
    "border-inline-start-color"
  ],
  "border-inline-end": [
    "border-inline-end-width",
    "border-inline-end-style",
    "border-inline-end-color"
  ],

  // Font
  "font-synthesis": [
    "font-synthesis-weight",
    "font-synthesis-style",
    "font-synthesis-small-caps"
  ],

  // Gap
  gap: ["row-gap", "column-gap"],

  // Inset (Logical Position Offsets)
  inset: ["top", "right", "bottom", "left"],
  "inset-block": ["inset-block-start", "inset-block-end"],
  "inset-inline": ["inset-inline-start", "inset-inline-end"],

  // Margins
  "margin-block": ["margin-block-start", "margin-block-end"],
  "margin-inline": ["margin-inline-start", "margin-inline-end"],

  // Offsets + Position Try
  offset: [
    "offset-position",
    "offset-path",
    "offset-distance",
    "offset-rotate",
    "offset-anchor"
  ],

  // Overflow
  overflow: ["overflow-x", "overflow-y"],

  // Overscroll Behavior
  "overscroll-behavior": [
    "overscroll-behavior-x",
    "overscroll-behavior-y",
    "overscroll-behavior-inline",
    "overscroll-behavior-block"
  ],

  // Padding
  "padding-block": ["padding-block-start", "padding-block-end"],
  "padding-inline": ["padding-inline-start", "padding-inline-end"],

  // Place Shorthands
  "place-content": ["align-content", "justify-content"],
  "place-items": ["align-items", "justify-items"],
  "place-self": ["align-self", "justify-self"],

  // Scroll Margin
  "scroll-margin": [
    "scroll-margin-top",
    "scroll-margin-right",
    "scroll-margin-bottom",
    "scroll-margin-left"
  ],
  "scroll-margin-block": [
    "scroll-margin-block-start",
    "scroll-margin-block-end"
  ],
  "scroll-margin-inline": [
    "scroll-margin-inline-start",
    "scroll-margin-inline-end"
  ],

  // WebKit Shorthands
  "-webkit-text-stroke": [
    "-webkit-text-stroke-width",
    "-webkit-text-stroke-color"
  ],
  "-webkit-border-before": [
    "-webkit-border-before-width",
    "-webkit-border-before-style",
    "-webkit-border-before-color"
  ],
  "-webkit-mask-box-image": [
    "-webkit-mask-box-image-source",
    "-webkit-mask-box-image-slice",
    "-webkit-mask-box-image-width",
    "-webkit-mask-box-image-outset",
    "-webkit-mask-box-image-repeat"
  ]
} as const;

/* checking no empty
for (const shorthand in shorthandMap) {
  const longhands = shorthandMap[shorthand];
  if (longhands.length === 0) {
    console.log(shorthand);
  }
}
*/
