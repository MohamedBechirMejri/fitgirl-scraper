import * as fs from "fs/promises";

function main() {
  fs.readFile("scraped_data.json", "utf-8")
    .then(data => {
      const posts = JSON.parse(data);

      const keys = Object.keys(posts);

      for (const key of keys) {
        const post = posts[key];

        const { "Genres/Tags": genres } = post.info;

        if (!genres) {
          continue;
        }

        const genresArray = genres.split(", ");

        console.log(genres);
        console.log(genresArray);

        post.info.genres = genresArray;
        delete post.info["Genres/Tags"];

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
