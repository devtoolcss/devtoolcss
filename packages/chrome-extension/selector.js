export function getUniqueSelector(element) {
  function getElementSelector(element) {
    if (element.id) {
      return `#${element.id.replace(/:/g, "\\:")}`;
    }

    let selector = element.tagName.toLowerCase();
    if (
      element.className instanceof String &&
      element.className.trim() !== ""
    ) {
      selector += `.${element.className.replace(/ /g, ".")}`;
    }
    let siblings = Array.from(element.parentNode.children);
    let index = siblings.indexOf(element) + 1;
    if (siblings.length > 1) {
      selector += `:nth-child(${index})`;
    }
    return selector;
  }

  function isUnique(selector) {
    let cnt = document.querySelectorAll(selector).length;
    if (cnt === 0) {
      throw new Error(`No elements found for selector: ${selector}`);
    }
    return cnt === 1;
  }

  let selector = getElementSelector(element);
  let parent = element.parentElement;

  while (parent) {
    selector = `${getElementSelector(parent)} > ${selector}`;
    parent = parent.parentElement;
    if (isUnique(selector)) {
      return selector;
    }
  }

  console.warn("No unique selector");
  return selector;
}
