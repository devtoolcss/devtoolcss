// From https://github.com/devtoolcss/chrome-inspector/blob/main/extension/xpath.js
// Licensed under MIT License

export function getAbsoluteXPath(node) {
  if (!node) return "";
  const pathSegments = [];

  while (node && node.nodeType !== Node.DOCUMENT_NODE) {
    let segment = "";
    let index = 1;
    let sibling = node.previousSibling;

    switch (node.nodeType) {
      case Node.ELEMENT_NODE: {
        const ns = node.namespaceURI;
        let prefix = "";
        if (ns === "http://www.w3.org/2000/svg") prefix = "svg:";
        else if (ns === "http://www.w3.org/1999/xhtml") prefix = ""; // default HTML

        while (sibling) {
          if (
            sibling.nodeType === Node.ELEMENT_NODE &&
            sibling.nodeName === node.nodeName
          )
            index++;
          sibling = sibling.previousSibling;
        }

        segment = `${prefix}${node.localName}[${index}]`;
        break;
      }

      case Node.TEXT_NODE:
        while (sibling) {
          if (sibling.nodeType === Node.TEXT_NODE) index++;
          sibling = sibling.previousSibling;
        }
        segment = `text()[${index}]`;
        break;

      case Node.COMMENT_NODE:
        while (sibling) {
          if (sibling.nodeType === Node.COMMENT_NODE) index++;
          sibling = sibling.previousSibling;
        }
        segment = `comment()[${index}]`;
        break;

      case Node.ATTRIBUTE_NODE:
        const ownerPath = getAbsoluteXPath(node.ownerElement);
        return `${ownerPath}/@${node.nodeName}`;

      default:
        segment = `node()[${index}]`;
    }

    pathSegments.unshift(segment);
    node = node.parentNode;
  }

  return "/" + pathSegments.join("/");
}
