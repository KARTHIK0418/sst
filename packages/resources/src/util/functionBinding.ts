import * as ssm from "aws-cdk-lib/aws-ssm";
import { SSTConstruct } from "../Construct.js";
import { App } from "../App.js";

export const ENVIRONMENT_PLACEHOLDER = "__FETCH_FROM_SSM__";

export interface FunctionBindingProps {
  clientPackage: string;
  permissions: Record<string, string[]>;
  variables: Record<string, {
    // environments are used for 2 purposes:
    //  - pass binding values to the function (ie. bucket name)
    //  - pass placeholder value to the function (ie. secret)
    environment: string;
    parameter?: string;
  }>;
}

export function bindEnvironment(c: SSTConstruct) {
  const binding = c.getFunctionBinding();

  const environment: Record<string, string> = {};
  if (binding) {
    Object.entries(binding.variables).forEach(([prop, variable]) => {
      const envName = getEnvironmentKey(c, prop);
      environment[envName] = variable.environment;
    });
  }

  return environment;
}

export function bindParameters(c: SSTConstruct) {
  const binding = c.getFunctionBinding();
  if (!binding) { return; }

  const app = c.node.root as App;
  Object.entries(binding.variables)
    .filter(([, variable]) => variable.parameter)
    .forEach(([prop, variable]) => {
      const resId = `Parameter_${prop}`;
      if (!c.node.tryFindChild(resId)) {
        new ssm.StringParameter(c, resId, {
          // Parameters, Secrets, and Jobs do not have a name
          parameterName: getParameterPath(c, prop),
          stringValue: variable.parameter!,
        });
      }
    });
}

export function bindPermissions(c: SSTConstruct) {
  return c.getFunctionBinding()?.permissions || {};
}

export function bindType(c: SSTConstruct) {
  const binding = c.getFunctionBinding();
  if (!binding) { return; }

  return {
    clientPackage: binding.clientPackage,
    variables: Object.keys(binding.variables),
  };
}

export function getEnvironmentKey(c: SSTConstruct, prop: string): string {
  return `SST_${c.constructor.name}_${prop}_${c.id}`;
}

export function getParameterPath(c: SSTConstruct, prop: string): string {
  const app = c.node.root as App;
  const construct = c.constructor.name;
  return construct === "Secret"
    ? `/sst/${app.name}/${app.stage}/secrets/${c.id}`
    : `/sst/${app.name}/${app.stage}/${construct}/${c.id}/${prop}`;
}

export function getParameterFallbackPath(c: SSTConstruct, prop: string): string {
  const app = c.node.root as App;
  const construct = c.constructor.name;
  return construct === "Secret"
    ? `/sst/${app.name}/.fallback/secrets/${c.id}`
    : `/sst/${app.name}/.fallback/${construct}/${c.id}/${prop}`;
}