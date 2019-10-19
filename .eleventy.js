const { DateTime } = require("luxon");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
module.exports = function(eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight);

  // Copied from https://www.11ty.io/docs/languages/markdown/#add-your-own-plugins
  let markdownIt = require("markdown-it");
  let markdownItEmoji = require("markdown-it-emoji");
  let options = {
    html: true
  };
  let markdownLib = markdownIt(options).use(markdownItEmoji);
  eleventyConfig.setLibrary("md", markdownLib);

  eleventyConfig.addPassthroughCopy("2017");

  // Copied from https://github.com/11ty/eleventy-base-blog/blob/master/.eleventy.js
  eleventyConfig.addFilter("readableDate", dateObj => {
    return DateTime.fromJSDate(dateObj, {zone: 'utc'}).toFormat("dd LLL yyyy");
  });

  return {
    templateFormats: [
      "md",
      "njk",
      "css",
      "png",
      "mp4",
      "gif",
      "jpg",
      "ico"
    ],

    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk",
    passthroughFileCopy: true,
    dir: {
      input: ".",
      includes: "_includes",
      data: "_data",
      output: "../binji.github.io-deploy"
    }
  };
}
