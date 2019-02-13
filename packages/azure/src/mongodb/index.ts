import { branchAndMerge, chain, Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { getProjectConfig, updateJsonInTree, updateProjectConfig } from '@nrwl/schematics/src/utils/ast-utils';
import { fragment } from '@angular-devkit/core';
import { execSync } from 'child_process';
import { join } from 'path';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';

function getDbConfigEnvName(schema: any): string {
  const env = schema.envName ? schema.envName.toUpperCase() : 'DEV';
  return `AZURE_MONGODB_${env}_${schema.project.toUpperCase()}_${schema.azureDbName.toUpperCase()}`;
}

function updateDotEnvFile(schema: any): Rule {
  return (host: Tree) => {
    const env = host.read('.env');
    const dbInfo = JSON.parse(execSync(`az cosmosdb list`).toString()).find(db => db.name === schema.azureDbName);
    const cs = JSON.parse(execSync(`az cosmosdb list-connection-strings --ids=${dbInfo.id}`).toString()).connectionStrings[0].connectionString;

    const [prefix, suffix] = cs.split('://');
    const [credentials, url] = suffix.split('@');
    const [username, password] = credentials.split(':');
    const encodedCs = `${prefix}://${username}:${encodeURIComponent(password)}@${url}`;

    const dbConfig = `${getDbConfigEnvName(schema)}=${encodedCs}`;
    const newEnv = env && env.length > 0 ? `${env}\n${dbConfig}` : dbConfig;
    if (! env) {
      host.create('.env', newEnv);
    } else {
      host.overwrite('.env', newEnv);
    }
  };
}

function updateEnvFiles(schema: any): Rule {
  return (host: Tree) => {
    const sourceRoot = getProjectConfig(host, schema.project).sourceRoot;
    const dev = host.getDir(`${sourceRoot}/environments`).file(fragment('environment.ts'));
    host.overwrite(dev.path, `
// This file can be replaced during build by using the \`fileReplacements\` array.
// \`ng build ---prod\` replaces \`environment.ts\` with \`environment.prod.ts\`.
// The list of file replacements can be found in \`angular.json\`.

export const environment = {
  production: false,
  mongodb: {
    connectionString: 'mongodb://localhost:27017/devdb'
  }
};
`);

    const prod = host.getDir(`${sourceRoot}/environments`).file(fragment(`environment.${schema.envName}.ts`));
    host.overwrite(prod.path, `
export const environment = {
  production: true,
  mongodb: {
    connectionString: process.env.${getDbConfigEnvName(schema)}
  }
};
`);
  };
}

function updateAppModule(schema: any): Rule {
  return (host: Tree) => {
    const sourceRoot = getProjectConfig(host, schema.project).sourceRoot;
    host.overwrite(join(sourceRoot, 'app', 'app.module.ts'), `
import { Module } from '@nestjs/common';
import { MondoDbModule } from '@nrwl/azure';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { environment } from '../environments/environment';


@Module({
  imports: [
    MondoDbModule.forRoot(environment)
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
    `);
  };
}

function registerDockerMongo(schema: any): Rule {
  return (host: Tree, context: SchematicContext) => {
    const project = getProjectConfig(host, schema.project);
    project.architect.mongodb = {
      'builder': '@nrwl/builders:run-commands',
      'options': {
        commands: [
          { command: 'docker run -d -p 27017:27017 mongo' }
        ]
      }
    };
    project.architect.serve.options.waitUntilTargets = [
      `${schema.project}:mongodb`
    ];
    updateProjectConfig(schema.project, project)(host, context);
  };
}

function addDependencies(): Rule {
  return chain([
    updateJsonInTree('package.json', json => {
      json.dependencies['mongodb'] = '3.1.13';
      json.devDependencies = json.devDependencies || {};
      json.devDependencies['shelljs'] = '0.8.3';
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
      updateDotEnvFile(schema),
      updateEnvFiles(schema),
      updateAppModule(schema),
      registerDockerMongo(schema),
      addDependencies()
    ]))
  ]);
}
