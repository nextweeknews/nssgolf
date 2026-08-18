(function(){
  const params = new URLSearchParams(globalThis.location.search);
  if(params.get("embed") !== "1") return;

  document.documentElement.classList.add("admin-embedded");
  if(globalThis.location.pathname === "/championship.html" && params.get("view") === "settings"){
    document.documentElement.classList.add("admin-settings-embedded");
  }

  const notifyParent = () => {
    if(globalThis.parent === globalThis) return;
    globalThis.parent.postMessage({
      type:"nssgolf-admin-route",
      pathname:globalThis.location.pathname,
      search:globalThis.location.search,
    }, globalThis.location.origin);
  };

  const notifyHeight = () => {
    if(globalThis.parent === globalThis || !document.body) return;
    globalThis.parent.postMessage({
      type:"nssgolf-admin-size",
      height:Math.max(document.body.scrollHeight, document.body.offsetHeight),
    }, globalThis.location.origin);
  };

  ["pushState", "replaceState"].forEach((method) => {
    const original = globalThis.history[method].bind(globalThis.history);
    globalThis.history[method] = (...args) => {
      const result = original(...args);
      notifyParent();
      return result;
    };
  });

  globalThis.addEventListener("popstate", notifyParent);
  globalThis.addEventListener("DOMContentLoaded", () => {
    notifyParent();
    notifyHeight();
    new ResizeObserver(notifyHeight).observe(document.body);
  }, { once:true });
  globalThis.addEventListener("load", notifyHeight, { once:true });
})();
