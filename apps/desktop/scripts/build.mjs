import { buildOnce } from "./bundle.mjs";
import { ensureNativeAddon } from "./build-native.mjs";

ensureNativeAddon();
buildOnce().catch((error) => {
  console.error(error);
  process.exit(1);
});
