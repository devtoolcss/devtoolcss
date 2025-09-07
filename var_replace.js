import postcss from "postcss";
import { postcssVarReplace } from "postcss-var-replace";

// TODO: can have duplicate rules, and each prop is a rule, need to merge

// BUG: cannot handle body:hover a

const input = `
:root {
	--my-color: blue;
	--my-bg: yellow !important;
}

body:hover a {
	--my-color: red;
}

body a {
  background-color: var(--my-color, var(--my-bg, black));	
	color: var(--my-color, var(--my-bg, black));	
}

a {
  background-color: var(--my-color, var(--my-bg, black));	
}
`;

const { css } = postcss([postcssVarReplace()]).process(input);

console.log(css);
