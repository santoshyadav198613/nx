import {
  apply,
  branchAndMerge,
  chain,
  mergeWith,
  move,
  Rule,
  SchematicContext,
  template,
  Tree,
  url
} from '@angular-devkit/schematics';
import { getProjectConfig, updateJsonInTree, updateProjectConfig } from '@nrwl/schematics/src/utils/ast-utils';
import { join } from 'path';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';

function generateFiles(schema: any): Rule {
  return (host: Tree) => {
    const project = getProjectConfig(host, schema.project);
    const templateSource = apply(
      url('./files'),
      [
        template(schema),
        move(join(project.sourceRoot, 'azure', schema.environment))
      ]
    );
    return mergeWith(templateSource);
  };
}

function registerBuilder(schema: any): Rule {
  return (host: Tree, context: SchematicContext) => {
    const project = getProjectConfig(host, schema.project);

    const newEnvFile = `${project.sourceRoot}/environments/environment.${schema.environment}.ts`;
    project.architect.build.configurations[schema.environment] = {
      fileReplacements: [
        {
          "replace": `${project.sourceRoot}/environments/environment.ts`,
          "with": newEnvFile
        }
      ],
      "externalDependencies": "none"
    };

    host.create(newEnvFile, `export const environment = {
  production: true
};`);

    project.architect.serve.configurations = {
      [schema.environment]: {
        "buildTarget": `${schema.project}:build:${schema.environment}`,
        "waitUntilTargets": []
      }
    };

    project.architect.deploy = {
      'builder': '@nrwl/azure:deploy',
      'options': {
        "buildTarget": `${schema.project}:build:${schema.environment}`,
        "frontendBuildTarget": `${schema.frontendProject}:build:production`
      },
      'configurations': {
        [schema.environment]: {
          'azureWebAppName': schema.azureWebAppName,
          'deployment': {
            type: 'git',
            remote: `https://${schema.azureWebAppName}.scm.azurewebsites.net:443/${schema.azureWebAppName}.git`
          }
        }
      }
    };
    updateProjectConfig(schema.project, project)(host, context);
  };
}

function addDependencies(): Rule {
  return chain([
    updateJsonInTree('package.json', json => {
      json.dependencies = json.dependencies || {};
      json.dependencies['shelljs'] = '0.8.3';
      return json;
    }),
    addInstall
  ]);
}

function addInstall(host: Tree, context: SchematicContext) {
  context.addTask(new NodePackageInstallTask());
  return host;
}

export default function(schema: any): Rule {
  return chain([
    branchAndMerge(chain([
      generateFiles(schema),
      registerBuilder(schema),
      addDependencies()
    ]))
  ]);
}
