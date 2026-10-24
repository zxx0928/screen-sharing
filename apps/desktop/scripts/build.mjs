import { buildOnce } from "./bundle.mjs";

buildOnce().catch((error) => {
  console.error(error);
  process.exit(1);
});
