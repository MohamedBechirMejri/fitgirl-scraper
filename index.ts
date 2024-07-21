import puppeteer, { Browser, Page } from "puppeteer";
import * as fs from "fs/promises";

interface PostData {
  title: string;
  image: string;
  info: Record<string, string>;
  description: string;
  previewImages: string[];
  createdAt: string;
}

interface ScrapedData {
  [url: string]: PostData;
}

const BASE_URL = "https://fitgirl-repacks.site";
const SITEMAP_INDEX_URL = `${BASE_URL}/sitemap_index.xml`;
const OUTPUT_FILE = "scraped_data.json";

async function loadExistingData(): Promise<ScrapedData> {
  try {
    const data = await fs.readFile(OUTPUT_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveData(data: ScrapedData): Promise<void> {
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2));
}

async function getSitemapLinks(page: Page): Promise<string[]> {
  await page.goto(SITEMAP_INDEX_URL, { waitUntil: "networkidle0" });

  const links = await page.$$eval("a", anchors =>
    anchors
      .map(anchor => anchor.getAttribute("href"))
      .filter(href => href?.includes("post-sitemap"))
  );

  return links as string[];
}

function getPostUrls(page: Page): Promise<string[]> {
  return page.$$eval(
    "a",
    (anchors, baseUrl) =>
      anchors
        .map(anchor => anchor.getAttribute("href"))
        .filter(href => href?.startsWith(baseUrl)),
    BASE_URL
  ) as Promise<string[]>;
}

async function scrapePost(page: Page, url: string): Promise<PostData> {
  await page.goto(url, { waitUntil: "networkidle0" });

  const title = await page.$eval(
    ".entry-title",
    el => el.textContent?.trim() || ""
  );
  const image = await page.$eval(
    ".entry-content img",
    el => el.getAttribute("src") || ""
  );
  const description = await page.$eval(
    ".entry-content p",
    el => el.textContent?.trim() || ""
  );
  const previewImages = await page.$$eval(".entry-content img", images =>
    images.map(img => img.getAttribute("src") || "").filter(Boolean)
  );

  const info = await page.evaluate(() => {
    const data: Record<string, string> = {};
    const infoSection = document.querySelector(".entry-content p");

    if (!infoSection) {
      console.log("Info section not found");
      return data;
    }

    const infoText = infoSection.innerHTML;
    console.log("Info section HTML:", infoText);

    // Split the text by <br> tags
    const infoParts = infoText.split(/<br\s*\/?>/i);

    // Process each part
    infoParts.forEach(part => {
      const text = part.replace(/<\/?[^>]+(>|$)/g, "").trim(); // Remove HTML tags
      const match = text.match(/^(.+?):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        data[key.trim()] = value.trim();
        console.log(`Matched: ${key.trim()} = ${value.trim()}`);
      } else {
        console.log(`No match for: ${text}`);
      }
    });

    console.log("Final data object:", data);
    return data;
  });

  const createdAt = await page.$eval(
    ".entry-date",
    el => el.textContent?.trim() || ""
  );

  console.log("Scraped info:", info);

  return {
    title,
    image,
    description,
    previewImages,
    info,
    createdAt,
  };
}

async function main() {
  const browser: Browser = await puppeteer.launch({
    headless: false,
  });
  const page: Page = await browser.newPage();

  try {
    const scrapedData = await loadExistingData();
    const sitemapLinks = await getSitemapLinks(page);

    console.log(`Found ${sitemapLinks.length} sitemaps.`);

    for (const sitemap of sitemapLinks) {
      await page.goto(sitemap, { waitUntil: "networkidle0" });
      const urls = (await getPostUrls(page)).map(url =>
        url.replace(`${BASE_URL}/`, "")
      );

      for (const postUrl of urls) {
        if (!postUrl || postUrl !== "oxygen-not-included/") {
          console.log("Skipping empty post URL.");
          continue;
        }

        if (scrapedData[postUrl]) {
          console.log(`Skipping already scraped: ${postUrl}`);
          continue;
        }

        try {
          const postData = await scrapePost(page, `${BASE_URL}/${postUrl}`);
          scrapedData[postUrl] = postData;
          await saveData(scrapedData);
          console.log(`Scraped: ${postUrl}`);

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
          console.error(`Error scraping ${postUrl}:`, error);
        }
      }
    }

    console.log("Scraping completed.");
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
