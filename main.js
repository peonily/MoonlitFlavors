const siteHeader = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  siteNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      siteNav.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

if (siteHeader) {
  const syncHeaderShadow = () => {
    siteHeader.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  syncHeaderShadow();
  window.addEventListener("scroll", syncHeaderShadow, { passive: true });
}

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    const targetId = anchor.getAttribute("href");

    if (!targetId || targetId === "#") {
      return;
    }

    const target = document.querySelector(targetId);

    if (!target) {
      return;
    }

    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

const categoryResultsUrl = (category) => `recipes.html?category=${encodeURIComponent(category)}#recipes`;

if (document.querySelector(".category-strip") && document.querySelector(".recipes-grid")) {
  const categoryCards = document.querySelectorAll(".category-card[data-category]");
  const recipeCards = document.querySelectorAll(".recipe-card[data-category]");
  const categoryTitle = document.querySelector("[data-category-results-title]");
  const categoryCopy = document.querySelector("[data-category-results-copy]");
  const requestedCategory = new URLSearchParams(window.location.search).get("category") || "";
  const hasRequestedCategory = [...categoryCards].some((card) => card.dataset.category === requestedCategory);
  let activeCategory = hasRequestedCategory ? requestedCategory : "";

  const syncCategoryUi = () => {
    categoryCards.forEach((item) => {
      const isActive = item.dataset.category === activeCategory;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
    });

    if (categoryTitle) {
      categoryTitle.textContent = activeCategory ? `${activeCategory} Recipes` : "All Recipes";
    }

    if (categoryCopy) {
      categoryCopy.textContent = activeCategory
        ? `Browse every Moonlit Flavors recipe filed under ${activeCategory}.`
        : "Browse the full Moonlit Flavors recipe collection, or filter by category.";
    }
  };

  const updateCategoryUrl = () => {
    const url = new URL(window.location.href);
    if (activeCategory) {
      url.searchParams.set("category", activeCategory);
      url.hash = "recipes";
    } else {
      url.searchParams.delete("category");
      url.hash = "";
    }

    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const applyFilter = (selectedCategory, { animate = true } = {}) => {
    const filterCards = () => {
      recipeCards.forEach((card) => {
        const matches = !selectedCategory || card.dataset.category === selectedCategory;
        card.classList.toggle("hidden", !matches);
      });
    };

    if (!animate) {
      filterCards();
      return;
    }

    recipeCards.forEach((card) => {
      card.classList.add("fading");
    });

    window.setTimeout(() => {
      filterCards();

      requestAnimationFrame(() => {
        recipeCards.forEach((card) => {
          card.classList.remove("fading");
        });
      });
    }, 140);
  };

  categoryCards.forEach((card) => {
    card.addEventListener("click", () => {
      const selectedCategory = card.dataset.category || "";
      activeCategory = activeCategory === selectedCategory ? "" : selectedCategory;

      syncCategoryUi();
      updateCategoryUrl();
      applyFilter(activeCategory);
    });
  });

  syncCategoryUi();
  applyFilter(activeCategory, { animate: false });
}

const recipeTemplate = document.querySelector("[data-recipe-template]");

if (recipeTemplate) {
  const recipeCatalog = {};

  const getSlugFromPath = () => {
    const match = window.location.pathname.match(/\/recipes\/([^/]+)\.html$/);
    return match ? decodeURIComponent(match[1]) : "";
  };

  const defaultRecipeSlug = Object.keys(recipeCatalog)[0] || "";
  const requestedRecipeSlug =
    recipeTemplate.dataset.recipeSlug ||
    getSlugFromPath() ||
    new URLSearchParams(window.location.search).get("recipe") ||
    defaultRecipeSlug;
  const recipeSlug = requestedRecipeSlug in recipeCatalog ? requestedRecipeSlug : defaultRecipeSlug;
  const recipe = recipeCatalog[recipeSlug];

  const setText = (selector, value) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  };

  const setHtml = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) {
      element.innerHTML = value;
    }
  };

  if (!recipe) {
    setText("[data-recipe-title]", "No recipes are published yet");
    setText(
      "[data-recipe-description]",
      "Moonlit Flavors is ready for the next recipe generated from the AI maker."
    );
    setHtml("[data-ingredient-list]", "");
    setHtml("[data-instruction-list]", "");
    setHtml("[data-related-list]", "");
    return;
  }

  const recipeUrl = `recipes/${recipeSlug}.html`;
  const recipeAbsoluteUrl = new URL(recipeUrl, document.baseURI).href;
  const recipeImageAbsoluteUrl = new URL(recipe.image, document.baseURI).href;
  const relatedCatalog = recipe.related.map((slug) => [slug, recipeCatalog[slug]]).filter((entry) => entry[1]);

  const getRecipeHref = (slug) => `recipes/${slug}.html`;

  setText("[data-breadcrumb-category]", recipe.category);
  setText("[data-recipe-category]", recipe.category);
  setText("[data-recipe-title]", recipe.title);
  setText("[data-recipe-description]", recipe.description);
  setText("[data-prep-time]", recipe.prepTime);
  setText("[data-cook-time]", recipe.cookTime);
  setText("[data-servings]", recipe.servings);
  setText("[data-difficulty]", recipe.difficulty);
  setText("[data-nutrition-calories]", recipe.nutrition.calories);
  setText("[data-nutrition-protein]", recipe.nutrition.protein);
  setText("[data-nutrition-carbs]", recipe.nutrition.carbs);
  setText("[data-nutrition-fat]", recipe.nutrition.fat);

  const recipeImage = document.querySelector("[data-recipe-image]");
  if (recipeImage) {
    recipeImage.src = recipe.image;
    recipeImage.alt = recipe.alt;
  }

  const breadcrumbCategoryLink = document.querySelector("[data-breadcrumb-category-link]");
  if (breadcrumbCategoryLink) {
    breadcrumbCategoryLink.href = categoryResultsUrl(recipe.category);
  }

  setHtml(
    "[data-ingredient-list]",
    recipe.ingredients.map((ingredient) => `<li>${ingredient}</li>`).join("")
  );
  setHtml(
    "[data-instruction-list]",
    recipe.instructions.map((step) => `<li class="instruction-step">${step}</li>`).join("")
  );
  setHtml(
    "[data-related-list]",
    relatedCatalog
      .map(
        ([slug, relatedRecipe]) => `
          <a class="related-card" href="${getRecipeHref(slug)}">
            <img
              class="related-image"
              src="${relatedRecipe.image}"
              alt="${relatedRecipe.alt}"
            />
            <div>
              <h4 class="related-title">${relatedRecipe.title}</h4>
              <span class="meta-badge">${relatedRecipe.cookTime}</span>
            </div>
          </a>
        `
      )
      .join("")
  );

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

  const setMetaContent = (attributeName, attributeValue, content) => {
    let element = document.querySelector(`meta[${attributeName}="${attributeValue}"]`);

    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attributeName, attributeValue);
      document.head.appendChild(element);
    }

    element.setAttribute("content", content);
  };

  const updateRecipeSeo = () => {
    const title = `${recipe.title} | Moonlit Flavors`;
    const description = `${recipe.description} Includes prep time, cook time, servings, ingredients, instructions, and nutrition facts.`;
    const pinterestSaveUrl = new URL("https://www.pinterest.com/pin/create/button/");
    const prepMinutes = parseDurationMinutes(recipe.prepTime);
    const cookMinutes = parseDurationMinutes(recipe.cookTime);
    const recipeJsonLd = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      "@id": `${recipeAbsoluteUrl}#recipe`,
      mainEntityOfPage: recipeAbsoluteUrl,
      url: recipeAbsoluteUrl,
      name: recipe.title,
      description: recipe.description,
      image: [recipeImageAbsoluteUrl],
      author: {
        "@type": "Organization",
        name: "Moonlit Flavors",
      },
      publisher: {
        "@type": "Organization",
        name: "Moonlit Flavors",
      },
      datePublished: "2025-04-26",
      dateModified: "2026-05-02",
      prepTime: toIsoDuration(prepMinutes),
      cookTime: toIsoDuration(cookMinutes),
      totalTime: toIsoDuration(prepMinutes + cookMinutes),
      recipeYield: `${recipe.servings} servings`,
      recipeCategory: recipe.category,
      keywords: [recipe.category, recipe.difficulty, "Moonlit Flavors recipe"].join(", "),
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

    document.title = title;

    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalLink);
    }

    canonicalLink.setAttribute("href", recipeAbsoluteUrl);

    setMetaContent("name", "description", description);
    setMetaContent("property", "og:type", "article");
    setMetaContent("property", "og:site_name", "Moonlit Flavors");
    setMetaContent("property", "og:title", title);
    setMetaContent("property", "og:description", description);
    setMetaContent("property", "og:image", recipeImageAbsoluteUrl);
    setMetaContent("property", "og:url", recipeAbsoluteUrl);
    setMetaContent("property", "article:section", recipe.category);
    setMetaContent("name", "twitter:card", "summary_large_image");
    setMetaContent("name", "twitter:title", title);
    setMetaContent("name", "twitter:description", description);
    setMetaContent("name", "twitter:image", recipeImageAbsoluteUrl);

    pinterestSaveUrl.searchParams.set("url", recipeAbsoluteUrl);
    pinterestSaveUrl.searchParams.set("media", recipeImageAbsoluteUrl);
    pinterestSaveUrl.searchParams.set("description", title);

    document.querySelectorAll("[data-pinterest-save-link]").forEach((link) => {
      link.href = pinterestSaveUrl.href;
    });

    let jsonLdScript = document.querySelector("#recipe-json-ld");
    if (!jsonLdScript) {
      jsonLdScript = document.createElement("script");
      jsonLdScript.type = "application/ld+json";
      jsonLdScript.id = "recipe-json-ld";
      document.head.appendChild(jsonLdScript);
    }

    jsonLdScript.textContent = JSON.stringify(recipeJsonLd, null, 2);
  };

  updateRecipeSeo();

  const canonicalRecipeLinks = document.querySelectorAll("[data-current-recipe-link]");
  canonicalRecipeLinks.forEach((link) => {
    link.href = recipeUrl;
  });
}
