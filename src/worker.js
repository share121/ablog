import markdownit from "markdown-it";
import * as cheerio from "cheerio";
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

/**
 * 处理 markdown
 * @param {string} html
 * @param {string} markdown
 * @param {string} content
 * @param {string} homePath
 * @returns {string}
 */
function processMarkdown(html, markdown, content, homePath) {
  const $ = cheerio.load(html);
  const md = markdownit({
    html: true,
    linkify: true,
    typographer: true,
    highlight: (str, lang) => {
      if (lang === "mermaid")
        return `<pre class="mermaid mermaid-light">${str}</pre><pre class="mermaid mermaid-dark">${str}</pre>`;
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre><code class="hljs lang-${lang}">${
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
          }</code></pre>`;
        } catch {}
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
    .use(anchor, { slugify: uslug })
    .use(toc, {
      slugify: uslug,
      callback: (html) => $("#toc").html(html),
    });
  $("#main").html(md.render(markdown));
  $("#content").html(content);
  $("#main>h1,h2,h3,h4,h5,h6").each((_, e) => {
    $(e).append(`<a class="header-anchor" href="#${$(e).prop("id")}">#</a>`);
  });
  $('[href*="~"]').each((_, e) => {
    $(e).prop("href", $(e).prop("href").replaceAll("~", homePath));
  });
  $('[src*="~"]').each((_, e) => {
    $(e).prop("src", $(e).prop("src").replaceAll("~", homePath));
  });
  $("[href]:not([href*=':'])").each((_, e) => {
    $(e).prop("href", changPath($(e).prop("href")));
  });
  $("[src]:not([src*=':'])").each((_, e) => {
    $(e).prop("src", changPath($(e).prop("src")));
  });
  $("img[src]:not([src*=':'])").each((_, e) => {
    const src = $(e).prop("src");
    switch (src.split(".").at(-1)) {
      case "apng":
      case "gif":
        $(e).replaceWith(
          `<picture><source srcset="${src.replace(
            /\.[^.]+?$/,
            ".webp"
          )}" type="image/webp">${$(e)
            .prop("src", src.replace(/\.[^.]+?$/, ".gif"))
            .prop("outerHTML")}</picture>`
        );
        break;
      case "svg":
        break;
      default:
        $(e).replaceWith(
          `<picture><source srcset="${src.replace(
            /\.[^.]+?$/,
            ".webp"
          )}" type="image/webp">${$(e)
            .prop("src", src.replace(/\.[^.]+?$/, ".png"))
            .prop("outerHTML")}</picture>`
        );
        break;
    }
  });
  $("a[href]").each((_, e) => {
    try {
      new URL($(e).prop("href"));
      $(e).prop("target", "_blank");
    } catch {}
  });
  return minify($.html(), {
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

workerpool.worker({
  md2html: processMarkdown,
});

/**
 *
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
          const mat = filename.match(/^(?:\d+\.)?(.+?)(?:\.(.+?))?$/);
          return (mat[2] ?? mat[1]) + ".html";
        }
        return e;
      }
      const mat = e.match(/^(?:\d+\.)?(.+?)(?:\.(.+?))?$/);
      return mat[2] ?? mat[1];
    })
    .join("/");
}