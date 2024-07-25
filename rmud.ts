// remove posts that are updates digest

import fs from "fs/promises";

async function main() {
  const posts = await fs
    .readFile("scraped_data.json", "utf-8")
    .then(data => JSON.parse(data));

  const keys = Object.keys(posts);

  for (const key of keys) {
    const post = posts[key];

    if (post.title.includes("Updates Digest")) {
      delete posts[key];
    }
  }

  await fs.writeFile("scraped_data.json", JSON.stringify(posts, null, 2));
}

main();
