import markdownit from "markdown-it";
import { minify } from "html-minifier";
import hljs from "highlight.js";
import workerpool from "workerpool";
import { full as emoji } from "markdown-it-emoji";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import ins from "markdown-it-ins";
import deflist from "markdown-it-deflist";
import abbr from "markdown-it-abbr";
import container from "markdown-it-container";
import mark from "markdown-it-mark";
import anchor from "markdown-it-anchor";
import toc from "markdown-it-toc-done-right";
import uslug from "uslug";
import attrs from "markdown-it-attrs";
import bracketedSpans from "markdown-it-bracketed-spans";
import { katex } from "@mdit/plugin-katex";
import alert from "markdown-it-github-alerts";
import { promises as fs } from "fs";
import { dirname, relative, basename } from "path";
import * as cheerio from "cheerio";

const regExt = /\.[^.]+?$/;
const regBasename = /^(?:\d+\.)?(.+?)(?:\.(.+?))?$/;

/**
 *
 * @param {string} from
 * @param {string} to
 * @param {string} template
 * @param {string} distDir
 */
async function md2html(from, to, template, distDir) {
  const raw = await fs.readFile(from, "utf8");
  const html = await processMarkdown(
    template,
    raw,
    relative(dirname(to), distDir) || ".",
    regBasename.exec(basename(from, ".md"))[1]
  );
  await fs.writeFile(to, html, "utf8");
}

/**
 * 处理 markdown
 * @param {string} template
 * @param {string} markdown
 * @param {string} homePath
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function processMarkdown(template, markdown, homePath, filename) {
  const md = markdownit({
    html: true,
    linkify: true,
    typographer: true,
    highlight: (str, lang) => {
      if (lang === "mermaid") {
        const res = md.utils.escapeHtml(str);
        return `<pre class="mermaid mermaid-light">${res}</pre><pre class="mermaid mermaid-dark">${res}</pre>`;
      }
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre><code class="hljs lang-${lang}">${
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
          }</code></pre>`;
        } catch {
          /**/
        }
      }
      return `<pre><code class="hljs lang-${lang}">${md.utils.escapeHtml(
        str
      )}</code></pre>`;
    },
  })
    .use(emoji)
    .use(sub)
    .use(sup)
    .use(abbr)
    .use(ins)
    .use(mark)
    .use(alert)
    .use(deflist)
    .use(taskLists, { label: true })
    .use(container, "spoiler", {
      validate: (params) => params.trim().match(/^spoiler\s+(.*)$/),
      render: (tokens, idx) => {
        const m = tokens[idx].info.trim().match(/^spoiler\s+(.*)$/);
        if (tokens[idx].nesting === 1) {
          return `<details><summary>${md.utils.escapeHtml(m[1])}</summary>\n`;
        } else {
          return "</details>\n";
        }
      },
    })
    .use(katex)
    .use(footnote)
    .use(bracketedSpans)
    .use(attrs)
    .use(anchor, {
      permalink: anchor.permalink.linkInsideHeader(),
      slugify: uslug,
    });
  const tocPromise = new Promise((resolve) => {
    md.use(toc, {
      slugify: uslug,
      callback: (html) => {
        resolve(html);
      },
    });
  });
  const $ = cheerio.load(md.render(markdown));
  $("img").prop("loading", "lazy");
  $("img[src]:not([src*=':'])").each((_, e) => {
    const src = $(e).prop("src");
    switch (src.split(".").at(-1)) {
      case "svg":
        break;
      case "apng":
      case "gif":
        $(e).replaceWith(
          `<picture><source srcset="${src.replace(
            regExt,
            ".webp"
          )}" type="image/webp">${$(e)
            .prop("src", src.replace(regExt, ".gif"))
            .prop("outerHTML")}</picture>`
        );
        break;
      default:
        $(e).replaceWith(
          `<picture><source srcset="${src.replace(
            regExt,
            ".webp"
          )}" type="image/webp">${$(e)
            .prop("src", src.replace(regExt, ".png"))
            .prop("outerHTML")}</picture>`
        );
        break;
    }
  });
  template = template.replaceAll(
    "{{title}}",
    $("h1,h2,h3,h4,h5,h6").eq(0).text().replace(/ #$/, "") || filename
  );
  template = template.replaceAll("{{markdown}}", $.html());
  template = template.replaceAll("{{toc}}", await tocPromise);
  template = template.replaceAll("{{home_path}}", homePath);
  return minify(template, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    minifyCSS: true,
    minifyJS: true,
    minifyURLs: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    sortAttributes: true,
    sortClassName: true,
    useShortDoctype: true,
  });
}

workerpool.worker({ md2html });
