import less from "less";
import { promises as fs } from "fs";
import { join, dirname, basename, extname, relative, sep } from "path";
import postcss from "postcss";
import postcssPresetEnv from "postcss-preset-env";
import { fileURLToPath } from "url";
import cssnano from "cssnano";
import { Compress } from "gzipper";
import { exec } from "child_process";
import mime from "mime";
import workerpool from "workerpool";
import os from "os";
const __dirname = dirname(fileURLToPath(import.meta.url));

export const distDir = join(__dirname, "../dist");
export const docsDir = join(__dirname, "../docs");
export const publicDir = join(__dirname, "../public");
export const themeDir = join(__dirname, "../theme");

const cpuCount = os.cpus().length;
const pool = workerpool.pool(join(__dirname, "md2html.js"), {
  maxWorkers: cpuCount,
});
const regBasename = /^(?:\d+\.)?(.+?)(?:\.(.+?))?$/;

console.time("HTML 生成");
let template, content;
await build();
console.timeEnd("HTML 生成");
console.time("gzip 压缩");
await compression();
console.timeEnd("gzip 压缩");

export async function build() {
  await clean();
  [template, content] = await Promise.all([
    fs.readFile(join(themeDir, "template.html"), "utf8"),
    genContent(),
  ]);
  template = template.replaceAll("{{content}}", content);
  await genDir(docsDir, publicDir, themeDir);
}

async function compression() {
  const gzip = new Compress(distDir, distDir, {
    gzip: true,
    gzipLevel: 9,
    include: [
      "appcache",
      "manifest",
      "ics",
      "ifb",
      "coffee",
      "litcoffee",
      "css",
      "csv",
      "html",
      "htm",
      "shtml",
      "jade",
      "js",
      "mjs",
      "jsx",
      "less",
      "md",
      "markdown",
      "mml",
      "mdx",
      "n3",
      "txt",
      "text",
      "conf",
      "def",
      "list",
      "log",
      "in",
      "ini",
      "rtx",
      "rtf",
      "sgml",
      "sgm",
      "shex",
      "slim",
      "slm",
      "spdx",
      "stylus",
      "styl",
      "tsv",
      "t",
      "tr",
      "roff",
      "man",
      "me",
      "ms",
      "ttl",
      "uri",
      "uris",
      "urls",
      "vcard",
      "vtt",
      "wgsl",
      "xml",
      "yaml",
      "yml",
    ],
    workers: cpuCount,
  });
  await gzip.run();
}

/**
 * 处理文件夹
 * @param {string[]} paths
 */
function genDir(...paths) {
  return Promise.all(
    paths.map(async (rootPath) => {
      const files = await fs.readdir(rootPath, {
        recursive: true,
        withFileTypes: true,
      });
      await Promise.all(
        files.map(async (item) => {
          const { parentPath, name: filename } = item;
          if (filename === "template.html") return;
          const isDir = item.isDirectory();
          await genFile(rootPath, parentPath, filename, isDir);
        })
      );
    })
  );
}

/**
 *
 * @param {string} rootPath
 * @param {string} parentPath
 * @param {string} filename
 * @param {boolean} isDir
 */
export async function genFile(rootPath, parentPath, filename, isDir) {
  const promises = [];
  const relativePath = join(relative(rootPath, parentPath), filename);
  if (isDir) {
    const resPath = relativePath
      .split(sep)
      .map((e) => {
        if (/^\.*$/.test(e)) return e;
        const mat = e.match(regBasename);
        return mat[2] ?? mat[1];
      })
      .join(sep);
    await fs.mkdir(join(distDir, resPath), { recursive: true });
  } else {
    const fullPath = join(parentPath, filename);
    const ext = extname(filename);
    const name = basename(filename, ext);
    const resPath = join(
      distDir,
      relativePath
        .split(sep)
        .map((e, i, arr) => {
          if (i !== arr.length - 1) {
            if (/^\.*$/.test(e)) return e;
            const mat = e.match(regBasename);
            return mat[2] ?? mat[1];
          } else {
            if (ext === ".md") {
              const mat = name.match(regBasename);
              return (mat[2] ?? mat[1]) + ".html";
            } else if (ext === ".less") {
              return name + ".css";
            }
            return e;
          }
        })
        .join(sep)
    );
    promises.push(
      (async () => {
        if (ext === ".md") {
          await genHtml(fullPath, resPath, template);
        } else if (ext === ".css") {
          await genCss(fullPath, resPath);
        } else if (ext === ".less") {
          await genLess(fullPath, resPath);
        } else if (ext !== ".svg" && mime.getType(ext)?.startsWith("image/")) {
          await genImg(fullPath, resPath);
        } else {
          await fs.copyFile(fullPath, resPath);
        }
      })()
    );
  }
  await Promise.all(promises);
}

async function clean() {
  try {
    await fs.rm(distDir, { recursive: true, force: true });
  } catch {
    /**/
  }
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
 *
 * @param {string} from
 * @param {string} to
 */
async function genCss(from, to) {
  const res = await fs.readFile(from, "utf8").then(processCss);
  await fs.writeFile(to, res, "utf8");
}

/**
 *
 * @param {string} from
 * @param {string} to
 */
async function genLess(from, to) {
  const data = await fs
    .readFile(from, "utf8")
    .then(less.render)
    .then((e) => processCss(e.css));
  await fs.writeFile(to, data, "utf8");
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

/**
 * 生成图像文件
 * @param {string} from
 * @param {string} to
 */
async function genImg(from, to) {
  const dir = dirname(to);
  const ext = extname(to);
  const name = basename(to, ext);
  const pathWithoutExt = join(dir, name);

  const promise = [];
  if (ext !== ".webp") {
    promise.push(cmd(`ffmpeg -y -i "${from}" "${pathWithoutExt}.webp"`));
  }
  if (ext === ".apng") {
    promise.push(cmd(`ffmpeg -y -i "${from}" "${pathWithoutExt}.gif"`));
  } else if (ext !== ".png" && ext !== ".gif") {
    promise.push(cmd(`ffmpeg -y -i "${from}" "${pathWithoutExt}.png"`));
  }
  if ([".webp", ".png", ".gif"].includes(ext))
    promise.push(fs.copyFile(from, to));
  await Promise.allSettled(promise);
}

/**
 * 处理目录
 */
async function processContent(dir = docsDir) {
  const res = {};
  const list = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  for (const item of list) {
    let p = res;
    const relativePath = join(relative(dir, item.parentPath), item.name);
    if (item.isDirectory()) {
      for (const i of relativePath.split(sep)) {
        if (p[i] === undefined) p[i] = {};
        p = p[i];
      }
    } else if (extname(item.name) === ".md") {
      for (const i of relativePath.split(sep)) {
        if (p[i] === undefined) p[basename(i, ".md")] = null;
        else p = p[i];
      }
    }
  }
  return res;
}

/**
 * 生成目录
 */
async function genContent() {
  const content = await processContent();
  let ul = "<ul>";
  /**
   *
   * @param {{}} content
   * @param {string} ul
   * @param {string} dir
   */
  function t(content, dir) {
    for (const [key, val] of Object.entries(content)) {
      const mat = key.match(regBasename);
      if (!mat) continue;
      const name = mat[1];
      if (val === null) {
        if (name !== "index") {
          const path = join(dir, mat[2] ?? name);
          ul += `<li><a href="~/${path}.html">${name}</a></li>`;
        }
      } else {
        const path = join(dir, mat[2] ?? name);
        ul += `<li><a href="~/${path}/index.html">${name}</a><ul>`;
        t(val, path);
        ul += "</ul></li>";
      }
    }
  }
  t(content, "");
  ul += "</ul>";
  return ul;
}

/**
 *
 * @param {string} from
 * @param {string} to
 * @param {string} template
 */
function genHtml(from, to, template) {
  return pool.exec("md2html", [from, to, template, distDir]);
}
