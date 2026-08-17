(function(){
  const params = new URLSearchParams(globalThis.location.search);
  if(params.get("embed") !== "1") return;

  document.documentElement.classList.add("admin-embedded");

  const notifyParent = () => {
    if(globalThis.parent === globalThis) return;
    globalThis.parent.postMessage({
      type:"nssgolf-admin-route",
      pathname:globalThis.location.pathname,
      search:globalThis.location.search,
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
  globalThis.addEventListener("DOMContentLoaded", notifyParent, { once:true });
})();
