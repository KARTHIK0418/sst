import { green, yellow } from "colorette";
import fs from "fs/promises";
import path from "path";
import { Program } from "../program.js";

const PACKAGE_MATCH = ["sst", "aws-cdk", "@aws-cdk"];

const FIELDS = ["dependencies", "devDependencies"];

export const update = (program: Program) =>
  program.command(
    "update [ver]",
    "Update SST and CDK packages to another version",
    (yargs) =>
      yargs.positional("ver", {
        type: "string",
        describe: "Optional SST version to update to",
      }),
    async (args) => {
      const { fetch } = await import("undici");
      const { useProject } = await import("../../app.js");

      const project = useProject();
      const files = await find(project.paths.root);
      const metadata: any = await fetch(
        `https://registry.npmjs.org/sst/${args.ver || "latest"}`
      ).then((resp) => resp.json());

      const results = new Map<string, Set<[string, string]>>();
      const tasks = files.map(async (file) => {
        const data = await fs
          .readFile(file)
          .then((x) => x.toString())
          .then(JSON.parse);

        for (const field of FIELDS) {
          const deps = data[field];
          if (!deps) continue;
          for (const [pkg, existing] of Object.entries(deps)) {
            if (!PACKAGE_MATCH.some((x) => pkg.startsWith(x))) continue;
            const desired = (() => {
              if (pkg === "sst") return metadata.version;
              if (pkg.endsWith("alpha"))
                return metadata.dependencies["@aws-cdk/aws-apigatewayv2-alpha"];
              return metadata.dependencies["aws-cdk-lib"];
            })();
            if (existing === desired) continue;
            let arr = results.get(file);
            if (!arr) {
              arr = new Set();
              results.set(file, arr);
            }
            arr.add([pkg, desired]);
            deps[pkg] = desired;
          }
        }

        await fs.writeFile(file, JSON.stringify(data, null, 2));
      });
      await Promise.all(tasks);

      if (results.size === 0) {
        console.log(
          green(`All packages already match version ${metadata.version}`)
        );
        return;
      }

      for (const [file, pkgs] of results.entries()) {
        console.log(green(`✅ ${path.relative(project.paths.root, file)}`));
        for (const [pkg, version] of pkgs) {
          console.log(green(`     ${pkg}@${version}`));
        }
      }

      console.log(
        yellow(
          "Don't forget to run your package manager to install the packages"
        )
      );
    }
  );

async function find(dir: string): Promise<string[]> {
  const children = await fs.readdir(dir);

  const tasks = children.map(async (item) => {
    if (item === "node_modules") return [];
    // Ignore hidden paths
    if (/(^|\/)\.[^\/\.]/g.test(item)) return [];

    const full = path.join(dir, item);
    if (item === "package.json") return [full];

    const stat = await fs.stat(full);
    if (stat.isDirectory()) return find(full);
    return [];
  });

  return (await Promise.all(tasks)).flat();
}
