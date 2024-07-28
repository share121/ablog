import chokidar from "chokidar";
import { dirname, basename } from "path";
import { fileURLToPath } from "url";
import { genFile, build, themeDir, docsDir, publicDir } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let p = Promise.resolve();
chokidar.watch([themeDir, publicDir, docsDir], { ignoreInitial: true }).on(
  "all",
  debounce(async (e) => {
    if (["unlink", "unlinkDir", "add", "addDir"].includes(e)) {
      console.time("全量更新");
      await p.finally(build);
      console.timeEnd("全量更新");
    }
  }, 300)
);
chokidar.watch(__dirname, { ignoreInitial: true }).on(
  "all",
  debounce(async () => {
    console.time("src 更新，全量更新");
    await p.finally(build);
    console.timeEnd("src 更新，全量更新");
  }, 300)
);
chokidar.watch("public", { ignoreInitial: true }).on(
  "change",
  debounce(async (path) => {
    console.time("public 更新，热重载");
    await p.finally(genFile(publicDir, dirname(path), basename(path), false));
    console.timeEnd("public 更新，热重载");
  }, 300)
);
chokidar.watch(docsDir, { ignoreInitial: true }).on(
  "change",
  debounce(async (path) => {
    console.time("文档更新，热重载");
    await p.finally(genFile(docsDir, dirname(path), basename(path), false));
    console.timeEnd("文档更新，热重载");
  })
);

function debounce(func, delay) {
  let timer = null;
  return function () {
    clearTimeout(timer);
    timer = setTimeout(() => {
      func.apply(this, arguments);
    }, delay);
  };
}
