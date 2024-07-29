import chokidar from "chokidar";
import { dirname, basename } from "path";
import { fileURLToPath } from "url";
import { genFile, build, themeDir, docsDir, publicDir } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let p = Promise.resolve();
chokidar.watch([publicDir, docsDir], { ignoreInitial: true }).on(
  "all",
  debounce(async (e) => {
    if (["unlink", "unlinkDir", "add", "addDir"].includes(e)) {
      console.log("增删文件，全量更新");
      console.time("增删文件，全量更新");
      try {
        await p.finally(build);
      } catch (e) {
        console.error(e);
      }
      console.timeEnd("增删文件，全量更新");
    }
  }, 300)
);
chokidar.watch(__dirname, { ignoreInitial: true }).on(
  "all",
  debounce(async () => {
    console.log("src 更新，全量更新");
    console.time("src 更新，全量更新");
    try {
      await p.finally(build);
    } catch (e) {
      console.error(e);
    }
    console.timeEnd("src 更新，全量更新");
  }, 300)
);
chokidar.watch(themeDir, { ignoreInitial: true }).on(
  "all",
  debounce(async () => {
    console.log("theme 更新，全量更新");
    console.time("theme 更新，全量更新");
    try {
      await p.finally(build);
    } catch (e) {
      console.error(e);
    }
    console.timeEnd("theme 更新，全量更新");
  }, 300)
);
chokidar.watch("public", { ignoreInitial: true }).on(
  "change",
  debounce(async (path) => {
    console.log("public 更新，热重载");
    console.time("public 更新，热重载");
    try {
      await p.finally(genFile(publicDir, dirname(path), basename(path), false));
    } catch (e) {
      console.error(e);
    }
    console.timeEnd("public 更新，热重载");
  }, 300)
);
chokidar.watch(docsDir, { ignoreInitial: true }).on(
  "change",
  debounce(async (path) => {
    console.log("文档更新，热重载");
    console.time("文档更新，热重载");
    try {
      await p.finally(genFile(docsDir, dirname(path), basename(path), false));
    } catch (e) {
      console.error(e);
    }
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
