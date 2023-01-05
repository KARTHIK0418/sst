import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import url from "url";
import os from "os";
import { Logger } from "./logger.js";
import { Context } from "./context/context.js";
import { VisibleError } from "./error.js";
import { blue } from "colorette";
import { dynamicImport } from "./util/module.js";
import dotenv from "dotenv";

export interface Project {
  name: string;
  region: string;
  stage?: string;
  profile?: string;
  main?: string;
  ssmPrefix?: string;
}

const DEFAULTS = {
  main: "stacks/index.ts",
  stage: undefined,
  ssmPrefix: undefined,
} as const;

type ProjectWithDefaults = Project &
  Required<{
    [key in keyof typeof DEFAULTS]: Exclude<Project[key], undefined>;
  }> & {
    version: string;
    paths: {
      root: string;
      out: string;
      artifacts: string;
    };
  };

export const ProjectContext = Context.create<ProjectWithDefaults>();

export function useProject() {
  return ProjectContext.use();
}

const CONFIG_EXTENSIONS = [".config.cjs", ".config.mjs", ".config.js", ".json"];

interface GlobalOptions {
  profile?: string;
  stage?: string;
  root?: string;
  region?: string;
}

export async function initProject(globals: GlobalOptions) {
  const root = globals.root || (await findRoot());
  const out = path.join(root, ".sst");
  await fs.mkdir(out, {
    recursive: true,
  });

  async function load() {
    const base = await (async function () {
      for (const ext of CONFIG_EXTENSIONS) {
        const file = path.join(root, "sst" + ext);
        try {
          await fs.access(file);
        } catch {
          continue;
        }
        if (file.endsWith("js")) {
          const fn = await dynamicImport(file);
          return await fn.default(globals);
        }

        if (file.endsWith(".json")) {
          const data = await fs.readFile(file);
          return Object.assign(
            DEFAULTS,
            JSON.parse(data.toString("utf8"))
          ) as ProjectWithDefaults;
        }
      }

      throw new VisibleError(
        "Could not found a configuration file",
        "Make sure one of the following exists",
        "  - sst.config.cjs",
        "  - sst.config.mjs",
        "  - sst.config.js",
        "  - sst.json"
      );
    })();

    return {
      ...DEFAULTS,
      ...base,
      stage:
        base.stage ||
        globals.stage ||
        (await usePersonalStage(out)) ||
        (await promptPersonalStage(out)),
      profile: base.profile || globals.profile,
      region: base.region || globals.region,
    } as ProjectWithDefaults;
  }
  const project = await load();
  project.ssmPrefix =
    project.ssmPrefix || `/sst/${project.name}/${project.stage}/`;
  project.paths = {
    root,
    out,
    artifacts: path.join(out, "artifacts"),
  };
  try {
    const packageJson = JSON.parse(
      await fs
        .readFile(url.fileURLToPath(new URL("./package.json", import.meta.url)))
        .then((x) => x.toString())
    );
    project.version = packageJson.version;
  } catch {
    project.version = "unknown";
  }

  ProjectContext.provide(project);
  dotenv.config({
    path: path.join(project.paths.root, `.env.${project.stage}`),
  });
  Logger.debug("Config loaded", project);
}

async function usePersonalStage(out: string) {
  try {
    const result = await fs.readFile(path.join(out, "stage"));
    return result.toString("utf8").trim();
  } catch {
    return;
  }
}

async function promptPersonalStage(out: string) {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    const suggested = os.userInfo().username;
    rl.question(
      `Please enter a name you’d like to use for your personal stage. Or hit enter to use ${blue(
        suggested
      )}: `,
      async (input) => {
        rl.close();
        const result = input || suggested;
        await fs.writeFile(path.join(out, "stage"), result);
        resolve(result);
      }
    );
  });
}

async function findRoot() {
  async function find(dir: string): Promise<string> {
    if (dir === "/")
      throw new VisibleError(
        "Could not found a configuration file",
        "Make sure one of the following exists",
        ...CONFIG_EXTENSIONS.map((ext) => `  - sst${ext}`)
      );
    for (const ext of CONFIG_EXTENSIONS) {
      const configPath = path.join(dir, `sst${ext}`);
      if (fsSync.existsSync(configPath)) {
        return dir;
      }
    }
    return await find(path.join(dir, ".."));
  }
  const result = await find(process.cwd());
  return result;
}
