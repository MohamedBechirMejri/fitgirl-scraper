import * as fs from "fs/promises";

function main() {
  fs.readFile("scraped_data.json", "utf-8")
    .then(data => {
      const posts = JSON.parse(data);

      const keys = Object.keys(posts);

      for (const key of keys) {
        const post = posts[key];

        const previews = post.previewImages;

        if (!previews) {
          continue;
        }

        const cleanPreviews = previews.filter((p: string) =>
          p.includes("riotpixels")
        );

        post.previewImages = cleanPreviews;

        posts[key] = post;
      }
      // save file
      fs.writeFile("scraped_data.json", JSON.stringify(posts, null, 2));
    })
    .catch(error => {
      console.error(error);
    });
}

main();
