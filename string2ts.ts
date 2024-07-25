import * as fs from "fs/promises";

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

function main() {
  fs.readFile("scraped_data.json", "utf-8")
    .then(data => {
      const posts = JSON.parse(data);

      const keys = Object.keys(posts);

      for (const key of keys) {
        const post = posts[key];

        const createdAt = post.createdAt;

        if (!createdAt) {
          throw new Error(`Missing createdAt for ${key}`);
        }

        const timestamp = parseCustomDate(createdAt);

        if (timestamp === null) {
          throw new Error(`Invalid date for ${key}`);
        }

        post.createdAt = timestamp;

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
