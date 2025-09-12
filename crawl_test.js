import CDP from "chrome-remote-interface";

async function crawlTest(pageURL) {
  // seems that each client is a tab, a tab is a ws connection
  const target = await CDP.New();
  console.log("Connecting to browser...");
  const client = await CDP({ target: target.id });
  console.log("Connected!");

  await client.Emulation.setDeviceMetricsOverride({
    width: 1280, // my browser's fullscreen innerWidth/Height
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const { DOM, CSS, Page, Runtime, Network } = client;

  // enable events
  await DOM.enable();
  await CSS.enable();
  await Page.enable();
  await Network.enable();

  console.log(`Loading "${pageURL}" ...`);
  // BUG: not sure why after testing with --headless, it doesn't navigate at all
  // leading to wrong inline style (somehow correct stylesheets?)
  // must reboot (or change url?) to fix
  const navResult = await Page.navigate({
    url: pageURL,
  });
  if (navResult.errorText) {
    throw new Error(`Navigation failed: ${navResult.errorText}`);
  }
  await Page.loadEventFired();
  console.log("Loaded!");
  // trigger all lazyloading
  await Runtime.evaluate({
    expression: "window.scrollTo(0, document.body.scrollHeight);",
  });

  const { result: resultLinks } = await Runtime.evaluate({
    expression: getAnchorHref.toString() + "; getAnchorHref();",
    returnByValue: true,
  });
  const links = resultLinks.value;

  await client.close();
  await CDP.Close({ id: target.id });
  const origin = getOrigin(pageURL);

  function filterPageUrls(origin, links) {
    const results = [];

    for (const link of links) {
      try {
        // Normalize to absolute URL
        const url = new URL(link, origin);

        // Check same origin
        if (url.origin !== origin) {
          continue;
        }

        // Heuristic: treat URLs with "file-like" extensions as not pages
        const fileExt = url.pathname.split(".").pop().toLowerCase();
        // prettier-ignore
        const nonPageExts=["pdf","jpg","jpeg","png","gif","svg","zip","exe","mp4","mp3","webm"];
        const isFile = nonPageExts.includes(fileExt);
        if (!isFile) results.push(url.origin + url.pathname);
      } catch (e) {}
    }

    return results;
  }

  return filterPageUrls(origin, links);
}
