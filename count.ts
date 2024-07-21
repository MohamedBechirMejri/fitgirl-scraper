import * as fs from "fs/promises";

function main() {
  fs.readFile("scraped_data.json", "utf-8")
    .then(data => {
      const posts = JSON.parse(data);
      console.log(Object.keys(posts).length);
    })
    .catch(error => {
      console.error(error);
    });
}

main();
