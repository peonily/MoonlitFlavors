const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env.local");
const MAIN_JS_PATH = path.join(ROOT_DIR, "main.js");
const GENERATE_PAGES_SCRIPT = path.join(__dirname, "generate-recipe-pages.js");
const TMP_DIR = path.join(ROOT_DIR, ".recipe-generator-tmp");
const OPENROUTER_THROTTLE_PATH = path.join(TMP_DIR, "openrouter-last-call.json");
const DEFAULT_OPENROUTER_MIN_REQUEST_INTERVAL_MS = 25000;
const DEFAULT_OPENROUTER_RETRY_COOLDOWN_MS = 90000;

const ALLOWED_CATEGORIES = [
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

const REQUIRED_ENV = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_BASE_URL",
  "SITE_URL",
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

const requireEnv = () => {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment values: ${missing.join(", ")}`);
  }
};

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readIntegerEnv = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const readOpenRouterThrottleState = () => {
  if (!fs.existsSync(OPENROUTER_THROTTLE_PATH)) {
    return { lastRequestAt: 0, cooldownUntil: 0 };
  }

  try {
    const state = JSON.parse(fs.readFileSync(OPENROUTER_THROTTLE_PATH, "utf8"));
    return {
      lastRequestAt: Number(state.lastRequestAt) || 0,
      cooldownUntil: Number(state.cooldownUntil) || 0,
    };
  } catch {
    return { lastRequestAt: 0, cooldownUntil: 0 };
  }
};

const writeOpenRouterThrottleState = (state) => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(OPENROUTER_THROTTLE_PATH, JSON.stringify(state));
};

const throttleOpenRouter = async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const minRequestIntervalMs = readIntegerEnv(
    "OPENROUTER_MIN_REQUEST_INTERVAL_MS",
    DEFAULT_OPENROUTER_MIN_REQUEST_INTERVAL_MS
  );
  const state = readOpenRouterThrottleState();
  const waitUntil = Math.max(state.lastRequestAt + minRequestIntervalMs, state.cooldownUntil);
  const waitMs = waitUntil - Date.now();

  if (waitMs > 0) {
    console.log(`Waiting ${Math.ceil(waitMs / 1000)}s for OpenRouter pacing...`);
    await sleep(waitMs);
  }

  writeOpenRouterThrottleState({
    lastRequestAt: Date.now(),
    cooldownUntil: Math.max(state.cooldownUntil, Date.now()),
  });
};

const applyOpenRouterRetryCooldown = async (attempt, status) => {
  const baseCooldownMs = readIntegerEnv("OPENROUTER_RETRY_COOLDOWN_MS", DEFAULT_OPENROUTER_RETRY_COOLDOWN_MS);
  const cooldownMs = baseCooldownMs * attempt;
  const state = readOpenRouterThrottleState();
  const cooldownUntil = Date.now() + cooldownMs;

  writeOpenRouterThrottleState({
    lastRequestAt: state.lastRequestAt || Date.now(),
    cooldownUntil: Math.max(state.cooldownUntil, cooldownUntil),
  });

  console.log(`OpenRouter returned ${status}. Cooling down ${Math.ceil(cooldownMs / 1000)}s before retry...`);
  await sleep(cooldownMs);
};

const getContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  throw new Error(`Unsupported image type "${ext}". Use JPG, PNG, or WebP.`);
};

const hmac = (key, value, encoding) => crypto.createHmac("sha256", key).update(value).digest(encoding);
const sha256 = (value, encoding = "hex") => crypto.createHash("sha256").update(value).digest(encoding);

const encodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const signR2Put = ({ body, contentType, objectKey }) => {
  const endpoint = new URL(process.env.R2_ENDPOINT);
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const encodedKey = objectKey.split("/").map(encodeRfc3986).join("/");
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const payloadHash = sha256(body);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${endpoint.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    "aws4_request"
  );
  const signature = hmac(signingKey, stringToSign, "hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    url: `${endpoint.origin}${canonicalUri}`,
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
    },
  };
};

const uploadToR2 = async (imagePath) => {
  const body = fs.readFileSync(imagePath);
  const contentType = getContentType(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const baseName = slugify(path.basename(imagePath, ext)) || "recipe-image";
  const objectKey = `recipe-generator/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${baseName}${ext}`;
  const signedRequest = signR2Put({ body, contentType, objectKey });
  const response = await fetch(signedRequest.url, {
    method: "PUT",
    headers: signedRequest.headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`R2 upload failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  return `${normalizeBaseUrl(process.env.R2_PUBLIC_BASE_URL)}/${objectKey}`;
};

const getRelatedSlugPromptText = () => {
  try {
    const source = fs.readFileSync(MAIN_JS_PATH, "utf8");
    const slugs = [...getExistingSlugs(source)];
    return slugs.length ? slugs.join(", ") : "No existing recipes yet. Return an empty related array.";
  } catch {
    return "No existing recipes yet. Return an empty related array.";
  }
};

const buildPrompt = (imageUrl) => `You are creating production recipe content for Moonlit Flavors, an editorial recipe website.

Analyze the food image and infer a realistic recipe from it. Return one strict JSON object only, with no markdown.

Rules:
- Use one category from this exact list: ${ALLOWED_CATEGORIES.join(", ")}.
- The recipe must match the visible dish in the image.
- Use concise editorial copy, not generic filler.
- Ingredients must be specific and usable.
- Instructions must be complete, ordered, and practical.
- Times must be strings like "15 min" or "1 hr 10 min".
- Nutrition may be a reasonable estimate.
- Slug must be lowercase kebab-case.
- Related recipe slugs must be existing recipes from the supplied list when possible.
- Do not include image URLs in the JSON.

Existing related recipe slug options:
${getRelatedSlugPromptText()}

Image URL: ${imageUrl}

JSON shape:
{
  "slug": "example-recipe-slug",
  "category": "Lunch",
  "title": "Recipe Title",
  "description": "One sentence description.",
  "alt": "Descriptive image alt text",
  "prepTime": "15 min",
  "cookTime": "20 min",
  "servings": "4",
  "difficulty": "Easy",
  "nutrition": {
    "calories": "520",
    "protein": "24g",
    "carbs": "48g",
    "fat": "26g"
  },
  "ingredients": ["..."],
  "instructions": ["..."],
  "related": []
}`;

const extractMessageContent = (payload) => {
  const choice = payload.choices?.[0];
  const message = choice?.message || {};
  const content = message.content;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      })
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
};

const extractMessageReasoning = (payload) => {
  const reasoning = payload.choices?.[0]?.message?.reasoning;
  return typeof reasoning === "string" ? reasoning.trim() : "";
};

const containsJsonObject = (value) => {
  const text = String(value || "");
  return text.includes("{") && text.includes("}");
};

const summarizeEmptyOpenRouterResponse = (payload) => {
  const choice = payload.choices?.[0] || {};
  const message = choice.message || {};
  const details = {
    finish_reason: choice.finish_reason || choice.native_finish_reason || null,
    error: choice.error || payload.error || null,
    message_keys: Object.keys(message),
    usage: payload.usage || null,
  };

  return JSON.stringify(details);
};

const postOpenRouter = async (body) => {
  let lastErrorText = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await throttleOpenRouter();

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.SITE_URL,
        "X-Title": "Moonlit Flavors Recipe Generator",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response.json();
    }

    lastErrorText = `${response.status} ${response.statusText}\n${await response.text()}`;
    if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      break;
    }

    await applyOpenRouterRetryCooldown(attempt, response.status);
  }

  throw new Error(`OpenRouter request failed: ${lastErrorText}`);
};

const requestOpenRouterRecipe = async (imageUrl) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL,
    reasoning: {
      effort: "none",
      exclude: true,
    },
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt(imageUrl) },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0.15,
    max_tokens: 2200,
  });

  return {
    content: extractMessageContent(payload),
    reasoning: extractMessageReasoning(payload),
    payload,
  };
};

const repairRecipeJson = async ({ sourceText, imageUrl }) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL,
    reasoning: {
      effort: "none",
      exclude: true,
    },
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: `Convert the recipe notes below into one strict JSON object only. Do not explain. Do not include markdown.

Use this exact JSON shape:
{
  "slug": "example-recipe-slug",
  "category": "Lunch",
  "title": "Recipe Title",
  "description": "One sentence description.",
  "alt": "Descriptive image alt text",
  "prepTime": "15 min",
  "cookTime": "20 min",
  "servings": "4",
  "difficulty": "Easy",
  "nutrition": {
    "calories": "520",
    "protein": "24g",
    "carbs": "48g",
    "fat": "26g"
  },
  "ingredients": ["..."],
  "instructions": ["..."],
  "related": []
}

Allowed categories: ${ALLOWED_CATEGORIES.join(", ")}.
Existing related recipe slug options: ${getRelatedSlugPromptText()}
Image URL: ${imageUrl}

Recipe notes:
${sourceText}`,
      },
    ],
    temperature: 0,
    max_tokens: 1600,
  });

  const content = extractMessageContent(payload);
  if (!containsJsonObject(content)) {
    throw new Error(`OpenRouter repair pass did not return JSON. Details: ${summarizeEmptyOpenRouterResponse(payload)}`);
  }

  return parseRecipeJson(content);
};

const callOpenRouter = async (imageUrl) => {
  let lastPayload = null;
  let repairSource = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { content, reasoning, payload } = await requestOpenRouterRecipe(imageUrl);
    lastPayload = payload;
    repairSource = content || reasoning || repairSource;

    if (containsJsonObject(content)) {
      return parseRecipeJson(content);
    }

    if (repairSource) {
      console.log("OpenRouter did not return final JSON. Running JSON repair pass...");
      return repairRecipeJson({ sourceText: repairSource, imageUrl });
    }

    if (attempt < 3) {
      console.log(`OpenRouter returned empty content. Retrying (${attempt + 1}/3)...`);
      await sleep(1200 * attempt);
    }
  }

  throw new Error(`OpenRouter returned no message content after 3 attempts. Details: ${summarizeEmptyOpenRouterResponse(lastPayload || {})}`);
};

const parseRecipeJson = (content) => {
  const trimmed = String(content).trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find JSON object in OpenRouter response:\n${content}`);
  }

  return JSON.parse(withoutFence.slice(start, end + 1));
};

const normalizeRecipe = (recipe, imageUrl) => {
  const normalized = {
    slug: slugify(recipe.slug || recipe.title),
    category: recipe.category,
    title: String(recipe.title || "").trim(),
    description: String(recipe.description || "").trim(),
    image: imageUrl,
    alt: String(recipe.alt || recipe.title || "Recipe image").trim(),
    prepTime: String(recipe.prepTime || "").trim(),
    cookTime: String(recipe.cookTime || "").trim(),
    servings: String(recipe.servings || "").trim(),
    difficulty: String(recipe.difficulty || "Easy").trim(),
    nutrition: recipe.nutrition || {},
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.map(String) : [],
    instructions: Array.isArray(recipe.instructions) ? recipe.instructions.map(String) : [],
    related: Array.isArray(recipe.related) ? recipe.related.map(slugify).slice(0, 3) : [],
  };

  if (!normalized.slug) throw new Error("Recipe is missing a usable slug.");
  if (!normalized.title) throw new Error("Recipe is missing title.");
  if (!ALLOWED_CATEGORIES.includes(normalized.category)) {
    normalized.category = "Lunch";
  }
  if (!normalized.description) throw new Error("Recipe is missing description.");
  if (!normalized.prepTime || !normalized.cookTime || !normalized.servings) {
    throw new Error("Recipe is missing prepTime, cookTime, or servings.");
  }
  if (normalized.ingredients.length < 6) throw new Error("Recipe needs at least 6 ingredients.");
  if (normalized.instructions.length < 4) throw new Error("Recipe needs at least 4 instructions.");

  normalized.nutrition = {
    calories: String(normalized.nutrition.calories || "500").replace(/\s*calories?$/i, ""),
    protein: String(normalized.nutrition.protein || "20g"),
    carbs: String(normalized.nutrition.carbs || "45g"),
    fat: String(normalized.nutrition.fat || "22g"),
  };

  return normalized;
};

const toJsString = (value) => JSON.stringify(value);

const formatRecipeEntry = (recipe) => `    "${recipe.slug}": {
      category: ${toJsString(recipe.category)},
      title: ${toJsString(recipe.title)},
      description:
        ${toJsString(recipe.description)},
      image: ${toJsString(recipe.image)},
      alt: ${toJsString(recipe.alt)},
      prepTime: ${toJsString(recipe.prepTime)},
      cookTime: ${toJsString(recipe.cookTime)},
      servings: ${toJsString(recipe.servings)},
      difficulty: ${toJsString(recipe.difficulty)},
      nutrition: {
        calories: ${toJsString(recipe.nutrition.calories)},
        protein: ${toJsString(recipe.nutrition.protein)},
        carbs: ${toJsString(recipe.nutrition.carbs)},
        fat: ${toJsString(recipe.nutrition.fat)},
      },
      ingredients: [
${recipe.ingredients.map((ingredient) => `        ${toJsString(ingredient)},`).join("\n")}
      ],
      instructions: [
${recipe.instructions.map((instruction) => `        ${toJsString(instruction)},`).join("\n")}
      ],
      related: [${recipe.related.map(toJsString).join(", ")}],
    },
`;

const findCatalogBounds = (source) => {
  const declaration = "const recipeCatalog = ";
  const declarationIndex = source.indexOf(declaration);
  if (declarationIndex === -1) {
    throw new Error("Could not find recipeCatalog in main.js.");
  }

  const objectStart = source.indexOf("{", declarationIndex);
  let depth = 0;

  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return { objectStart, objectEnd: index };
    }
  }

  throw new Error("Could not find end of recipeCatalog in main.js.");
};

const getExistingSlugs = (source) => {
  const { objectStart, objectEnd } = findCatalogBounds(source);
  const catalogSource = source.slice(objectStart, objectEnd);
  return new Set([...catalogSource.matchAll(/"([^"]+)"\s*:/g)].map((match) => match[1]));
};

const makeUniqueSlug = (slug, existingSlugs) => {
  if (!existingSlugs.has(slug)) {
    return slug;
  }

  let index = 2;
  let candidate = `${slug}-${index}`;
  while (existingSlugs.has(candidate)) {
    index += 1;
    candidate = `${slug}-${index}`;
  }

  return candidate;
};

const insertRecipeIntoCatalog = (recipe) => {
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");
  const existingSlugs = getExistingSlugs(source);
  recipe.slug = makeUniqueSlug(recipe.slug, existingSlugs);
  const { objectEnd } = findCatalogBounds(source);
  const entry = formatRecipeEntry(recipe);
  const updated = `${source.slice(0, objectEnd)}${entry}${source.slice(objectEnd)}`;
  fs.writeFileSync(MAIN_JS_PATH, updated);
};

const main = async () => {
  loadEnvFile(ENV_PATH);
  requireEnv();

  const imagePath = process.argv[2];
  if (!imagePath) {
    throw new Error('Usage: node scripts/generate-from-image.js "C:\\path\\to\\recipe-image.jpeg"');
  }

  const resolvedImagePath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedImagePath)) {
    throw new Error(`Image file not found: ${resolvedImagePath}`);
  }

  console.log("Uploading image to R2...");
  const imageUrl = await uploadToR2(resolvedImagePath);
  console.log(`Uploaded image: ${imageUrl}`);

  console.log("Requesting recipe from OpenRouter...");
  const generatedRecipe = await callOpenRouter(imageUrl);
  const recipe = normalizeRecipe(generatedRecipe, imageUrl);

  console.log(`Generated recipe: ${recipe.title} (${recipe.slug})`);
  insertRecipeIntoCatalog(recipe);

  console.log("Regenerating static recipe pages...");
  execFileSync(process.execPath, [GENERATE_PAGES_SCRIPT], {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });

  console.log(`Done: recipes/${recipe.slug}.html`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
