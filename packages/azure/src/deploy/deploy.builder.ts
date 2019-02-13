import { Builder, BuilderConfiguration, BuilderContext, BuildEvent } from '@angular-devkit/architect';
import { Observable } from 'rxjs';
import { concatMap, first, tap } from 'rxjs/operators';
import { BuildNodeBuilderOptions, NodeBuildEvent } from '../../../builders/src/node/build/node-build.builder';
import { dirSync } from 'tmp';
import { execSync } from 'child_process';
import { basename, join } from 'path';
import { readdirSync, readFileSync, writeFileSync } from 'fs';

const shell = require('shelljs');

try {
  require('dotenv').config();
} catch (e) {
}

export interface DeployArgs {
  buildTarget: string;
  frontendBuildTarget: string;
  azureWebAppName: string;
  create: boolean;
  deployment: {
    type: 'git' | 'zip',
    remote: string
  }
}

export default class DeployBuilder implements Builder<DeployArgs> {

  constructor(private context: BuilderContext) {
  }

  run(
    builderConfig: BuilderConfiguration<DeployArgs>
  ): Observable<BuildEvent> {
    const { backendBuildConfig, backend } = this.buildBackend(builderConfig);
    const { frontendBuildConfig, frontend } = this.buildFrontend(builderConfig);

    return backend.pipe(
      concatMap((r: any) => !r.success ? r : frontend),
      tap((r: any) => {
        if (r.success) {
          if (builderConfig.options.create) {
            this.createApp(builderConfig);
          }

          console.log('Deploying to Azure...');
          const tmpWithProject = this.createTmpDirectory(backendBuildConfig);
          console.log(`Release folder ${tmpWithProject}`);
          this.patchMainJsToReplaceEnvVariables(tmpWithProject);
          this.copyAzureAssets(backendBuildConfig, tmpWithProject);
          this.copyFrontend(frontendBuildConfig, tmpWithProject);

          this.gitPush(tmpWithProject, builderConfig);
          const hostname = this.getHostName(builderConfig);
          console.log(`You can access the deployed app at: https://${hostname}`);
        }
      })
    );
  }

  private getHostName(builderConfig: BuilderConfiguration<DeployArgs>) {
    const apps = JSON.parse(execSync(`az webapp list`).toString());
    const app = apps.find(f => f.name === builderConfig.options.azureWebAppName);
    return app.hostNames[0];
  }

  private gitPush(tmpWithProject: string, builderConfig: BuilderConfiguration<DeployArgs>) {
    execSync(`git init`, { cwd: tmpWithProject });
    execSync(`git add .`, { cwd: tmpWithProject });
    execSync(`git commit -am 'init'`, { cwd: tmpWithProject });
    execSync(`git remote add azure ${builderConfig.options.deployment.remote}`, { cwd: tmpWithProject });
    execSync(`git push --force azure master`, { cwd: tmpWithProject, stdio: [0, 1, 2] });
  }

  private buildFrontend(builderConfig: BuilderConfiguration<DeployArgs>) {
    const [frontendProject, frontendTarget, frontendConfiguration] = builderConfig.options.frontendBuildTarget.split(':');
    const frontendBuildConfig = this.context.architect.getBuilderConfiguration<BuildNodeBuilderOptions>({
      project: frontendProject,
      target: frontendTarget,
      configuration: frontendConfiguration
    });

    const frontend = this.context.architect.getBuilderDescription(frontendBuildConfig).pipe(
      concatMap(buildDescription =>
        this.context.architect.validateBuilderOptions(
          frontendBuildConfig,
          buildDescription
        )
      ),
      concatMap(
        builderConfig =>
          this.context.architect.run(builderConfig, this.context) as Observable<NodeBuildEvent>
      ),
      first()
    );
    return { frontendBuildConfig, frontend };
  }

  private buildBackend(builderConfig: BuilderConfiguration<DeployArgs>) {
    const [backendProject, backendTarget, backendConfiguration] = builderConfig.options.buildTarget.split(':');
    const backendBuildConfig = this.context.architect.getBuilderConfiguration<BuildNodeBuilderOptions>({
      project: backendProject,
      target: backendTarget,
      configuration: backendConfiguration
    });
    const backend = this.context.architect.getBuilderDescription(backendBuildConfig).pipe(
      concatMap(buildDescription =>
        this.context.architect.validateBuilderOptions(
          backendBuildConfig,
          buildDescription
        )
      ),
      concatMap(
        builderConfig =>
          this.context.architect.run(builderConfig, this.context) as Observable<NodeBuildEvent>
      ),
      first()
    );
    return { backendBuildConfig, backend };
  }

  private copyAzureAssets(buildBuilderConfig: any, tmpWithProject: string) {
    const dir = readdirSync(join(buildBuilderConfig.sourceRoot, 'azure'))[0];
    shell.cp('-R', `${join(buildBuilderConfig.sourceRoot, 'azure', dir)}/*.*`, tmpWithProject);
  }

  private copyFrontend(buildBuilderConfig: any, tmpWithProject: string) {
    shell.cp('-R', `${buildBuilderConfig.options.outputPath}`, `${tmpWithProject}/public`);
  }

  private createTmpDirectory(buildBuilderConfig: any) {
    const tmp = dirSync().name;
    const projectFolder = basename(buildBuilderConfig.options.outputPath);
    const tmpWithProject = join(tmp, projectFolder);
    shell.cp('-R', buildBuilderConfig.options.outputPath, tmp);
    return tmpWithProject;
  }

  private patchMainJsToReplaceEnvVariables(tmpWithProject: string) {
    let mainJs = readFileSync(join(tmpWithProject, 'main.js')).toString();
    Object.keys(process.env).forEach(k => {
      if (k.startsWith('AZURE_MONGODB')) {
        mainJs = mainJs.replace(`process.env.${k}`, `'${process.env[k]}'`);
      }
    });
    writeFileSync(join(tmpWithProject, 'main.js'), mainJs);
  }

  private createApp(builderConfig: BuilderConfiguration<DeployArgs>) {
    const resource = JSON.parse(execSync(`az appservice plan list`).toString())[0];
    const plan = resource.name;
    const resourceGroup = resource.resourceGroup;
    const runtime = `node|10.6`;

    console.log('Creating a new webapp on Azure');
    execSync(`az webapp create --name=${builderConfig.options.azureWebAppName} --plan=${plan} --resource-group=${resourceGroup} --runtime='${runtime}' --deployment-local-git`, { stdio: [0, 1, 2] });

    console.log('Successfully create a new app on Azure');
  }
}
