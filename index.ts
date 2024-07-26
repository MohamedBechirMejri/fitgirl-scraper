import puppeteer, { Browser, Page } from "puppeteer";
import * as fs from "fs/promises";

interface PostData {
  title: string;
  image: string;
  info: Record<string, string | string[]>;
  // description: string;
  previewImages: string[];
  createdAt: number | null;
}

interface ScrapedData {
  [url: string]: PostData;
}

const BASE_URL = "https://fitgirl-repacks.site";
const SITEMAP_INDEX_URL = `${BASE_URL}/sitemap_index.xml`;
const OUTPUT_FILE = "scraped_data.json";
const IGNORE_LIST = "ignore-list.json";

async function loadExistingData(): Promise<ScrapedData> {
  try {
    const data = await fs.readFile(OUTPUT_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function loadIgnoreList(): Promise<string[]> {
  try {
    const data = await fs.readFile(IGNORE_LIST, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function saveData(data: ScrapedData): Promise<void> {
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2));
}

async function saveIgnoreList(data: string[]): Promise<void> {
  await fs.writeFile(IGNORE_LIST, JSON.stringify(data, null, 2));
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
  await page.goto(url, { waitUntil: "networkidle0", timeout: 0 });

  const title = await page.$eval(
    ".entry-title",
    el => el.textContent?.trim() || ""
  );
  const image = await page.$eval(
    ".entry-content img",
    el => el.getAttribute("src") || ""
  );
  const previewImages = await page.$$eval(".entry-content img", images =>
    images
      .map(img => img.getAttribute("src") || "")
      .filter(Boolean)
      .filter(x => x.includes("riotpixels"))
  );

  const info = await page.evaluate(() => {
    const data: Record<string, string | string[]> = {};
    const infoSection = document.querySelector(".entry-content p");

    if (!infoSection) {
      console.log("Info section not found");
      return data;
    }

    const infoText = infoSection.innerHTML;
    console.log("Info section HTML:", infoText);

    const infoParts = infoText.split(/<br\s*\/?>/i);

    infoParts.forEach(part => {
      const text = part.replace(/<\/?[^>]+(>|$)/g, "").trim();
      const match = text.match(/^(.+?):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        if (key.trim() === "Genres/Tags") {
          data["genres"] = value.trim().split(", ");
        } else {
          data[key.trim()] = value.trim();
        }
        console.log(`Matched: ${key.trim()} = ${value.trim()}`);
      } else {
        console.log(`No match for: ${text}`);
      }
    });

    console.log("Final data object:", data);
    return data;
  });

  const createdAt = await page.evaluate(() => {
    function parseCustomDate(dateString: string): number | null {
      const parts = dateString.split("/");
      if (parts.length === 3) {
        const [day, month, year] = parts.map(Number);
        const date = new Date(year, month - 1, day);
        if (!isNaN(date.getTime())) {
          return date.getTime();
        }
      }

      const timestamp = new Date(dateString).getTime();
      return isNaN(timestamp) ? null : timestamp;
    }

    const dateEl = document.querySelector(".entry-date");
    if (!dateEl) return null;

    const dateString =
      dateEl.getAttribute("datetime") || dateEl.textContent?.trim() || "";
    console.log(`Raw date string: ${dateString}`);
    return parseCustomDate(dateString);
  });

  console.log("Scraped info:", info);

  return {
    title,
    image,
    previewImages,
    info,
    createdAt,
  };
}

async function main() {
  const browser: Browser = await puppeteer.launch({
    headless: true,
  });
  const page: Page = await browser.newPage();

  try {
    const scrapedData = await loadExistingData();
    const sitemapLinks = await getSitemapLinks(page);
    const ignoreList = await loadIgnoreList();

    console.log(`Found ${sitemapLinks.length} sitemaps.`);

    for (const sitemap of sitemapLinks) {
      await page.goto(sitemap, { waitUntil: "networkidle0" });
      const urls = (await getPostUrls(page)).map(url =>
        url.replace(`${BASE_URL}/`, "")
      );

      const count = urls.length;
      let index = 0;

      for (const postUrl of urls) {
        index++;
        console.log(`Scraping post ${index} of ${count}`);
        if (!postUrl) {
          console.log("Skipping empty post URL.");
          continue;
        }

        if (
          ignoreList.includes(postUrl) ||
          postUrl.includes("updates-digest")
        ) {
          console.log(`Skipping ignored post: ${postUrl}`);
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

          console.log("Waiting .5 seconds before next request...");
          await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (error) {
          console.error(`Error scraping ${postUrl}:`, error);
          ignoreList.push(postUrl);
          await saveIgnoreList(ignoreList);
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    console.log("Scraping completed.");
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
