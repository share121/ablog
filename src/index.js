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
import os from "os";
const { stream: glob } = fg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const distDir = join(__dirname, "../dist");
const docDir = join(__dirname, "../doc");
const publicDir = join(__dirname, "../public");

const cpuCount = os.cpus().length;
const pool = workerpool.pool(join(__dirname, "md2html.js"), {
  maxWorkers: cpuCount * 3,
});
const regBasename = /^(?:\d+\.)?(.+?)(?:\.(.+?))?$/;
await clean();
const ignoreImg = {};
chokidar.watch(distDir).on("add", (path) => {
  if (!ignoreImg[path]) {
    const mimetype = mime.getType(extname(path));
    if (mimetype.startsWith("image/") && mimetype !== "image/svg+xml")
      genImg(path);
  }
});
console.time("HTML 生成");
await Promise.all([genPublic(), genAssets(), genLess(), genCss(), genHtml()]);
console.timeEnd("HTML 生成");
console.time("gzip 压缩");
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
  workers: cpuCount * 3,
});
await gzip.run();
console.timeEnd("gzip 压缩");
exit(0);

/**
 * 生成图像文件
 * @param {string} path
 */
async function genImg(path) {
  const promise = [];
  const webp = setExtname(path, ".webp");
  ignoreImg[webp] = true;
  promise.push(cmd(`ffmpeg -y -i "${path}" "${webp}"`));
  const ext = extname(path);
  if (ext === ".apng") {
    const gif = setExtname(path, ".gif");
    ignoreImg[gif] = true;
    promise.push(cmd(`ffmpeg -y -i "${path}" "${gif}"`));
  } else if (ext !== ".png") {
    const png = setExtname(path, ".png");
    ignoreImg[png] = true;
    promise.push(cmd(`ffmpeg -y -i "${path}" "${png}"`));
  }
  await Promise.allSettled(promise);
  if (![".png", ".webp", ".gif"].includes(ext))
    await fs.rm(path, { force: true });
}

/**
 * 改变文件后缀
 * @param {string} path
 * @param {string} ext
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
    const newPath = join(distDir, changPath(path));
    promise.push(
      fs
        .mkdir(dirname(newPath), { recursive: true })
        .then(() => fs.copyFile(join(docDir, path), newPath))
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
        browsers: [">=0%"],
        stage: 0,
      }),
      cssnano({ preset: "default" }),
    ]).process(css, { from: undefined })
  ).css;
}

/**
 * 处理目录
 */
async function processContent(dir = docDir) {
  const res = {};
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
      const mat = key.match(regBasename);
      if (!mat) continue;
      const name = mat[1];
      if (val === null) {
        if (name !== "index") {
          const path = join(dir, mat[2] ?? name);
          ul.append(`<li><a href="~/${path}.html">${name}</a></li>`);
        }
      } else if (typeof val === "object") {
        const path = join(dir, mat[2] ?? name);
        const li = $(`<li><a href="~/${path}/index.html">${name}</a></li>`);
        ul.append(li);
        const newUl = $("<ul></ul>");
        li.append(newUl);
        t(val, newUl, path);
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
      pool.exec("md2html", [docDir, mdPath, distDir, htmlRaw, contentStr])
    );
  }
  await Promise.all(promises);
}

/**
 * @param {string} path
 */
function changPath(path) {
  return path
    .split(/[\/]/)
    .map((e, i, arr) => {
      if (i === arr.length - 1) {
        const ext = e.split(".").at(-1);
        if (ext === "md") {
          const filename = e.replace(/\.[^.]+?$/, "");
          const mat = filename.match(regBasename);
          return (mat[2] ?? mat[1]) + ".html";
        }
        return e;
      }
      const mat = e.match(regBasename);
      return mat[2] ?? mat[1];
    })
    .join("/");
}
