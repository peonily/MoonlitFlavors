const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env.local");
const SITE_NAME = "Moonlit Flavors";
const SITE_SLUG = "moonlit-flavors";
const DEFAULT_SLUG = "";

const mainJsPath = path.join(ROOT_DIR, "main.js");
const indexPath = path.join(ROOT_DIR, "index.html");
const recipesIndexPath = path.join(ROOT_DIR, "recipes.html");
const recipeTemplatePath = path.join(ROOT_DIR, "recipe.html");
const recipesDir = path.join(ROOT_DIR, "recipes");
const HOMEPAGE_RECIPE_LIMIT = 21;
const CATEGORY_NAMES = [
  "Breakfast",
  "Lunch",
  "Dinner",
  "Desserts",
  "Snacks",
  "Drinks & Cocktails",
  "Soups & Stews",
  "Salads",
  "Baking & Bread",
  "Pasta & Noodles",
  "Vegan",
  "Grilling & BBQ",
];

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    });
};

loadEnvFile(ENV_PATH);

const SITE_URL = (process.env.SITE_URL || "https://moonlit-flavors.pages.dev").replace(/\/+$/, "");

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const parseDurationMinutes = (label) => {
  const hours = Number(label.match(/(\d+)\s*hr/)?.[1] || 0);
  const minutes = Number(label.match(/(\d+)\s*min/)?.[1] || 0);
  return hours * 60 + minutes;
};

const toIsoDuration = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const hourPart = hours ? `${hours}H` : "";
  const minutePart = remainingMinutes ? `${remainingMinutes}M` : "";
  return `PT${hourPart}${minutePart || (!hourPart ? "0M" : "")}`;
};

const absoluteUrl = (pathname) => `${SITE_URL}${pathname}`;
const categoryResultsPath = (category) => `recipes.html?category=${encodeURIComponent(category)}#recipes`;
const categoryResultsUrl = (category) => absoluteUrl(`/${categoryResultsPath(category)}`);
const assetUrl = (source) => {
  if (/^https?:\/\//i.test(source)) {
    return source;
  }

  return absoluteUrl(`/${source.replace(/^\/+/, "")}`);
};

const extractRecipeCatalog = () => {
  const source = fs.readFileSync(mainJsPath, "utf8");
  const declaration = "const recipeCatalog = ";
  const declarationIndex = source.indexOf(declaration);

  if (declarationIndex === -1) {
    throw new Error("Could not find recipeCatalog in main.js.");
  }

  const objectStart = source.indexOf("{", declarationIndex);
  let depth = 0;

  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;
    }

    if (depth === 0) {
      const objectLiteral = source.slice(objectStart, index + 1);
      return vm.runInNewContext(`(${objectLiteral})`);
    }
  }

  throw new Error("Could not parse recipeCatalog object.");
};

const buildRecipeJsonLd = (recipe, slug) => {
  const prepMinutes = parseDurationMinutes(recipe.prepTime);
  const cookMinutes = parseDurationMinutes(recipe.cookTime);
  const recipeUrl = absoluteUrl(`/recipes/${slug}.html`);

  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "@id": `${recipeUrl}#recipe`,
    mainEntityOfPage: recipeUrl,
    url: recipeUrl,
    name: recipe.title,
    description: recipe.description,
    image: [assetUrl(recipe.image)],
    author: {
      "@type": "Organization",
      name: SITE_NAME,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
    },
    datePublished: "2025-04-26",
    dateModified: "2026-05-02",
    prepTime: toIsoDuration(prepMinutes),
    cookTime: toIsoDuration(cookMinutes),
    totalTime: toIsoDuration(prepMinutes + cookMinutes),
    recipeYield: `${recipe.servings} servings`,
    recipeCategory: recipe.category,
    keywords: [recipe.category, recipe.difficulty, `${SITE_NAME} recipe`].join(", "),
    recipeIngredient: recipe.ingredients,
    recipeInstructions: recipe.instructions.map((step, index) => ({
      "@type": "HowToStep",
      name: `Step ${index + 1}`,
      text: step.replace(/Â°F/g, " degrees F"),
    })),
    nutrition: {
      "@type": "NutritionInformation",
      calories: `${recipe.nutrition.calories} calories`,
      proteinContent: recipe.nutrition.protein,
      carbohydrateContent: recipe.nutrition.carbs,
      fatContent: recipe.nutrition.fat,
    },
  };
};

const buildRecipeSchemaGraph = (recipe, slug) => {
  const prepMinutes = parseDurationMinutes(recipe.prepTime);
  const cookMinutes = parseDurationMinutes(recipe.cookTime);
  const recipeUrl = absoluteUrl(`/recipes/${slug}.html`);
  const imageUrl = assetUrl(recipe.image);
  const title = `${recipe.title} | ${SITE_NAME}`;
  const publishedDate = "2025-04-26T00:00:00+00:00";
  const modifiedDate = "2026-05-02T00:00:00+00:00";

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${recipeUrl}#article`,
        isPartOf: { "@id": recipeUrl },
        author: { "@id": `${SITE_URL}/#organization` },
        headline: recipe.title,
        datePublished: publishedDate,
        dateModified: modifiedDate,
        publisher: { "@id": `${SITE_URL}/#organization` },
        image: { "@id": `${recipeUrl}#primaryimage` },
        thumbnailUrl: imageUrl,
        articleSection: [recipe.category],
        inLanguage: "en-US",
      },
      {
        "@type": "WebPage",
        "@id": recipeUrl,
        url: recipeUrl,
        name: title,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        primaryImageOfPage: { "@id": `${recipeUrl}#primaryimage` },
        image: { "@id": `${recipeUrl}#primaryimage` },
        thumbnailUrl: imageUrl,
        datePublished: publishedDate,
        dateModified: modifiedDate,
        breadcrumb: { "@id": `${recipeUrl}#breadcrumb` },
        inLanguage: "en-US",
        potentialAction: [{ "@type": "ReadAction", target: [recipeUrl] }],
      },
      {
        "@type": "ImageObject",
        inLanguage: "en-US",
        "@id": `${recipeUrl}#primaryimage`,
        url: imageUrl,
        contentUrl: imageUrl,
        caption: recipe.alt,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${recipeUrl}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: recipe.category, item: categoryResultsUrl(recipe.category) },
          { "@type": "ListItem", position: 3, name: recipe.title },
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        description: "Recipes worth savoring.",
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en-US",
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
      },
      {
        "@type": "Recipe",
        "@id": `${recipeUrl}#recipe`,
        isPartOf: { "@id": `${recipeUrl}#article` },
        mainEntityOfPage: recipeUrl,
        url: recipeUrl,
        name: recipe.title,
        author: { "@id": `${SITE_URL}/#organization` },
        description: recipe.description,
        datePublished: publishedDate,
        dateModified: modifiedDate,
        image: [imageUrl],
        recipeYield: [recipe.servings, `${recipe.servings} servings`],
        prepTime: toIsoDuration(prepMinutes),
        cookTime: toIsoDuration(cookMinutes),
        totalTime: toIsoDuration(prepMinutes + cookMinutes),
        recipeCategory: [recipe.category],
        recipeCuisine: ["American"],
        keywords: [recipe.category, recipe.difficulty, `${SITE_NAME} recipe`].join(", "),
        recipeIngredient: recipe.ingredients,
        recipeInstructions: recipe.instructions.map((step, index) => ({
          "@type": "HowToStep",
          name: `Step ${index + 1}`,
          text: step.replace(/(?:Ã‚Â°F|Â°F|°F)/g, " degrees F"),
          url: `${recipeUrl}#recipe-step-${index + 1}`,
        })),
        nutrition: {
          "@type": "NutritionInformation",
          servingSize: "1 serving",
          calories: `${recipe.nutrition.calories} calories`,
          proteinContent: recipe.nutrition.protein,
          carbohydrateContent: recipe.nutrition.carbs,
          fatContent: recipe.nutrition.fat,
        },
      },
    ],
  };
};

const buildPinterestSaveUrl = (recipe, slug) => {
  const saveUrl = new URL("https://www.pinterest.com/pin/create/button/");
  saveUrl.searchParams.set("url", absoluteUrl(`/recipes/${slug}.html`));
  saveUrl.searchParams.set("media", assetUrl(recipe.image));
  saveUrl.searchParams.set("description", `${recipe.title} | ${SITE_NAME}`);
  return saveUrl.href;
};

const buildSeoBlock = (recipe, slug) => {
  const title = `${recipe.title} | ${SITE_NAME}`;
  const description = `${recipe.description} Includes prep time, cook time, servings, ingredients, instructions, and nutrition facts.`;
  const recipeUrl = absoluteUrl(`/recipes/${slug}.html`);
  const recipeJsonLd = JSON.stringify(buildRecipeSchemaGraph(recipe, slug), null, 6).replace(/</g, "\\u003c");

  return `<!-- SEO: recipe rich pins -->
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <link rel="canonical" href="${escapeHtml(recipeUrl)}" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta
      property="og:description"
      content="${escapeHtml(description)}"
    />
    <meta
      property="og:image"
      content="${escapeHtml(assetUrl(recipe.image))}"
    />
    <meta property="og:url" content="${escapeHtml(recipeUrl)}" />
    <meta property="article:section" content="${escapeHtml(recipe.category)}" />
    <meta property="article:published_time" content="2025-04-26T00:00:00+00:00" />
    <meta property="article:modified_time" content="2026-05-02T00:00:00+00:00" />
    <meta name="author" content="${SITE_NAME}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta
      name="twitter:description"
      content="${escapeHtml(description)}"
    />
    <meta
      name="twitter:image"
      content="${escapeHtml(assetUrl(recipe.image))}"
    />
    <script type="application/ld+json" id="recipe-json-ld">
      ${recipeJsonLd}
    </script>
    <!-- /SEO: recipe rich pins -->`;
};

const replaceDataText = (html, attribute, value) => {
  const pattern = new RegExp(`(<([a-z0-9]+)[^>]*${attribute}[^>]*>)[\\s\\S]*?(<\\/\\2>)`, "gi");
  return html.replace(pattern, (_match, open, _tagName, close) => `${open}${escapeHtml(value)}${close}`);
};

const renderRelatedRecipes = (catalog, relatedSlugs) =>
  relatedSlugs
    .map((relatedSlug) => [relatedSlug, catalog[relatedSlug]])
    .filter((entry) => entry[1])
    .map(
      ([relatedSlug, relatedRecipe]) => `
                  <a class="related-card" href="recipes/${escapeHtml(relatedSlug)}.html">
                    <img
                      class="related-image"
                      src="${escapeHtml(relatedRecipe.image)}"
                      alt="${escapeHtml(relatedRecipe.alt)}"
                    />
                    <div>
                      <h4 class="related-title">${escapeHtml(relatedRecipe.title)}</h4>
                      <span class="meta-badge">${escapeHtml(relatedRecipe.cookTime)}</span>
                    </div>
                  </a>`
    )
    .join("");

const imageForCard = (source) => {
  if (/^https:\/\/pub-[^/]+\.r2\.dev\//i.test(source)) {
    return source;
  }

  if (/^https?:\/\//i.test(source)) {
    return source.replace(/([?&])w=\d+/i, "$1w=900");
  }

  return source;
};

const excerpt = (value, maxLength = 132) => {
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 3).trim()}...`;
};

const renderHomepageRecipeCards = (catalog) =>
  Object.keys(catalog).length === 0
    ? `              <div class="empty-recipes">
                <h3>No recipes are published yet.</h3>
                <p>New Moonlit Flavors recipes will appear here after they are generated.</p>
              </div>`
    : Object.entries(catalog)
    .reverse()
    .slice(0, HOMEPAGE_RECIPE_LIMIT)
    .map(
      ([slug, recipe]) => `              <article class="recipe-card" data-category="${escapeHtml(recipe.category)}">
                <img
                  class="recipe-image"
                  src="${escapeHtml(imageForCard(recipe.image))}"
                  alt="${escapeHtml(recipe.alt)}"
                />
                <div class="recipe-card-body">
                  <span class="tag">${escapeHtml(recipe.category)}</span>
                  <h3 class="recipe-title">${escapeHtml(recipe.title)}</h3>
                  <p class="recipe-description">
                    ${escapeHtml(excerpt(recipe.description))}
                  </p>
                  <div class="card-footer">
                    <span class="meta-badge">${escapeHtml(recipe.cookTime)}</span>
                    <a class="button button-secondary" href="recipes/${escapeHtml(slug)}.html">View Recipe</a>
                  </div>
                </div>
              </article>`
    )
    .join("\n");

const renderRecipeDirectoryCards = (catalog) =>
  Object.keys(catalog).length === 0
    ? `              <div class="empty-recipes">
                <h3>No recipes are published yet.</h3>
                <p>The Moonlit Flavors recipe directory is ready for the next generated recipe.</p>
              </div>`
    : Object.entries(catalog)
    .reverse()
    .map(
      ([slug, recipe]) => `              <article class="recipe-card" data-category="${escapeHtml(recipe.category)}">
                <img
                  class="recipe-image"
                  src="${escapeHtml(imageForCard(recipe.image))}"
                  alt="${escapeHtml(recipe.alt)}"
                />
                <div class="recipe-card-body">
                  <span class="tag">${escapeHtml(recipe.category)}</span>
                  <h3 class="recipe-title">${escapeHtml(recipe.title)}</h3>
                  <p class="recipe-description">
                    ${escapeHtml(excerpt(recipe.description))}
                  </p>
                  <div class="card-footer">
                    <span class="meta-badge">${escapeHtml(recipe.cookTime)}</span>
                    <a class="button button-secondary" href="recipes/${escapeHtml(slug)}.html">View Recipe</a>
                  </div>
                </div>
              </article>`
    )
    .join("\n");

const renderCategoryButtons = () =>
  CATEGORY_NAMES.map(
    (category) => `              <button class="category-card" type="button" data-category="${escapeHtml(
      category
    )}" aria-pressed="false">
                <h3 class="category-name">${escapeHtml(category)}</h3>
              </button>`
  ).join("\n");

const renderRecipesDirectoryPage = (catalog) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Recipes | ${SITE_NAME}</title>
    <meta
      name="description"
      content="Browse the full ${SITE_NAME} recipe collection by category."
    />
    <meta name="monetization" content="$${SITE_SLUG}" />
    <meta name="p:domain_verify" content="4e0ddfc2a9a0471173a81529345d2760" />
    <link rel="stylesheet" href="style.css" />
    <script src="main.js" defer></script>
  </head>
  <body>
    <div class="page-shell">
      <!-- SECTION: header -->
      <header class="site-header">
        <div class="container nav-wrap">
          <a class="brand" href="index.html">${SITE_NAME}</a>
          <button
            class="nav-toggle"
            type="button"
            aria-expanded="false"
            aria-controls="site-nav"
            aria-label="Toggle navigation"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
          <nav class="site-nav" id="site-nav" aria-label="Primary">
            <a class="nav-link" href="index.html">Home</a>
            <a class="nav-link is-current" href="categories.html">Categories</a>
            <a class="nav-link" href="about.html">About</a>
            <a class="nav-link" href="privacy-policy.html">Privacy Policy</a>
            <a
              class="nav-link"
              href="https://www.pinterest.com/MoonlitFlavors/"
              target="_blank"
              rel="noreferrer"
              >Pinterest</a
            >
          </nav>
        </div>
      </header>

      <main>
        <!-- SECTION: page intro -->
        <section class="page-hero">
          <div class="container">
            <div class="page-hero-card">
              <span class="eyebrow">Recipe Directory</span>
              <h1 class="section-heading" data-category-results-title>All Recipes</h1>
              <p class="section-copy" data-category-results-copy>
                Browse the full ${SITE_NAME} recipe collection, or filter by category.
              </p>
            </div>
          </div>
        </section>

        <!-- SECTION: browse categories -->
        <section class="section-space" style="padding-top: 1rem;">
          <div class="container">
            <div class="category-strip" aria-label="Recipe categories">
${renderCategoryButtons()}
            </div>
          </div>
        </section>

        <!-- SECTION: recipes -->
        <section class="section-space" id="recipes" style="padding-top: 0;">
          <div class="container">
            <div class="recipes-grid">
${renderRecipeDirectoryCards(catalog)}
            </div>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>
`;

const updateHomepageRecipes = (catalog) => {
  const indexHtml = fs.readFileSync(indexPath, "utf8");
  const cards = renderHomepageRecipeCards(catalog);
  let matchedHomepageGrid = false;
  const updated = indexHtml.replace(
    /(<div class="recipes-grid">\r?\n)[\s\S]*?(\r?\n\s*<\/div>\r?\n\s*<\/div>\r?\n\s*<\/section>\r?\n\r?\n\s*<!-- SECTION: pinterest banner -->)/,
    (_match, open, close) => {
      matchedHomepageGrid = true;
      return `${open}${cards}${close}`;
    }
  );

  if (!matchedHomepageGrid) {
    throw new Error("Could not find homepage recipes grid to update.");
  }

  if (updated !== indexHtml) {
    fs.writeFileSync(indexPath, updated);
  }
};

const updateRecipeDirectory = (catalog) => {
  fs.writeFileSync(recipesIndexPath, renderRecipesDirectoryPage(catalog));
};

const renderStaticRecipeBody = (html, catalog, recipe) => {
  let page = html;

  page = replaceDataText(page, "data-breadcrumb-category", recipe.category);
  page = replaceDataText(page, "data-recipe-category", recipe.category);
  page = replaceDataText(page, "data-recipe-title", recipe.title);
  page = replaceDataText(page, "data-recipe-description", recipe.description);
  page = replaceDataText(page, "data-prep-time", recipe.prepTime);
  page = replaceDataText(page, "data-cook-time", recipe.cookTime);
  page = replaceDataText(page, "data-servings", recipe.servings);
  page = replaceDataText(page, "data-difficulty", recipe.difficulty);
  page = replaceDataText(page, "data-nutrition-calories", recipe.nutrition.calories);
  page = replaceDataText(page, "data-nutrition-protein", recipe.nutrition.protein);
  page = replaceDataText(page, "data-nutrition-carbs", recipe.nutrition.carbs);
  page = replaceDataText(page, "data-nutrition-fat", recipe.nutrition.fat);

  page = page.replace(/<img[\s\S]*?data-recipe-image[\s\S]*?\/>/, (imageTag) =>
    imageTag
      .replace(/src="[^"]*"/, `src="${escapeHtml(recipe.image)}"`)
      .replace(/alt="[^"]*"/, `alt="${escapeHtml(recipe.alt)}"`)
  );
  page = page.replace(
    /href="[^"]*"\s+data-breadcrumb-category-link/,
    `href="${escapeHtml(categoryResultsPath(recipe.category))}" data-breadcrumb-category-link`
  );
  page = page.replace(
    /(<ul class="ingredient-list" data-ingredient-list>)[\s\S]*?(<\/ul>)/,
    (_match, open, close) =>
      `${open}\n${recipe.ingredients.map((ingredient) => `                  <li>${escapeHtml(ingredient)}</li>`).join("\n")}\n                ${close}`
  );
  page = page.replace(
    /(<ol class="instruction-list" data-instruction-list>)[\s\S]*?(<\/ol>)/,
    (_match, open, close) =>
      `${open}\n${recipe.instructions
        .map(
          (step, index) =>
            `                  <li class="instruction-step" id="recipe-step-${index + 1}">\n                    ${escapeHtml(step)}\n                  </li>`
        )
        .join("\n")}\n                ${close}`
  );
  page = page.replace(
    /(<div class="related-list" data-related-list>)[\s\S]*?(<\/div>\s*<\/article>)/,
    (_match, open, close) => `${open}\n${renderRelatedRecipes(catalog, recipe.related)}\n                ${close}`
  );

  return page;
};

const buildRecipePage = (template, catalog, recipe, slug) => {
  const title = `${recipe.title} | ${SITE_NAME}`;
  const description = `${recipe.description} Includes prep time, cook time, servings, ingredients, instructions, and nutrition facts.`;
  let page = template
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[\s\S]*?"\s*\/>/,
      `<meta\n      name="description"\n      content="${escapeHtml(description)}"\n    />`
    )
    .replace(
      /<!-- SEO: recipe rich pins -->[\s\S]*?<!-- \/SEO: recipe rich pins -->/,
      buildSeoBlock(recipe, slug)
    )
    .replace(
      '<div class="page-shell" data-recipe-template>',
      `<div class="page-shell" data-recipe-template data-recipe-slug="${escapeHtml(slug)}">`
    );

  page = page.replace(
    /href="https:\/\/www\.pinterest\.com\/pin\/create\/button\/\?[^"]*"\s+target="_blank"\s+data-pinterest-save-link/,
    `href="${escapeHtml(buildPinterestSaveUrl(recipe, slug))}"\n                target="_blank"\n                data-pinterest-save-link`
  );

  if (!page.includes("<base href=\"../\" />")) {
    page = page.replace(
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <base href="../" />'
    );
  }

  return renderStaticRecipeBody(page, catalog, recipe);
};

const catalog = extractRecipeCatalog();
const template = fs.readFileSync(recipeTemplatePath, "utf8");

fs.mkdirSync(recipesDir, { recursive: true });

Object.entries(catalog).forEach(([slug, recipe]) => {
  const page = buildRecipePage(template, catalog, recipe, slug || DEFAULT_SLUG);
  fs.writeFileSync(path.join(recipesDir, `${slug}.html`), page);
});

updateHomepageRecipes(catalog);
updateRecipeDirectory(catalog);

console.log(
  `Generated ${Object.keys(catalog).length} recipe pages in ${path.relative(
    ROOT_DIR,
    recipesDir
  )}, refreshed the ${HOMEPAGE_RECIPE_LIMIT} newest homepage cards, and rebuilt recipes.html.`
);
