// remove description from each post

import fs from "fs/promises";

interface PostData {
  title: string;
  image: string;
  info: Record<string, string>;
  description?: string;
  previewImages: string[];
  createdAt: string;
}

function main() {
  fs.readFile("scraped_data.json", "utf-8")
    .then(data => {
      const posts = JSON.parse(data) as Record<string, PostData>;
      for (const url in posts) {
        delete posts[url].description;
      }
      //   console.log(posts);
      fs.writeFile("scraped_data.json", JSON.stringify(posts, null, 2));
    })
    .catch(error => {
      console.error(error);
    });
}

main();
