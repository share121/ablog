import * as cheerio from "cheerio";
import less from "less";
import { promises as fs } from "fs";
import { join, dirname, basename, extname, sep, relative } from "path";
import fg from "fast-glob";
import postcss from "postcss";
import postcssPresetEnv from "postcss-preset-env";
import { fileURLToPath } from "url";
import cssnano from "cssnano";
import { Compress } from "gzipper";
import { exec } from "child_process";
import chokidar from "chokidar";
import mime from "mime";
import { exit } from "process";
import workerpool from "workerpool";

const { stream: glob } = fg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "../dist");
const docDir = join(__dirname, "../doc");
const publicDir = join(__dirname, "../public");
const pool = workerpool.pool(join(__dirname, "worker.js"));

await clean();
const ignoreImg = [];
chokidar.watch(distDir).on("add", (path) => {
  if (
    !ignoreImg.includes(path) &&
    mime.getType(extname(path)).split("/")[0] === "image"
  )
    genImg(path);
});
await Promise.all([genPublic(), genAssets(), genLess(), genCss(), genHtml()]);
const gzip = new Compress(distDir, distDir, {
  gzip: true,
  gzipLevel: 9,
  exclude: [
    "apng",
    "avif",
    "gif",
    "jpg",
    "jpeg",
    "jfif",
    "pjpeg",
    "pjp",
    "png",
    "webp",
    "bmp",
    "ico",
    "cur",
    "tif",
    "tiff",
  ],
  workers: 16,
});
await gzip.run();
exit(0);

/**
 * 生成图像文件
 * @param {string} path
 */
async function genImg(path) {
  const promise = [];
  ignoreImg.push(setExtname(path, ".webp"));
  if (extname(path) === ".svg") return;
  promise.push(cmd(`ffmpeg -y -i "${path}" "${setExtname(path, ".webp")}"`));
  switch (extname(path)) {
    case ".apng":
    case ".gif":
      ignoreImg.push(setExtname(path, ".gif"));
      promise.push(cmd(`ffmpeg -y -i "${path}" "${setExtname(path, ".gif")}"`));
      break;
    default:
      ignoreImg.push(setExtname(path, ".png"));
      promise.push(cmd(`ffmpeg -y -i "${path}" "${setExtname(path, ".png")}"`));
      break;
  }
  await Promise.allSettled(promise);
  if (![".png", ".webp", ".gif"].includes(extname(path)))
    await fs.rm(path, { force: true });
}

/**
 * 改变文件后缀
 * @param {string} path
 * @param {string} extname
 * @returns {string}
 */
function setExtname(path, ext) {
  return join(dirname(path), basename(path, extname(path)) + ext);
}

/**
 * 执行命令
 * @param {string} cmd
 * @returns {Promise<{ stdout: string, stderr: string }, { err: ExecException, stdout: string, stderr: string }>}
 */
function cmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject({ err, stdout, stderr });
      else resolve({ stdout, stderr });
    });
  });
}

async function genAssets() {
  const promise = [];
  for await (const path of glob("**/*", {
    cwd: docDir,
    onlyFiles: true,
    ignore: ["**/*.md"],
  })) {
    promise.push(
      (async () => {
        const s = dirname(path).split(sep);
        const newPath = join(
          distDir,
          ...s.map((e) => {
            const mat = e.match(/^(?:\d+\.)?(.+?)(?:\.(.+?))?$/);
            return mat[2] ?? mat[1];
          }),
          basename(path)
        );
        await fs.mkdir(dirname(newPath), { recursive: true });
        await fs.copyFile(join(docDir, path), newPath);
      })()
    );
  }
  await Promise.all(promise);
}

async function genPublic() {
  await fs.cp(publicDir, distDir, { recursive: true });
}

async function genCss() {
  const promise = [];
  for await (const path of glob("**/*.css", {
    cwd: __dirname,
    onlyFiles: true,
  })) {
    promise.push(
      (async () => {
        const res = fs.readFile(join(__dirname, path), "utf8").then(processCss);
        const newPath = join(distDir, path);
        await fs.mkdir(dirname(newPath), { recursive: true });
        await fs.writeFile(newPath, await res, "utf8");
      })()
    );
  }
  await Promise.all(promise);
}

async function genLess() {
  const promise = [];
  for await (const path of glob("**/*.less", {
    cwd: __dirname,
    onlyFiles: true,
  })) {
    promise.push(
      (async () => {
        const newPath = setExtname(join(distDir, path), ".css");
        const data = fs
          .readFile(join(__dirname, path), "utf8")
          .then(less.render)
          .then((e) => processCss(e.css));
        await fs.mkdir(dirname(newPath), { recursive: true });
        await fs.writeFile(newPath, await data, "utf8");
      })()
    );
  }
  await Promise.all(promise);
}

async function clean() {
  try {
    await fs.rm(distDir, { recursive: true });
  } catch {}
  await fs.mkdir(distDir, { recursive: true });
}

/**
 * 处理 css
 * @param {string} css
 * @returns {Promise<string>}
 */
async function processCss(css) {
  return (
    await postcss([
      postcssPresetEnv({
        browsers: [">= 0%"],
        stage: 0,
      }),
      cssnano({ preset: "default" }),
    ]).process(css, { from: undefined })
  ).css;
}

/**
 * 处理目录
 */
async function processContent(dir = docDir, res = {}) {
  const list = await fs.readdir(dir);
  for (const name of list) {
    const stat = await fs.stat(join(dir, name));
    if (stat.isDirectory()) {
      res[name] = await processContent(join(dir, name));
    } else if (stat.isFile() && extname(name) === ".md") {
      res[basename(name, extname(name))] = null;
    }
  }
  return res;
}

/**
 * 生成目录
 */
async function genContent() {
  const content = await processContent();
  const $ = cheerio.load("<ul></ul>", undefined, false);
  let ul = $("ul");
  function t(content, ul, dir) {
    for (const [key, val] of Object.entries(content)) {
      const mat = key.match(/^(?:\d+\.)?(.+?)(?:\.(.+?))?$/);
      if (!mat) continue;
      const name = mat[1];
      const path = join(dir, mat[2] ?? name);
      if (val === null) {
        if (name !== "index")
          ul.append(`<li><a href="~/${path + ".html"}">${name}</a></li>`);
      } else if (typeof val === "object") {
        ul.append(
          `<li><a href="~/${path}/index.html">${name}</a><ul></ul></li>`
        );
        t(val, ul.find("ul"), path);
      }
    }
  }

  t(content, ul, "");
  return $.html();
}

async function genHtml() {
  const [contentStr, htmlRaw] = await Promise.all([
    genContent(),
    fs.readFile(join(__dirname, "index.html"), "utf8"),
  ]);
  const promises = [];
  for await (const mdPath of glob("**/*.md", {
    cwd: docDir,
    onlyFiles: true,
  })) {
    promises.push(
      (async () => {
        const raw = await fs.readFile(join(docDir, mdPath), "utf8");
        const mat = basename(mdPath, extname(mdPath)).match(
          /^(?:\d+\.)?(.+?)(?:\.(.+?))?$/
        );
        if (!mat) return;
        const name = mat[1];
        const s = dirname(mdPath).split(sep);
        const path = join(
          distDir,
          ...s.map((e) => {
            const mat = e.match(/^(?:\d+\.)?(.+?)(?:\.(.+?))?$/);
            return mat[2] ?? mat[1];
          }),
          (mat[2] ?? name) + ".html"
        );
        const [html] = await Promise.all([
          pool.exec("md2html", [
            htmlRaw,
            raw,
            contentStr,
            relative(dirname(path), distDir) || ".",
          ]),
          fs.mkdir(dirname(path), { recursive: true }),
        ]);
        await fs.writeFile(path, html, "utf8");
      })()
    );
  }
  await Promise.all(promises);
}
