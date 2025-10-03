// https://gist.github.com/Eseperio/9545e9d8a540dd79a4f6eed6ff2d4ada

export function getUniqueSelector(element) {
  function getElementSelector(element) {
    if (element.id) {
      return `#${element.id.replace(/:/g, "\\:")}`;
    }
    if (element.tagName === "BODY") {
      return "body";
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

  let selector = getElementSelector(element);
  let elements = document.querySelectorAll(selector);

  if (elements.length === 1) {
    return selector;
  }

  let bestSelector = selector;
  let bestCount = elements.length;

  // Try with parents' ids
  let parent = element.parentElement;
  while (parent) {
    if (parent.id) {
      let parentSelector = `#${parent.id} ${selector}`;
      elements = document.querySelectorAll(parentSelector);
      if (elements.length === 1) {
        return parentSelector;
      }
      if (elements.length < bestCount) {
        bestSelector = parentSelector;
        bestCount = elements.length;
      }
    }
    parent = parent.parentElement;
  }

  // Try with parents' classes
  let parentClasses = [];
  parent = element.parentElement;
  while (parent && parent.tagName !== "BODY") {
    let classes = Array.from(parent.classList).filter(
      (c) => !parentClasses.includes(c),
    );
    for (let i = 0; i < classes.length; i++) {
      let parentSelector = `.${classes[i]} ${selector}`;
      elements = document.querySelectorAll(parentSelector);
      if (elements.length === 1) {
        return parentSelector;
      }
      if (elements.length < bestCount) {
        bestSelector = parentSelector;
        bestCount = elements.length;
      }
      parentClasses.push(classes[i]);
    }
    parent = parent.parentElement;
  }

  // Try with all parents
  parent = element.parentElement;
  let selectors = [selector];
  while (parent && parent.tagName !== "BODY") {
    let newSelectors = [];
    for (let i = 0; i < selectors.length; i++) {
      let newSelector = `${parent.tagName.toLowerCase()} ${selectors[i]}`;
      newSelectors.push(newSelector);
      elements = document.querySelectorAll(newSelector);
      if (elements.length === 1) {
        return newSelector;
      }
      if (elements.length < bestCount) {
        bestSelector = newSelector;
        bestCount = elements.length;
      }
    }
    selectors = newSelectors;
    parent = parent.parentElement;
  }

  // Show alert and return best selector
  // alert("No se ha podido encontrar un selector único.");
  return bestSelector;
}
