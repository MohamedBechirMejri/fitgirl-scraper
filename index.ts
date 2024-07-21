// fitgirl scraper

// first we open /sitemap_index.xml
// we get all links that contain 'post-sitemap' in them

// we then open the links that have text after the slash
// in each page we get the post title the image the info like genre, publisher, size, etc and get the description and the preview images

// we then save the data in a json file

// whenever we scrape the links from the sitemaps we check if the link is already in the json file and if it is we skip it so we don't abuse the server

// when done we push the json file to the repo

import puppeteer, { Browser, Page } from "puppeteer";
import * as fs from "fs/promises";

interface PostData {
  title: string;
  image: string;
  info: Record<string, string[]>;
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

  const title = await page.$eval(".entry-title", el => el.textContent);
  const image = await page.$eval(".entry-content img", el =>
    el.getAttribute("src")
  );
  const description = await page.$eval(
    ".entry-content p",
    el => el.textContent
  );
  const previewImages = await page.$$eval(".entry-content img", images =>
    images.map(img => img.getAttribute("src"))
  );
  const info = await page.$$eval(".entry-content p", paragraphs => {
    const data: Record<string, string[]> = {};

    for (const paragraph of paragraphs) {
      const text = paragraph.textContent;
      if (!text) continue;

      const [key, ...values] = text.split(":");
      if (!key || !values.length) continue;

      data[key.trim()] = values.map(value => value.trim());
    }

    return data;
  });
  const createdAt = await page.$eval(".entry-date", el => el.textContent);

  return {
    title: title || "",
    image: image || "",
    description: description || "",
    previewImages: (previewImages as string[]) || [],
    info: info || {},
    createdAt: createdAt || "",
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
        if (!postUrl) {
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
