import type {
  AstroConfig,
  RouteData,
  RouteType,
  ValidRedirectStatus,
} from "astro";
import { join, relative } from "path";
import { writeFile } from "fs/promises";
import { fileURLToPath } from "url";

const BUILD_EXPORT_NAME = "sst.buildMeta.json";

type BuildResults = {
  pages: {
    pathname: string;
  }[];
  dir: URL;
  routes: RouteData[];
};

type SerializableRoute = {
  route: string;
  type: RouteType;
  pattern: string;
  prerender: boolean;
  redirectPath?: string;
  redirectStatus?: ValidRedirectStatus;
};

export class BuildMeta {
  protected static astroConfig: AstroConfig;
  protected static buildResults: BuildResults;

  public static setAstroConfig(config: AstroConfig) {
    this.astroConfig = config;
  }

  public static setBuildResults(buildResults: BuildResults) {
    this.buildResults = buildResults;
  }

  private static serializableRoute(route: RouteData): SerializableRoute {
    return {
      route: route.route,
      type: route.type,
      pattern: route.pattern.toString(),
      prerender: route.prerender,
      redirectPath:
        typeof route.redirect === "string"
          ? route.redirect
          : route.redirect?.destination,
      redirectStatus:
        typeof route.redirect === "object" ? route.redirect.status : undefined,
    };
  }

  public static async exportBuildMeta(buildExportName = BUILD_EXPORT_NAME) {
    const rootDir = fileURLToPath(this.astroConfig.root);

    const outputPath = join(
      relative(rootDir, fileURLToPath(this.astroConfig.outDir)),
      buildExportName
    );

    const buildMeta = {
      astroSite: {
        outputMode: this.astroConfig.output,
        pageResolution: this.astroConfig.build.format,
        trailingSlash: this.astroConfig.trailingSlash,
        routes: this.buildResults.routes.map((route) =>
          this.serializableRoute(route)
        ),
      },
    };

    await writeFile(outputPath, JSON.stringify(buildMeta));
  }
}
