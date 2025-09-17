export function getPath(url) {
  const urlObj = new URL(url);
  return urlObj.pathname;
}

export function getOrigin(url) {
  const urlObj = new URL(url);
  return urlObj.origin;
}
