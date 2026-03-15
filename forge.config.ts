import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { PublisherGithub } from "@electron-forge/publisher-github";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "NIOM",
    executableName: "niom",
    icon: "./assets/icon",
    appBundleId: "com.openicipher.niom",
    appCategoryType: "public.app-category.developer-tools",
    // macOS notarization (requires APPLE_ID + APPLE_PASSWORD env vars)
    ...(process.env.APPLE_ID
      ? {
          osxSign: {},
          osxNotarize: {
            appleId: process.env.APPLE_ID!,
            appleIdPassword: process.env.APPLE_PASSWORD!,
            teamId: process.env.APPLE_TEAM_ID!,
          },
        }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    // macOS — DMG + ZIP (ZIP needed for auto-update)
    new MakerDMG({
      format: "ULFO",
      icon: "./assets/icon.icns",
    }),
    new MakerZIP({}, ["darwin"]),
    // Windows — Squirrel
    new MakerSquirrel({
      name: "niom",
      setupIcon: "./assets/icon.ico",
    }),
    // Linux — DEB + RPM
    new MakerDeb({
      options: {
        name: "niom",
        productName: "NIOM",
        genericName: "AI Agent",
        description: "Local-first AI agent that learns, remembers, and grows.",
        categories: ["Development", "Utility"],
        icon: "./assets/icon.png",
      },
    }),
    new MakerRpm({
      options: {
        name: "niom",
        productName: "NIOM",
        genericName: "AI Agent",
        description: "Local-first AI agent that learns, remembers, and grows.",
        categories: ["Development", "Utility"],
        icon: "./assets/icon.png",
      },
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "niomstack",
        name: "niom",
      },
      prerelease: false,
      draft: false,
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./src/index.html",
            js: "./src/renderer.tsx",
            name: "main_window",
            preload: {
              js: "./src/preload.ts",
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
