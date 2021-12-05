"use strict";

import { join } from "path";
import { appPath } from "./util/paths.js";
import { synth, deploy, writeOutputsFile } from "./util/cdkHelpers.js";
import { STACK_DEPLOY_STATUS } from "@serverless-stack/core";

export default async function (argv, config, cliInfo) {
  // Normalize stack name
  const stackPrefix = `${config.stage}-${config.name}-`;
  let stackName = argv.stack;
  if (stackName) {
    stackName = stackName.startsWith(stackPrefix)
      ? stackName
      : `${stackPrefix}${stackName}`;
  }

  // Run CDK Synth
  await synth(cliInfo.cdkOptions);

  // Run CDK Deploy
  const stacksData = await deploy(cliInfo.cdkOptions, stackName);

  // Write outputsFile
  if (argv.outputsFile) {
    await writeOutputsFile(
      stacksData,
      join(appPath, argv.outputsFile),
      cliInfo.cdkOptions
    );
  }

  // Check all stacks deployed successfully
  if (stacksData.some(({ status }) => status === STACK_DEPLOY_STATUS.FAILED)) {
    throw new Error(`Failed to deploy the app`);
  }

  return stacksData;
}
