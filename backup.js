/*
function inlineStyle() {
	const body = document.querySelector("body");
	const elements = body.querySelectorAll("*");

	var id = 0;
	function injectPseudoStyle(el, pseudoStylesJson) {
		// Ensure the element has an ID (or generate one)
		if (!el.id) {
			el.id = `pseudo-${id++}`;
		}
		const selector = `#${el.id}`;

		// Build CSS rules
		let cssRules = "";
		for (const [pseudo, declarations] of Object.entries(pseudoStylesJson)) {
			if (Object.keys(declarations).length === 0) continue; // skip empty
			const decls = Object.entries(declarations)
				.map(
					([prop, val]) =>
						`${prop}: ${val.value}${val.important ? " !important" : ""};`
				)
				.join(" ");
			cssRules += `${selector}${pseudo} { ${decls} }\n`;
		}

		// Create <style> element
		const styleEl = document.createElement("style");
		styleEl.textContent = cssRules;

		// Insert before the element
		el.parentNode.insertBefore(styleEl, el);
	}

	function processElement(el) {
		if (el.tagName.toLowerCase() === "script") {
			el.remove();
			return;
		}

		const data_css = el.getAttribute("data-css");
		if (data_css) {
			const css = JSON.parse(data_css);
			for (const [name, { value, important }] of Object.entries(css)) {
				el.style.setProperty(name, value, important ? "important" : "");
			}
		}

		const data_pseudo = el.getAttribute("data-pseudo");
		if (data_pseudo) {
			const pseudo = JSON.parse(data_pseudo);
			injectPseudoStyle(el, pseudo);
		}

		// clean up attrs
		[...el.attributes].forEach((attr) => {
			if (
				attr.name !== "id" &&
				attr.name !== "class" &&
				attr.name !== "style" &&
				attr.name !== "href" &&
				//attr.name !== "data-pseudo" &&
				!attr.name.includes("src")
			) {
				el.removeAttribute(attr.name);
			}
		});
	}

	elements.forEach(processElement);
	// not sure why cannot push body to elements
	processElement(body);
}
*/
