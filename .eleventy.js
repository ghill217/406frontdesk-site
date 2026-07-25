module.exports = function (eleventyConfig) {
  // Static assets copied straight through to /dist
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });

  // Cache-buster for /css/* links: the Netlify headers serve CSS as immutable/1yr,
  // so the URL must change per deploy or returning visitors keep stale styles.
  eleventyConfig.addGlobalData("buildStamp", Date.now().toString(36));

  // Date filters
  eleventyConfig.addFilter("isoDate", (d) => (d instanceof Date ? d.toISOString() : d));
  eleventyConfig.addFilter("readableDate", (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  });

  return {
    dir: {
      input: "src",
      output: "dist",
      includes: "_includes",
      data: "_data",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"],
  };
};
