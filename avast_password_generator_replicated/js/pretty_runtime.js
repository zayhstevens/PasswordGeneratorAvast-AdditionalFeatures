(() => {
  const g = (typeof self !== "undefined") ? self : window;
  const chunkName = "webpackChunkaem_maven_archetype";
  const chunkArr = (g[chunkName] = g[chunkName] || []);

  // Collect module factories from any chunks already present (rare)
  const modules = Object.create(null);
  for (const item of chunkArr) {
    if (Array.isArray(item) && item.length >= 2 && item[1] && typeof item[1] === "object") {
      Object.assign(modules, item[1]);
    }
  }

  const cache = Object.create(null);
  const hasOwn = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

  function __require(moduleId) {
    const id = String(moduleId);
    if (cache[id]) return cache[id].exports;
    const factory = modules[id];
    if (!factory) throw new Error("Pretty bundle module not found: " + id);

    const module = { exports: {} };
    cache[id] = module;
    factory.call(module.exports, module, module.exports, __require);
    return module.exports;
  }

  // webpack-ish helpers used inside the pretty bundle
  __require.d = (exports, definition) => {
    for (const key in definition) {
      if (hasOwn(definition, key) && !hasOwn(exports, key)) {
        Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
      }
    }
  };
  __require.r = (exports) => {
    if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    }
    Object.defineProperty(exports, "__esModule", { value: true });
  };
  __require.o = (obj, prop) => hasOwn(obj, prop);
  __require.n = (mod) => {
    const getter = mod && mod.__esModule ? () => mod.default : () => mod;
    __require.d(getter, { a: getter });
    return getter;
  };

  // Hook chunk pushes so when pretty_chunk.js runs, we harvest its modules.
  const origPush = chunkArr.push.bind(chunkArr);
  chunkArr.push = (chunk) => {
    if (Array.isArray(chunk) && chunk.length >= 2 && chunk[1] && typeof chunk[1] === "object") {
      Object.assign(modules, chunk[1]);
    }
    return origPush(chunk);
  };

  g.PrettyBundle = {
    require: __require,
    _modules: modules,
    _cache: cache,
  };
})();